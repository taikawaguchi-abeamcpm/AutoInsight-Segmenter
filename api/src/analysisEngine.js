const { fetchTableRows } = require('./fabricClient');
const { buildAnalysisSummary } = require('./semanticModel');

const nowIso = () => new Date().toISOString();

const isMissing = (value) => value === null || value === undefined || value === '';

const toNumber = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

const normalizeBool = (value, targetConfig = {}) => {
  if (isMissing(value)) return undefined;
  if (targetConfig.positiveValue !== undefined && String(value) === String(targetConfig.positiveValue)) return 1;
  if (targetConfig.negativeValue !== undefined && String(value) === String(targetConfig.negativeValue)) return 0;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number') return value !== 0 ? 1 : 0;

  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'won', 'success', 'converted', '成約', 'あり'].includes(normalized)) return 1;
  if (['false', '0', 'no', 'n', 'lost', 'failure', 'not_converted', '未成約', 'なし'].includes(normalized)) return 0;
  return undefined;
};

const mean = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);

const stddev = (values) => {
  if (values.length < 2) return 0;
  const avg = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1));
};

const clampScore = (value) => Math.max(0, Math.min(100, Math.round(value)));

const percentile = (values, ratio) => {
  if (!values.length) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * ratio)))];
};

const categoryForTable = (tableName = '') => {
  const name = tableName.toLowerCase();
  if (/(order|purchase|transaction|sales|invoice|contract)/.test(name)) return 'transaction';
  if (/(event|log|click|web|visit|activity|engagement)/.test(name)) return 'behavior';
  return 'profile';
};

const analyzeNumericFeature = ({ rows, feature, targetColumnName, baselineRate, minGroupCount }) => {
  const pairs = rows
    .map((row) => ({ value: toNumber(row[feature.sourceColumnName]), target: row[targetColumnName] }))
    .filter((item) => item.value !== undefined);
  if (pairs.length < minGroupCount * 2) return null;

  const positives = pairs.filter((item) => item.target === 1).map((item) => item.value);
  const negatives = pairs.filter((item) => item.target === 0).map((item) => item.value);
  if (positives.length < minGroupCount || negatives.length < minGroupCount) return null;

  const values = pairs.map((item) => item.value);
  const posMean = mean(positives);
  const negMean = mean(negatives);
  const spread = stddev(values) || 1;
  const effect = (posMean - negMean) / spread;
  const direction = Math.abs(effect) < 0.05 ? 'neutral' : effect > 0 ? 'positive' : 'negative';
  const threshold = percentile(values, direction === 'negative' ? 0.25 : 0.75);
  if (threshold === undefined) return null;

  const matched = pairs.filter((item) => (direction === 'negative' ? item.value <= threshold : item.value >= threshold));
  const matchedPositives = matched.filter((item) => item.target === 1).length;
  const matchedRate = matched.length ? matchedPositives / matched.length : 0;
  const delta = matchedRate - baselineRate;

  return {
    score: clampScore(Math.abs(effect) * 45 + Math.abs(delta) * 100),
    direction,
    pattern: {
      matchedCount: matched.length,
      conversionRate: matchedRate,
      supportRate: matched.length / rows.length,
      conversionDelta: delta,
      lift: baselineRate > 0 ? matchedRate / baselineRate : undefined,
      condition: {
        featureKey: feature.featureKey,
        operator: direction === 'negative' ? 'lte' : 'gte',
        value: Number(threshold.toFixed(4)),
        label: `${feature.label} が ${Number(threshold.toFixed(4))} ${direction === 'negative' ? '以下' : '以上'}`
      }
    }
  };
};

const analyzeCategoricalFeature = ({ rows, feature, targetColumnName, baselineRate, minGroupCount }) => {
  const groups = new Map();
  let observed = 0;
  rows.forEach((row) => {
    const raw = row[feature.sourceColumnName];
    if (isMissing(raw)) return;
    observed += 1;
    const key = String(raw);
    const group = groups.get(key) || { count: 0, positives: 0 };
    group.count += 1;
    group.positives += row[targetColumnName] === 1 ? 1 : 0;
    groups.set(key, group);
  });

  let best = null;
  for (const [value, group] of groups.entries()) {
    if (group.count < minGroupCount) continue;
    const conversionRate = group.positives / group.count;
    const delta = conversionRate - baselineRate;
    const candidate = {
      value,
      count: group.count,
      conversionRate,
      delta
    };
    if (!best || Math.abs(candidate.delta) > Math.abs(best.delta)) {
      best = candidate;
    }
  }

  if (!best || observed === 0) return null;
  const direction = Math.abs(best.delta) < 0.01 ? 'neutral' : best.delta > 0 ? 'positive' : 'negative';

  return {
    score: clampScore(Math.abs(best.delta) * 120 * Math.sqrt(best.count / rows.length)),
    direction,
    pattern: {
      matchedCount: best.count,
      conversionRate: best.conversionRate,
      supportRate: best.count / rows.length,
      conversionDelta: best.delta,
      lift: baselineRate > 0 ? best.conversionRate / baselineRate : undefined,
      condition: {
        featureKey: feature.featureKey,
        operator: 'eq',
        value: best.value,
        label: `${feature.label} が ${best.value}`
      }
    }
  };
};

const failedResult = ({ analysisJobId, runId, mapping, dataset, config, message }) => ({
  id: analysisJobId,
  analysisJobId,
  runId,
  datasetId: dataset.id,
  mappingDocumentId: mapping.id,
  mode: config?.mode || 'custom',
  status: 'failed',
  progressPercent: 100,
  message,
  createdAt: nowIso(),
  startedAt: nowIso(),
  completedAt: nowIso(),
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

const buildRealAnalysisResult = async ({ connection, req, analysisJobId, runId, mapping, dataset, config }) => {
  const summary = buildAnalysisSummary(mapping, dataset);
  const tableById = new Map(dataset.tables.map((table) => [table.id, table]));
  const columnById = new Map(dataset.tables.flatMap((table) => table.columns.map((column) => [column.id, { table, column }])));
  const targetMapping = mapping.columnMappings.find((column) => column.columnRole === 'target') || mapping.columnMappings.find((column) => column.targetConfig);
  const target = targetMapping ? columnById.get(targetMapping.columnId) : null;
  if (!target) {
    return failedResult({ analysisJobId, runId, mapping, dataset, config, message: '目的変数カラムが見つからないため、実データ分析を開始できませんでした。' });
  }

  const selectedKeys = config?.mode === 'custom' ? new Set(config.selectedFeatureKeys || []) : null;
  const featureMappings = mapping.columnMappings
    .filter((column) => column.columnRole === 'feature' && column.featureConfig?.enabled)
    .filter((column) => !selectedKeys || selectedKeys.has(column.featureConfig.featureKey));
  const sameTableFeatures = featureMappings
    .map((column) => {
      const item = columnById.get(column.columnId);
      if (!item || item.table.id !== target.table.id) return null;
      return {
        featureKey: column.featureConfig.featureKey,
        label: column.featureConfig.label || column.businessName,
        sourceColumnName: item.column.name,
        dataType: item.column.dataType,
        category: categoryForTable(item.table.name),
        aggregation: column.featureConfig.aggregation,
        tableName: item.table.displayName
      };
    })
    .filter(Boolean);

  if (sameTableFeatures.length === 0) {
    return failedResult({ analysisJobId, runId, mapping, dataset, config, message: '現時点の実分析は目的変数と同じテーブル上の特徴量に対応しています。同一テーブルの特徴量を選択してください。' });
  }

  const columnNames = [target.column.name, ...sameTableFeatures.map((feature) => feature.sourceColumnName)];
  const { rows: rawRows, truncated } = await fetchTableRows(connection, req, target.table.name, columnNames);
  const rows = rawRows
    .map((row) => ({ ...row, [target.column.name]: normalizeBool(row[target.column.name], targetMapping.targetConfig) }))
    .filter((row) => row[target.column.name] !== undefined);

  if (rows.length === 0) {
    return failedResult({ analysisJobId, runId, mapping, dataset, config, message: '目的変数を二値として判定できる行がありませんでした。目的変数の役割または正例/負例の値を確認してください。' });
  }

  const positiveCount = rows.filter((row) => row[target.column.name] === 1).length;
  const baselineRate = positiveCount / rows.length;
  const minGroupCount = Math.max(3, Math.ceil(rows.length * 0.02));
  const importances = [];

  sameTableFeatures.forEach((feature) => {
    const missingCount = rows.filter((row) => isMissing(row[feature.sourceColumnName])).length;
    const analysis =
      feature.dataType === 'integer' || feature.dataType === 'float'
        ? analyzeNumericFeature({ rows, feature, targetColumnName: target.column.name, baselineRate, minGroupCount })
        : analyzeCategoricalFeature({ rows, feature, targetColumnName: target.column.name, baselineRate, minGroupCount });

    if (!analysis) return;
    importances.push({
      feature,
      analysis,
      result: {
        featureKey: feature.featureKey,
        label: feature.label,
        category: feature.category,
        importanceScore: analysis.score,
        direction: analysis.direction,
        aggregation: feature.aggregation,
        missingRate: missingCount / rows.length,
        description: `${target.table.displayName}.${feature.sourceColumnName} を実データ ${rows.length.toLocaleString('ja-JP')} 行で集計し、目的変数 ${target.column.displayName} との差を評価しました。`
      }
    });
  });

  importances.sort((left, right) => right.result.importanceScore - left.result.importanceScore);
  const topImportances = importances.slice(0, config?.maxFeatureCount || 20);
  const patterns = topImportances
    .filter((item) => item.analysis.pattern.matchedCount >= minGroupCount)
    .slice(0, config?.patternCount || 5)
    .map((item, index) => ({
      id: `pattern-real-${index + 1}`,
      title: `${item.feature.label} による差分`,
      conditions: [item.analysis.pattern.condition],
      supportRate: item.analysis.pattern.supportRate,
      lift: item.analysis.pattern.lift,
      conversionDelta: item.analysis.pattern.conversionDelta,
      confidence: Math.min(0.95, Math.max(0.35, item.result.importanceScore / 100)),
      description: `${item.analysis.pattern.matchedCount.toLocaleString('ja-JP')} 行で ${summary.target.label} の比率が ${Math.round(item.analysis.pattern.conversionRate * 1000) / 10}% でした。全体平均との差は ${Math.round(item.analysis.pattern.conversionDelta * 1000) / 10}pt です。`,
      recommendedAction: 'この条件をセグメント候補として施策検証してください。'
    }));

  const segments = patterns.map((pattern, index) => ({
    id: `segment-real-${index + 1}`,
    name: `${pattern.conditions[0].label} セグメント`,
    description: '実データ集計で目的変数との差が出た顧客グループです。',
    sourcePatternId: pattern.id,
    estimatedAudienceSize: Math.round(pattern.supportRate * rows.length),
    estimatedConversionRate: baselineRate + (pattern.conversionDelta || 0),
    conditions: pattern.conditions,
    useCase: '施策検証',
    priorityScore: clampScore((pattern.conversionDelta || 0) * 100 + pattern.supportRate * 40 + 50)
  }));

  return {
    id: analysisJobId,
    analysisJobId,
    runId,
    datasetId: dataset.id,
    mappingDocumentId: mapping.id,
    mode: config?.mode || 'custom',
    status: 'completed',
    progressPercent: 100,
    message: `Fabric実データ ${rows.length.toLocaleString('ja-JP')} 行を集計して分析しました。${truncated ? '上限行数までの集計です。' : ''}`,
    createdAt: nowIso(),
    startedAt: nowIso(),
    completedAt: nowIso(),
    summary: {
      analyzedRowCount: rows.length,
      topFeatureCount: topImportances.length,
      validPatternCount: patterns.length,
      recommendedSegmentCount: segments.length,
      baselineMetricValue: baselineRate,
      improvedMetricValue: patterns[0] ? baselineRate + (patterns[0].conversionDelta || 0) : undefined,
      improvementRate: patterns[0] && baselineRate > 0 ? (baselineRate + (patterns[0].conversionDelta || 0)) / baselineRate - 1 : undefined
    },
    featureImportances: topImportances.map((item) => item.result),
    interactionPairs: [],
    goldenPatterns: patterns,
    segmentRecommendations: segments
  };
};

module.exports = {
  buildRealAnalysisResult
};
