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

  return {
    dataset: {
      id: datasetId,
      name: apiName,
      displayName: `${connection.displayName} (${apiName})`,
      workspaceId: connection.workspaceId || 'workspace未指定',
      workspaceName: connection.workspaceId ? `Workspace ${connection.workspaceId}` : connection.displayName,
      description: `Fabric GraphQL endpoint から取得したQueryスキーマです。`,
      tags: ['Fabric', 'GraphQL', '実接続'],
      tableCount: fields.length,
      lastSyncedAt: new Date().toISOString(),
      connectionStatus: 'ready',
      recommended: fields.length > 0,
      recommendationScore: fields.length > 0 ? 90 : 40,
      recommendationReasons: [
        'Fabric GraphQL endpoint への実接続に成功しました',
        `${fields.length} 件のQueryフィールドを検出しました`
      ],
      recentlyUsed: true,
      warningCodes: []
    },
    preview: {
      datasetId,
      ownerName: connection.displayName,
      rowEstimate: undefined,
      columnCount: fields.length,
      primaryKeyCandidateCount: 0,
      timestampColumnCount: fields.filter((field) => /date|time|timestamp/i.test(field.name)).length,
      sampleAvailable: false,
      topTables: fields.map((field) => ({
        tableId: `query-${field.name}`,
        tableName: field.name,
        suggestedRole: 'unknown',
        typeName: typeName(field.type)
      })),
      warnings: fields.length === 0
        ? [{ code: 'LOW_TABLE_COUNT', severity: 'warning', message: 'Queryフィールドを検出できませんでした。Fabric側の公開設定を確認してください。' }]
        : []
    }
  };
};

module.exports = {
  buildDataset,
  executeFabricGraphql,
  getActiveConnection,
  getBearerToken,
  getGraphqlApiName,
  introspectFabric
};
