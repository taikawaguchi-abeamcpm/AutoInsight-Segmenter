import { Download, RefreshCw, Save } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { isAbortError, isApiError } from '../../services/client';
import { resultsApi } from '../../services/results/resultsApi';
import type { AnalysisResultDocument, GoldenPatternResult, PatternCondition, SegmentRecommendation, SelectedSegmentContext } from '../../types/results';
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
  return stripDecimalSuffixes(feature || label);
};

const conditionSummary = (conditions: { label: string; operator: string; value: string | number | boolean; valueTo?: string | number }[]) =>
  conditions
    .map((condition) => `${conditionFeatureLabel(condition.label)} ${operatorLabel[condition.operator] ?? condition.operator} ${conditionValueLabel(condition)}`)
    .join(' かつ ');

type OutcomeGroup = {
  id: string;
  segment?: SegmentRecommendation;
  pattern?: GoldenPatternResult;
  conditions: PatternCondition[];
};

const outcomeGroupName = (group: OutcomeGroup) =>
  stripDecimalSuffixes(group.segment?.name || group.pattern?.title || conditionSummary(group.conditions));

const outcomeEffectText = (pattern?: GoldenPatternResult) => {
  const parts = [
    typeof pattern?.conversionDelta === 'number' ? `平均との差 ${formatPercent(pattern.conversionDelta)}` : null,
    typeof pattern?.lift === 'number' ? `全体比 ${pattern.lift.toFixed(2)} 倍` : null
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(' / ') : '効果見込みを確認中';
};

const recommendedActionText = (group: OutcomeGroup) =>
  group.pattern?.recommendedAction ||
  group.segment?.useCase ||
  'この条件で対象顧客を抽出し、既存施策の配信対象として確認します。';

export const ResultsVisualizationScreen = ({
  analysisJobId,
  onBack,
  onSegmentsSelected
}: {
  analysisJobId: string;
  onBack: () => void;
  onSegmentsSelected: (context: SelectedSegmentContext) => void;
}) => {
  const [result, setResult] = useState<AnalysisResultDocument | null>(null);
  const [selectedSegmentIds, setSelectedSegmentIds] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [savingResult, setSavingResult] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    resultsApi
      .getResult(analysisJobId, { signal: controller.signal })
      .then((nextResult) => {
        setResult(nextResult);
        setLoadError(null);
        setSelectedSegmentIds(nextResult.segmentRecommendations.slice(0, 1).map((segment) => segment.id));
      })
      .catch((error: unknown) => {
        if (!isAbortError(error)) {
          setResult(null);
          setLoadError(isApiError(error) || error instanceof Error ? error.message : '分析結果を読み込めませんでした。');
        }
      });

    return () => controller.abort();
  }, [analysisJobId]);

  const selectedSegments = useMemo(
    () => result?.segmentRecommendations.filter((segment) => selectedSegmentIds.includes(segment.id)) ?? [],
    [result, selectedSegmentIds]
  );

  const outcomeGroups = useMemo<OutcomeGroup[]>(() => {
    if (!result) {
      return [];
    }

    const groups = result.segmentRecommendations.map((segment) => ({
      id: segment.id,
      segment,
      pattern: result.goldenPatterns.find((pattern) => pattern.id === segment.sourcePatternId),
      conditions: segment.conditions
    }));

    if (groups.length > 0) {
      return groups;
    }

    return result.goldenPatterns.map((pattern) => ({
      id: pattern.id,
      pattern,
      conditions: pattern.conditions
    }));
  }, [result]);

  const toggleSegment = (segmentId: string) => {
    setSelectedSegmentIds((current) =>
      current.includes(segmentId) ? current.filter((id) => id !== segmentId) : [...current, segmentId]
    );
  };

  const continueToSegments = async () => {
    if (!result || selectedSegments.length === 0 || result.status !== 'completed') {
      return;
    }

    onSegmentsSelected(
      await resultsApi.prepareSegments({
        analysisJobId: result.analysisJobId,
        segmentIds: selectedSegments.map((segment) => segment.id),
        segments: selectedSegments
      })
    );
  };

  const saveResult = async () => {
    if (!result) {
      return;
    }

    setSavingResult(true);
    try {
      await resultsApi.saveResult(result);
      setActionMessage('分析結果を保存しました。');
    } finally {
      setSavingResult(false);
    }
  };

  const exportSegmentsCsv = () => {
    if (selectedSegments.length === 0) {
      return;
    }

    const headers = ['segmentId', 'name', 'estimatedAudienceSize', 'priorityScore', 'conditions'];
    const rows = selectedSegments.map((segment) => [
      segment.id,
      segmentDisplayName(segment),
      String(segment.estimatedAudienceSize),
      String(segment.priorityScore),
      segment.conditions.map((condition) => conditionSummary([condition])).join(' / ')
    ]);
    const csv = [headers, ...rows]
      .map((row) => row.map((value) => `"${value.replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `autoinsight-segments-${result?.analysisJobId ?? 'result'}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
    setActionMessage('選択中のセグメント候補をCSVとして出力しました。');
  };

  const segmentDisplayName = (segment: SelectedSegmentContext['segments'][number]) =>
    segment.conditions.length > 0 ? `${conditionSummary(segment.conditions)} 未成果候補` : stripDecimalSuffixes(segment.name);

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

      {actionMessage ? <p className="notice success">{actionMessage}</p> : null}

      <Card>
        <div className="panel-heading">
          <h2>成果につながる顧客群</h2>
          {!completed ? <Badge tone="warning">暫定</Badge> : <Badge tone="success">{outcomeGroups.length} 件</Badge>}
        </div>
        {outcomeGroups.length === 0 ? <EmptyState title="候補なし" description="成果に結びつく顧客群はまだ生成されていません。" /> : null}
        <div className="outcome-group-list">
          {outcomeGroups.map((group, index) => {
            const selected = group.segment ? selectedSegmentIds.includes(group.segment.id) : false;
            return (
              <label className={selected ? 'outcome-group-card selected' : 'outcome-group-card'} key={group.id}>
                <div className="outcome-group-main">
                  <input
                    type="checkbox"
                    checked={selected}
                    disabled={!group.segment}
                    onChange={() => group.segment && toggleSegment(group.segment.id)}
                    aria-label={`${outcomeGroupName(group)}を選択`}
                  />
                  <div className="outcome-group-copy">
                    <span className="insight-rank">候補 {index + 1}</span>
                    <strong>{outcomeGroupName(group)}</strong>
                    {group.segment?.description || group.pattern?.description ? (
                      <p>{group.segment?.description || group.pattern?.description}</p>
                    ) : null}
                  </div>
                </div>
                <div className="outcome-condition-list" aria-label="条件">
                  {group.conditions.map((condition) => (
                    <span className="chip strong" key={`${group.id}-${condition.featureKey}-${condition.label}`}>
                      {conditionSummary([condition])}
                    </span>
                  ))}
                </div>
                <div className="outcome-decision-grid">
                  <div>
                    <span>期待効果</span>
                    <strong>{outcomeEffectText(group.pattern)}</strong>
                  </div>
                  <div>
                    <span>対象規模</span>
                    <strong>{group.segment ? `${formatNumber(group.segment.estimatedAudienceSize)} 人` : '-'}</strong>
                  </div>
                  <div>
                    <span>優先度</span>
                    <strong>{group.segment?.priorityScore ?? '-'}</strong>
                  </div>
                </div>
                <div className="outcome-next-action">
                  <span>次にやること</span>
                  <strong>{recommendedActionText(group)}</strong>
                </div>
              </label>
            );
          })}
        </div>
      </Card>

      <footer className="action-bar">
        <span>{completed ? '確定済み' : '更新中'}</span>
        <strong>{selectedSegments.length > 0 ? `${selectedSegments.length} 件の候補を選択` : '候補未選択'}</strong>
        <div className="actions">
          <Button variant="secondary" onClick={exportSegmentsCsv} disabled={!completed || selectedSegments.length === 0}><Download size={16} /> CSV 出力</Button>
          <Button onClick={continueToSegments} disabled={!completed || selectedSegments.length === 0}>セグメント作成へ進む</Button>
        </div>
      </footer>
    </div>
  );
};
