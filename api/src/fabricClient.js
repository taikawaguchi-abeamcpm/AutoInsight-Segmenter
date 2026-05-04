const FABRIC_SCOPE = 'https://api.fabric.microsoft.com/.default';
const FABRIC_GRAPHQL_TIMEOUT_MS = Number(process.env.FABRIC_GRAPHQL_TIMEOUT_MS || 30000);
const ROW_COUNT_PAGE_SIZE = Number(process.env.FABRIC_ROW_COUNT_PAGE_SIZE || 1000);
const ROW_COUNT_MAX_PAGES = Number(process.env.FABRIC_ROW_COUNT_MAX_PAGES || 1000);
const ANALYSIS_PAGE_SIZE = Number(process.env.FABRIC_ANALYSIS_PAGE_SIZE || 500);
const ANALYSIS_MAX_ROWS = Number(process.env.FABRIC_ANALYSIS_MAX_ROWS || 5000);

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

const resolveStoredClientSecret = async (connection) => {
  if (connection.clientSecret) {
    return connection.clientSecret;
  }

  if (!connection.id && !connection.endpointUrl) {
    return undefined;
  }

  try {
    const { queryAll } = require('./cosmosStore');
    const records = connection.id
      ? await queryAll('fabricConnections', {
          query: 'SELECT * FROM c WHERE c.id = @id',
          parameters: [{ name: '@id', value: connection.id }]
        })
      : [];
    const matchedById = records.find((record) => record.clientSecret);
    if (matchedById?.clientSecret) {
      return matchedById.clientSecret;
    }

    const matches = await queryAll('fabricConnections', {
      query: 'SELECT * FROM c WHERE c.endpointUrl = @endpointUrl AND c.tenantId = @tenantId',
      parameters: [
        { name: '@endpointUrl', value: connection.endpointUrl },
        { name: '@tenantId', value: connection.tenantId }
      ]
    });
    return matches.find((record) => record.clientSecret)?.clientSecret;
  } catch {
    return undefined;
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

  const clientSecret = await resolveStoredClientSecret(connection);
  if (!clientSecret) {
    throw Object.assign(new Error('Service principal方式ではClient Secretがサーバー側に保存されている必要があります。'), {
      status: 400,
      code: 'FABRIC.SECRET_NOT_CONFIGURED'
    });
  }

  const tokenEndpoint = `https://login.microsoftonline.com/${encodeURIComponent(connection.tenantId)}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: connection.clientId,
    client_secret: clientSecret,
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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FABRIC_GRAPHQL_TIMEOUT_MS);
  let response;

  try {
    response = await fetch(connection.endpointUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal
    });
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw Object.assign(new Error('Fabric GraphQL request timed out.'), {
        status: 504,
        code: 'FABRIC.GRAPHQL_TIMEOUT'
      });
    }

    throw err;
  } finally {
    clearTimeout(timeout);
  }

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
            args {
              name
              defaultValue
              type {
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

const isNonNullType = (type) => type?.kind === 'NON_NULL';

const fieldArguments = (field, { first, after } = {}) => {
  const availableArgs = new Set((field?.args || []).map((arg) => arg.name));
  const args = [];
  if (typeof first === 'number' && availableArgs.has('first')) {
    args.push(`first: ${first}`);
  }
  if (after && availableArgs.has('after')) {
    args.push(`after: ${JSON.stringify(after)}`);
  }

  return args.length ? `(${args.join(', ')})` : '';
};

const hasUnsupportedRequiredArgs = (field) =>
  (field.args || []).some((arg) => isNonNullType(arg.type) && arg.defaultValue == null && !['first', 'after'].includes(arg.name));

const rowCountTotalSource = (field, objectTypes) => {
  if (hasUnsupportedRequiredArgs(field)) {
    return null;
  }

  const connectionType = objectTypes.get(unwrapNamedType(field.type));
  const totalCountField = findField(connectionType, 'totalCount');
  if (!totalCountField) {
    return null;
  }

  return connectionType;
};

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

const rowCountPageSource = (field, objectTypes) => {
  if (hasUnsupportedRequiredArgs(field)) {
    return null;
  }

  const connectionType = objectTypes.get(unwrapNamedType(field.type));
  const itemsField = findField(connectionType, 'items');
  if (!itemsField || !isListType(itemsField.type)) {
    return null;
  }

  const rowType = objectTypes.get(unwrapNamedType(itemsField.type));
  const selector = (rowType?.fields || []).filter(isBusinessColumn)[0]?.name;
  if (!selector) {
    return null;
  }

  return { selector };
};

const fetchTotalCountHints = async (connection, req, tableFields, objectTypes) => {
  const countableFields = tableFields.filter((field) => rowCountTotalSource(field, objectTypes));
  if (countableFields.length === 0) {
    return new Map();
  }

  const selections = countableFields
    .map((field, index) => `t${index}: ${field.name}${fieldArguments(field, { first: 1 })} { totalCount }`)
    .join('\n');

  try {
    const data = await executeFabricGraphql(
      connection,
      req,
      `query AutoInsightRowCounts {
        ${selections}
      }`
    );

    return new Map(
      countableFields.map((field, index) => {
        const value = data?.[`t${index}`]?.totalCount;
        return [field.name, typeof value === 'number' ? value : Number.isFinite(Number(value)) ? Number(value) : undefined];
      })
    );
  } catch {
    return new Map();
  }
};

const fetchPagedRowCount = async (connection, req, field, selector) => {
  let count = 0;
  let after;

  for (let page = 0; page < ROW_COUNT_MAX_PAGES; page += 1) {
    const args = fieldArguments(field, { first: ROW_COUNT_PAGE_SIZE, after });
    const data = await executeFabricGraphql(
      connection,
      req,
      `query AutoInsightPagedRowCount {
        page: ${field.name}${args} {
          items {
            ${selector}
          }
          endCursor
          hasNextPage
        }
      }`
    );
    const result = data?.page;
    const items = Array.isArray(result?.items) ? result.items : [];
    count += items.length;

    if (!result?.hasNextPage || !result?.endCursor || items.length === 0) {
      break;
    }

    after = result.endCursor;
  }

  return count;
};

const fetchRowCounts = async (connection, req, tableFields, objectTypes) => {
  const counts = await fetchTotalCountHints(connection, req, tableFields, objectTypes);
  const missingFields = tableFields.filter((field) => typeof counts.get(field.name) !== 'number');

  for (const field of missingFields) {
    const source = rowCountPageSource(field, objectTypes);
    if (!source) {
      continue;
    }

    try {
      counts.set(field.name, await fetchPagedRowCount(connection, req, field, source.selector));
    } catch {
      // Row count is best-effort. Schema and mapping can still be used without it.
    }
  }

  return counts;
};

const fetchTableRows = async (connection, req, tableName, columnNames, options = {}) => {
  const pageSize = Number(options.pageSize || ANALYSIS_PAGE_SIZE);
  const maxRows = Number(options.maxRows || ANALYSIS_MAX_ROWS);
  const selectedColumns = [...new Set(columnNames)].filter(Boolean);
  if (!tableName || selectedColumns.length === 0) {
    return { rows: [], truncated: false };
  }

  const rows = [];
  let after;
  let truncated = false;

  while (rows.length < maxRows) {
    const remaining = maxRows - rows.length;
    const first = Math.min(pageSize, remaining);
    const args = [`first: ${first}`];
    if (after) {
      args.push(`after: ${JSON.stringify(after)}`);
    }

    const data = await executeFabricGraphql(
      connection,
      req,
      `query AutoInsightAnalysisRows {
        page: ${tableName}(${args.join(', ')}) {
          items {
            ${selectedColumns.join('\n')}
          }
          endCursor
          hasNextPage
        }
      }`
    );

    const result = data?.page;
    const items = Array.isArray(result?.items) ? result.items : [];
    rows.push(...items);

    if (!result?.hasNextPage || !result?.endCursor || items.length === 0) {
      break;
    }

    after = result.endCursor;
    truncated = rows.length >= maxRows;
  }

  return { rows, truncated };
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

const buildFabricDatasetFromSchema = (connection, schema, makeHash, rowCounts = new Map()) => {
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
        rowCount: rowCounts.get(field.name),
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

const buildDataset = async (connection, req, makeHash, options = {}) => {
  const schema = await introspectFabric(connection, req);
  const fields = schema.queryType?.fields || [];
  const objectTypes = new Map((schema.types || []).filter((type) => type.kind === 'OBJECT').map((type) => [type.name, type]));
  const tableFields = fields.filter((field) => isBusinessQueryField(field, objectTypes));
  const rowCounts = options.includeRowCounts === false
    ? new Map()
    : options.rowCountMode === 'totalOnly'
      ? await fetchTotalCountHints(connection, req, tableFields, objectTypes)
      : await fetchRowCounts(connection, req, tableFields, objectTypes);
  const apiName = getGraphqlApiName(connection.endpointUrl);
  const datasetId = `fabric-${makeHash({ endpointUrl: connection.endpointUrl, workspaceId: connection.workspaceId, tenantId: connection.tenantId })}`;
  const fabricDataset = buildFabricDatasetFromSchema(connection, schema, makeHash, rowCounts);
  const hasRowCounts = fabricDataset.tables.some((table) => typeof table.rowCount === 'number');
  const rowEstimate = fabricDataset.tables.reduce(
    (sum, table) => (typeof table.rowCount === 'number' ? sum + table.rowCount : sum),
    0
  );

  return {
    fabricDataset,
    dataset: {
      id: datasetId,
      connectionId: connection.id,
      secretConfigured: Boolean(connection.clientSecret || connection.secretConfigured),
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
      rowEstimate: hasRowCounts ? rowEstimate : undefined,
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
  fetchTableRows,
  getActiveConnection,
  getBearerToken,
  getGraphqlApiName,
  introspectFabric
};
