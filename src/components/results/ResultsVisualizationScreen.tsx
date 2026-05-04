import { Download, RefreshCw, Save } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { isAbortError, isApiError } from '../../services/client';
import { resultsApi } from '../../services/results/resultsApi';
import type { AnalysisResultDocument, FeatureImportanceResult, SelectedSegmentContext } from '../../types/results';
import { Badge, Button, Card, EmptyState, Metric, formatNumber, formatPercent } from '../common/ui';

const directionLabel: Record<FeatureImportanceResult['direction'], string> = {
  positive: 'プラス',
  negative: 'マイナス',
  neutral: '中立'
};

const categoryLabel: Record<FeatureImportanceResult['category'], string> = {
  profile: '顧客属性',
  behavior: '行動',
  transaction: '取引',
  engagement: '接触',
  derived: '自動生成'
};

const aggregationLabel: Record<FeatureImportanceResult['aggregation'], string> = {
  none: 'そのまま',
  count: '回数',
  sum: '合計',
  avg: '平均',
  min: '最小',
  max: '最大',
  latest: '最新値',
  distinct_count: '種類数'
};

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

  return value;
};

const conditionFeatureLabel = (label: string) => {
  const [feature] = label.split(' が ');
  return feature || label;
};

const conditionSummary = (conditions: { label: string; operator: string; value: string | number | boolean; valueTo?: string | number }[]) =>
  conditions
    .map((condition) => `${conditionFeatureLabel(condition.label)} ${operatorLabel[condition.operator] ?? condition.operator} ${conditionValueLabel(condition)}`)
    .join(' かつ ');

const patternActionText = (conversionDelta?: number, lift?: number) => {
  const parts = [
    typeof conversionDelta === 'number' ? `平均との差が ${formatPercent(conversionDelta)}` : null,
    typeof lift === 'number' ? `全体の ${lift.toFixed(2)} 倍` : null
  ].filter(Boolean);

  if (parts.length === 0) {
    return '条件に合う顧客を施策候補として確認できます。';
  }

  return `${parts.join('、')}のため、優先して施策対象にする価値があります。`;
};

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
  const [selectedFeatureKey, setSelectedFeatureKey] = useState<string | null>(null);
  const [selectedPatternId, setSelectedPatternId] = useState<string | null>(null);
  const [selectedSegmentIds, setSelectedSegmentIds] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    resultsApi
      .getResult(analysisJobId, { signal: controller.signal })
      .then((nextResult) => {
        setResult(nextResult);
        setLoadError(null);
        setSelectedFeatureKey(nextResult.featureImportances[0]?.featureKey ?? null);
        setSelectedPatternId(nextResult.goldenPatterns[0]?.id ?? null);
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

  const selectedFeature = result?.featureImportances.find((feature) => feature.featureKey === selectedFeatureKey) ?? null;
  const selectedPattern = result?.goldenPatterns.find((pattern) => pattern.id === selectedPatternId) ?? null;

  const selectedSegments = useMemo(
    () => result?.segmentRecommendations.filter((segment) => selectedSegmentIds.includes(segment.id)) ?? [],
    [result, selectedSegmentIds]
  );

  const priorityPatterns = useMemo(
    () =>
      [...(result?.goldenPatterns ?? [])]
        .sort((left, right) => (right.conversionDelta ?? 0) - (left.conversionDelta ?? 0) || (right.lift ?? 0) - (left.lift ?? 0))
        .slice(0, 3),
    [result]
  );

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

  if (!result) {
    return (
      <div className="screen">
        <Card className="loading-panel">
          <strong>{loadError ?? '分析結果を準備しています。'}</strong>
          {!loadError ? <p>重要要因、黄金パターン、セグメント候補を読み込んでいます。</p> : null}
        </Card>
      </div>
    );
  }

  const completed = result.status === 'completed';
  const statusMessage = result.message.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  return (
    <div className="screen">
      <header className="screen-header">
        <div>
          <h1>施策候補</h1>
          <p>分析で見つかった成功パターンを、次に試せる顧客グループとして確認します。</p>
        </div>
        <div className="actions">
          <Button variant="secondary" onClick={onBack}>条件を見直す</Button>
          <Button variant="secondary"><RefreshCw size={16} /> 再実行</Button>
          <Button variant="secondary"><Save size={16} /> 結果を保存</Button>
        </div>
      </header>

      <Card className="status-strip">
        <Badge tone={completed ? 'success' : result.status === 'failed' ? 'danger' : 'info'}>{result.status}</Badge>
        <div
          className="progress-track"
          role="progressbar"
          aria-label="Analysis progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={result.progressPercent}
        >
          <span style={{ width: `${result.progressPercent}%` }} />
        </div>
        <strong>{result.progressPercent}%</strong>
        <span>{statusMessage}</span>
        {result.status === 'failed' && result.detail ? <small>{result.detail}</small> : null}
      </Card>

      <div className="kpi-strip">
        <Metric label="分析対象件数" value={formatNumber(result.summary.analyzedRowCount)} />
        <Metric label="重要特徴量" value={result.summary.topFeatureCount} />
        <Metric label="有効パターン" value={result.summary.validPatternCount} />
        <Metric label="推奨セグメント" value={result.summary.recommendedSegmentCount} />
        <Metric label="ベースライン比改善" value={formatPercent(result.summary.improvementRate)} />
      </div>

      <Card>
        <div className="panel-heading">
          <h2>優先して試したい施策</h2>
          <Badge tone="success">上位 {priorityPatterns.length} 件</Badge>
        </div>
        <div className="action-insight-grid">
          {priorityPatterns.map((pattern, index) => {
            const linkedSegment = result.segmentRecommendations.find((segment) => segment.sourcePatternId === pattern.id);
            return (
              <button
                key={pattern.id}
                type="button"
                className={pattern.id === selectedPatternId ? 'insight-card selected' : 'insight-card'}
                aria-pressed={pattern.id === selectedPatternId}
                onClick={() => {
                  setSelectedPatternId(pattern.id);
                  if (linkedSegment) {
                    setSelectedSegmentIds((current) => (current.includes(linkedSegment.id) ? current : [linkedSegment.id]));
                  }
                }}
              >
                <span className="insight-rank">候補 {index + 1}</span>
                <strong>{conditionSummary(pattern.conditions)}</strong>
                <p>{patternActionText(pattern.conversionDelta, pattern.lift)}</p>
                <div className="card-row">
                  <Badge tone="success">平均との差 {formatPercent(pattern.conversionDelta)}</Badge>
                  {linkedSegment ? <Badge tone="info">{formatNumber(linkedSegment.estimatedAudienceSize)} 人</Badge> : null}
                </div>
              </button>
            );
          })}
        </div>
      </Card>

      <div className="two-column">
        <Card>
          <div className="panel-heading">
            <h2>成功に効いていそうな要因</h2>
            <Badge tone="info">0-100 正規化</Badge>
          </div>
          <div className="bar-list">
            {result.featureImportances.map((feature) => (
              <button
                key={feature.featureKey}
                type="button"
                className={feature.featureKey === selectedFeatureKey ? 'selected' : ''}
                aria-pressed={feature.featureKey === selectedFeatureKey}
                aria-label={`${feature.label}: 影響度 ${feature.importanceScore}, 向き ${directionLabel[feature.direction]}`}
                onClick={() => setSelectedFeatureKey(feature.featureKey)}
              >
                <span>{feature.label}</span>
                <div className="bar-track">
                  <span style={{ width: `${feature.importanceScore}%` }} />
                </div>
                <strong>{feature.importanceScore}</strong>
                <Badge tone={feature.direction === 'positive' ? 'success' : feature.direction === 'negative' ? 'warning' : 'neutral'}>
                  {directionLabel[feature.direction]}
                </Badge>
              </button>
            ))}
          </div>
          <section className="detail-section">
            <h3>要因の詳細</h3>
            <table className="feature-table">
              <thead>
                <tr>
                  <th>要因</th>
                  <th>影響度</th>
                  <th>向き</th>
                </tr>
              </thead>
              <tbody>
                {result.featureImportances.map((feature) => (
                  <tr key={feature.featureKey}>
                    <td>{feature.label}</td>
                    <td>{feature.importanceScore}</td>
                    <td>{directionLabel[feature.direction]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          {selectedFeature ? (
            <section className="detail-section">
              <h3>{selectedFeature.label}</h3>
              <p>{selectedFeature.description ?? 'この特徴量は成約率の違いを説明する候補です。'}</p>
              <div className="tag-row">
                <span>{categoryLabel[selectedFeature.category]}</span>
                <span>{aggregationLabel[selectedFeature.aggregation]}</span>
                <span>欠損率 {formatPercent(selectedFeature.missingRate)}</span>
              </div>
            </section>
          ) : null}
          <section className="detail-section">
            <h3>組み合わせで効く要因</h3>
            {result.interactionPairs.map((pair) => (
              <p className="notice" key={`${pair.leftFeatureKey}-${pair.rightFeatureKey}`}>{pair.summary}</p>
            ))}
          </section>
        </Card>

        <Card>
          <div className="panel-heading">
            <h2>黄金パターン</h2>
            {!completed ? <Badge tone="warning">暫定</Badge> : null}
          </div>
          <section className="pattern-list">
            {result.goldenPatterns.map((pattern) => (
              <button
                key={pattern.id}
                type="button"
                className={pattern.id === selectedPatternId ? 'selected' : ''}
                aria-pressed={pattern.id === selectedPatternId}
                onClick={() => setSelectedPatternId(pattern.id)}
              >
                <strong>{conditionSummary(pattern.conditions)}</strong>
                <div className="chip-list">
                  {pattern.conditions.map((condition) => (
                    <span className="chip strong" key={`${pattern.id}-${condition.featureKey}-${condition.label}`}>
                      {conditionFeatureLabel(condition.label)}
                    </span>
                  ))}
                </div>
                <p>{patternActionText(pattern.conversionDelta, pattern.lift)}</p>
                <div className="card-row">
                  <Badge tone="success">対象割合 {formatPercent(pattern.supportRate)}</Badge>
                  {pattern.lift ? <Badge tone="info">全体比 {pattern.lift.toFixed(2)} 倍</Badge> : null}
                  <Badge tone="warning">成約率差 {formatPercent(pattern.conversionDelta)}</Badge>
                </div>
              </button>
            ))}
          </section>
          {selectedPattern ? (
            <section className="detail-section">
              <h3>条件</h3>
              <div className="data-table">
                {selectedPattern.conditions.map((condition) => (
                  <div className="sample-row" key={`${condition.featureKey}-${condition.label}`}>
                    <strong>{conditionFeatureLabel(condition.label)}</strong>
                    <span>{conditionValueLabel(condition)}</span>
                    <small>判定: {operatorLabel[condition.operator] ?? condition.operator}</small>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
          <section className="detail-section">
            <h3>次に試したい顧客グループ</h3>
            {result.segmentRecommendations.length === 0 ? <EmptyState title="候補なし" description="セグメント候補はまだ生成されていません。" /> : null}
            <div className="data-table">
              {result.segmentRecommendations.map((segment) => (
                <label className="feature-row" key={segment.id}>
                  <input type="checkbox" checked={selectedSegmentIds.includes(segment.id)} onChange={() => toggleSegment(segment.id)} />
                  <span>{segment.name}</span>
                  <small>{formatNumber(segment.estimatedAudienceSize)} 人</small>
                  <Badge tone="info">{segment.priorityScore}</Badge>
                </label>
              ))}
            </div>
          </section>
        </Card>
      </div>

      <footer className="action-bar">
        <span>{completed ? '確定済み' : '更新中'}</span>
        <strong>{selectedSegments.length > 0 ? `${selectedSegments.length} 件の候補を選択` : '候補未選択'}</strong>
        <div className="actions">
          <Button variant="secondary" disabled={!completed}><Download size={16} /> CSV 出力</Button>
          <Button onClick={continueToSegments} disabled={!completed || selectedSegments.length === 0}>セグメント作成へ進む</Button>
        </div>
      </footer>
    </div>
  );
};
