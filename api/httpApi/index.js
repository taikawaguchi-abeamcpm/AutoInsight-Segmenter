const { buildDataset, introspectFabric, getActiveConnection } = require('../src/fabricClient');
const { correlationId, makeHash, nowIso } = require('../src/http');
const { buildRealAnalysisResult } = require('../src/analysisEngine');
const { buildAnalysisSummary, buildSemanticMapping, normalizeSemanticMapping } = require('../src/semanticModel');

const actor = 'system';

const getStore = () => require('../src/cosmosStore');

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

const validateDraft = (draft, options = {}) => {
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

  if (draft.authMode === 'service_principal' && options.requireSecret && !draft.clientSecret?.trim()) {
    throw Object.assign(new Error('Service principal 方式では Client Secret の登録が必要です。'), {
      status: 400,
      code: 'VALIDATION.SECRET_REQUIRED'
    });
  }
};

const listConnections = async () => {
  const { queryAll } = getStore();
  const records = await queryAll('fabricConnections', {
    query: 'SELECT * FROM c ORDER BY c.updatedAt DESC'
  });
  return records.map(sanitize);
};

const routes = {
  'GET ping': async (_req, context) => {
    json(context, 200, {
      status: 'ok',
      checkedAt: nowIso(),
      runtime: 'node',
      message: 'AutoInsight API is running.'
    });
  },

  'GET cosmos/config': async (_req, context) => {
    json(context, 200, {
      hasCosmosEndpoint: Boolean(process.env.COSMOS_ENDPOINT),
      hasCosmosConnectionString: Boolean(process.env.COSMOS_CONNECTION_STRING),
      hasCosmosKey: Boolean(process.env.COSMOS_KEY),
      databaseName: process.env.COSMOS_DATABASE_NAME || process.env.COSMOS_DATABASE || 'autoinsight',
      containers: {
        fabricConnections: process.env.COSMOS_CONNECTIONS_CONTAINER || 'fabricConnections',
        semanticMappings: process.env.COSMOS_MAPPINGS_CONTAINER || 'semanticMappings',
        analysisRuns: process.env.COSMOS_ANALYSIS_RUNS_CONTAINER || 'analysisRuns',
        analysisResults: process.env.COSMOS_ANALYSIS_RESULTS_CONTAINER || 'analysisResults',
        segments: process.env.COSMOS_SEGMENTS_CONTAINER || 'segments',
        auditLogs: process.env.COSMOS_AUDIT_CONTAINER || 'auditLogs'
      }
    });
  },

  'GET cosmos/health': async (_req, context) => {
    const { containerFor, containerNames } = getStore();
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
    const { queryAll } = getStore();
    const records = await queryAll('fabricConnections', {
      query: 'SELECT * FROM c WHERE c.isActive = true AND c.status = "ready" ORDER BY c.updatedAt DESC'
    });
    json(context, 200, records[0] ? sanitize(records[0]) : null);
  },

  'POST fabric-connections/test': async (req, context) => {
    const draft = readBody(req);
    const id = `fabric-conn-${makeHash({ endpointUrl: draft.endpointUrl, tenantId: draft.tenantId })}`;
    const { queryAll } = getStore();
    const rawExisting = (await queryAll('fabricConnections', {
      query: 'SELECT * FROM c WHERE c.id = @id',
      parameters: [{ name: '@id', value: id }]
    }))[0];
    const testConnection = {
      ...draft,
      clientSecret: draft.clientSecret?.trim() || rawExisting?.clientSecret
    };

    validateDraft(testConnection, { requireSecret: testConnection.authMode === 'service_principal' });
    const schema = await introspectFabric(testConnection, req);
    const fields = schema.queryType?.fields || [];

    json(context, 200, {
      status: 'ready',
      message: `Fabric GraphQL endpoint への実接続に成功しました。Queryフィールド ${fields.length} 件を検出しました。`,
      testedAt: nowIso(),
      queryTypeName: schema.queryType?.name || 'Query',
      correlationId: correlationId()
    });
  },

  'POST fabric-connections': async (req, context) => {
    const draft = readBody(req);
    const id = `fabric-conn-${makeHash({ endpointUrl: draft.endpointUrl, tenantId: draft.tenantId })}`;
    const now = nowIso();
    const current = await listConnections();
    const existing = current.find((connection) => connection.id === id);
    const { queryAll, upsert } = getStore();
    const rawExisting = (await queryAll('fabricConnections', {
      query: 'SELECT * FROM c WHERE c.id = @id',
      parameters: [{ name: '@id', value: id }]
    }))[0];
    validateDraft(draft, { requireSecret: draft.authMode === 'service_principal' && !rawExisting?.clientSecret });

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
      clientSecret: draft.authMode === 'service_principal'
        ? draft.clientSecret?.trim() || rawExisting?.clientSecret
        : undefined,
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

  'GET datasets': async (req, context) => {
    const connection = await getActiveConnection();
    if (!connection) {
      json(context, 200, { data: [], pageInfo: { hasNextPage: false, totalCount: 0 } });
      return;
    }

    const { dataset } = await buildDataset(connection, req, makeHash);
    json(context, 200, {
      data: [dataset],
      pageInfo: {
        hasNextPage: false,
        totalCount: 1
      }
    });
  },

  'POST mappings/bootstrap': async (req, context) => {
    const body = readBody(req);
    const connection = await getActiveConnection();
    if (!connection) {
      error(context, 404, 'FABRIC.NO_ACTIVE_CONNECTION', '有効なFabric接続がありません。');
      return;
    }

    const { fabricDataset } = await buildDataset(connection, req, makeHash);
    const dataset = { ...fabricDataset, id: body.datasetId || fabricDataset.id, displayName: body.datasetName || fabricDataset.displayName };
    const { queryAll } = getStore();
    const existing = (await queryAll('semanticMappings', {
      query: 'SELECT * FROM c WHERE c.id = @id',
      parameters: [{ name: '@id', value: `map-${dataset.id}` }]
    }))[0];

    json(context, 200, {
      dataset,
      mapping: existing ? normalizeSemanticMapping(existing, dataset) : buildSemanticMapping(dataset)
    });
  },

  'POST mappings/save': async (req, context) => {
    const mapping = readBody(req);
    const { upsert } = getStore();
    const saved = await upsert('semanticMappings', {
      ...mapping,
      tenantId: mapping.tenantId || 'default',
      tenantDatasetKey: mapping.tenantDatasetKey || `${mapping.tenantId || 'default'}#${mapping.datasetId || 'unknown'}`,
      partitionKey: mapping.tenantDatasetKey || `${mapping.tenantId || 'default'}#${mapping.datasetId || 'unknown'}`,
      version: Number(mapping.version || 0) + 1,
      updatedAt: nowIso(),
      updatedBy: actor
    });

    json(context, 200, saved);
  },

  'POST analysis/start': async (req, context) => {
    const { mappingDocumentId, mapping, dataset, config } = readBody(req);
    const { upsert } = getStore();
    const now = nowIso();
    const runId = `run-${makeHash({ mappingDocumentId, config })}`;
    const analysisJobId = `job-${makeHash({ runId, now })}`;
    const estimatedDurationSeconds = config?.mode === 'autopilot' ? 600 : 240;
    const activeConnection = await getActiveConnection();
    if (!activeConnection) {
      error(context, 400, 'FABRIC.NO_ACTIVE_CONNECTION', '実データ分析には有効なFabric接続が必要です。');
      return;
    }
    const resolvedDataset = dataset || (activeConnection ? (await buildDataset(activeConnection, req, makeHash)).fabricDataset : null);
    const resolvedMapping = mapping || null;
    if (!resolvedDataset || !resolvedMapping) {
      error(context, 400, 'ANALYSIS.INPUT_REQUIRED', '実データ分析にはdatasetとmappingが必要です。');
      return;
    }

    await upsert('analysisRuns', {
      id: analysisJobId,
      tenantId: 'default',
      partitionKey: 'default',
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

    const analysisResult = await buildRealAnalysisResult({ connection: activeConnection, req, analysisJobId, runId, mapping: resolvedMapping, dataset: resolvedDataset, config });
    await upsert('analysisResults', {
      ...analysisResult,
      id: analysisResult.analysisJobId,
      jobId: analysisResult.analysisJobId,
      partitionKey: analysisResult.analysisJobId,
      updatedAt: now
    });

    json(context, 200, {
      analysisJobId,
      runId,
      status: analysisResult?.status || 'queued',
      startedAt: now,
      estimatedDurationSeconds
    });
  },

  'POST analysis/bootstrap': async (req, context) => {
    const { mapping, dataset } = readBody(req);
    if (!mapping || !dataset) {
      error(context, 400, 'ANALYSIS.BOOTSTRAP_INPUT_REQUIRED', '分析入力にはmappingとdatasetが必要です。');
      return;
    }

    json(context, 200, {
      summary: buildAnalysisSummary(mapping, dataset),
      defaultConfig: null
    });
  },

  'POST analysis-results': async (req, context) => {
    const result = readBody(req);
    const { upsert } = getStore();
    const saved = await upsert('analysisResults', {
      ...result,
      id: result.id || result.analysisJobId,
      jobId: result.jobId || result.analysisJobId || 'default',
      partitionKey: result.jobId || result.analysisJobId || 'default',
      updatedAt: nowIso()
    });

    json(context, 200, saved);
  },

  'POST segments/prepare': async (req, context) => {
    const contextBody = readBody(req);
    const { upsert } = getStore();
    await upsert('segments', {
      id: `segment-selection-${contextBody.analysisJobId}`,
      tenantId: contextBody.tenantId || 'default',
      partitionKey: contextBody.tenantId || 'default',
      kind: 'selectedSegmentContext',
      ...contextBody,
      updatedAt: nowIso()
    });

    json(context, 200, contextBody);
  },

  'POST segments/save': async (req, context) => {
    const { draft, result } = readBody(req);
    const { upsert } = getStore();
    const now = nowIso();
    const savedDraft = await upsert('segments', {
      ...draft,
      id: draft.id,
      tenantId: draft.tenantId || 'default',
      partitionKey: draft.tenantId || 'default',
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
      tenantId: draft.tenantId || 'default',
      partitionKey: draft.tenantId || 'default',
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
      const { removeById, upsert } = getStore();
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
      const { queryAll } = getStore();
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

    const datasetPreviewMatch = route.match(/^datasets\/([^/]+)\/preview$/);
    if (req.method.toUpperCase() === 'GET' && datasetPreviewMatch) {
      const connection = await getActiveConnection();
      if (!connection) {
        json(context, 404, null);
        return;
      }

      const { preview } = await buildDataset(connection, req, makeHash);
      if (preview.datasetId !== decodeURIComponent(datasetPreviewMatch[1])) {
        json(context, 404, null);
        return;
      }

      json(context, 200, preview);
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
