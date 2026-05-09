import { Download, RefreshCw, Save } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { isAbortError, isApiError } from '../../services/client';
import { resultsApi } from '../../services/results/resultsApi';
import type { AnalysisDataRow, AnalysisResultDocument, GoldenPatternResult, PatternCondition, SegmentRecommendation } from '../../types/results';
import { Badge, Button, Card, EmptyState, formatNumber, formatPercent } from '../common/ui';

const operatorLabel: Record<string, string> = {
  eq: 'が',
  neq: 'が次以外',
  gt: 'が次より大きい',
  gte: 'が次以上',
  lt: 'が次未満',
  lte: 'が次以下',
  between: 'が次の範囲',
  in: 'が次のいずれか'
};

const stripDecimalSuffixes = (value: string) => value.replace(/(\d+)\.0\b/g, '$1');

const conditionValueLabel = (condition: { value: string | number | boolean; valueTo?: string | number }) =>
  condition.valueTo !== undefined
    ? `${formatDisplayValue(condition.value)} - ${formatDisplayValue(condition.valueTo)}`
    : formatDisplayValue(condition.value);

const formatDisplayValue = (value: string | number | boolean) => {
  if (typeof value === 'number') {
    return formatNumber(value, { maximumFractionDigits: value >= 1000 ? 0 : 2 });
  }

  if (typeof value === 'boolean') {
    return value ? 'はい' : 'いいえ';
  }

  return stripDecimalSuffixes(value);
};

const conditionFeatureLabel = (label: string) => {
  const [feature] = label.split(' が ');
  return stripDecimalSuffixes((feature || label).replace(/\sなし$/, ''));
};

const countConditionSummary = (condition: { label: string; operator: string; value: string | number | boolean }) => {
  const feature = conditionFeatureLabel(condition.label);
  const [countFeature, countValue] = feature.split(':').map((part) => part.trim());
  const value = typeof condition.value === 'number' ? Math.max(0, Math.round(condition.value)) : condition.value;
  if (!countValue || !countFeature.endsWith('別回数') || typeof value !== 'number') {
    return null;
  }

  if (condition.operator === 'gte') {
    return `${feature} が ${formatDisplayValue(value)} 回以上`;
  }
  if (condition.operator === 'lte') {
    return value <= 0 ? `${feature} なし` : `${feature} が ${formatDisplayValue(value)} 回以下`;
  }

  return null;
};

const numericConditionSummary = (condition: { label: string; operator: string; value: string | number | boolean; valueTo?: string | number }) => {
  if (typeof condition.value !== 'number') {
    return null;
  }

  const suffixByOperator: Record<string, string> = {
    gt: 'より大きい',
    gte: '以上',
    lt: '未満',
    lte: '以下'
  };
  const suffix = suffixByOperator[condition.operator];
  if (!suffix) {
    return null;
  }

  return `${conditionFeatureLabel(condition.label)} が ${conditionValueLabel(condition)} ${suffix}`;
};

const singleConditionSummary = (condition: { label: string; operator: string; value: string | number | boolean; valueTo?: string | number }) =>
  countConditionSummary(condition) ??
  numericConditionSummary(condition) ??
  `${conditionFeatureLabel(condition.label)} ${operatorLabel[condition.operator] ?? condition.operator} ${conditionValueLabel(condition)}`;

const conditionSummary = (conditions: { label: string; operator: string; value: string | number | boolean; valueTo?: string | number }[]) =>
  conditions
    .map(singleConditionSummary)
    .join(' かつ ');

type OutcomeGroup = {
  id: string;
  segment?: SegmentRecommendation;
  pattern?: GoldenPatternResult;
  conditions: PatternCondition[];
};

type SegmentMetric = {
  totalCount: number;
  remainingCount: number;
  effectDelta?: number;
};

type ActionNotice = {
  tone: 'success' | 'warning' | 'error';
  message: string;
};

const comparableValue = (value: string | number | boolean) =>
  stripDecimalSuffixes(String(value)).trim().toLowerCase();

const canonicalConditionKey = (condition: PatternCondition) => {
  const feature = conditionFeatureLabel(condition.label);
  const [countFeature, countValue] = feature.split(':').map((part) => part.trim());

  if (
    countValue &&
    countFeature.endsWith('別回数') &&
    ['gt', 'gte'].includes(condition.operator) &&
    typeof condition.value === 'number' &&
    condition.value >= 1
  ) {
    return `${countFeature.replace(/別回数$/, '')}:${comparableValue(countValue)}`;
  }

  if (condition.operator === 'eq') {
    return `${feature}:${comparableValue(condition.value)}`;
  }

  return conditionSummary([condition]).replace(/\s+/g, '').toLowerCase();
};

const canonicalGroupKey = (conditions: PatternCondition[]) =>
  conditions.map(canonicalConditionKey).sort().join('&&');

const compactConditions = (conditions: PatternCondition[]) => {
  const seen = new Set<string>();

  return conditions.filter((condition) => {
    const key = canonicalConditionKey(condition);
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
};

const dedupeOutcomeGroups = (groups: OutcomeGroup[]) => {
  const deduped = new Map<string, OutcomeGroup>();

  groups.forEach((group) => {
    const compacted = { ...group, conditions: compactConditions(group.conditions) };
    const key = canonicalGroupKey(compacted.conditions);
    const current = deduped.get(key);
    if (!current || (!current.segment && compacted.segment)) {
      deduped.set(key, compacted);
    }
  });

  return [...deduped.values()];
};

const outcomeGroupName = (group: OutcomeGroup) =>
  stripDecimalSuffixes(conditionSummary(group.conditions) || group.segment?.name || group.pattern?.title || '');

const formatEffectDelta = (value?: number) =>
  typeof value === 'number' ? `${value >= 0 ? '+' : ''}${formatPercent(value)}` : '-';

const outcomeAudienceSize = (group: OutcomeGroup, result: AnalysisResultDocument) => {
  if (typeof group.segment?.estimatedAudienceSize === 'number' && group.segment.estimatedAudienceSize > 0) {
    return group.segment.estimatedAudienceSize;
  }

  if (typeof group.pattern?.supportRate === 'number' && typeof result.summary.analyzedRowCount === 'number') {
    return Math.round(result.summary.analyzedRowCount * group.pattern.supportRate);
  }

  return 0;
};

const toSegmentRecommendation = (group: OutcomeGroup, result: AnalysisResultDocument): SegmentRecommendation =>
  group.segment
    ? {
        ...group.segment,
        name: outcomeGroupName(group),
        conditions: group.conditions
      }
    : {
        id: `seg-${group.id}`,
        name: outcomeGroupName(group),
        sourcePatternId: group.pattern?.id,
        estimatedAudienceSize: outcomeAudienceSize(group, result),
        conditions: group.conditions,
        priorityScore: Math.round(((group.pattern?.lift ?? 1) * 100) + ((group.pattern?.conversionDelta ?? 0) * 100))
      };

const rowsFromSegments = (segments: SegmentRecommendation[]) =>
  segments.flatMap((segment) =>
    (segment.audienceRows ?? []).map((row) => ({
      segmentId: segment.id,
      segmentName: segment.name,
      customerKey: row.customerKey,
      targetValue: row.targetValue,
      matchedReasons: row.matchedReasons?.join(' / ') ?? '',
      attributes: row.attributes ?? {}
    }))
  );

const asComparable = (value: string | number | boolean | null | undefined) => {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'boolean') {
    return value;
  }

  const text = stripDecimalSuffixes(String(value ?? '')).trim();
  const number = Number(text);
  return text !== '' && Number.isFinite(number) ? number : text.toLowerCase();
};

const matchesCondition = (row: AnalysisDataRow, condition: PatternCondition) => {
  const value = row.values[condition.featureKey];
  const comparable = asComparable(value);
  const expected = asComparable(condition.value);
  const expectedTo = condition.valueTo === undefined ? undefined : asComparable(condition.valueTo);

  switch (condition.operator) {
    case 'eq':
      return comparable === expected;
    case 'neq':
      return comparable !== expected;
    case 'gt':
      return Number(comparable) > Number(expected);
    case 'gte':
      return Number(comparable) >= Number(expected);
    case 'lt':
      return Number(comparable) < Number(expected);
    case 'lte':
      return Number(comparable) <= Number(expected);
    case 'between':
      return expectedTo !== undefined && Number(comparable) >= Number(expected) && Number(comparable) <= Number(expectedTo);
    case 'in':
      return String(condition.value)
        .split(',')
        .map((item) => comparableValue(item))
        .includes(comparableValue(value ?? ''));
    default:
      return false;
  }
};

const rowsFromAnalysisRows = (analysisRows: AnalysisDataRow[], segments: SegmentRecommendation[]) =>
  segments.flatMap((segment) =>
    analysisRows
      .filter((row) => segment.conditions.every((condition) => matchesCondition(row, condition)))
      .map((row) => ({
        segmentId: segment.id,
        segmentName: segment.name,
        customerKey: row.customerKey,
        targetValue: row.targetValue,
        matchedReasons: segment.conditions.map((condition) => condition.label).join(' / '),
        attributes: row.values
      }))
  );

const matchingAnalysisRows = (analysisRows: AnalysisDataRow[] | undefined, segment: SegmentRecommendation) =>
  (analysisRows ?? []).filter((row) => segment.conditions.every((condition) => matchesCondition(row, condition)));

const segmentMetric = (result: AnalysisResultDocument, group: OutcomeGroup): SegmentMetric => {
  const segment = toSegmentRecommendation(group, result);
  const rows = matchingAnalysisRows(result.analysisRows, segment);

  if (rows.length > 0 && result.analysisRows?.length) {
    const positiveCount = rows.filter((row) => row.targetValue === 1 || row.targetValue === true || row.targetValue === '1').length;
    const baselinePositiveCount = result.analysisRows.filter((row) => row.targetValue === 1 || row.targetValue === true || row.targetValue === '1').length;
    const segmentRate = positiveCount / rows.length;
    const baselineRate = result.analysisRows.length > 0 ? baselinePositiveCount / result.analysisRows.length : 0;

    return {
      totalCount: rows.length,
      remainingCount: rows.length - positiveCount,
      effectDelta: segmentRate - baselineRate
    };
  }

  const totalCount = outcomeAudienceSize(group, result);
  const segmentRate =
    typeof group.pattern?.conversionDelta === 'number' && typeof result.summary.baselineMetricValue === 'number'
      ? result.summary.baselineMetricValue + group.pattern.conversionDelta
      : group.segment?.estimatedConversionRate;
  const positiveCount = typeof segmentRate === 'number' && totalCount > 0 ? Math.round(totalCount * segmentRate) : 0;

  return {
    totalCount,
    remainingCount: totalCount > 0 ? Math.max(totalCount - positiveCount, 0) : 0,
    effectDelta: group.pattern?.conversionDelta
  };
};

const topFeatureColumns = (result: AnalysisResultDocument) =>
  result.featureImportances
    .slice()
    .sort((left, right) => right.importanceScore - left.importanceScore)
    .slice(0, 5)
    .map((feature) => ({
      key: feature.featureKey,
      label: feature.label
    }));

const dedupeRowsByCustomer = <T extends { customerKey: string }>(rows: T[]) => {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.customerKey)) {
      return false;
    }
    seen.add(row.customerKey);
    return true;
  });
};

const mergeCustomerListResult = (
  result: AnalysisResultDocument,
  hydratedSegments: SegmentRecommendation[],
  analysisRows?: AnalysisDataRow[]
): AnalysisResultDocument => {
  const byId = new Map(hydratedSegments.map((segment) => [segment.id, segment]));

  return {
    ...result,
    analysisRows: analysisRows ?? result.analysisRows,
    segmentRecommendations: result.segmentRecommendations.map((segment) => {
      const hydrated = byId.get(segment.id);
      return hydrated
        ? {
            ...segment,
            estimatedAudienceSize: hydrated.estimatedAudienceSize,
            audienceRows: hydrated.audienceRows
          }
        : segment;
    })
  };
};

export const ResultsVisualizationScreen = ({
  analysisJobId,
  onBack
}: {
  analysisJobId: string;
  onBack: () => void;
}) => {
  const [result, setResult] = useState<AnalysisResultDocument | null>(null);
  const [selectedOutcomeIds, setSelectedOutcomeIds] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<ActionNotice | null>(null);
  const [savingResult, setSavingResult] = useState(false);
  const [exportingCsv, setExportingCsv] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    resultsApi
      .getResult(analysisJobId, { signal: controller.signal })
      .then((nextResult) => {
        setResult(nextResult);
        setLoadError(null);
        setSelectedOutcomeIds([]);
      })
      .catch((error: unknown) => {
        if (!isAbortError(error)) {
          setResult(null);
          setLoadError(isApiError(error) || error instanceof Error ? error.message : '分析結果を読み込めませんでした。');
        }
      });

    return () => controller.abort();
  }, [analysisJobId]);

  const outcomeGroups = useMemo<OutcomeGroup[]>(() => {
    if (!result) {
      return [];
    }

    const segmentGroups = result.segmentRecommendations.map((segment) => ({
      id: segment.id,
      segment,
      pattern: result.goldenPatterns.find((pattern) => pattern.id === segment.sourcePatternId),
      conditions: segment.conditions
    }));
    const segmentPatternIds = new Set(segmentGroups.map((group) => group.segment.sourcePatternId).filter(Boolean));
    const segmentConditionKeys = new Set(segmentGroups.map((group) => canonicalGroupKey(compactConditions(group.conditions))));
    const patternGroups = result.goldenPatterns
      .filter((pattern) => !segmentPatternIds.has(pattern.id))
      .filter((pattern) => !segmentConditionKeys.has(canonicalGroupKey(compactConditions(pattern.conditions))))
      .map((pattern) => ({
        id: pattern.id,
        pattern,
        conditions: pattern.conditions
      }));

    return dedupeOutcomeGroups([...segmentGroups, ...patternGroups]).sort((left, right) => {
      const leftMetric = segmentMetric(result, left);
      const rightMetric = segmentMetric(result, right);
      return (rightMetric.effectDelta ?? -Infinity) - (leftMetric.effectDelta ?? -Infinity);
    });
  }, [result]);

  const selectedGroups = useMemo(
    () => outcomeGroups.filter((group) => selectedOutcomeIds.includes(group.id)),
    [outcomeGroups, selectedOutcomeIds]
  );

  const selectedSegments = useMemo(
    () => (result ? selectedGroups.map((group) => toSegmentRecommendation(group, result)) : []),
    [result, selectedGroups]
  );

  const toggleOutcome = (outcomeId: string) => {
    setSelectedOutcomeIds((current) =>
      current.includes(outcomeId) ? current.filter((id) => id !== outcomeId) : [...current, outcomeId]
    );
  };

  const saveResult = async () => {
    if (!result) {
      return;
    }

    setSavingResult(true);
    try {
      await resultsApi.saveResult(result);
      setActionNotice({ tone: 'success', message: '分析結果を保存しました。' });
    } finally {
      setSavingResult(false);
    }
  };

  const exportSegmentsCsv = async () => {
    if (selectedSegments.length === 0) {
      return;
    }

    setExportingCsv(true);
    setActionNotice(null);

    try {
      let exportSegments = selectedSegments;
      let rows = result?.analysisRows?.length ? rowsFromAnalysisRows(result.analysisRows, exportSegments) : rowsFromSegments(exportSegments);

      if (rows.length === 0 && result) {
        setActionNotice({ tone: 'warning', message: '分析テーブルから顧客リストを抽出しています。' });
        const response = await resultsApi.getCustomerList(result.analysisJobId, exportSegments);
        exportSegments = response.segments ?? [];
        rows = response.analysisRows?.length ? rowsFromAnalysisRows(response.analysisRows, exportSegments) : rowsFromSegments(exportSegments);
        if (rows.length === 0) {
          rows = rowsFromSegments(exportSegments);
        }
        setResult((current) => (current ? mergeCustomerListResult(current, exportSegments, response.analysisRows) : current));
      }

      if (rows.length === 0) {
        setActionNotice({
          tone: 'error',
          message: '表示されている条件に一致する顧客リストを作成できませんでした。条件に該当する行がないか、分析条件の保存情報が不足しています。'
        });
        return;
      }

      rows = dedupeRowsByCustomer(rows);
      const featureColumns = result ? topFeatureColumns(result) : [];
      const headers = ['customerKey', 'targetValue', ...featureColumns.map((feature) => feature.label)];
      const csvRows = rows.map((row) => [
        row.customerKey,
        row.targetValue === undefined ? '' : String(row.targetValue),
        ...featureColumns.map((feature) => {
          const value = row.attributes[feature.key];
          return value === undefined || value === null ? '' : String(value);
        })
      ]);
      const csv = [headers, ...csvRows]
        .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','))
        .join('\n');
      const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `autoinsight-customer-list-${result?.analysisJobId ?? 'result'}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(link.href);
      setActionNotice({ tone: 'success', message: `${formatNumber(rows.length)} 行の顧客リストをCSVとして出力しました。` });
    } catch (error: unknown) {
      setActionNotice({
        tone: 'error',
        message: isApiError(error) || error instanceof Error ? error.message : '顧客リストを作成できませんでした。'
      });
    } finally {
      setExportingCsv(false);
    }
  };

  if (!result) {
    return (
      <div className="screen">
        <Card className="loading-panel">
          <strong>{loadError ?? '分析結果を準備しています。'}</strong>
          {!loadError ? <p>成果につながる顧客群を読み込んでいます。</p> : null}
        </Card>
      </div>
    );
  }

  const completed = result.status === 'completed';

  return (
    <div className="screen">
      <header className="screen-header">
        <div>
          <h1>施策候補</h1>
          <p>分析で見つかった成功パターンを、次に試せる顧客グループとして確認します。</p>
        </div>
        <div className="actions">
          <Button variant="secondary" onClick={onBack}>条件を見直す</Button>
          <Button variant="secondary" onClick={onBack}><RefreshCw size={16} /> 再実行</Button>
          <Button variant="secondary" onClick={saveResult} disabled={savingResult}><Save size={16} /> {savingResult ? '保存中' : '結果を保存'}</Button>
        </div>
      </header>

      {actionNotice ? <p className={`notice ${actionNotice.tone}`}>{actionNotice.message}</p> : null}

      <Card>
        <div className="panel-heading">
          <h2>成果につながる顧客群</h2>
          {!completed ? <Badge tone="warning">暫定</Badge> : <Badge tone="success">{outcomeGroups.length} 件</Badge>}
        </div>
        {outcomeGroups.length === 0 ? <EmptyState title="候補なし" description="成果に結びつく顧客群はまだ生成されていません。" /> : null}
        {outcomeGroups.length > 0 ? (
          <div className="outcome-table-wrap">
            <table className="outcome-table">
              <thead>
                <tr>
                  <th>セグメント条件</th>
                  <th>全体件数</th>
                  <th>残件数</th>
                  <th>期待効果</th>
                </tr>
              </thead>
              <tbody>
                {outcomeGroups.map((group) => {
                  const selected = selectedOutcomeIds.includes(group.id);
                  const metric = segmentMetric(result, group);
                  return (
                    <tr
                      className={selected ? 'selected' : undefined}
                      key={group.id}
                      onClick={() => toggleOutcome(group.id)}
                    >
                      <td>
                        <label className="outcome-condition-cell" onClick={(event) => event.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => toggleOutcome(group.id)}
                            aria-label={`${outcomeGroupName(group)}を選択`}
                          />
                          <span>{outcomeGroupName(group)}</span>
                        </label>
                      </td>
                      <td>{metric.totalCount > 0 ? `${formatNumber(metric.totalCount)} 行` : '-'}</td>
                      <td>{metric.remainingCount > 0 ? `${formatNumber(metric.remainingCount)} 行` : '0 行'}</td>
                      <td>{formatEffectDelta(metric.effectDelta)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>

      <footer className="action-bar">
        <span>{completed ? '確定済み' : '更新中'}</span>
        <strong>{selectedSegments.length > 0 ? `${selectedSegments.length} 件の候補を選択` : '候補未選択'}</strong>
        <div className="actions">
          <Button onClick={exportSegmentsCsv} disabled={!completed || selectedSegments.length === 0 || exportingCsv}>
            <Download size={16} /> {exportingCsv ? '準備中' : '顧客リストCSV'}
          </Button>
        </div>
      </footer>
    </div>
  );
};
