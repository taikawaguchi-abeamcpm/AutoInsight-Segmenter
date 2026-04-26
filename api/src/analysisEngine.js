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

const toTimestamp = (value) => {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
};

const normalizeBool = (value, targetConfig = {}) => {
  if (isMissing(value)) return undefined;
  if (targetConfig.positiveValue !== undefined) {
    if (String(value) === String(targetConfig.positiveValue)) return 1;
    if (targetConfig.negativeValue !== undefined) {
      return String(value) === String(targetConfig.negativeValue) ? 0 : undefined;
    }
    return 0;
  }
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

const formatRate = (value) => `${Math.round(value * 1000) / 10}%`;

const formatPointDelta = (value) => `${Math.round(value * 1000) / 10}pt`;

const patternDirectionText = (delta) => (delta >= 0 ? '高い' : '低い');

const percentile = (values, ratio) => {
  if (!values.length) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * ratio)))];
};

const mode = (values) => {
  const counts = new Map();
  values.forEach((value) => counts.set(String(value), (counts.get(String(value)) || 0) + 1));
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0];
};

const categoryForTable = (tableName = '') => {
  const name = tableName.toLowerCase();
  if (/(order|purchase|transaction|sales|invoice|contract|deal|opportunity)/.test(name)) return 'transaction';
  if (/(event|log|click|web|visit|activity|engagement|appointment|task|call|meeting|interaction)/.test(name)) return 'behavior';
  return 'profile';
};

const categoryForEntityRole = (role, tableName) => {
  if (role === 'transaction_fact') return 'transaction';
  if (role === 'event_log') return 'behavior';
  return categoryForTable(tableName);
};

const isSequenceMiningFeature = (feature, eventTimeColumnsByTable) =>
  feature.valueType === 'categorical' &&
  eventTimeColumnsByTable.has(feature.sourceTableId) &&
  (feature.entityRole === 'transaction_fact' || feature.entityRole === 'event_log' || feature.category === 'transaction' || feature.category === 'behavior');

const columnIdMap = (dataset) => new Map(dataset.tables.flatMap((table) => table.columns.map((column) => [column.id, { table, column }])));

const edgeBetween = (mapping, leftTableId, rightTableId) => {
  const join = (mapping.joinDefinitions || []).find(
    (item) =>
      (item.fromTableId === leftTableId && item.toTableId === rightTableId) ||
      (item.fromTableId === rightTableId && item.toTableId === leftTableId)
  );
  if (!join || join.fromColumnIds.length !== 1 || join.toColumnIds.length !== 1) return null;

  if (join.fromTableId === leftTableId) {
    return { leftColumnId: join.fromColumnIds[0], rightColumnId: join.toColumnIds[0], join };
  }

  return { leftColumnId: join.toColumnIds[0], rightColumnId: join.fromColumnIds[0], join };
};

const findFeaturePlan = (mapping, dataset, targetTableId, featureTableId) => {
  if (targetTableId === featureTableId) return { kind: 'same' };

  const direct = edgeBetween(mapping, targetTableId, featureTableId);
  if (direct) {
    return {
      kind: 'join',
      targetKeyColumnId: direct.leftColumnId,
      featureKeyColumnId: direct.rightColumnId
    };
  }

  for (const hub of dataset.tables) {
    if (hub.id === targetTableId || hub.id === featureTableId) continue;
    const targetToHub = edgeBetween(mapping, targetTableId, hub.id);
    const featureToHub = edgeBetween(mapping, featureTableId, hub.id);
    if (targetToHub && featureToHub) {
      return {
        kind: 'join',
        targetKeyColumnId: targetToHub.leftColumnId,
        featureKeyColumnId: featureToHub.leftColumnId,
        hubTableId: hub.id
      };
    }
  }

  return null;
};

const aggregateValues = (values, feature) => {
  const present = values
    .map((item) => (item && typeof item === 'object' && Object.prototype.hasOwnProperty.call(item, 'value') ? item : { value: item }))
    .filter((item) => !isMissing(item.value))
    .sort((left, right) => {
      if (left.at === undefined || right.at === undefined) return 0;
      return left.at - right.at;
    });
  if (present.length === 0) return undefined;

  const aggregation = feature.aggregation || 'latest';
  const rawValues = present.map((item) => item.value);
  const numericValues = rawValues.map(toNumber).filter((value) => value !== undefined);
  const numericFeature = feature.valueType === 'numeric';

  if (aggregation === 'count') return present.length;
  if (aggregation === 'distinct_count') return new Set(rawValues.map(String)).size;
  if (numericFeature) {
    if (aggregation === 'sum') return numericValues.reduce((sum, value) => sum + value, 0);
    if (aggregation === 'avg') return mean(numericValues);
    if (aggregation === 'min') return Math.min(...numericValues);
    if (aggregation === 'max') return Math.max(...numericValues);
    return numericValues[numericValues.length - 1];
  }

  return aggregation === 'latest' || aggregation === 'none' ? rawValues[rawValues.length - 1] : mode(rawValues);
};

const analyzeNumericFeature = ({ rows, feature, baselineRate, minGroupCount }) => {
  const pairs = rows
    .map((row) => ({ value: toNumber(row[feature.featureKey]), target: row.__target }))
    .filter((item) => item.value !== undefined);
  if (pairs.length < minGroupCount * 2) return null;

  const positives = pairs.filter((item) => item.target === 1).map((item) => item.value);
  const negatives = pairs.filter((item) => item.target === 0).map((item) => item.value);
  if (positives.length < minGroupCount || negatives.length < minGroupCount) return null;

  const values = pairs.map((item) => item.value);
  const effect = (mean(positives) - mean(negatives)) / (stddev(values) || 1);
  const direction = Math.abs(effect) < 0.05 ? 'neutral' : effect > 0 ? 'positive' : 'negative';
  const threshold = percentile(values, direction === 'negative' ? 0.25 : 0.75);
  if (threshold === undefined) return null;

  const matched = pairs.filter((item) => (direction === 'negative' ? item.value <= threshold : item.value >= threshold));
  const matchedRate = matched.length ? matched.filter((item) => item.target === 1).length / matched.length : 0;
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

const analyzeCategoricalFeature = ({ rows, feature, baselineRate, minGroupCount }) => {
  const groups = new Map();
  rows.forEach((row) => {
    const raw = row[feature.featureKey];
    if (isMissing(raw)) return;
    const key = String(raw);
    const group = groups.get(key) || { count: 0, positives: 0 };
    group.count += 1;
    group.positives += row.__target === 1 ? 1 : 0;
    groups.set(key, group);
  });

  let best = null;
  for (const [value, group] of groups.entries()) {
    if (group.count < minGroupCount) continue;
    const conversionRate = group.positives / group.count;
    const delta = conversionRate - baselineRate;
    const candidate = { value, count: group.count, conversionRate, delta };
    if (!best || Math.abs(candidate.delta) > Math.abs(best.delta)) best = candidate;
  }

  if (!best) return null;
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

const buildFeatureDescriptors = (mapping, dataset, target, config) => {
  const columns = columnIdMap(dataset);
  const tableMappingById = new Map((mapping.tableMappings || []).map((table) => [table.tableId, table]));
  const selectedKeys = config?.mode === 'custom' ? new Set(config.selectedFeatureKeys || []) : null;

  return mapping.columnMappings
    .filter((column) => column.columnRole === 'feature' && column.featureConfig?.enabled)
    .filter((column) => !selectedKeys || selectedKeys.has(column.featureConfig.featureKey))
    .map((column) => {
      const item = columns.get(column.columnId);
      if (!item) return null;
      const plan = findFeaturePlan(mapping, dataset, target.table.id, item.table.id);
      if (!plan) return null;
      const tableMapping = tableMappingById.get(item.table.id);

      return {
        featureKey: column.featureConfig.featureKey,
        label: column.featureConfig.label || column.businessName,
        sourceColumnName: item.column.name,
        sourceColumnId: item.column.id,
        sourceTableId: item.table.id,
        sourceTableName: item.table.name,
        sourceTableDisplayName: item.table.displayName,
        dataType: item.column.dataType,
        valueType: column.featureConfig.valueType || (item.column.dataType === 'integer' || item.column.dataType === 'float' ? 'numeric' : 'categorical'),
        entityRole: tableMapping?.entityRole,
        category: categoryForEntityRole(tableMapping?.entityRole, item.table.name),
        aggregation: column.featureConfig.aggregation,
        plan
      };
    })
    .filter(Boolean);
};

const resolveEventTimeColumnsByTable = (mapping, dataset) => {
  const columns = columnIdMap(dataset);
  const byTable = new Map();
  (mapping.columnMappings || [])
    .filter((column) => column.columnRole === 'event_time')
    .forEach((mappingColumn) => {
      if (byTable.has(mappingColumn.tableId)) return;
      const item = columns.get(mappingColumn.columnId);
      if (item) byTable.set(mappingColumn.tableId, item.column);
    });
  return byTable;
};

const materializeAnalysisRows = async ({ connection, req, dataset, target, targetConfig, features, eventTimeColumnsByTable }) => {
  const columns = columnIdMap(dataset);
  const targetKeyColumnIds = features.map((feature) => feature.plan.targetKeyColumnId).filter(Boolean);
  const sameTableColumns = features.filter((feature) => feature.plan.kind === 'same').map((feature) => feature.sourceColumnName);
  const targetKeyColumns = targetKeyColumnIds.map((columnId) => columns.get(columnId)?.column.name).filter(Boolean);
  const targetFetchColumns = [target.column.name, ...targetKeyColumns, ...sameTableColumns];
  const { rows: rawTargetRows, truncated } = await fetchTableRows(connection, req, target.table.name, targetFetchColumns);
  const rows = rawTargetRows
    .map((row, index) => ({
      __rowId: index,
      __target: normalizeBool(row[target.column.name], targetConfig),
      __sequences: {},
      __raw: row
    }))
    .filter((row) => row.__target !== undefined);

  const rowById = new Map(rows.map((row) => [row.__rowId, row]));

  features
    .filter((feature) => feature.plan.kind === 'same')
    .forEach((feature) => {
      rows.forEach((row) => {
        row[feature.featureKey] = row.__raw[feature.sourceColumnName];
      });
    });

  for (const feature of features.filter((item) => item.plan.kind === 'join')) {
    const targetKeyName = columns.get(feature.plan.targetKeyColumnId)?.column.name;
    const featureKeyName = columns.get(feature.plan.featureKeyColumnId)?.column.name;
    if (!targetKeyName || !featureKeyName) continue;

    const targetRowsByKey = new Map();
    rows.forEach((row) => {
      const key = row.__raw[targetKeyName];
      if (isMissing(key)) return;
      const textKey = String(key);
      const bucket = targetRowsByKey.get(textKey) || [];
      bucket.push(row.__rowId);
      targetRowsByKey.set(textKey, bucket);
    });
    if (targetRowsByKey.size === 0) continue;

    const featureEventTimeColumnName = eventTimeColumnsByTable.get(feature.sourceTableId)?.name;
    const { rows: featureRows } = await fetchTableRows(connection, req, feature.sourceTableName, [
      featureKeyName,
      feature.sourceColumnName,
      featureEventTimeColumnName
    ]);
    const featureValuesByKey = new Map();
    featureRows.forEach((featureRow) => {
      const key = featureRow[featureKeyName];
      if (isMissing(key)) return;
      const textKey = String(key);
      const bucket = featureValuesByKey.get(textKey) || [];
      bucket.push({
        value: featureRow[feature.sourceColumnName],
        at: featureEventTimeColumnName ? toTimestamp(featureRow[featureEventTimeColumnName]) : undefined
      });
      featureValuesByKey.set(textKey, bucket);
    });

    targetRowsByKey.forEach((rowIds, key) => {
      const values = featureValuesByKey.get(key) || [];
      const orderedValues = values
        .filter((item) => !isMissing(item.value))
        .sort((left, right) => {
          if (left.at === undefined || right.at === undefined) return 0;
          return left.at - right.at;
        })
        .map((item) => String(item.value));
      const aggregated = aggregateValues(values, feature);
      rowIds.forEach((rowId) => {
        const row = rowById.get(rowId);
        if (row) {
          row[feature.featureKey] = aggregated;
          if (isSequenceMiningFeature(feature, eventTimeColumnsByTable)) {
            row.__sequences[feature.featureKey] = orderedValues;
          }
        }
      });
    });
  }

  rows.forEach((row) => {
    delete row.__raw;
  });

  return { rows, truncated };
};

const matchesCondition = (row, condition) => {
  const value = row[condition.featureKey];
  if (condition.operator === 'eq') return String(value) === String(condition.value);
  if (condition.operator === 'neq') return String(value) !== String(condition.value);
  const numeric = toNumber(value);
  if (numeric === undefined) return false;
  if (condition.operator === 'gt') return numeric > condition.value;
  if (condition.operator === 'gte') return numeric >= condition.value;
  if (condition.operator === 'lt') return numeric < condition.value;
  if (condition.operator === 'lte') return numeric <= condition.value;
  if (condition.operator === 'between') return numeric >= condition.value && numeric <= condition.valueTo;
  return false;
};

const mineSequentialRouteFeatures = ({ rows, features, baselineRate, minGroupCount, eventTimeColumnsByTable, maxRoutes = 5 }) => {
  const candidates = [];
  const routeLengths = [2, 3];

  features
    .filter((feature) => isSequenceMiningFeature(feature, eventTimeColumnsByTable))
    .forEach((feature) => {
      const groups = new Map();

      rows.forEach((row, rowIndex) => {
        const sequence = row.__sequences?.[feature.featureKey] || [];
        if (sequence.length < 2) return;

        const rowRoutes = new Set();
        routeLengths.forEach((length) => {
          if (sequence.length < length) return;
          for (let index = 0; index <= sequence.length - length; index += 1) {
            rowRoutes.add(sequence.slice(index, index + length).join(' → '));
          }
        });

        rowRoutes.forEach((route) => {
          const group = groups.get(route) || { count: 0, positives: 0, rowIndexes: [] };
          group.count += 1;
          group.positives += row.__target === 1 ? 1 : 0;
          group.rowIndexes.push(rowIndex);
          groups.set(route, group);
        });
      });

      for (const [route, group] of groups.entries()) {
        if (group.count < minGroupCount) continue;
        const conversionRate = group.positives / group.count;
        const delta = conversionRate - baselineRate;
        if (delta <= 0) continue;

        candidates.push({ feature, route, group, conversionRate, delta });
      }
    });

  candidates.sort((left, right) => {
    const leftScore = left.delta * Math.sqrt(left.group.count);
    const rightScore = right.delta * Math.sqrt(right.group.count);
    return rightScore - leftScore;
  });

  return candidates.slice(0, maxRoutes).map((candidate, index) => {
    const featureKey = `seq_route_${index + 1}`;
    const matchedRowIndexes = new Set(candidate.group.rowIndexes);
    rows.forEach((row, rowIndex) => {
      row[featureKey] = matchedRowIndexes.has(rowIndex);
    });

    const score = clampScore(65 + candidate.delta * 120 * Math.sqrt(candidate.group.count / rows.length));
    const label = `黄金ルート: ${candidate.route}`;

    return {
      feature: {
        featureKey,
        label,
        category: 'derived',
        aggregation: 'none',
        valueType: 'categorical',
        sourceTableDisplayName: candidate.feature.sourceTableDisplayName,
        sourceColumnName: candidate.feature.sourceColumnName
      },
      analysis: {
        score,
        direction: 'positive',
        pattern: {
          matchedCount: candidate.group.count,
          conversionRate: candidate.conversionRate,
          supportRate: candidate.group.count / rows.length,
          conversionDelta: candidate.delta,
          lift: baselineRate > 0 ? candidate.conversionRate / baselineRate : undefined,
          condition: {
            featureKey,
            operator: 'eq',
            value: true,
            label
          }
        }
      },
      result: {
        featureKey,
        label,
        category: 'derived',
        importanceScore: score,
        direction: 'positive',
        aggregation: 'none',
        missingRate: 0,
        description: `${candidate.feature.sourceTableDisplayName}.${candidate.feature.sourceColumnName} の時系列から抽出した順序パターンです。正解率は全体平均より ${formatPointDelta(candidate.delta)} 高いです。`
      }
    };
  });
};

const buildInteractionPairs = (patterns, rows) => {
  if (patterns.length < 2) return [];
  const [left, right] = patterns;
  const matched = rows.filter((row) => matchesCondition(row, left.conditions[0]) && matchesCondition(row, right.conditions[0]));
  if (matched.length === 0) return [];
  const rate = matched.filter((row) => row.__target === 1).length / matched.length;

  return [{
    leftFeatureKey: left.conditions[0].featureKey,
    rightFeatureKey: right.conditions[0].featureKey,
    synergyScore: clampScore(rate * 100),
    summary: `${left.conditions[0].label} と ${right.conditions[0].label} を同時に満たす ${matched.length.toLocaleString('ja-JP')} 行の目的変数率は ${Math.round(rate * 1000) / 10}% です。`
  }];
};

const buildRealAnalysisResult = async ({ connection, req, analysisJobId, runId, mapping, dataset, config }) => {
  const summary = buildAnalysisSummary(mapping, dataset);
  const columns = columnIdMap(dataset);
  const targetMapping = mapping.columnMappings.find((column) => column.columnRole === 'target') || mapping.columnMappings.find((column) => column.targetConfig);
  const target = targetMapping ? columns.get(targetMapping.columnId) : null;
  if (!target) {
    return failedResult({ analysisJobId, runId, mapping, dataset, config, message: '目的変数カラムが見つからないため、実データ分析を開始できませんでした。' });
  }

  const features = buildFeatureDescriptors(mapping, dataset, target, config);
  if (features.length === 0) {
    return failedResult({ analysisJobId, runId, mapping, dataset, config, message: '分析可能な特徴量がありません。目的変数テーブルと同一テーブル、またはjoin定義で接続できる特徴量を選択してください。' });
  }

  const targetConfig = {
    ...(targetMapping.targetConfig || {}),
    positiveValue: config?.mode === 'custom' && config.targetPositiveValue?.trim()
      ? config.targetPositiveValue.trim()
      : targetMapping.targetConfig?.positiveValue
  };
  const eventTimeColumnsByTable = resolveEventTimeColumnsByTable(mapping, dataset);

  const { rows, truncated } = await materializeAnalysisRows({ connection, req, dataset, target, targetConfig, features, eventTimeColumnsByTable });
  if (rows.length === 0) {
    return failedResult({ analysisJobId, runId, mapping, dataset, config, message: '目的変数を二値として判定できる行がありませんでした。目的変数の役割または正例/負例の値を確認してください。' });
  }

  const positiveCount = rows.filter((row) => row.__target === 1).length;
  const baselineRate = positiveCount / rows.length;
  const minGroupCount = Math.max(3, Math.ceil(rows.length * 0.02));
  const importances = [];

  features.forEach((feature) => {
    if (isSequenceMiningFeature(feature, eventTimeColumnsByTable)) {
      return;
    }

    const missingCount = rows.filter((row) => isMissing(row[feature.featureKey])).length;
    const numericFeature = feature.valueType === 'numeric' || ['sum', 'avg', 'count', 'distinct_count', 'min', 'max'].includes(feature.aggregation);
    const analysis = numericFeature
      ? analyzeNumericFeature({ rows, feature, baselineRate, minGroupCount })
      : analyzeCategoricalFeature({ rows, feature, baselineRate, minGroupCount });

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
        description: `${feature.sourceTableDisplayName}.${feature.sourceColumnName} を実データ ${rows.length.toLocaleString('ja-JP')} 行に結合・集計し、目的変数 ${target.column.displayName} との差を評価しました。`
      }
    });
  });

  importances.push(
    ...mineSequentialRouteFeatures({
      rows,
      features,
      baselineRate,
      minGroupCount,
      eventTimeColumnsByTable,
      maxRoutes: Math.min(5, config?.patternCount || 5)
    })
  );

  importances.sort((left, right) => right.result.importanceScore - left.result.importanceScore);
  const topImportances = importances.slice(0, config?.maxFeatureCount || 20);
  const patterns = topImportances
    .filter((item) => item.analysis.pattern.matchedCount >= minGroupCount)
    .slice(0, config?.patternCount || 5)
    .map((item, index) => ({
      id: `pattern-real-${index + 1}`,
      title: item.analysis.pattern.condition.label,
      conditions: [item.analysis.pattern.condition],
      supportRate: item.analysis.pattern.supportRate,
      lift: item.analysis.pattern.lift,
      conversionDelta: item.analysis.pattern.conversionDelta,
      confidence: Math.min(0.95, Math.max(0.35, item.result.importanceScore / 100)),
      description: `${item.analysis.pattern.condition.label} の ${item.analysis.pattern.matchedCount.toLocaleString('ja-JP')} 行では、${summary.target.label} の比率が ${formatRate(item.analysis.pattern.conversionRate)} でした。全体平均 ${formatRate(baselineRate)} より ${formatPointDelta(Math.abs(item.analysis.pattern.conversionDelta))} ${patternDirectionText(item.analysis.pattern.conversionDelta)}条件です。`,
      recommendedAction: `${item.analysis.pattern.condition.label} を条件にしたセグメントで施策検証してください。`
    }));

  const segments = patterns
    .filter((pattern) => (pattern.conversionDelta || 0) > 0)
    .map((pattern, index) => {
      const candidateRows = rows.filter(
        (row) => row.__target !== 1 && pattern.conditions.every((condition) => matchesCondition(row, condition))
      );

      return {
        id: `segment-real-${index + 1}`,
        name: `${pattern.conditions[0].label} 未正解候補`,
        description: '目的変数が正解の値ではないデータのうち、正解データに多い傾向へ近い候補です。',
        sourcePatternId: pattern.id,
        estimatedAudienceSize: candidateRows.length,
        estimatedConversionRate: baselineRate + (pattern.conversionDelta || 0),
        conditions: pattern.conditions,
        useCase: '未正解候補リスト化',
        priorityScore: clampScore((pattern.conversionDelta || 0) * 100 + (candidateRows.length / rows.length) * 40 + 50)
      };
    })
    .filter((segment) => segment.estimatedAudienceSize > 0);

  return {
    id: analysisJobId,
    analysisJobId,
    runId,
    datasetId: dataset.id,
    mappingDocumentId: mapping.id,
    mode: config?.mode || 'custom',
    status: 'completed',
    progressPercent: 100,
    message: `Fabric実データ ${rows.length.toLocaleString('ja-JP')} 行を結合・集計して分析しました。${truncated ? '上限行数までの集計です。' : ''}`,
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
    interactionPairs: buildInteractionPairs(patterns, rows),
    goldenPatterns: patterns,
    segmentRecommendations: segments
  };
};

module.exports = {
  buildRealAnalysisResult
};
