const { containerFor, containerNames, queryAll, removeById, upsert } = require('../src/cosmosStore');
const { correlationId, makeHash, nowIso } = require('../src/http');

const actor = 'system';

const json = (context, status, body) => {
  context.res = {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    },
    body
  };
};

const error = (context, status, code, message, targetPath) => {
  json(context, status, {
    code,
    message,
    severity: 'error',
    retryable: status >= 500,
    targetPath,
    correlationId: correlationId()
  });
};

const readBody = (req) => {
  if (typeof req.body === 'string') {
    return JSON.parse(req.body);
  }

  return req.body || {};
};

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

const routes = {
  'GET cosmos/health': async (_req, context) => {
    const checked = [];
    for (const logicalName of Object.keys(containerNames)) {
      const { partitionPath } = await containerFor(logicalName);
      checked.push({
        logicalName,
        containerName: containerNames[logicalName],
        partitionPath
      });
    }

    json(context, 200, {
      status: 'ok',
      checkedAt: nowIso(),
      containers: checked
    });
  },

  'GET fabric-connections': async (_req, context) => {
    json(context, 200, await listConnections());
  },

  'GET fabric-connections/active': async (_req, context) => {
    const records = await queryAll('fabricConnections', {
      query: 'SELECT * FROM c WHERE c.isActive = true AND c.status = "ready" ORDER BY c.updatedAt DESC'
    });
    json(context, 200, records[0] ? sanitize(records[0]) : null);
  },

  'POST fabric-connections/test': async (req, context) => {
    const draft = readBody(req);
    validateDraft(draft);

    json(context, 200, {
      status: 'ready',
      message: 'Fabric GraphQL endpoint の設定値を確認しました。実疎通はFabric認証実装後に有効化します。',
      testedAt: nowIso(),
      queryTypeName: 'Query',
      correlationId: correlationId()
    });
  },

  'POST fabric-connections': async (req, context) => {
    const draft = readBody(req);
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

    json(context, 200, sanitize(saved));
  },

  'POST mappings/save': async (req, context) => {
    const mapping = readBody(req);
    const saved = await upsert('semanticMappings', {
      ...mapping,
      partitionKey: mapping.datasetId || 'default',
      version: Number(mapping.version || 0) + 1,
      updatedAt: nowIso(),
      updatedBy: actor
    });

    json(context, 200, saved);
  },

  'POST analysis/start': async (req, context) => {
    const { mappingDocumentId, config } = readBody(req);
    const now = nowIso();
    const runId = `run-${makeHash({ mappingDocumentId, config })}`;
    const analysisJobId = `job-${makeHash({ runId, now })}`;
    const estimatedDurationSeconds = config?.mode === 'autopilot' ? 600 : 240;

    await upsert('analysisRuns', {
      id: analysisJobId,
      partitionKey: mappingDocumentId || 'default',
      datasetId: 'unknown',
      mappingDocumentId,
      mode: config?.mode || 'custom',
      config,
      configHash: makeHash(config),
      status: 'queued',
      estimatedDurationSeconds,
      createdAt: now,
      createdBy: actor,
      updatedAt: now
    });

    json(context, 200, {
      analysisJobId,
      runId,
      status: 'queued',
      startedAt: now,
      estimatedDurationSeconds
    });
  },

  'POST analysis-results': async (req, context) => {
    const result = readBody(req);
    const saved = await upsert('analysisResults', {
      ...result,
      id: result.id || result.analysisJobId,
      partitionKey: result.analysisJobId || 'default',
      updatedAt: nowIso()
    });

    json(context, 200, saved);
  },

  'POST segments/prepare': async (req, context) => {
    const contextBody = readBody(req);
    await upsert('segments', {
      id: `segment-selection-${contextBody.analysisJobId}`,
      partitionKey: contextBody.analysisJobId || 'default',
      kind: 'selectedSegmentContext',
      ...contextBody,
      updatedAt: nowIso()
    });

    json(context, 200, contextBody);
  },

  'POST segments/save': async (req, context) => {
    const { draft, result } = readBody(req);
    const now = nowIso();
    const savedDraft = await upsert('segments', {
      ...draft,
      id: draft.id,
      partitionKey: draft.analysisJobId || 'default',
      kind: 'segmentDraft',
      status: draft.outputConfig?.executionTiming === 'now' ? 'executed' : 'saved',
      updatedAt: now
    });

    const saveResult = result || {
      segmentId: `segment-${makeHash(savedDraft)}`,
      segmentExecutionId: draft.outputConfig?.executionTiming === 'now' ? `segment-exec-${makeHash({ id: draft.id, now })}` : undefined,
      status: draft.outputConfig?.executionTiming === 'now' ? 'queued' : 'saved',
      outputTypes: draft.outputConfig?.outputs || [],
      outputLocation: 'segment_outputs.high_value_active',
      affectedRowCount: draft.previewSummary?.estimatedAudienceSize,
      executedBy: actor,
      savedAt: now
    };

    await upsert('segments', {
      id: saveResult.segmentExecutionId || saveResult.segmentId,
      partitionKey: draft.analysisJobId || 'default',
      kind: 'segmentSaveResult',
      ...saveResult,
      updatedAt: now
    });

    json(context, 200, saveResult);
  }
};

module.exports = async function (context, req) {
  const route = (req.params.route || '').replace(/^\/+|\/+$/g, '');
  const key = `${req.method.toUpperCase()} ${route}`;

  try {
    const deleteMatch = route.match(/^fabric-connections\/([^/]+)$/);
    if (req.method.toUpperCase() === 'DELETE' && deleteMatch) {
      const deleted = await removeById('fabricConnections', decodeURIComponent(deleteMatch[1]));
      if (!deleted) {
        error(context, 404, 'CONNECTION.NOT_FOUND', '削除対象の接続設定が見つかりません。');
        return;
      }

      const remaining = await listConnections();
      if (remaining.length > 0 && !remaining.some((connection) => connection.isActive)) {
        await upsert('fabricConnections', { ...remaining[0], isActive: true, partitionKey: remaining[0].tenantId || 'default' });
      }

      json(context, 200, await listConnections());
      return;
    }

    const resultMatch = route.match(/^analysis-results\/([^/]+)$/);
    if (req.method.toUpperCase() === 'GET' && resultMatch) {
      const records = await queryAll('analysisResults', {
        query: 'SELECT * FROM c WHERE c.analysisJobId = @analysisJobId ORDER BY c.updatedAt DESC',
        parameters: [{ name: '@analysisJobId', value: decodeURIComponent(resultMatch[1]) }]
      });

      if (!records[0]) {
        json(context, 404, null);
        return;
      }

      json(context, 200, records[0]);
      return;
    }

    const handler = routes[key];
    if (!handler) {
      error(context, 404, 'API.NOT_FOUND', `API route not found: ${key}`);
      return;
    }

    await handler(req, context);
  } catch (err) {
    context.log.error(err);
    error(context, err.status || err.statusCode || 500, err.code || 'SERVER.ERROR', err.message || 'API request failed.');
  }
};
