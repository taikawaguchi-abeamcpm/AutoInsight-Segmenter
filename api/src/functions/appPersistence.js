const { app } = require('@azure/functions');
const { queryAll, upsert } = require('../cosmosStore');
const { handle, json, makeHash, nowIso, requireJson } = require('../http');

const actor = 'system';

app.http('saveSemanticMapping', {
  route: 'mappings/save',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (request, context) => handle(context, async () => {
    const mapping = await requireJson(request);
    const now = nowIso();
    const saved = await upsert('semanticMappings', {
      ...mapping,
      partitionKey: mapping.datasetId || 'default',
      version: Number(mapping.version || 0) + 1,
      updatedAt: now,
      updatedBy: actor
    });

    return json(saved);
  })
});

app.http('startAnalysisRun', {
  route: 'analysis/start',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (request, context) => handle(context, async () => {
    const { mappingDocumentId, config } = await requireJson(request);
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

    return json({
      analysisJobId,
      runId,
      status: 'queued',
      startedAt: now,
      estimatedDurationSeconds
    });
  })
});

app.http('getAnalysisResult', {
  route: 'analysis-results/{analysisJobId}',
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async (request, context) => handle(context, async () => {
    const records = await queryAll('analysisResults', {
      query: 'SELECT * FROM c WHERE c.analysisJobId = @analysisJobId ORDER BY c.updatedAt DESC',
      parameters: [{ name: '@analysisJobId', value: request.params.analysisJobId }]
    });

    return records[0] ? json(records[0]) : json(null, 404);
  })
});

app.http('saveAnalysisResult', {
  route: 'analysis-results',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (request, context) => handle(context, async () => {
    const result = await requireJson(request);
    const saved = await upsert('analysisResults', {
      ...result,
      id: result.id || result.analysisJobId,
      partitionKey: result.analysisJobId || 'default',
      updatedAt: nowIso()
    });

    return json(saved);
  })
});

app.http('saveSelectedSegments', {
  route: 'segments/prepare',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (request, context) => handle(context, async () => {
    const contextBody = await requireJson(request);
    await upsert('segments', {
      id: `segment-selection-${contextBody.analysisJobId}`,
      partitionKey: contextBody.analysisJobId || 'default',
      kind: 'selectedSegmentContext',
      ...contextBody,
      updatedAt: nowIso()
    });

    return json(contextBody);
  })
});

app.http('saveSegmentDraft', {
  route: 'segments/save',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (request, context) => handle(context, async () => {
    const { draft, result } = await requireJson(request);
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

    return json(saveResult);
  })
});
