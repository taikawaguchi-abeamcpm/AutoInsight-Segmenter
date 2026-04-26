import type { ValidationIssue } from './common';

export type AnalysisMode = 'custom' | 'autopilot';
export type OptimizationPreference = 'explainability' | 'accuracy' | 'balanced';

export interface AnalysisInputSummary {
  datasetId: string;
  datasetName: string;
  workspaceId: string;
  workspaceName: string;
  mappingDocumentId: string;
  customerTableName: string;
  target: AnalysisTargetSummary;
  features: AnalysisFeatureSummary[];
  relatedTables: string[];
  dataQuality: AnalysisDataQualitySummary;
}

export interface AnalysisTargetSummary {
  targetKey: string;
  label: string;
  dataType: 'binary' | 'continuous';
  positiveValue?: string;
  negativeValue?: string;
  eventTimeColumnName?: string;
  evaluationWindowDays?: number;
}

export interface AnalysisFeatureSummary {
  featureKey: string;
  label: string;
  sourceTableName: string;
  sourceColumnName: string;
  dataType: 'string' | 'integer' | 'float' | 'boolean' | 'date' | 'datetime';
  category: 'profile' | 'behavior' | 'transaction' | 'engagement' | 'derived';
  aggregation: 'none' | 'count' | 'sum' | 'avg' | 'latest' | 'distinct_count';
  timeWindowDays?: number;
  enabled: boolean;
  missingRate?: number;
  piiCandidate?: boolean;
}

export interface AnalysisDataQualitySummary {
  eligibleRowCount?: number;
  duplicateRate: number;
  averageMissingRate: number;
  invalidFeatureCount: number;
  warningMessages: string[];
}

export interface CustomAnalysisConfig {
  mode: 'custom';
  observationStartDate: string;
  observationEndDate: string;
  evaluationStartDate?: string;
  evaluationEndDate?: string;
  analysisUnit: 'customer' | 'event';
  targetType: 'binary' | 'continuous';
  optimizationPreference: OptimizationPreference;
  crossValidationFolds: 3 | 5 | 10;
  maxFeatureCount: number;
  correlationThreshold: number;
  importanceMethod: 'model_based' | 'permutation' | 'hybrid';
  patternCount: number;
  selectedFeatureKeys: string[];
}

export interface AutopilotAnalysisConfig {
  mode: 'autopilot';
  timeBudgetMinutes: 5 | 10 | 30 | 60;
  candidateFeatureLimit: number;
  allowGeneratedFeatures: boolean;
  businessPriority: 'explainability' | 'segmentability' | 'reproducibility';
  excludeHighMissingColumns: boolean;
  excludeHighCardinalityColumns: boolean;
  blockedColumnKeys: string[];
}

export type AnalysisRunConfig = CustomAnalysisConfig | AutopilotAnalysisConfig;

export interface AnalysisRunDocument {
  id: string;
  datasetId: string;
  mappingDocumentId: string;
  mode: AnalysisMode;
  config: AnalysisRunConfig;
  configHash: string;
  status: 'draft' | 'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled' | 'timed_out';
  estimatedDurationSeconds?: number;
  modelVersion?: string;
  featureGenerationVersion?: string;
  randomSeed?: number;
  createdAt: string;
  createdBy: string;
}

export interface AnalysisRunValidation {
  valid: boolean;
  estimatedDurationSeconds: number;
  issues: ValidationIssue[];
}

export interface StartAnalysisResult {
  analysisJobId: string;
  runId: string;
  status: AnalysisRunDocument['status'];
  startedAt: string;
  estimatedDurationSeconds: number;
}
