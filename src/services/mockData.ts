import type { AnalysisInputSummary } from '../types/analysis';
import type { DatasetListItem, DatasetPreview } from '../types/dataset';
import type { FabricDataset, SemanticMappingDocument } from '../types/mapping';
import type { AnalysisResultDocument, SegmentRecommendation } from '../types/results';
import type { SegmentDraft } from '../types/segment';

export const nowIso = () => new Date().toISOString();

export const mockDatasets: DatasetListItem[] = [
  {
    id: 'ds-commerce-001',
    name: 'commerce_customer_analytics',
    displayName: 'EC 顧客・購買データ',
    workspaceId: 'ws-marketing',
    workspaceName: 'Marketing Fabric',
    description: '顧客マスタ、注文、Web 行動、メール接触を横断した分析用データセット。',
    tags: ['CRM', 'EC', 'Web 行動'],
    tableCount: 8,
    lastSyncedAt: '2026-04-24T02:15:00Z',
    connectionStatus: 'ready',
    recommended: true,
    recommendationScore: 92,
    recommendationReasons: ['顧客IDと日時列が揃っています', '最終同期が新しいです', '分析に十分なテーブル数があります'],
    recentlyUsed: true,
    warningCodes: []
  },
  {
    id: 'ds-sales-002',
    name: 'b2b_pipeline_activity',
    displayName: 'B2B 営業活動データ',
    workspaceId: 'ws-sales',
    workspaceName: 'Sales Operations',
    description: '商談、担当者接触、案件ステージを含む営業分析向けデータ。',
    tags: ['営業活動', 'CRM'],
    tableCount: 5,
    lastSyncedAt: '2026-04-23T22:20:00Z',
    connectionStatus: 'warning',
    recommended: true,
    recommendationScore: 74,
    recommendationReasons: ['目的変数候補があります', '一部テーブルで主キー候補の確認が必要です'],
    recentlyUsed: false,
    warningCodes: ['NO_PRIMARY_KEY']
  },
  {
    id: 'ds-web-003',
    name: 'web_event_stream',
    displayName: 'Web イベントログ',
    workspaceId: 'ws-digital',
    workspaceName: 'Digital Analytics',
    description: '閲覧、クリック、フォーム到達などの匿名イベントログ。',
    tags: ['Web 行動'],
    tableCount: 3,
    lastSyncedAt: '2026-04-20T16:05:00Z',
    connectionStatus: 'forbidden',
    recommended: false,
    recommendationScore: 0,
    recommendationReasons: ['閲覧権限が不足しています'],
    recentlyUsed: false,
    warningCodes: ['ACCESS_LIMITED']
  }
];

export const mockPreviews: Record<string, DatasetPreview> = {
  'ds-commerce-001': {
    datasetId: 'ds-commerce-001',
    ownerName: 'Marketing Analytics Team',
    rowEstimate: 1245000,
    columnCount: 84,
    primaryKeyCandidateCount: 7,
    timestampColumnCount: 11,
    sampleAvailable: false,
    topTables: [
      { tableId: 'tbl-customers', tableName: 'customers', rowCount: 184000, suggestedRole: 'customer' },
      { tableId: 'tbl-orders', tableName: 'orders', rowCount: 812000, suggestedRole: 'transaction' },
      { tableId: 'tbl-web', tableName: 'web_events', rowCount: 1245000, suggestedRole: 'event' },
      { tableId: 'tbl-email', tableName: 'email_engagements', rowCount: 420000, suggestedRole: 'event' },
      { tableId: 'tbl-products', tableName: 'products', rowCount: 12500, suggestedRole: 'unknown' }
    ],
    warnings: []
  },
  'ds-sales-002': {
    datasetId: 'ds-sales-002',
    ownerName: 'Sales Operations',
    rowEstimate: 166000,
    columnCount: 52,
    primaryKeyCandidateCount: 2,
    timestampColumnCount: 6,
    sampleAvailable: false,
    topTables: [
      { tableId: 'tbl-accounts', tableName: 'accounts', rowCount: 26000, suggestedRole: 'customer' },
      { tableId: 'tbl-opportunities', tableName: 'opportunities', rowCount: 41000, suggestedRole: 'transaction' },
      { tableId: 'tbl-activities', tableName: 'activities', rowCount: 99000, suggestedRole: 'event' }
    ],
    warnings: [{ code: 'NO_PRIMARY_KEY', severity: 'warning', message: '一部テーブルで主キー候補の確認が必要です。' }]
  }
};

export const mockFabricDataset: FabricDataset = {
  id: 'ds-commerce-001',
  workspaceId: 'ws-marketing',
  name: 'commerce_customer_analytics',
  displayName: 'EC 顧客・購買データ',
  lastSyncedAt: '2026-04-24T02:15:00Z',
  tables: [
    {
      id: 'tbl-customers',
      name: 'customers',
      displayName: '顧客',
      rowCount: 184000,
      columns: [
        { id: 'col-customer-id', tableId: 'tbl-customers', name: 'customer_id', displayName: '顧客 ID', dataType: 'string', nullable: false, isPrimaryKey: true, isForeignKey: false },
        { id: 'col-pref', tableId: 'tbl-customers', name: 'prefecture', displayName: '都道府県', dataType: 'string', nullable: true, isPrimaryKey: false, isForeignKey: false, sampleValues: ['東京都', '大阪府', '福岡県'] },
        { id: 'col-rank', tableId: 'tbl-customers', name: 'loyalty_rank', displayName: '会員ランク', dataType: 'string', nullable: true, isPrimaryKey: false, isForeignKey: false, sampleValues: ['Gold', 'Silver', 'Regular'] }
      ]
    },
    {
      id: 'tbl-orders',
      name: 'orders',
      displayName: '注文',
      rowCount: 812000,
      columns: [
        { id: 'col-order-id', tableId: 'tbl-orders', name: 'order_id', displayName: '注文 ID', dataType: 'string', nullable: false, isPrimaryKey: true, isForeignKey: false },
        { id: 'col-order-customer-id', tableId: 'tbl-orders', name: 'customer_id', displayName: '顧客 ID', dataType: 'string', nullable: false, isPrimaryKey: false, isForeignKey: true },
        { id: 'col-order-at', tableId: 'tbl-orders', name: 'ordered_at', displayName: '注文日時', dataType: 'datetime', nullable: false, isPrimaryKey: false, isForeignKey: false },
        { id: 'col-amount', tableId: 'tbl-orders', name: 'order_amount', displayName: '注文金額', dataType: 'float', nullable: false, isPrimaryKey: false, isForeignKey: false }
      ]
    },
    {
      id: 'tbl-web',
      name: 'web_events',
      displayName: 'Web 行動',
      rowCount: 1245000,
      columns: [
        { id: 'col-event-id', tableId: 'tbl-web', name: 'event_id', displayName: 'イベント ID', dataType: 'string', nullable: false, isPrimaryKey: true, isForeignKey: false },
        { id: 'col-web-customer-id', tableId: 'tbl-web', name: 'customer_id', displayName: '顧客 ID', dataType: 'string', nullable: true, isPrimaryKey: false, isForeignKey: true },
        { id: 'col-event-time', tableId: 'tbl-web', name: 'event_time', displayName: 'イベント日時', dataType: 'datetime', nullable: false, isPrimaryKey: false, isForeignKey: false },
        { id: 'col-converted', tableId: 'tbl-web', name: 'is_converted', displayName: '成約フラグ', dataType: 'boolean', nullable: false, isPrimaryKey: false, isForeignKey: false }
      ]
    }
  ]
};

export const buildDefaultMapping = (datasetId: string): SemanticMappingDocument => ({
  id: `map-${datasetId}`,
  datasetId,
  version: 1,
  status: 'draft',
  tableMappings: [
    { tableId: 'tbl-customers', entityRole: 'customer_master', businessName: '顧客の基本情報', primaryKeyColumnId: 'col-customer-id', source: 'suggested', status: 'mapped' },
    { tableId: 'tbl-orders', entityRole: 'transaction_fact', businessName: '購買や成約の履歴', customerJoinColumnId: 'col-order-customer-id', source: 'suggested', status: 'mapped' },
    { tableId: 'tbl-web', entityRole: 'event_log', businessName: 'Web 行動イベント', customerJoinColumnId: 'col-web-customer-id', source: 'suggested', status: 'mapped' }
  ],
  columnMappings: [
    { columnId: 'col-customer-id', tableId: 'tbl-customers', columnRole: 'customer_id', businessName: '顧客 ID', source: 'suggested', status: 'validated', confidence: 0.98, reason: '列名と主キー属性が一致' },
    { columnId: 'col-converted', tableId: 'tbl-web', columnRole: 'target', businessName: '成約', source: 'suggested', status: 'mapped', confidence: 0.86, reason: 'is_ で始まる二値列', targetConfig: { targetKey: 'converted', label: '成約', positiveValue: 'true', negativeValue: 'false', eventTimeColumnId: 'col-event-time', evaluationWindow: { unit: 'day', value: 30 } } },
    { columnId: 'col-rank', tableId: 'tbl-customers', columnRole: 'feature', businessName: '会員ランク', source: 'suggested', status: 'mapped', confidence: 0.76, reason: '顧客属性のカテゴリ列', featureConfig: { featureKey: 'loyalty_rank', label: '会員ランク', dataType: 'string', aggregation: 'latest', missingValuePolicy: 'unknown_category', enabled: true } },
    { columnId: 'col-amount', tableId: 'tbl-orders', columnRole: 'feature', businessName: '注文金額', source: 'suggested', status: 'mapped', confidence: 0.82, reason: '購買履歴の数値列', featureConfig: { featureKey: 'order_amount_90d', label: '90日間の注文金額', dataType: 'float', aggregation: 'sum', timeWindow: { unit: 'day', value: 90 }, missingValuePolicy: 'zero_fill', enabled: true } }
  ],
  joinDefinitions: [
    { id: 'join-orders-customers', fromTableId: 'tbl-orders', fromColumnIds: ['col-order-customer-id'], toTableId: 'tbl-customers', toColumnIds: ['col-customer-id'], joinType: 'left', cardinality: 'many_to_one', confidence: 0.93, source: 'suggested' },
    { id: 'join-web-customers', fromTableId: 'tbl-web', fromColumnIds: ['col-web-customer-id'], toTableId: 'tbl-customers', toColumnIds: ['col-customer-id'], joinType: 'left', cardinality: 'many_to_one', confidence: 0.88, source: 'suggested' }
  ],
  validationIssues: [
    { id: 'map-warn-1', scope: 'mapping', severity: 'warning', code: 'MANY_TO_ONE_CONFIRMATION', message: 'Web 行動テーブルの顧客 ID 欠損を確認してください。', blocking: false }
  ],
  createdAt: nowIso(),
  updatedAt: nowIso(),
  updatedBy: 'demo.user'
});

export const buildAnalysisSummary = (mappingDocumentId: string): AnalysisInputSummary => ({
  datasetId: 'ds-commerce-001',
  datasetName: 'EC 顧客・購買データ',
  workspaceId: 'ws-marketing',
  workspaceName: 'Marketing Fabric',
  mappingDocumentId,
  customerTableName: '顧客',
  target: {
    targetKey: 'converted',
    label: '成約',
    dataType: 'binary',
    positiveValue: 'true',
    negativeValue: 'false',
    eventTimeColumnName: 'イベント日時',
    evaluationWindowDays: 30
  },
  features: [
    { featureKey: 'loyalty_rank', label: '会員ランク', sourceTableName: '顧客', sourceColumnName: 'loyalty_rank', dataType: 'string', category: 'profile', aggregation: 'latest', enabled: true, missingRate: 0.04 },
    { featureKey: 'order_amount_90d', label: '90日間の注文金額', sourceTableName: '注文', sourceColumnName: 'order_amount', dataType: 'float', category: 'transaction', aggregation: 'sum', timeWindowDays: 90, enabled: true, missingRate: 0.12 },
    { featureKey: 'web_visit_count_30d', label: '30日間の訪問回数', sourceTableName: 'Web 行動', sourceColumnName: 'event_id', dataType: 'integer', category: 'behavior', aggregation: 'count', timeWindowDays: 30, enabled: true, missingRate: 0.08 },
    { featureKey: 'email_opened_30d', label: '30日間のメール開封', sourceTableName: 'メール接触', sourceColumnName: 'opened', dataType: 'boolean', category: 'engagement', aggregation: 'count', timeWindowDays: 30, enabled: true, missingRate: 0.18 }
  ],
  relatedTables: ['注文', 'Web 行動', 'メール接触'],
  dataQuality: {
    eligibleRowCount: 184000,
    duplicateRate: 0.006,
    averageMissingRate: 0.105,
    invalidFeatureCount: 0,
    warningMessages: ['Web 行動の一部で顧客 ID が欠損しています。']
  }
});

const segmentRecommendations: SegmentRecommendation[] = [
  {
    id: 'seg-high-value-active',
    name: '高単価かつ直近アクティブ',
    description: '購買金額と Web 行動がともに高い顧客グループ。',
    sourcePatternId: 'pat-1',
    estimatedAudienceSize: 12800,
    estimatedConversionRate: 0.184,
    priorityScore: 91,
    useCase: '優待オファー、上位プラン訴求',
    conditions: [
      { featureKey: 'order_amount_90d', operator: 'gte', value: 50000, label: '90日間の注文金額が 50,000 円以上' },
      { featureKey: 'web_visit_count_30d', operator: 'gte', value: 5, label: '30日間の訪問回数が 5 回以上' }
    ]
  },
  {
    id: 'seg-gold-reactivation',
    name: 'Gold 会員の再訪促進',
    sourcePatternId: 'pat-2',
    estimatedAudienceSize: 8700,
    estimatedConversionRate: 0.151,
    priorityScore: 84,
    useCase: '休眠防止メール、限定クーポン',
    conditions: [
      { featureKey: 'loyalty_rank', operator: 'eq', value: 'Gold', label: '会員ランクが Gold' },
      { featureKey: 'web_visit_count_30d', operator: 'lt', value: 2, label: '30日間の訪問回数が 2 回未満' }
    ]
  }
];

export const mockResult: AnalysisResultDocument = {
  analysisJobId: 'job-demo-001',
  runId: 'run-demo-001',
  datasetId: 'ds-commerce-001',
  mappingDocumentId: 'map-ds-commerce-001',
  mode: 'custom',
  status: 'completed',
  progressPercent: 100,
  message: '分析が完了しました。',
  createdAt: nowIso(),
  startedAt: nowIso(),
  completedAt: nowIso(),
  summary: {
    analyzedRowCount: 184000,
    topFeatureCount: 12,
    validPatternCount: 6,
    recommendedSegmentCount: segmentRecommendations.length,
    baselineMetricValue: 0.074,
    improvedMetricValue: 0.182,
    improvementRate: 1.46
  },
  featureImportances: [
    { featureKey: 'order_amount_90d', label: '90日間の注文金額', category: 'transaction', importanceScore: 92, direction: 'positive', aggregation: 'sum', timeWindowDays: 90, missingRate: 0.12, description: '直近購買金額が高いほど成約しやすい傾向です。' },
    { featureKey: 'web_visit_count_30d', label: '30日間の訪問回数', category: 'behavior', importanceScore: 81, direction: 'positive', aggregation: 'count', timeWindowDays: 30, missingRate: 0.08 },
    { featureKey: 'email_opened_30d', label: '30日間のメール開封', category: 'engagement', importanceScore: 66, direction: 'positive', aggregation: 'count', timeWindowDays: 30, missingRate: 0.18 },
    { featureKey: 'loyalty_rank', label: '会員ランク', category: 'profile', importanceScore: 53, direction: 'neutral', aggregation: 'latest', missingRate: 0.04 }
  ],
  interactionPairs: [
    { leftFeatureKey: 'order_amount_90d', rightFeatureKey: 'web_visit_count_30d', synergyScore: 78, summary: '購買金額と再訪頻度が同時に高い場合に成約率が上がります。' }
  ],
  goldenPatterns: [
    {
      id: 'pat-1',
      title: '高単価 x 直近再訪',
      supportRate: 0.069,
      lift: 2.42,
      conversionDelta: 0.108,
      confidence: 0.86,
      description: '直近購買金額と訪問回数が高い顧客は、平均より成約率が大きく上がります。',
      recommendedAction: '上位商品や定期購入への誘導を優先します。',
      conditions: segmentRecommendations[0].conditions
    },
    {
      id: 'pat-2',
      title: 'Gold 会員の低訪問',
      supportRate: 0.047,
      lift: 1.9,
      conversionDelta: 0.077,
      confidence: 0.79,
      description: 'Gold 会員で直近訪問が少ない層は、再訪刺激への反応余地があります。',
      recommendedAction: '限定クーポンと再訪導線を組み合わせます。',
      conditions: segmentRecommendations[1].conditions
    }
  ],
  segmentRecommendations
};

export const buildSegmentDraft = (analysisJobId: string, segments: SegmentRecommendation[]): SegmentDraft => {
  const first = segments[0] ?? segmentRecommendations[0];
  return {
    id: `draft-${analysisJobId}`,
    analysisJobId,
    sourceRecommendationIds: segments.map((segment) => segment.id),
    name: first.name,
    description: first.description,
    tags: ['分析結果', '優先施策'],
    status: 'draft',
    ruleTree: {
      id: 'group-root',
      operator: 'and',
      conditions: first.conditions.map((condition, index) => ({
        id: `cond-${index + 1}`,
        fieldKey: condition.featureKey,
        fieldLabel: condition.label,
        fieldType: typeof condition.value === 'number' ? 'number' : typeof condition.value === 'boolean' ? 'boolean' : 'string',
        operator: condition.operator === 'in' ? 'in' : condition.operator,
        value: condition.value,
        valueTo: condition.valueTo,
        source: 'recommendation'
      })),
      groups: []
    },
    outputConfig: {
      outputs: ['flag', 'list'],
      flagConfig: { tableName: 'segment_outputs', flagColumnName: 'is_high_value_active', overwriteMode: 'overwrite' },
      listConfig: { tableName: 'segment_lists', listName: first.name },
      executionTiming: 'now'
    },
    previewSummary: {
      estimatedAudienceSize: first.estimatedAudienceSize,
      audienceRate: first.estimatedAudienceSize / 184000,
      deltaFromPreviousPreview: 0,
      topConstrainingConditions: first.conditions.map((condition) => condition.label),
      warnings: [{ code: 'TOO_BROAD', severity: 'info', message: '配信施策には十分な母数があります。' }],
      sampleRows: [
        { customerKey: 'C-10293', displayName: '匿名ID C-10293', attributes: { prefecture: '東京都', loyaltyRank: 'Gold' }, matchedReasons: first.conditions.map((condition) => condition.label) },
        { customerKey: 'C-18482', displayName: '匿名ID C-18482', attributes: { prefecture: '大阪府', loyaltyRank: 'Silver' }, matchedReasons: first.conditions.slice(0, 1).map((condition) => condition.label) }
      ]
    },
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
};
