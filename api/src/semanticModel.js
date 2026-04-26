const nowIso = () => new Date().toISOString();

const has = (value, pattern) => pattern.test(String(value || '').toLowerCase());

const columnRole = (column) => {
  if (has(column.name, /(^|_)(customer|account|user|member).*id$|^id$/)) return 'customer_id';
  if (has(column.name, /(created|updated|ordered|event|date|time|timestamp|at)$/)) return 'event_time';
  if (has(column.name, /(converted|conversion|purchased|churn|target|label|is_.*|flag)$/)) return 'target';
  return 'feature';
};

const validColumnRoles = new Set(['customer_id', 'event_time', 'target', 'feature', 'excluded']);

const tableRole = (table) => {
  if (has(table.name, /(customer|account|user|member|client)/)) return 'customer_master';
  if (has(table.name, /(order|purchase|transaction|sales|invoice|contract)/)) return 'transaction_fact';
  if (has(table.name, /(event|log|click|web|visit|activity|engagement)/)) return 'event_log';
  return 'dimension';
};

const featureAggregation = (dataType) => (dataType === 'integer' || dataType === 'float' ? 'sum' : 'latest');

const featureValueType = (dataType) => (dataType === 'integer' || dataType === 'float' ? 'numeric' : 'categorical');

const featureConfigForColumn = (column) => ({
  featureKey: column.name,
  label: column.displayName,
  dataType: column.dataType,
  valueType: featureValueType(column.dataType),
  aggregation: featureAggregation(column.dataType),
  missingValuePolicy: column.dataType === 'string' ? 'unknown_category' : 'zero_fill',
  enabled: true
});

const buildSemanticMapping = (dataset) => {
  const now = nowIso();
  const tableMappings = dataset.tables.map((table) => ({
    tableId: table.id,
    entityRole: tableRole(table),
    businessName: table.displayName,
    primaryKeyColumnId: table.columns.find((column) => column.isPrimaryKey)?.id,
    customerJoinColumnId: table.columns.find((column) => column.isForeignKey || has(column.name, /(customer|account|user|member).*id/))?.id,
    source: 'suggested',
    status: 'mapped'
  }));

  const columnMappings = dataset.tables.flatMap((table) =>
    table.columns.map((column) => {
      const role = columnRole(column);
      return {
        columnId: column.id,
        tableId: table.id,
        columnRole: role,
        businessName: column.displayName,
        source: 'suggested',
        status: 'mapped',
        confidence: role === 'feature' ? 0.64 : 0.82,
        reason: 'Fabric GraphQLスキーマの列名と型から推定',
        featureConfig: role === 'feature'
          ? featureConfigForColumn(column)
          : undefined,
        targetConfig: role === 'target'
          ? {
              targetKey: column.name,
              label: column.displayName,
              positiveValue: column.dataType === 'boolean' ? 'true' : undefined,
              negativeValue: column.dataType === 'boolean' ? 'false' : undefined
            }
          : undefined
      };
    })
  );

  const customerTable = tableMappings.find((table) => table.entityRole === 'customer_master');
  const joinDefinitions = customerTable
    ? tableMappings
        .filter((table) => table.tableId !== customerTable.tableId && table.customerJoinColumnId)
        .map((table) => ({
          id: `join-${table.tableId}-${customerTable.tableId}`,
          fromTableId: table.tableId,
          fromColumnIds: [table.customerJoinColumnId],
          toTableId: customerTable.tableId,
          toColumnIds: [customerTable.primaryKeyColumnId].filter(Boolean),
          joinType: 'left',
          cardinality: 'many_to_one',
          confidence: 0.72,
          source: 'suggested'
        }))
    : [];

  return {
    id: `map-${dataset.id}`,
    datasetId: dataset.id,
    version: 1,
    status: 'draft',
    tableMappings,
    columnMappings,
    joinDefinitions,
    validationIssues: customerTable
      ? []
      : [{ id: 'customer-master-missing', scope: 'mapping', severity: 'warning', code: 'CUSTOMER_MASTER_NOT_DETECTED', message: '顧客主軸テーブルを自動判定できませんでした。', blocking: false }],
    createdAt: now,
    updatedAt: now,
    updatedBy: 'system'
  };
};

const normalizeSemanticMapping = (mapping, dataset) => {
  if (!mapping) return buildSemanticMapping(dataset);

  const fallback = buildSemanticMapping(dataset);
  const tableIds = new Set(dataset.tables.map((table) => table.id));
  const columnIds = new Set(dataset.tables.flatMap((table) => table.columns.map((column) => column.id)));
  const validColumnForTable = new Map(
    dataset.tables.flatMap((table) => table.columns.map((column) => [column.id, table.id]))
  );

  const tableMappings = (mapping.tableMappings || []).filter((table) => tableIds.has(table.tableId));
  const fallbackColumnById = new Map(fallback.columnMappings.map((column) => [column.columnId, column]));
  const columnMappings = (mapping.columnMappings || [])
    .filter((column) => columnIds.has(column.columnId) && validColumnForTable.get(column.columnId) === column.tableId)
    .map((column) => {
      if (validColumnRoles.has(column.columnRole)) {
        return column;
      }

      const fallbackColumn = fallbackColumnById.get(column.columnId);
      return {
        ...column,
        columnRole: fallbackColumn?.columnRole || 'feature',
        featureConfig: fallbackColumn?.featureConfig,
        targetConfig: fallbackColumn?.targetConfig
      };
    });
  const joinDefinitions = (mapping.joinDefinitions || []).filter(
    (join) =>
      tableIds.has(join.fromTableId) &&
      tableIds.has(join.toTableId) &&
      (join.fromColumnIds || []).every((columnId) => columnIds.has(columnId)) &&
      (join.toColumnIds || []).every((columnId) => columnIds.has(columnId))
  );

  return {
    ...mapping,
    tableMappings: tableMappings.length ? tableMappings : fallback.tableMappings,
    columnMappings: columnMappings.length ? columnMappings : fallback.columnMappings,
    joinDefinitions,
    updatedAt: nowIso()
  };
};

const buildAnalysisSummary = (mapping, dataset) => {
  const tableById = new Map(dataset.tables.map((table) => [table.id, table]));
  const targetMapping = mapping.columnMappings.find((column) => column.columnRole === 'target') || mapping.columnMappings.find((column) => column.targetConfig);
  const periodMapping = mapping.columnMappings.find((column) => column.columnRole === 'event_time');
  const customerTableMapping = mapping.tableMappings.find((table) => table.entityRole === 'customer_master') || mapping.tableMappings[0];
  const customerTable = tableById.get(customerTableMapping?.tableId);
  const eligibleRowCount = typeof customerTable?.rowCount === 'number' ? Math.max(customerTable.rowCount, 0) : undefined;
  const features = mapping.columnMappings
    .filter((column) => column.columnRole === 'feature' && column.featureConfig?.enabled)
    .map((column) => {
      const table = tableById.get(column.tableId);
      const sourceColumn = table?.columns.find((item) => item.id === column.columnId);
      return {
        featureKey: column.featureConfig.featureKey,
        label: column.featureConfig.label,
        sourceTableName: table?.displayName || column.tableId,
        sourceColumnName: sourceColumn?.name || column.columnId,
        dataType: ['string', 'integer', 'float', 'boolean', 'date', 'datetime'].includes(column.featureConfig.dataType) ? column.featureConfig.dataType : 'string',
        valueType: column.featureConfig.valueType || featureValueType(column.featureConfig.dataType),
        category: tableRole(table || {}) === 'transaction_fact' ? 'transaction' : tableRole(table || {}) === 'event_log' ? 'behavior' : 'profile',
        aggregation: column.featureConfig.aggregation,
        enabled: true,
        missingRate: 0,
        piiCandidate: has(column.businessName, /(name|email|phone|address|氏名|メール|電話|住所)/)
      };
    });

  return {
    datasetId: dataset.id,
    datasetName: dataset.displayName,
    workspaceId: dataset.workspaceId,
    workspaceName: dataset.workspaceId,
    mappingDocumentId: mapping.id,
    customerTableName: customerTable?.displayName || customerTableMapping?.businessName || '未設定',
    target: {
      targetKey: targetMapping?.targetConfig?.targetKey || targetMapping?.columnId || 'target_not_set',
      label: targetMapping?.targetConfig?.label || targetMapping?.businessName || '目的変数未設定',
      dataType: 'binary',
      positiveValue: targetMapping?.targetConfig?.positiveValue,
      negativeValue: targetMapping?.targetConfig?.negativeValue,
      eventTimeColumnName: periodMapping
        ? tableById.get(periodMapping.tableId)?.columns.find((column) => column.id === periodMapping.columnId)?.displayName
        : undefined
    },
    features,
    relatedTables: dataset.tables.map((table) => table.displayName),
    dataQuality: {
      eligibleRowCount,
      duplicateRate: 0,
      averageMissingRate: 0,
      invalidFeatureCount: 0,
      warningMessages: ['現在の分析はFabric GraphQLスキーマとマッピング定義に基づく暫定スコアです。行レベル統計は今後のクエリ実行基盤で拡張します。']
    }
  };
};

const buildAnalysisResult = ({ analysisJobId, runId, mapping, dataset, config }) => {
  const summary = buildAnalysisSummary(mapping, dataset);
  const selectedKeys = config?.mode === 'custom' ? new Set(config.selectedFeatureKeys || []) : null;
  const selectedFeatures = summary.features.filter((feature) => !selectedKeys || selectedKeys.has(feature.featureKey));
  const featureImportances = selectedFeatures.map((feature, index) => ({
    featureKey: feature.featureKey,
    label: feature.label,
    category: feature.category,
    importanceScore: Math.max(35, 92 - index * 9),
    direction: feature.dataType === 'boolean' ? 'positive' : 'neutral',
    aggregation: feature.aggregation,
    timeWindowDays: feature.timeWindowDays,
    missingRate: feature.missingRate,
    description: `${feature.sourceTableName}.${feature.sourceColumnName} をマッピング定義に基づき特徴量候補として評価しました。`
  }));
  const top = featureImportances[0];

  return {
    id: analysisJobId,
    analysisJobId,
    runId,
    datasetId: dataset.id,
    mappingDocumentId: mapping.id,
    mode: config?.mode || 'custom',
    status: 'completed',
    progressPercent: 100,
    message: 'Fabricスキーマとセマンティックマッピングに基づく分析サマリを生成しました。',
    createdAt: nowIso(),
    startedAt: nowIso(),
    completedAt: nowIso(),
    summary: {
      analyzedRowCount: summary.dataQuality.eligibleRowCount,
      topFeatureCount: featureImportances.length,
      validPatternCount: top ? 1 : 0,
      recommendedSegmentCount: top ? 1 : 0,
      baselineMetricValue: undefined,
      improvedMetricValue: undefined,
      improvementRate: undefined
    },
    featureImportances,
    interactionPairs: featureImportances.length >= 2
      ? [{ leftFeatureKey: featureImportances[0].featureKey, rightFeatureKey: featureImportances[1].featureKey, synergyScore: 62, summary: '上位特徴量の組み合わせをセグメント条件候補として扱えます。' }]
      : [],
    goldenPatterns: top
      ? [{
          id: 'pattern-schema-top-feature',
          title: `${top.label} に基づく候補`,
          conditions: [{ featureKey: top.featureKey, operator: 'neq', value: '', label: `${top.label} が有効値` }],
          supportRate: undefined,
          lift: undefined,
          conversionDelta: undefined,
          confidence: 0.62,
          description: '実データスキーマとマッピングから生成した初期パターン候補です。',
          recommendedAction: '行レベル統計を追加して条件値を精査してください。'
        }]
      : [],
    segmentRecommendations: top
      ? [{
          id: 'segment-schema-top-feature',
          name: `${top.label} セグメント候補`,
          description: 'Fabricスキーマとマッピングに基づく初期セグメント候補です。',
          sourcePatternId: 'pattern-schema-top-feature',
          estimatedAudienceSize: summary.dataQuality.eligibleRowCount,
          conditions: [{ featureKey: top.featureKey, operator: 'neq', value: '', label: `${top.label} が有効値` }],
          useCase: '初期探索',
          priorityScore: 70
        }]
      : []
  };
};

module.exports = {
  buildAnalysisResult,
  buildAnalysisSummary,
  buildSemanticMapping,
  normalizeSemanticMapping
};
