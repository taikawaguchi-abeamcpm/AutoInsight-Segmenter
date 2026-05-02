export type AnalysisJobStatus = 'queued' | 'running' | 'completed' | 'partial' | 'failed';

export interface AnalysisResultDocument {
  analysisJobId: string;
  runId: string;
  datasetId: string;
  mappingDocumentId: string;
  mode: 'custom' | 'autopilot';
  status: AnalysisJobStatus;
  progressPercent: number;
  message: string;
  detail?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  summary: AnalysisResultSummary;
  featureImportances: FeatureImportanceResult[];
  interactionPairs: FeatureInteractionResult[];
  goldenPatterns: GoldenPatternResult[];
  segmentRecommendations: SegmentRecommendation[];
  modelMetadata?: AnalysisModelMetadata;
}

export interface AnalysisResultSummary {
  analyzedRowCount: number;
  topFeatureCount: number;
  validPatternCount: number;
  recommendedSegmentCount: number;
  baselineMetricValue?: number;
  improvedMetricValue?: number;
  improvementRate?: number;
}

export interface FeatureImportanceResult {
  featureKey: string;
  label: string;
  category: 'profile' | 'behavior' | 'transaction' | 'engagement' | 'derived';
  importanceScore: number;
  direction: 'positive' | 'negative' | 'neutral';
  aggregation: 'none' | 'count' | 'sum' | 'avg' | 'latest' | 'distinct_count';
  timeWindowDays?: number;
  missingRate?: number;
  description?: string;
}

export interface FeatureInteractionResult {
  leftFeatureKey: string;
  rightFeatureKey: string;
  synergyScore: number;
  summary: string;
}

export interface GoldenPatternResult {
  id: string;
  title: string;
  conditions: PatternCondition[];
  supportRate: number;
  lift?: number;
  conversionDelta?: number;
  confidence?: number;
  description: string;
  recommendedAction?: string;
}

export interface PatternCondition {
  featureKey: string;
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'between' | 'in';
  value: string | number | boolean;
  valueTo?: string | number;
  label: string;
}

export interface SegmentRecommendation {
  id: string;
  name: string;
  description?: string;
  sourcePatternId?: string;
  estimatedAudienceSize: number;
  estimatedConversionRate?: number;
  conditions: PatternCondition[];
  useCase?: string;
  priorityScore: number;
}

export interface AnalysisModelMetadata {
  modelType: string;
  modelVersion: string;
  trainingRowCount: number;
  trainingFeatureCount: number;
  logLoss?: number;
}

export interface SelectedSegmentContext {
  analysisJobId: string;
  segmentIds: string[];
  segments: SegmentRecommendation[];
}
