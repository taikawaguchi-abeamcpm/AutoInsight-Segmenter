import type { ValidationIssue } from './common';

export type FabricDataType =
  | 'string'
  | 'integer'
  | 'float'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'timestamp'
  | 'array'
  | 'unknown';

export type SemanticEntityRole =
  | 'customer_master'
  | 'transaction_fact'
  | 'event_log'
  | 'dimension'
  | 'excluded';

export type SemanticColumnRole =
  | 'customer_id'
  | 'event_time'
  | 'target'
  | 'feature'
  | 'excluded';

export type MappingSource = 'manual' | 'suggested' | 'imported';
export type MappingStatus = 'unmapped' | 'mapped' | 'validated' | 'error';

export interface FabricDataset {
  id: string;
  workspaceId: string;
  name: string;
  displayName: string;
  lastSyncedAt: string;
  tables: FabricTable[];
}

export interface FabricTable {
  id: string;
  name: string;
  displayName: string;
  rowCount?: number;
  description?: string;
  columns: FabricColumn[];
}

export interface FabricColumn {
  id: string;
  tableId: string;
  name: string;
  displayName: string;
  dataType: FabricDataType;
  nullable: boolean;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  sampleValues?: string[];
}

export interface TableSemanticMapping {
  tableId: string;
  entityRole: SemanticEntityRole;
  businessName: string;
  description?: string;
  primaryKeyColumnId?: string;
  customerJoinColumnId?: string;
  source: MappingSource;
  status: MappingStatus;
}

export interface ColumnSemanticMapping {
  columnId: string;
  tableId: string;
  columnRole: SemanticColumnRole;
  businessName: string;
  description?: string;
  source: MappingSource;
  status: MappingStatus;
  confidence?: number;
  reason?: string;
  featureConfig?: FeatureConfig;
  targetConfig?: TargetConfig;
}

export type AggregationType = 'none' | 'count' | 'sum' | 'avg' | 'min' | 'max' | 'latest' | 'distinct_count';
export type MissingValuePolicy = 'exclude' | 'zero_fill' | 'most_frequent' | 'unknown_category';
export type FeatureValueType = 'categorical' | 'numeric';

export interface TimeWindow {
  unit: 'day' | 'week' | 'month';
  value: number;
}

export interface FeatureConfig {
  featureKey: string;
  label: string;
  dataType: FabricDataType;
  valueType: FeatureValueType;
  aggregation: AggregationType;
  timeWindow?: TimeWindow;
  missingValuePolicy: MissingValuePolicy;
  enabled: boolean;
}

export interface TargetConfig {
  targetKey: string;
  label: string;
  positiveValue?: string;
  negativeValue?: string;
  eventTimeColumnId?: string;
  evaluationWindow?: TimeWindow;
}

export interface JoinDefinition {
  id: string;
  fromTableId: string;
  fromColumnIds: string[];
  toTableId: string;
  toColumnIds: string[];
  joinType: 'left' | 'inner';
  cardinality: 'one_to_one' | 'one_to_many' | 'many_to_one' | 'many_to_many';
  confidence?: number;
  source: MappingSource;
}

export interface SemanticMappingDocument {
  id: string;
  datasetId: string;
  version: number;
  status: 'draft' | 'ready' | 'archived';
  tableMappings: TableSemanticMapping[];
  columnMappings: ColumnSemanticMapping[];
  joinDefinitions: JoinDefinition[];
  validationIssues: ValidationIssue[];
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}
