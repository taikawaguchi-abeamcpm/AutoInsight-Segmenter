const { buildDataset, introspectFabric, fetchTableRows, getActiveConnection } = require('../src/fabricClient');
const { correlationId, makeHash, nowIso } = require('../src/http');
const { buildRealAnalysisResult, getAnalysisWorkerStatus } = require('../src/analysisEngine');
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

const looksLikeHtml = (value) =>
  typeof value === 'string' && /<html[\s>]|<!doctype html|<body[\s>]|<h\d[\s>]/i.test(value);

const compactErrorText = (value) =>
  String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const truncateText = (value, maxLength = 2000) => {
  if (typeof value !== 'string') {
    return value;
  }

  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
};

const toJsonSafeValue = (value, depth = 0) => {
  if (value === undefined) return undefined;
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return truncateText(value);
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    if (depth > 8) return [];
    return value.map((item) => toJsonSafeValue(item, depth + 1)).filter((item) => item !== undefined);
  }
  if (typeof value === 'object') {
    if (depth > 8) return {};
    return Object.fromEntries(
      Object.entries(value)
        .map(([key, item]) => [key, toJsonSafeValue(item, depth + 1)])
        .filter(([, item]) => item !== undefined)
    );
  }

  return String(value);
};

const normalizeAnalysisResultForStorage = ({ analysisResult, analysisJobId, runId, mapping, dataset, config }) => {
  const normalized = toJsonSafeValue({
    ...analysisResult,
    id: analysisResult?.analysisJobId || analysisJobId,
    analysisJobId: analysisResult?.analysisJobId || analysisJobId,
    runId: analysisResult?.runId || runId,
    datasetId: analysisResult?.datasetId || dataset?.id || mapping?.datasetId || 'unknown',
    mappingDocumentId: analysisResult?.mappingDocumentId || mapping?.id || 'unknown',
    mode: analysisResult?.mode || config?.mode || 'custom',
    status: analysisResult?.status || 'failed',
    progressPercent: analysisResult?.progressPercent ?? 100,
    message: analysisResult?.message || 'Analysis finished without a message.',
    summary: analysisResult?.summary || {
      analyzedRowCount: 0,
      topFeatureCount: 0,
      validPatternCount: 0,
      recommendedSegmentCount: 0
    },
    featureImportances: (analysisResult?.featureImportances || []).slice(0, 100),
    interactionPairs: (analysisResult?.interactionPairs || []).slice(0, 50),
    goldenPatterns: (analysisResult?.goldenPatterns || []).slice(0, 50),
    segmentRecommendations: (analysisResult?.segmentRecommendations || []).slice(0, 50)
  });

  return {
    ...normalized,
    id: normalized.analysisJobId,
    jobId: normalized.analysisJobId,
    partitionKey: normalized.analysisJobId
  };
};

const failedAnalysisResult = ({ analysisJobId, runId, mapping, dataset, config, message, detail }) => {
  const timestamp = nowIso();
  const safeMessage = looksLikeHtml(message)
    ? 'Python analysis worker returned an HTML server error. Check the Function App logs.'
    : message;
  const safeDetail = detail || (looksLikeHtml(message) ? compactErrorText(message).slice(0, 1000) : undefined);
  return {
    id: analysisJobId,
    analysisJobId,
    runId,
    datasetId: dataset?.id || mapping?.datasetId || 'unknown',
    mappingDocumentId: mapping?.id || 'unknown',
    mode: config?.mode || 'custom',
    status: 'failed',
    progressPercent: 100,
    message: safeMessage,
    detail: safeDetail,
    createdAt: timestamp,
    startedAt: timestamp,
    completedAt: timestamp,
    summary: {
      analyzedRowCount: 0,
      topFeatureCount: 0,
      validPatternCount: 0,
      recommendedSegmentCount: 0
    },
    featureImportances: [],
    interactionPairs: [],
    goldenPatterns: [],
    segmentRecommendations: []
  };
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

const datasetIdForConnection = (connection) =>
  `fabric-${makeHash({ endpointUrl: connection.endpointUrl, workspaceId: connection.workspaceId, tenantId: connection.tenantId })}`;

const readyConnections = async () => {
  const { queryAll } = getStore();
  return queryAll('fabricConnections', {
    query: 'SELECT * FROM c WHERE c.status = "ready" ORDER BY c.updatedAt DESC'
  });
};

const connectionForDatasetId = async (datasetId) =>
  (await readyConnections()).find((connection) => datasetIdForConnection(connection) === datasetId) || null;

const fallbackDatasetForConnection = (connection, reason) => {
  const apiName = (() => {
    try {
      const url = new URL(connection.endpointUrl);
      const segments = url.pathname.split('/').filter(Boolean);
      const apiIndex = segments.findIndex((segment) => segment.toLowerCase() === 'graphqlapis');
      return apiIndex >= 0 && segments[apiIndex + 1] ? segments[apiIndex + 1] : 'fabric-graphql';
    } catch {
      return 'fabric-graphql';
    }
  })();

  return {
    id: datasetIdForConnection(connection),
    connectionId: connection.id,
    secretConfigured: Boolean(connection.clientSecret || connection.secretConfigured),
    name: apiName,
    displayName: `${connection.displayName} (${apiName})`,
    workspaceId: connection.workspaceId || 'workspace未指定',
    workspaceName: connection.workspaceId ? `Workspace ${connection.workspaceId}` : connection.displayName,
    description: reason ? `スキーマ取得に失敗しました: ${reason}` : 'Fabric GraphQL 接続候補です。',
    tags: ['Fabric', 'GraphQL', '接続確認が必要'],
    tableCount: 0,
    lastSyncedAt: connection.lastSuccessAt || connection.updatedAt,
    connectionStatus: 'warning',
    recommended: true,
    recommendationScore: 10,
    recommendationReasons: ['接続設定は存在しますが、スキーマ取得を確認できませんでした'],
    recentlyUsed: Boolean(connection.isActive),
    warningCodes: ['SCHEMA_PREVIEW_UNAVAILABLE']
  };
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

const resolveConnectionForDataset = async (datasetId) => {
  if (!datasetId) {
    return getActiveConnection();
  }

  return connectionForDatasetId(datasetId);
};

const inferPositiveValue = (values, configuredPositiveValue) => {
  const present = values.filter((value) => value !== null && value !== undefined && value !== '');
  if (present.length === 0) {
    return configuredPositiveValue;
  }

  const counts = new Map();
  present.forEach((value) => {
    const key = String(value);
    counts.set(key, (counts.get(key) || 0) + 1);
  });

  if (configuredPositiveValue !== undefined && counts.has(String(configuredPositiveValue))) {
    return String(configuredPositiveValue);
  }

  const positiveHints = ['true', '1', 'yes', 'y', 'won', 'success', 'converted', '成約', 'あり'];
  for (const hint of positiveHints) {
    const matched = [...counts.keys()].find((value) => value.trim().toLowerCase() === hint);
    if (matched !== undefined) {
      return matched;
    }
  }

  const ranked = [...counts.entries()].sort((left, right) => left[1] - right[1]);
  return ranked[0]?.[0] ?? configuredPositiveValue;
};

const buildDefaultAnalysisConfig = (summary, positiveValue) => ({
  mode: 'custom',
  targetPositiveValue: String(positiveValue ?? summary.target.positiveValue ?? 'true'),
  analysisUnit: 'customer',
  targetType: summary.target.dataType,
  optimizationPreference: 'balanced',
  crossValidationFolds: 5,
  maxFeatureCount: 80,
  correlationThreshold: 0.9,
  importanceMethod: 'hybrid',
  patternCount: 10,
  selectedFeatureKeys: summary.features.filter((feature) => feature.enabled).map((feature) => feature.featureKey),
  segmentObjective: 'unconverted_targeting'
});

const inferTargetPositiveValueFromData = async ({ connection, req, mapping, dataset }) => {
  const targetMapping = mapping.columnMappings.find((column) => column.columnRole === 'target') || mapping.columnMappings.find((column) => column.targetConfig);
  const table = dataset.tables.find((item) => item.id === targetMapping?.tableId);
  const column = table?.columns.find((item) => item.id === targetMapping?.columnId);
  if (!table || !column) {
    return targetMapping?.targetConfig?.positiveValue;
  }

  try {
    const { rows } = await fetchTableRows(connection, req, table.name, [column.name], { pageSize: 200, maxRows: 200 });
    return inferPositiveValue(rows.map((row) => row[column.name]), targetMapping?.targetConfig?.positiveValue);
  } catch {
    return targetMapping?.targetConfig?.positiveValue;
  }
};

const fetchDistinctColumnValues = async ({ connection, req, dataset, tableId, columnId, limit = 200 }) => {
  const table = dataset.tables.find((item) => item.id === tableId);
  const column = table?.columns.find((item) => item.id === columnId);
  if (!table || !column) {
    throw Object.assign(new Error('カテゴリ値を取得する列が見つかりません。'), {
      status: 400,
      code: 'MAPPING.COLUMN_NOT_FOUND'
    });
  }

  const { rows, truncated } = await fetchTableRows(connection, req, table.name, [column.name], {
    pageSize: 1000,
    maxRows: Number(process.env.FABRIC_CATEGORY_VALUE_MAX_ROWS || 5000)
  });
  const counts = new Map();
  rows.forEach((row) => {
    const value = row[column.name];
    if (value === null || value === undefined || value === '') return;
    const key = String(value);
    counts.set(key, (counts.get(key) || 0) + 1);
  });

  const values = [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'ja-JP'))
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));

  return {
    tableId,
    columnId,
    values,
    truncated: truncated || counts.size > values.length
  };
};

const computedConnectionId = (draft) =>
  `fabric-conn-${makeHash({ endpointUrl: draft.endpointUrl?.trim(), tenantId: draft.tenantId?.trim() })}`;

const findExistingConnectionForDraft = async (draft) => {
  const { queryAll } = getStore();
  const ids = [...new Set([draft.id, draft.connectionId, computedConnectionId(draft)].filter(Boolean))];

  for (const id of ids) {
    const byId = (await queryAll('fabricConnections', {
      query: 'SELECT * FROM c WHERE c.id = @id',
      parameters: [{ name: '@id', value: id }]
    }))[0];
    if (byId) {
      return byId;
    }
  }

  if (!draft.endpointUrl?.trim() || !draft.tenantId?.trim()) {
    return null;
  }

  return (await queryAll('fabricConnections', {
    query: 'SELECT * FROM c WHERE c.endpointUrl = @endpointUrl AND c.tenantId = @tenantId',
    parameters: [
      { name: '@endpointUrl', value: draft.endpointUrl.trim() },
      { name: '@tenantId', value: draft.tenantId.trim() }
    ]
  }))[0] || null;
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

  'GET analysis/worker-health': async (_req, context) => {
    json(context, 200, await getAnalysisWorkerStatus());
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
    const rawExisting = await findExistingConnectionForDraft(draft);
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
    const id = computedConnectionId(draft);
    const now = nowIso();
    const current = await listConnections();
    const existing = current.find((connection) => connection.id === id);
    const { upsert } = getStore();
    const rawExisting = await findExistingConnectionForDraft(draft);
    validateDraft(draft, { requireSecret: draft.authMode === 'service_principal' && !rawExisting?.clientSecret });

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
    const connections = await readyConnections();
    if (connections.length === 0) {
      json(context, 200, { data: [], pageInfo: { hasNextPage: false, totalCount: 0 } });
      return;
    }

    const settled = await Promise.allSettled(
      connections.map((connection) => buildDataset(connection, req, makeHash, { includeRowCounts: false }))
    );
    const datasets = settled.map((result, index) =>
      result.status === 'fulfilled'
        ? result.value.dataset
        : fallbackDatasetForConnection(connections[index], result.reason?.message || 'unknown error')
    );
    json(context, 200, {
      data: datasets,
      pageInfo: {
        hasNextPage: false,
        totalCount: datasets.length
      }
    });
  },

  'POST mappings/bootstrap': async (req, context) => {
    const body = readBody(req);
    const connection = await resolveConnectionForDataset(body.datasetId);
    if (!connection) {
      error(context, 404, 'FABRIC.NO_ACTIVE_CONNECTION', '有効なFabric接続がありません。');
      return;
    }

    const { fabricDataset } = await buildDataset(connection, req, makeHash, { rowCountMode: 'totalOnly' });
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

  'POST mappings/category-values': async (req, context) => {
    const { dataset, tableId, columnId, limit } = readBody(req);
    if (!dataset || !tableId || !columnId) {
      error(context, 400, 'MAPPING.CATEGORY_VALUES_INPUT_REQUIRED', 'カテゴリ値の取得にはdataset、tableId、columnIdが必要です。');
      return;
    }

    const connection = await resolveConnectionForDataset(dataset.id);
    if (!connection) {
      error(context, 400, 'FABRIC.NO_ACTIVE_CONNECTION', 'カテゴリ値の取得には有効なFabric接続が必要です。');
      return;
    }

    json(context, 200, await fetchDistinctColumnValues({ connection, req, dataset, tableId, columnId, limit }));
  },

  'POST analysis/start': async (req, context) => {
    const { mappingDocumentId, mapping, dataset, config } = readBody(req);
    const { upsert } = getStore();
    const now = nowIso();
    const runId = `run-${makeHash({ mappingDocumentId, config })}`;
    const analysisJobId = `job-${makeHash({ runId, now })}`;
    const estimatedDurationSeconds = config?.mode === 'autopilot' ? 600 : 240;
    const datasetId = dataset?.id || mapping?.datasetId;
    const analysisConnection = await resolveConnectionForDataset(datasetId);
    if (!analysisConnection) {
      error(context, 400, 'FABRIC.NO_ACTIVE_CONNECTION', '実データ分析には有効なFabric接続が必要です。');
      return;
    }
    const resolvedDataset = dataset || (await buildDataset(analysisConnection, req, makeHash)).fabricDataset;
    const resolvedMapping = mapping || null;
    if (!resolvedDataset || !resolvedMapping) {
      error(context, 400, 'ANALYSIS.INPUT_REQUIRED', '実データ分析にはdatasetとmappingが必要です。');
      return;
    }

    const analysisRun = {
      id: analysisJobId,
      tenantId: 'default',
      partitionKey: 'default',
      datasetId: resolvedDataset.id,
      mappingDocumentId,
      mode: config?.mode || 'custom',
      config,
      configHash: makeHash(config),
      status: 'queued',
      estimatedDurationSeconds,
      createdAt: now,
      createdBy: actor,
      updatedAt: now
    };

    await upsert('analysisRuns', analysisRun);

    let analysisResult;
    try {
      analysisResult = await buildRealAnalysisResult({ connection: analysisConnection, req, analysisJobId, runId, mapping: resolvedMapping, dataset: resolvedDataset, config });
    } catch (err) {
      context.log.error('Python analysis worker failed', err);
      analysisResult = failedAnalysisResult({
        analysisJobId,
        runId,
        mapping: resolvedMapping,
        dataset: resolvedDataset,
        config,
        message: err.message || 'Python analysis worker failed.',
        detail: err.code ? `${err.code}${err.status ? ` (${err.status})` : ''}` : undefined
      });
    }

    let storedResult = normalizeAnalysisResultForStorage({
      analysisResult,
      analysisJobId,
      runId,
      mapping: resolvedMapping,
      dataset: resolvedDataset,
      config
    });

    try {
      await upsert('analysisResults', {
        ...storedResult,
        updatedAt: now
      });
    } catch (err) {
      context.log.error('Analysis result persistence failed', err);
      analysisResult = failedAnalysisResult({
        analysisJobId,
        runId,
        mapping: resolvedMapping,
        dataset: resolvedDataset,
        config,
        message: 'Analysis completed, but the result could not be saved. The stored result was reduced to failure diagnostics.',
        detail: err.message || 'Cosmos analysis result persistence failed.'
      });
      storedResult = normalizeAnalysisResultForStorage({
        analysisResult,
        analysisJobId,
        runId,
        mapping: resolvedMapping,
        dataset: resolvedDataset,
        config
      });
      await upsert('analysisResults', {
        ...storedResult,
        updatedAt: now
      });
    }

    await upsert('analysisRuns', {
      ...analysisRun,
      status: storedResult?.status || 'failed',
      modelVersion: storedResult?.modelMetadata?.modelVersion,
      featureGenerationVersion: 'python-worker-v1',
      updatedAt: now,
      completedAt: storedResult?.completedAt
    });

    json(context, 200, {
      analysisJobId,
      runId,
      status: storedResult?.status || 'failed',
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

    const analysisConnection = await resolveConnectionForDataset(dataset.id || mapping.datasetId);
    const positiveValue = analysisConnection
      ? await inferTargetPositiveValueFromData({ connection: analysisConnection, req, mapping, dataset })
      : undefined;
    const summary = buildAnalysisSummary(mapping, dataset);
    const summaryWithPositiveValue = {
      ...summary,
      target: {
        ...summary.target,
        positiveValue: positiveValue ?? summary.target.positiveValue
      }
    };

    json(context, 200, {
      summary: summaryWithPositiveValue,
      defaultConfig: buildDefaultAnalysisConfig(summaryWithPositiveValue, positiveValue)
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
      const datasetId = decodeURIComponent(datasetPreviewMatch[1]);
      const connection = await resolveConnectionForDataset(datasetId);
      if (!connection) {
        json(context, 404, null);
        return;
      }

      const { preview } = await buildDataset(connection, req, makeHash, { rowCountMode: 'totalOnly' });
      if (preview.datasetId !== datasetId) {
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
