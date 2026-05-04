import { Cable, Database, RefreshCcw, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { isAbortError, isApiError } from '../../services/client';
import { datasetApi } from '../../services/dataset/datasetApi';
import type { ApiError } from '../../types/common';
import type { DatasetConnectionStatus, DatasetListItem, DatasetPreview, SelectedDatasetContext } from '../../types/dataset';
import { Badge, Button, Card, EmptyState, Field, FieldGroup, Metric, formatDateTime, formatNumber } from '../common/ui';

const statusLabel: Record<DatasetConnectionStatus, string> = {
  ready: 'すぐに使えます',
  warning: '確認してから使う',
  error: 'このままでは使えません',
  forbidden: '閲覧不可',
  syncing: '同期中'
};

const statusTone: Record<DatasetConnectionStatus, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  ready: 'success',
  warning: 'warning',
  error: 'danger',
  forbidden: 'danger',
  syncing: 'info'
};

export const DatasetSelectionScreen = ({
  onSelected,
  onOpenConnectionAdmin
}: {
  onSelected: (context: SelectedDatasetContext) => void;
  onOpenConnectionAdmin: () => void;
}) => {
  const [datasets, setDatasets] = useState<DatasetListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<DatasetPreview | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | DatasetConnectionStatus>('all');
  const [listMode, setListMode] = useState<'all' | 'recent' | 'recommended'>('recommended');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewApiError, setPreviewApiError] = useState<ApiError | null>(null);
  const [previewRetryNonce, setPreviewRetryNonce] = useState(0);
  const previewCache = useRef(new Map<string, DatasetPreview>());

  const load = async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const response = await datasetApi.listDatasets({ signal });
      setDatasets(response.data);
      setSelectedId(
        response.data.find((dataset) => dataset.recommended && dataset.connectionStatus === 'ready')?.id ??
          response.data.find((dataset) => dataset.connectionStatus === 'ready')?.id ??
          response.data[0]?.id ??
          null
      );
    } catch (error) {
      if (!isAbortError(error)) {
        setDatasets([]);
      }
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);

    return () => controller.abort();
  }, []);

  const selected = datasets.find((dataset) => dataset.id === selectedId) ?? null;

  useEffect(() => {
    if (!selected) {
      setPreview(null);
      setPreviewApiError(null);
      return;
    }

    if (selected.connectionStatus !== 'ready') {
      setPreview(null);
      setPreviewApiError(null);
      setPreviewError('このデータセットは接続確認が完了していないため使用できません。Fabric接続設定を確認してください。');
      return;
    }

    setPreviewError(null);
    setPreviewApiError(null);

    const cachedPreview = previewCache.current.get(selected.id);
    if (cachedPreview) {
      setPreview(cachedPreview);
      return;
    }

    setPreview(null);
    const controller = new AbortController();
    datasetApi
      .getDatasetPreview(selected.id, { signal: controller.signal })
      .then((nextPreview) => {
        previewCache.current.set(selected.id, nextPreview);
        setPreview(nextPreview);
      })
      .catch((error: unknown) => {
        if (isAbortError(error)) {
          return;
        }

        setPreview(null);
        setPreviewError(isApiError(error) ? error.message : 'Dataset preview could not be loaded.');
        setPreviewApiError(isApiError(error) ? error : null);
      });

    return () => controller.abort();
  }, [selected, previewRetryNonce]);

  const filtered = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return datasets
      .filter((dataset) => {
        const matchesQuery =
          query.length === 0 ||
          [dataset.displayName, dataset.description, dataset.workspaceName, ...dataset.tags]
            .filter(Boolean)
            .some((value) => value?.toLowerCase().includes(query));
        const matchesStatus = statusFilter === 'all' || dataset.connectionStatus === statusFilter;
        const matchesMode =
          listMode === 'all' ||
          (listMode === 'recent' && dataset.recentlyUsed) ||
          (listMode === 'recommended' && dataset.recommended);

        return matchesQuery && matchesStatus && matchesMode;
      })
      .sort((left, right) => (right.recommendationScore ?? 0) - (left.recommendationScore ?? 0));
  }, [datasets, listMode, searchQuery, statusFilter]);

  const canSubmit = selected?.connectionStatus === 'ready' && !submitting;

  const submit = async () => {
    if (!selected || !canSubmit) {
      return;
    }

    setSubmitting(true);
    try {
      onSelected(await datasetApi.selectDataset(selected));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="screen">
      <header className="screen-header">
        <div>
          <h1>データセット選択</h1>
          <p>分析に使う Fabric データソースを選択してください。</p>
        </div>
        <div className="actions">
          <Button variant="secondary" onClick={() => void load()}>
            <RefreshCcw size={16} /> 再読み込み
          </Button>
          <Button variant="secondary" onClick={onOpenConnectionAdmin}>
            <Cable size={16} /> Fabric に接続
          </Button>
        </div>
      </header>

      <section className="toolbar">
        <Field label="キーワード">
          <div className="input-with-icon">
            <Search size={16} />
            <input
              aria-label="データセット検索キーワード"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="データセット名、説明、タグ"
            />
          </div>
        </Field>
        <Field label="ステータス">
          <select
            aria-label="データセットのステータス"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as 'all' | DatasetConnectionStatus)}
          >
            <option value="all">すべて</option>
            <option value="ready">利用可能</option>
            <option value="warning">警告あり</option>
            <option value="forbidden">閲覧不可</option>
            <option value="error">接続エラー</option>
          </select>
        </Field>
        <FieldGroup label="表示">
          <div className="segmented" role="group">
            {(['recommended', 'recent', 'all'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                className={listMode === mode ? 'selected' : ''}
                aria-pressed={listMode === mode}
                onClick={() => setListMode(mode)}
              >
                {mode === 'recommended' ? 'おすすめ' : mode === 'recent' ? '最近使った' : 'すべて'}
              </button>
            ))}
          </div>
        </FieldGroup>
      </section>

      <div className="two-column">
        <section className="list-panel">
          {loading ? <EmptyState title="読み込み中" description="Fabric ワークスペースとデータセットを確認しています。" /> : null}
          {!loading && filtered.length === 0 ? <EmptyState title="候補がありません" description="検索条件を変更してください。" /> : null}
          {filtered.map((dataset) => (
            <button
              key={dataset.id}
              type="button"
              className={`dataset-card ${dataset.id === selectedId ? 'selected' : ''}`}
              aria-pressed={dataset.id === selectedId}
              aria-label={`${dataset.displayName}を選択`}
              onClick={() => setSelectedId(dataset.id)}
              disabled={dataset.connectionStatus === 'error'}
              onDoubleClick={submit}
            >
              <div>
                <h2>{dataset.displayName}</h2>
                <p>{dataset.description}</p>
              </div>
              <div className="card-row">
                <Badge tone={statusTone[dataset.connectionStatus]}>{statusLabel[dataset.connectionStatus]}</Badge>
                {dataset.recommended ? <Badge tone="info">おすすめ {dataset.recommendationScore}</Badge> : null}
              </div>
              <div className="tag-row">
                {dataset.tags.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
              <div className="subtle-row">
                <span>{dataset.workspaceName}</span>
                <span>{dataset.tableCount} テーブル</span>
                <span>{formatDateTime(dataset.lastSyncedAt)}</span>
              </div>
            </button>
          ))}
        </section>

        <Card className="detail-panel">
          {selected ? (
            <>
              <div className="panel-heading">
                <div>
                  <h2>{selected.displayName}</h2>
                  <p>{selected.workspaceName}</p>
                </div>
                <Badge tone={statusTone[selected.connectionStatus]}>{statusLabel[selected.connectionStatus]}</Badge>
              </div>
              <div className="metrics-grid">
                <Metric label="テーブル数" value={selected.tableCount} />
                <Metric label="推定行数" value={formatNumber(preview?.rowEstimate)} />
                <Metric label="カラム数" value={formatNumber(preview?.columnCount)} />
                <Metric label="日時列候補" value={preview?.timestampColumnCount ?? '-'} />
              </div>
              <section className="detail-section">
                <h3>おすすめ理由</h3>
                <ul className="clean-list">
                  {selected.recommendationReasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </section>
              <section className="detail-section">
                <h3>主要テーブル</h3>
                {selected.connectionStatus !== 'ready' ? (
                  <div className="notice warning">
                    <span>
                      この接続はスキーマ確認が完了していないため次へ進めません。
                      {selected.connectionId ? ` 接続ID: ${selected.connectionId}` : ''}
                      {selected.secretConfigured === false ? ' Client Secret が未登録です。' : ''}
                    </span>
                  </div>
                ) : null}
                {previewError ? (
                  <div className="notice danger">
                    <span>
                      {previewError}
                      {previewApiError?.correlationId ? ` (${previewApiError.correlationId})` : ''}
                    </span>
                    {previewApiError?.retryable ? (
                      <Button variant="secondary" onClick={() => setPreviewRetryNonce((value) => value + 1)}>
                        <RefreshCcw size={16} /> Retry
                      </Button>
                    ) : null}
                  </div>
                ) : null}
                {preview?.topTables.map((table) => (
                  <div className="table-preview" key={table.tableId}>
                    <Database size={16} />
                    <span>{table.tableName}</span>
                    <strong>{formatNumber(table.rowCount)} 行</strong>
                    <Badge tone="neutral">{table.suggestedRole ?? 'unknown'}</Badge>
                  </div>
                ))}
              </section>
            </>
          ) : (
            <EmptyState title="未選択" description="左の一覧からデータセットを選択してください。" />
          )}
        </Card>
      </div>

      <footer className="action-bar">
        <span>{filtered.length} 件を表示</span>
        <strong>{submitting ? '意味付け画面を準備しています。' : selected ? `${selected.displayName} / ${statusLabel[selected.connectionStatus]}` : '未選択'}</strong>
        <Button onClick={submit} disabled={!canSubmit}>
          {submitting ? '準備中' : 'このデータを使う'}
        </Button>
      </footer>
    </div>
  );
};
