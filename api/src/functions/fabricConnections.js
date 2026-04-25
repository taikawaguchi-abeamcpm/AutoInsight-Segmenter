const { app } = require('@azure/functions');
const { queryAll, removeById, upsert } = require('../cosmosStore');
const { apiError, correlationId, handle, json, makeHash, nowIso, requireJson } = require('../http');

const actor = 'system';

const sanitize = (connection) => {
  const { clientSecret, ...safe } = connection;
  return safe;
};

const validateDraft = (draft) => {
  if (!draft.displayName?.trim()) {
    throw Object.assign(new Error('接続名を入力してください。'), {
      status: 400,
      code: 'VALIDATION.DISPLAY_NAME_REQUIRED'
    });
  }

  if (!draft.endpointUrl?.startsWith('https://')) {
    throw Object.assign(new Error('Fabric GraphQL endpoint は https:// で始まるURLを入力してください。'), {
      status: 400,
      code: 'VALIDATION.ENDPOINT_URL_INVALID'
    });
  }

  if (!draft.tenantId?.trim() || !draft.clientId?.trim()) {
    throw Object.assign(new Error('Tenant ID と Client ID を入力してください。'), {
      status: 400,
      code: 'VALIDATION.AUTH_REQUIRED'
    });
  }

  if (draft.authMode === 'service_principal' && !draft.clientSecret?.trim()) {
    throw Object.assign(new Error('Service principal 方式では Client Secret の登録が必要です。'), {
      status: 400,
      code: 'VALIDATION.SECRET_REQUIRED'
    });
  }
};

const listConnections = async () => {
  const records = await queryAll('fabricConnections', {
    query: 'SELECT * FROM c ORDER BY c.updatedAt DESC'
  });
  return records.map(sanitize);
};

app.http('listFabricConnections', {
  route: 'fabric-connections',
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async (_request, context) => handle(context, async () => json(await listConnections()))
});

app.http('activeFabricConnection', {
  route: 'fabric-connections/active',
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async (_request, context) => handle(context, async () => {
    const records = await queryAll('fabricConnections', {
      query: 'SELECT * FROM c WHERE c.isActive = true AND c.status = "ready" ORDER BY c.updatedAt DESC'
    });
    return json(records[0] ? sanitize(records[0]) : null);
  })
});

app.http('testFabricConnection', {
  route: 'fabric-connections/test',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (request, context) => handle(context, async () => {
    const draft = await requireJson(request);
    validateDraft(draft);

    return json({
      status: 'ready',
      message: 'Fabric GraphQL endpoint の設定値を確認しました。実疎通はFabric認証実装後に有効化します。',
      testedAt: nowIso(),
      queryTypeName: 'Query',
      correlationId: correlationId()
    });
  })
});

app.http('saveFabricConnection', {
  route: 'fabric-connections',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (request, context) => handle(context, async () => {
    const draft = await requireJson(request);
    validateDraft(draft);

    const id = `fabric-conn-${makeHash({ endpointUrl: draft.endpointUrl, tenantId: draft.tenantId })}`;
    const now = nowIso();
    const current = await listConnections();
    const existing = current.find((connection) => connection.id === id);

    await Promise.all(
      current
        .filter((connection) => connection.id !== id && connection.isActive)
        .map((connection) => upsert('fabricConnections', { ...connection, isActive: false, partitionKey: connection.tenantId || 'default' }))
    );

    const saved = await upsert('fabricConnections', {
      id,
      partitionKey: draft.tenantId.trim(),
      displayName: draft.displayName.trim(),
      endpointUrl: draft.endpointUrl.trim(),
      tenantId: draft.tenantId.trim(),
      clientId: draft.clientId.trim(),
      authMode: draft.authMode,
      workspaceId: draft.workspaceId?.trim() || undefined,
      schemaVersion: draft.schemaVersion?.trim() || undefined,
      status: 'ready',
      isActive: true,
      secretConfigured: draft.authMode === 'service_principal' ? true : existing?.secretConfigured ?? false,
      lastTestedAt: now,
      lastSuccessAt: now,
      updatedAt: now,
      updatedBy: actor
    });

    return json(sanitize(saved));
  })
});

app.http('deleteFabricConnection', {
  route: 'fabric-connections/{id}',
  methods: ['DELETE'],
  authLevel: 'anonymous',
  handler: async (request, context) => handle(context, async () => {
    const deleted = await removeById('fabricConnections', request.params.id);
    if (!deleted) {
      return apiError('CONNECTION.NOT_FOUND', '削除対象の接続設定が見つかりません。', 404);
    }

    const remaining = await listConnections();
    if (remaining.length > 0 && !remaining.some((connection) => connection.isActive)) {
      await upsert('fabricConnections', { ...remaining[0], isActive: true, partitionKey: remaining[0].tenantId || 'default' });
    }

    return json(await listConnections());
  })
});
