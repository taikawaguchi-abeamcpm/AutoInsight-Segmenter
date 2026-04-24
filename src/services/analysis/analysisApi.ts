import { delay, makeHash, type RequestOptions } from '../client';
import { buildAnalysisSummary, nowIso } from '../mockData';
import type {
  AnalysisInputSummary,
  AnalysisMode,
  AnalysisRunConfig,
  AnalysisRunValidation,
  AutopilotAnalysisConfig,
  CustomAnalysisConfig,
  StartAnalysisResult
} from '../../types/analysis';

export interface AnalysisBootstrap {
  summary: AnalysisInputSummary;
  defaultConfig: AnalysisRunConfig;
}

export const createDefaultConfig = (summary: AnalysisInputSummary, mode: AnalysisMode): AnalysisRunConfig => {
  const featureKeys = summary.features.filter((feature) => feature.enabled).map((feature) => feature.featureKey);

  if (mode === 'autopilot') {
    return {
      mode: 'autopilot',
      timeBudgetMinutes: 10,
      candidateFeatureLimit: 100,
      allowGeneratedFeatures: true,
      businessPriority: 'segmentability',
      excludeHighMissingColumns: true,
      excludeHighCardinalityColumns: true,
      blockedColumnKeys: []
    } satisfies AutopilotAnalysisConfig;
  }

  return {
    mode: 'custom',
    observationStartDate: '2025-10-01',
    observationEndDate: '2026-03-31',
    evaluationStartDate: '2026-04-01',
    evaluationEndDate: '2026-04-23',
    analysisUnit: 'customer',
    targetType: summary.target.dataType,
    optimizationPreference: 'balanced',
    crossValidationFolds: 5,
    maxFeatureCount: 80,
    correlationThreshold: 0.9,
    importanceMethod: 'hybrid',
    patternCount: 10,
    selectedFeatureKeys: featureKeys
  } satisfies CustomAnalysisConfig;
};

export const analysisApi = {
  async bootstrap(mappingDocumentId: string, options: RequestOptions = {}): Promise<AnalysisBootstrap> {
    await delay(undefined, options.signal);
    const summary = buildAnalysisSummary(mappingDocumentId);

    return {
      summary,
      defaultConfig: createDefaultConfig(summary, 'custom')
    };
  },

  async validate(summary: AnalysisInputSummary, config: AnalysisRunConfig, options: RequestOptions = {}): Promise<AnalysisRunValidation> {
    await delay(130, options.signal);
    const issues = [];
    const selectedFeatureCount =
      config.mode === 'custom'
        ? config.selectedFeatureKeys.length
        : summary.features.filter((feature) => !config.blockedColumnKeys.includes(feature.featureKey)).length;

    if (selectedFeatureCount < 1) {
      issues.push({
        id: 'no-enabled-features',
        scope: 'analysis' as const,
        severity: 'error' as const,
        code: 'NO_ENABLED_FEATURES',
        message: '有効な特徴量を 1 件以上選択してください。',
        blocking: true
      });
    }

    if (summary.dataQuality.eligibleRowCount < 100) {
      issues.push({
        id: 'insufficient-row-count',
        scope: 'analysis' as const,
        severity: 'error' as const,
        code: 'INSUFFICIENT_ROW_COUNT',
        message: '分析に使える件数が不足しています。',
        blocking: true
      });
    }

    issues.push(
      ...summary.dataQuality.warningMessages.map((message, index) => ({
        id: `quality-warning-${index}`,
        scope: 'analysis' as const,
        severity: 'warning' as const,
        code: 'DATA_QUALITY_WARNING',
        message,
        blocking: false
      }))
    );

    return {
      valid: !issues.some((issue) => issue.blocking),
      estimatedDurationSeconds: config.mode === 'autopilot' ? 600 : 240,
      issues
    };
  },

  async start(mappingDocumentId: string, config: AnalysisRunConfig, options: RequestOptions = {}): Promise<StartAnalysisResult> {
    await delay(240, options.signal);

    return {
      analysisJobId: 'job-demo-001',
      runId: `run-${makeHash({ mappingDocumentId, config })}`,
      status: 'queued',
      startedAt: nowIso(),
      estimatedDurationSeconds: config.mode === 'autopilot' ? 600 : 240
    };
  }
};
