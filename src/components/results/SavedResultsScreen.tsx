import { RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { isAbortError, isApiError } from '../../services/client';
import { resultsApi } from '../../services/results/resultsApi';
import type { SavedAnalysisResultListItem } from '../../types/results';
import { Badge, Button, Card, EmptyState, formatDateTime, formatNumber, formatPercent } from '../common/ui';

const statusTone: Record<SavedAnalysisResultListItem['status'], 'neutral' | 'success' | 'warning' | 'danger' | 'info'> = {
  queued: 'neutral',
  running: 'info',
  completed: 'success',
  partial: 'warning',
  failed: 'danger'
};

const statusLabel: Record<SavedAnalysisResultListItem['status'], string> = {
  queued: '待機中',
  running: '実行中',
  completed: '完了',
  partial: '一部完了',
  failed: '失敗'
};

export const SavedResultsScreen = ({
  onOpenResult,
  onBackToDataset
}: {
  onOpenResult: (analysisJobId: string) => void;
  onBackToDataset: () => void;
}) => {
  const [results, setResults] = useState<SavedAnalysisResultListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadResults = () => {
    const controller = new AbortController();
    setLoading(true);
    setErrorMessage(null);

    resultsApi
      .listSavedResults({ signal: controller.signal })
      .then((nextResults) => {
        setResults(Array.isArray(nextResults) ? nextResults : []);
        setErrorMessage(null);
      })
      .catch((error: unknown) => {
        if (!isAbortError(error)) {
          setResults([]);
          setErrorMessage(isApiError(error) || error instanceof Error ? error.message : '保存済み結果を読み込めませんでした。');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return controller;
  };

  useEffect(() => {
    const controller = loadResults();
    return () => controller.abort();
  }, []);

  return (
    <div className="screen">
      <header className="screen-header">
        <div>
          <h1>保存済み結果</h1>
          <p>過去に保存した分析結果を呼び出して、施策候補を再確認します。</p>
        </div>
        <div className="actions">
          <Button variant="secondary" onClick={() => loadResults()}>
            <RefreshCw size={16} /> 再読み込み
          </Button>
          <Button variant="secondary" onClick={onBackToDataset}>データセットへ戻る</Button>
        </div>
      </header>

      {errorMessage ? <p className="notice error">{errorMessage}</p> : null}

      <Card>
        <div className="panel-heading">
          <h2>結果一覧</h2>
          <Badge tone="info">{results.length} 件</Badge>
        </div>
        {loading ? <EmptyState title="読み込み中" description="保存済みの分析結果を確認しています。" /> : null}
        {!loading && results.length === 0 ? (
          <EmptyState title="保存済み結果なし" description="結果画面で「結果を保存」を押すと、ここから呼び出せるようになります。" />
        ) : null}
        <div className="saved-result-list">
          {results.map((result) => (
            <button
              type="button"
              className="saved-result-row"
              key={result.analysisJobId}
              onClick={() => onOpenResult(result.analysisJobId)}
            >
              <span>
                <strong>{formatDateTime(result.completedAt ?? result.updatedAt ?? result.createdAt)}</strong>
                <small>{result.mode === 'autopilot' ? 'オートパイロット' : 'カスタム分析'} / {result.analysisJobId}</small>
              </span>
              <span>
                <small>成果候補</small>
                <strong>{formatNumber(result.summary.validPatternCount)} 件</strong>
              </span>
              <span>
                <small>分析対象</small>
                <strong>{formatNumber(result.summary.analyzedRowCount)} 行</strong>
              </span>
              <span>
                <small>改善</small>
                <strong>{formatPercent(result.summary.improvementRate)}</strong>
              </span>
              <Badge tone={statusTone[result.status]}>{statusLabel[result.status]}</Badge>
            </button>
          ))}
        </div>
      </Card>
    </div>
  );
};
