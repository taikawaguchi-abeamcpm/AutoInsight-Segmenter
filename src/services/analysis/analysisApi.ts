import { apiRequest, createApiError, delay, type RequestOptions } from '../client';
import type {
  AnalysisInputSummary,
  AnalysisMode,
  AnalysisRunConfig,
  AnalysisRunValidation,
  AutopilotAnalysisConfig,
  CustomAnalysisConfig,
  StartAnalysisResult
} from '../../types/analysis';
import type { FabricDataset, SemanticMappingDocument } from '../../types/mapping';

export interface AnalysisBootstrap {
  summary: AnalysisInputSummary;
  defaultConfig: AnalysisRunConfig | null;
}

const scopedAnalysisInputs = (
  mapping: SemanticMappingDocument,
  dataset: FabricDataset,
  config: AnalysisRunConfig
): { mapping: SemanticMappingDocument; dataset: FabricDataset } => {
  const targetMappings = mapping.columnMappings.filter((column) => column.columnRole === 'target' || column.targetConfig);
  const selectedFeatureKeys = config.mode === 'custom'
    ? new Set(config.selectedFeatureKeys)
    : new Set(
        mapping.columnMappings
          .filter((column) => column.columnRole === 'feature' && column.featureConfig?.enabled !== false)
          .filter((column) => !config.blockedColumnKeys.includes(column.featureConfig?.featureKey ?? column.columnId))
          .map((column) => column.featureConfig?.featureKey ?? column.columnId)
      );
  const selectedFeatureMappings = mapping.columnMappings.filter(
    (column) => column.columnRole === 'feature' && selectedFeatureKeys.has(column.featureConfig?.featureKey ?? column.columnId)
  );
  const requiredTableIds = new Set([
    ...targetMappings.map((column) => column.tableId),
    ...selectedFeatureMappings.map((column) => column.tableId)
  ]);
  const requiredColumnIds = new Set([
    ...targetMappings.map((column) => column.columnId),
    ...selectedFeatureMappings.map((column) => column.columnId)
  ]);

  mapping.tableMappings
    .filter((table) => requiredTableIds.has(table.tableId))
    .forEach((table) => {
      [table.primaryKeyColumnId, table.customerJoinColumnId].filter(Boolean).forEach((columnId) => requiredColumnIds.add(columnId as string));
    });

  mapping.joinDefinitions
    .filter((join) => requiredTableIds.has(join.fromTableId) || requiredTableIds.has(join.toTableId))
    .forEach((join) => {
      requiredTableIds.add(join.fromTableId);
      requiredTableIds.add(join.toTableId);
      join.fromColumnIds.forEach((columnId) => requiredColumnIds.add(columnId));
      join.toColumnIds.forEach((columnId) => requiredColumnIds.add(columnId));
    });

  mapping.columnMappings
    .filter((column) => requiredTableIds.has(column.tableId) && ['customer_id', 'event_time'].includes(column.columnRole))
    .forEach((column) => requiredColumnIds.add(column.columnId));

  const scopedDataset: FabricDataset = {
    id: dataset.id,
    workspaceId: dataset.workspaceId,
    name: dataset.name,
    displayName: dataset.displayName,
    lastSyncedAt: dataset.lastSyncedAt,
    tables: dataset.tables
      .filter((table) => requiredTableIds.has(table.id))
      .map((table) => ({
        id: table.id,
        name: table.name,
        displayName: table.displayName,
        rowCount: table.rowCount,
        columns: table.columns
          .filter((column) => requiredColumnIds.has(column.id))
          .map((column) => ({
            id: column.id,
            tableId: column.tableId,
            name: column.name,
            displayName: column.displayName,
            dataType: column.dataType,
            nullable: column.nullable,
            isPrimaryKey: column.isPrimaryKey,
            isForeignKey: column.isForeignKey
          }))
      }))
      .filter((table) => table.columns.length > 0)
  };
  const scopedTableIds = new Set(scopedDataset.tables.map((table) => table.id));
  const scopedColumnIds = new Set(scopedDataset.tables.flatMap((table) => table.columns.map((column) => column.id)));

  return {
    dataset: scopedDataset,
    mapping: {
      id: mapping.id,
      datasetId: mapping.datasetId,
      version: mapping.version,
      status: mapping.status,
      createdAt: mapping.createdAt,
      updatedAt: mapping.updatedAt,
      updatedBy: mapping.updatedBy,
      validationIssues: [],
      tableMappings: mapping.tableMappings
        .filter((table) => scopedTableIds.has(table.tableId))
        .map((table) => ({
          tableId: table.tableId,
          entityRole: table.entityRole,
          businessName: table.businessName,
          primaryKeyColumnId: table.primaryKeyColumnId,
          customerJoinColumnId: table.customerJoinColumnId,
          source: table.source,
          status: table.status
        })),
      columnMappings: mapping.columnMappings
        .filter((column) => scopedTableIds.has(column.tableId) && scopedColumnIds.has(column.columnId))
        .map((column) => ({
          columnId: column.columnId,
          tableId: column.tableId,
          columnRole: column.columnRole,
          businessName: column.businessName,
          source: column.source,
          status: column.status,
          featureConfig: column.featureConfig
            ? {
                featureKey: column.featureConfig.featureKey,
                label: column.featureConfig.label,
                dataType: column.featureConfig.dataType,
                valueType: column.featureConfig.valueType,
                aggregation: column.featureConfig.aggregation,
                timeWindow: column.featureConfig.timeWindow,
                missingValuePolicy: column.featureConfig.missingValuePolicy,
                enabled: column.featureConfig.enabled
              }
            : undefined,
          targetConfig: column.targetConfig
            ? {
                targetKey: column.targetConfig.targetKey,
                label: column.targetConfig.label,
                positiveValue: column.targetConfig.positiveValue,
                negativeValue: column.targetConfig.negativeValue,
                eventTimeColumnId: column.targetConfig.eventTimeColumnId,
                evaluationWindow: column.targetConfig.evaluationWindow
              }
            : undefined
        })),
      joinDefinitions: mapping.joinDefinitions.filter(
        (join) =>
          scopedTableIds.has(join.fromTableId) &&
          scopedTableIds.has(join.toTableId) &&
          join.fromColumnIds.every((columnId) => scopedColumnIds.has(columnId)) &&
          join.toColumnIds.every((columnId) => scopedColumnIds.has(columnId))
      ).map((join) => ({
        id: join.id,
        fromTableId: join.fromTableId,
        fromColumnIds: join.fromColumnIds,
        toTableId: join.toTableId,
        toColumnIds: join.toColumnIds,
        joinType: join.joinType,
        cardinality: join.cardinality,
        source: join.source
      }))
    }
  };
};

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
      blockedColumnKeys: [],
      segmentObjective: 'unconverted_targeting'
    } satisfies AutopilotAnalysisConfig;
  }

  return {
    mode: 'custom',
    targetPositiveValue: summary.target.positiveValue ?? 'true',
    analysisUnit: 'customer',
    targetType: summary.target.dataType,
    optimizationPreference: 'balanced',
    crossValidationFolds: 5,
    maxFeatureCount: 80,
    correlationThreshold: 0.9,
    importanceMethod: 'hybrid',
    patternCount: 10,
    selectedFeatureKeys: featureKeys,
    segmentObjective: 'unconverted_targeting'
  } satisfies CustomAnalysisConfig;
};

export const analysisApi = {
  async bootstrap(mappingOrId: string | SemanticMappingDocument, dataset?: FabricDataset, options: RequestOptions = {}): Promise<AnalysisBootstrap> {
    if (typeof mappingOrId !== 'string' && dataset) {
      const response = await apiRequest<AnalysisBootstrap>('/analysis/bootstrap', {
        method: 'POST',
        body: JSON.stringify({ mapping: mappingOrId, dataset }),
        signal: options.signal
      });
      if (response) {
        return {
          ...response,
          defaultConfig: response.defaultConfig ?? createDefaultConfig(response.summary, 'custom')
        };
      }
    }

    throw createApiError({
      code: 'ANALYSIS_BOOTSTRAP_UNAVAILABLE',
      message: '実データ分析の入力サマリを取得できません。API接続とFabric接続を確認してください。',
      retryable: true
    });
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

    if (config.mode === 'custom' && !config.targetPositiveValue.trim()) {
      issues.push({
        id: 'missing-target-positive-value',
        scope: 'analysis' as const,
        severity: 'error' as const,
        code: 'MISSING_TARGET_POSITIVE_VALUE',
        message: '目的変数の正解の値を入力してください。',
        blocking: true
      });
    }

    if (typeof summary.dataQuality.eligibleRowCount === 'number' && summary.dataQuality.eligibleRowCount > 0 && summary.dataQuality.eligibleRowCount < 100) {
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
      estimatedDurationSeconds: config.mode === 'autopilot' ? 180 : 90,
      issues
    };
  },

  async start(mappingOrId: string | SemanticMappingDocument, config: AnalysisRunConfig, options: RequestOptions = {}, dataset?: FabricDataset): Promise<StartAnalysisResult> {
    const mappingDocumentId = typeof mappingOrId === 'string' ? mappingOrId : mappingOrId.id;
    const scoped = typeof mappingOrId === 'string' || !dataset ? null : scopedAnalysisInputs(mappingOrId, dataset, config);
    const response = await apiRequest<StartAnalysisResult>('/analysis/start', {
      method: 'POST',
      body: JSON.stringify({
        mappingDocumentId,
        mapping: scoped?.mapping ?? (typeof mappingOrId === 'string' ? undefined : mappingOrId),
        dataset: scoped?.dataset ?? dataset,
        config
      }),
      signal: options.signal
    });
    if (response) {
      return response;
    }

    throw createApiError({
      code: 'ANALYSIS_START_UNAVAILABLE',
      message: '実データ分析を開始できません。API接続とFabric接続を確認してください。',
      retryable: true
    });
  }
};
