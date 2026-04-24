import { Download, RefreshCw, Save } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { isAbortError } from '../../services/client';
import { resultsApi } from '../../services/results/resultsApi';
import type { AnalysisResultDocument, FeatureImportanceResult, SelectedSegmentContext } from '../../types/results';
import { Badge, Button, Card, EmptyState, Metric, formatNumber, formatPercent } from '../common/ui';

const directionLabel: Record<FeatureImportanceResult['direction'], string> = {
  positive: 'プラス',
  negative: 'マイナス',
  neutral: '中立'
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

  useEffect(() => {
    const controller = new AbortController();

    resultsApi
      .getResult(analysisJobId, { signal: controller.signal })
      .then((nextResult) => {
        setResult(nextResult);
        setSelectedFeatureKey(nextResult.featureImportances[0]?.featureKey ?? null);
        setSelectedPatternId(nextResult.goldenPatterns[0]?.id ?? null);
        setSelectedSegmentIds(nextResult.segmentRecommendations.slice(0, 1).map((segment) => segment.id));
      })
      .catch((error: unknown) => {
        if (!isAbortError(error)) {
          setResult(null);
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
    return <div className="screen"><Card>結果を読み込んでいます。</Card></div>;
  }

  const completed = result.status === 'completed';

  return (
    <div className="screen">
      <header className="screen-header">
        <div>
          <h1>結果可視化</h1>
          <p>分析で見つかった重要要因とパターンを確認します。</p>
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
        <span>{result.message}</span>
      </Card>

      <div className="kpi-strip">
        <Metric label="分析対象件数" value={formatNumber(result.summary.analyzedRowCount)} />
        <Metric label="重要特徴量" value={result.summary.topFeatureCount} />
        <Metric label="有効パターン" value={result.summary.validPatternCount} />
        <Metric label="推奨セグメント" value={result.summary.recommendedSegmentCount} />
        <Metric label="ベースライン比改善" value={formatPercent(result.summary.improvementRate)} />
      </div>

      <div className="two-column">
        <Card>
          <div className="panel-heading">
            <h2>重要特徴量ランキング</h2>
            <Badge tone="info">0-100 正規化</Badge>
          </div>
          <div className="bar-list">
            {result.featureImportances.map((feature) => (
              <button
                key={feature.featureKey}
                type="button"
                className={feature.featureKey === selectedFeatureKey ? 'selected' : ''}
                aria-pressed={feature.featureKey === selectedFeatureKey}
                aria-label={`${feature.label}: importance ${feature.importanceScore}, direction ${feature.direction}`}
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
            <h3>Feature importance table</h3>
            <table className="feature-table">
              <thead>
                <tr>
                  <th>Feature</th>
                  <th>Score</th>
                  <th>Direction</th>
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
                <span>{selectedFeature.category}</span>
                <span>{selectedFeature.aggregation}</span>
                <span>欠損率 {formatPercent(selectedFeature.missingRate)}</span>
              </div>
            </section>
          ) : null}
          <section className="detail-section">
            <h3>相互作用</h3>
            {result.interactionPairs.map((pair) => (
              <p className="notice" key={`${pair.leftFeatureKey}-${pair.rightFeatureKey}`}>{pair.summary}</p>
            ))}
          </section>
        </Card>

        <Card>
          <div className="panel-heading">
            <h2>パターンとアクション候補</h2>
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
                <strong>{pattern.title}</strong>
                <p>{pattern.description}</p>
                <div className="card-row">
                  <Badge tone="success">support {formatPercent(pattern.supportRate)}</Badge>
                  {pattern.lift ? <Badge tone="info">lift {pattern.lift.toFixed(2)}</Badge> : null}
                  <Badge tone="warning">成約率差 {formatPercent(pattern.conversionDelta)}</Badge>
                </div>
              </button>
            ))}
          </section>
          {selectedPattern ? (
            <section className="detail-section">
              <h3>条件</h3>
              <div className="chip-list">
                {selectedPattern.conditions.map((condition) => (
                  <span className="chip" key={`${condition.featureKey}-${condition.label}`}>{condition.label}</span>
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
