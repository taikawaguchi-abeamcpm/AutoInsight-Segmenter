const { nowIso } = require('../src/http');
const { compactErrorText, looksLikeHtml, toJsonSafeValue } = require('./httpUtils');

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
    goldenPatterns: analysisResult?.goldenPatterns || [],
    segmentRecommendations: analysisResult?.segmentRecommendations || [],
    analysisRows: analysisResult?.analysisRows || []
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

const queuedAnalysisResult = ({ analysisJobId, runId, mapping, dataset, config, now }) => ({
  id: analysisJobId,
  analysisJobId,
  runId,
  datasetId: dataset?.id || mapping?.datasetId || 'unknown',
  mappingDocumentId: mapping?.id || 'unknown',
  mode: config?.mode || 'custom',
  status: 'queued',
  progressPercent: 0,
  message: 'Analysis job is queued.',
  createdAt: now,
  startedAt: now,
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
});

module.exports = {
  failedAnalysisResult,
  normalizeAnalysisResultForStorage,
  queuedAnalysisResult
};
