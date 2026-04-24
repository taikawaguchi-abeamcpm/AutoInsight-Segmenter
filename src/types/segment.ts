export type SegmentOutputType = 'flag' | 'list' | 'csv' | 'external';
export type LogicalOperator = 'and' | 'or';

export interface SegmentDraft {
  id: string;
  analysisJobId: string;
  sourceRecommendationIds: string[];
  name: string;
  description?: string;
  tags: string[];
  status: 'draft' | 'validated' | 'saved' | 'executed';
  ruleTree: SegmentRuleGroup;
  outputConfig: SegmentOutputConfig;
  previewSummary?: SegmentPreviewSummary;
  createdAt: string;
  updatedAt: string;
}

export interface SegmentRuleGroup {
  id: string;
  operator: LogicalOperator;
  conditions: SegmentRuleCondition[];
  groups: SegmentRuleGroup[];
}

export interface SegmentRuleCondition {
  id: string;
  fieldKey: string;
  fieldLabel: string;
  fieldType: 'string' | 'number' | 'boolean' | 'date' | 'datetime';
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'between' | 'contains' | 'in';
  value: string | number | boolean;
  valueTo?: string | number;
  source: 'recommendation' | 'manual';
}

export interface SegmentPreviewSummary {
  estimatedAudienceSize: number;
  audienceRate: number;
  deltaFromPreviousPreview?: number;
  topConstrainingConditions: string[];
  warnings: SegmentPreviewWarning[];
  sampleRows: SegmentPreviewRow[];
}

export interface SegmentPreviewWarning {
  code: 'ZERO_AUDIENCE' | 'TOO_BROAD' | 'CONFLICTING_RULES' | 'MISSING_OUTPUT_TARGET';
  severity: 'info' | 'warning' | 'error';
  message: string;
}

export interface SegmentPreviewRow {
  customerKey: string;
  displayName?: string;
  attributes: Record<string, string | number | boolean | null>;
  matchedReasons: string[];
}

export interface SegmentOutputConfig {
  outputs: SegmentOutputType[];
  flagConfig?: SegmentFlagConfig;
  listConfig?: SegmentListConfig;
  csvConfig?: SegmentCsvConfig;
  externalConfig?: SegmentExternalConfig;
  executionTiming: 'now' | 'later';
}

export interface SegmentFlagConfig {
  tableName: string;
  flagColumnName: string;
  overwriteMode: 'overwrite' | 'append' | 'skip';
}

export interface SegmentListConfig {
  tableName: string;
  listName: string;
}

export interface SegmentCsvConfig {
  fileName: string;
  includeColumns: string[];
}

export interface SegmentExternalConfig {
  destinationKey: string;
  payloadFormat: 'csv' | 'json';
}

export interface SegmentSaveResult {
  segmentId: string;
  segmentExecutionId?: string;
  status: 'saved' | 'queued' | 'completed' | 'failed';
  outputTypes: SegmentOutputType[];
  outputLocation?: string;
  affectedRowCount?: number;
  executedBy: string;
  savedAt: string;
}
