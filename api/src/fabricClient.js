const FABRIC_SCOPE = 'https://api.fabric.microsoft.com/.default';

const getGraphqlApiName = (endpointUrl) => {
  try {
    const url = new URL(endpointUrl);
    const segments = url.pathname.split('/').filter(Boolean);
    const apiIndex = segments.findIndex((segment) => segment.toLowerCase() === 'graphqlapis');
    return apiIndex >= 0 && segments[apiIndex + 1] ? segments[apiIndex + 1] : 'fabric-graphql';
  } catch {
    return 'fabric-graphql';
  }
};

const getBearerToken = async (connection, req) => {
  const authorization = req.headers?.authorization || req.headers?.Authorization;
  if (connection.authMode === 'obo') {
    const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) {
      throw Object.assign(
        new Error('OBO方式ではユーザーのFabricアクセストークンが必要です。現状の匿名SWAではService principal方式を使用してください。'),
        { status: 400, code: 'FABRIC.OBO_TOKEN_REQUIRED' }
      );
    }

    return token;
  }

  if (!connection.clientSecret) {
    throw Object.assign(new Error('Service principal方式ではClient Secretがサーバー側に保存されている必要があります。'), {
      status: 400,
      code: 'FABRIC.SECRET_NOT_CONFIGURED'
    });
  }

  const tokenEndpoint = `https://login.microsoftonline.com/${encodeURIComponent(connection.tenantId)}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: connection.clientId,
    client_secret: connection.clientSecret,
    grant_type: 'client_credentials',
    scope: FABRIC_SCOPE
  });

  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw Object.assign(new Error(payload.error_description || payload.error || 'Fabric access token could not be acquired.'), {
      status: response.status || 502,
      code: 'FABRIC.TOKEN_FAILED'
    });
  }

  return payload.access_token;
};

const executeFabricGraphql = async (connection, req, query, variables) => {
  const token = await getBearerToken(connection, req);
  const response = await fetch(connection.endpointUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query, variables })
  });

  const payload = await response.json().catch(async () => ({ raw: await response.text().catch(() => '') }));
  if (!response.ok || payload.errors?.length) {
    const message = payload.errors?.map((item) => item.message).join(' / ') || payload.raw || response.statusText;
    throw Object.assign(new Error(message || 'Fabric GraphQL request failed.'), {
      status: response.status || 502,
      code: 'FABRIC.GRAPHQL_FAILED'
    });
  }

  return payload.data;
};

const introspectFabric = async (connection, req) => {
  const data = await executeFabricGraphql(
    connection,
    req,
    `query AutoInsightSchema {
      __schema {
        queryType {
          name
          fields {
            name
            type {
              kind
              name
              ofType {
                kind
                name
                ofType {
                  kind
                  name
                  ofType {
                    kind
                    name
                    ofType {
                      kind
                      name
                    }
                  }
                }
              }
            }
          }
        }
        types {
          kind
          name
          fields {
            name
            type {
              kind
              name
              ofType {
                kind
                name
                ofType {
                  kind
                  name
                  ofType {
                    kind
                    name
                    ofType {
                      kind
                      name
                    }
                  }
                }
              }
            }
          }
        }
      }
    }`
  );

  return data.__schema;
};

const typeName = (type) => {
  let current = type;
  while (current?.ofType) {
    current = current.ofType;
  }
  return current?.name || current?.kind || 'unknown';
};

const graphTypeName = typeName;

const toFabricDataType = (name) => {
  const value = String(name || '').toLowerCase();
  if (['int', 'integer', 'long', 'short', 'byte'].includes(value)) return 'integer';
  if (['float', 'decimal', 'double', 'single'].includes(value)) return 'float';
  if (['boolean', 'bool'].includes(value)) return 'boolean';
  if (value === 'date') return 'date';
  if (['datetime', 'timestamp', 'datetimeoffset'].includes(value)) return 'datetime';
  if (value.includes('list') || value.includes('array')) return 'array';
  return 'string';
};

const titleize = (value) =>
  String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());

const unwrapNamedType = (type) => {
  let current = type;
  while (current?.ofType) {
    current = current.ofType;
  }
  return current?.name || null;
};

const unwrapTypeRef = (type) => {
  const chain = [];
  let current = type;
  while (current) {
    chain.push(current);
    current = current.ofType;
  }
  return chain;
};

const isListType = (type) => unwrapTypeRef(type).some((item) => item.kind === 'LIST');

const findField = (type, fieldName) => (type?.fields || []).find((field) => field.name === fieldName);

const resolveRowType = (field, objectTypes) => {
  const directType = objectTypes.get(unwrapNamedType(field.type));
  const itemsField = findField(directType, 'items');

  if (itemsField && isListType(itemsField.type)) {
    const itemType = objectTypes.get(unwrapNamedType(itemsField.type));
    if (itemType) {
      return itemType;
    }
  }

  return directType;
};

const isBusinessQueryField = (field, objectTypes) => {
  if (!field?.name || field.name.startsWith('__')) return false;
  const rowType = resolveRowType(field, objectTypes);
  return Boolean(rowType?.fields?.length);
};

const isBusinessColumn = (column) => {
  if (!column?.name || column.name.startsWith('__')) return false;
  if (['items', 'endCursor', 'hasNextPage', 'groupBy', 'nodes', 'edges', 'pageInfo', 'totalCount'].includes(column.name)) {
    return false;
  }

  return !isListType(column.type);
};

const buildFabricDatasetFromSchema = (connection, schema, makeHash) => {
  const fields = schema.queryType?.fields || [];
  const objectTypes = new Map((schema.types || []).filter((type) => type.kind === 'OBJECT').map((type) => [type.name, type]));
  const datasetId = `fabric-${makeHash({ endpointUrl: connection.endpointUrl, workspaceId: connection.workspaceId, tenantId: connection.tenantId })}`;

  const tables = fields
    .filter((field) => isBusinessQueryField(field, objectTypes))
    .map((field) => {
      const objectType = resolveRowType(field, objectTypes);
      const columns = (objectType?.fields || []).filter(isBusinessColumn);
      return {
        id: `tbl-${field.name}`,
        name: field.name,
        displayName: titleize(field.name),
        description: objectType?.name ? `GraphQL type: ${objectType.name}` : undefined,
        columns: columns.map((column) => {
          const columnTypeName = graphTypeName(column.type);
          const lower = column.name.toLowerCase();
          return {
            id: `col-${field.name}-${column.name}`,
            tableId: `tbl-${field.name}`,
            name: column.name,
            displayName: titleize(column.name),
            dataType: toFabricDataType(columnTypeName),
            nullable: column.type?.kind !== 'NON_NULL',
            isPrimaryKey: lower === 'id' || lower.endsWith('_id') || lower.endsWith('id'),
            isForeignKey: lower.endsWith('_id') && lower !== 'id',
            sampleValues: undefined
          };
        })
      };
    });

  return {
    id: datasetId,
    workspaceId: connection.workspaceId || 'workspace未指定',
    name: getGraphqlApiName(connection.endpointUrl),
    displayName: `${connection.displayName} (${getGraphqlApiName(connection.endpointUrl)})`,
    lastSyncedAt: new Date().toISOString(),
    tables
  };
};

const getActiveConnection = async () => {
  const { queryAll } = require('./cosmosStore');
  const records = await queryAll('fabricConnections', {
    query: 'SELECT * FROM c WHERE c.isActive = true AND c.status = "ready" ORDER BY c.updatedAt DESC'
  });
  return records[0] || null;
};

const buildDataset = async (connection, req, makeHash) => {
  const schema = await introspectFabric(connection, req);
  const fields = schema.queryType?.fields || [];
  const apiName = getGraphqlApiName(connection.endpointUrl);
  const datasetId = `fabric-${makeHash({ endpointUrl: connection.endpointUrl, workspaceId: connection.workspaceId, tenantId: connection.tenantId })}`;
  const fabricDataset = buildFabricDatasetFromSchema(connection, schema, makeHash);

  return {
    fabricDataset,
    dataset: {
      id: datasetId,
      name: apiName,
      displayName: `${connection.displayName} (${apiName})`,
      workspaceId: connection.workspaceId || 'workspace未指定',
      workspaceName: connection.workspaceId ? `Workspace ${connection.workspaceId}` : connection.displayName,
      description: `Fabric GraphQL endpoint から取得したQueryスキーマです。`,
      tags: ['Fabric', 'GraphQL', '実接続'],
      tableCount: fabricDataset.tables.length,
      lastSyncedAt: new Date().toISOString(),
      connectionStatus: 'ready',
      recommended: fields.length > 0,
      recommendationScore: fields.length > 0 ? 90 : 40,
      recommendationReasons: [
        'Fabric GraphQL endpoint への実接続に成功しました',
        `${fabricDataset.tables.length} 件のテーブル候補を検出しました`
      ],
      recentlyUsed: true,
      warningCodes: []
    },
    preview: {
      datasetId,
      ownerName: connection.displayName,
      rowEstimate: undefined,
      columnCount: fabricDataset.tables.reduce((sum, table) => sum + table.columns.length, 0),
      primaryKeyCandidateCount: 0,
      timestampColumnCount: fabricDataset.tables.flatMap((table) => table.columns).filter((column) => column.dataType === 'date' || column.dataType === 'datetime' || /date|time|timestamp/i.test(column.name)).length,
      sampleAvailable: false,
      topTables: fabricDataset.tables.map((table) => ({
        tableId: table.id,
        tableName: table.displayName,
        suggestedRole: 'unknown',
        rowCount: table.rowCount
      })),
      warnings: fields.length === 0
        ? [{ code: 'LOW_TABLE_COUNT', severity: 'warning', message: 'Queryフィールドを検出できませんでした。Fabric側の公開設定を確認してください。' }]
        : []
    }
  };
};

module.exports = {
  buildFabricDatasetFromSchema,
  buildDataset,
  executeFabricGraphql,
  getActiveConnection,
  getBearerToken,
  getGraphqlApiName,
  introspectFabric
};
