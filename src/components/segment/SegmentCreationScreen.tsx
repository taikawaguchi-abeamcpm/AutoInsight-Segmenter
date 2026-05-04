import { Plus, Save, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { isAbortError } from '../../services/client';
import { segmentApi } from '../../services/segment/segmentApi';
import type { SelectedSegmentContext } from '../../types/results';
import type { SegmentDraft, SegmentOutputType, SegmentRuleCondition, SegmentSaveResult } from '../../types/segment';
import { Badge, Button, Card, Field, Metric, formatNumber, formatPercent } from '../common/ui';

const outputLabels: Record<SegmentOutputType, string> = {
  flag: '専用セグメントテーブルにフラグ保存',
  list: '固定リストとして保存',
  csv: 'CSV として出力',
  external: 'ほかの施策ツールで使うために保存'
};

const outputHelp: Record<SegmentOutputType, string> = {
  flag: 'Fabric 側で施策対象フラグとして参照できます。',
  list: '今回の条件に合う顧客IDリストとして残します。',
  csv: '確認や外部連携用にファイル出力します。',
  external: 'MA や営業支援ツールへ渡す前提で保存します。'
};

const formatAudienceRate = (value?: number) => {
  if (typeof value !== 'number') {
    return '-';
  }

  if (value > 0 && value < 0.001) {
    return formatPercent(value, 3);
  }

  return formatPercent(value);
};

export const SegmentCreationScreen = ({
  context,
  onBack
}: {
  context: SelectedSegmentContext;
  onBack: () => void;
}) => {
  const [draft, setDraft] = useState<SegmentDraft | null>(null);
  const [saveResult, setSaveResult] = useState<SegmentSaveResult | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    segmentApi
      .bootstrap(context, { signal: controller.signal })
      .then(setDraft)
      .catch((error: unknown) => {
        if (!isAbortError(error)) {
          setDraft(null);
        }
      });

    return () => controller.abort();
  }, [context]);

  const updateDraft = (patch: Partial<SegmentDraft>) => {
    setDraft((current) => (current ? { ...current, ...patch, updatedAt: new Date().toISOString() } : current));
  };

  const updateCondition = (conditionId: string, patch: Partial<SegmentRuleCondition>) => {
    if (!draft) {
      return;
    }

    updateDraft({
      ruleTree: {
        ...draft.ruleTree,
        conditions: draft.ruleTree.conditions.map((condition) =>
          condition.id === conditionId ? { ...condition, ...patch } : condition
        )
      }
    });
  };

  const addCondition = () => {
    if (!draft) {
      return;
    }

    updateDraft({
      ruleTree: {
        ...draft.ruleTree,
        conditions: [
          ...draft.ruleTree.conditions,
          {
            id: `cond-${Date.now()}`,
            fieldKey: 'web_visit_count_30d',
            fieldLabel: '30日間の訪問回数',
            fieldType: 'number',
            operator: 'gte',
            value: 1,
            source: 'manual'
          }
        ]
      }
    });
  };

  const removeCondition = (conditionId: string) => {
    if (!draft) {
      return;
    }

    updateDraft({
      ruleTree: {
        ...draft.ruleTree,
        conditions: draft.ruleTree.conditions.filter((condition) => condition.id !== conditionId)
      }
    });
  };

  const toggleOutput = (output: SegmentOutputType) => {
    if (!draft) {
      return;
    }

    const outputs = draft.outputConfig.outputs.includes(output)
      ? draft.outputConfig.outputs.filter((item) => item !== output)
      : [...draft.outputConfig.outputs, output];

    updateDraft({
      outputConfig: {
        ...draft.outputConfig,
        outputs
      }
    });
  };

  const refreshPreview = async () => {
    if (!draft) {
      return;
    }

    updateDraft({ previewSummary: await segmentApi.preview(draft) });
  };

  const save = async () => {
    if (!draft) {
      return;
    }

    const preview = await segmentApi.preview(draft);
    const nextDraft = { ...draft, previewSummary: preview };
    setDraft(nextDraft);

    if (preview.warnings.some((warning) => warning.severity === 'error') || draft.ruleTree.conditions.length === 0 || draft.outputConfig.outputs.length === 0 || !draft.name.trim()) {
      return;
    }

    setSubmitting(true);
    setSaveResult(await segmentApi.save(nextDraft));
    setSubmitting(false);
  };

  if (!draft) {
    return (
      <div className="screen">
        <Card className="loading-panel">
          <strong>セグメント編集内容を準備しています。</strong>
          <p>選択した候補から条件、件数、出力先を作成しています。</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="screen">
      <header className="screen-header">
        <div>
          <h1>セグメント作成</h1>
          <p>分析結果を配信・抽出に使える顧客グループとして保存します。作成前に条件と件数を確認してください。</p>
        </div>
        <div className="actions">
          <Button variant="secondary" onClick={onBack}>結果に戻る</Button>
          <Button variant="secondary"><Save size={16} /> 下書き保存</Button>
          <Button onClick={save} disabled={submitting}>セグメントを作成</Button>
        </div>
      </header>

      <div className="kpi-strip">
        <Metric label="セグメント名" value={draft.name} />
        <Metric label="元候補数" value={draft.sourceRecommendationIds.length} />
        <Metric label="推定対象件数" value={formatNumber(draft.previewSummary?.estimatedAudienceSize)} />
        <Metric label="母集団比率" value={formatAudienceRate(draft.previewSummary?.audienceRate)} />
      </div>

      <div className="segment-grid">
        <Card>
          <div className="panel-heading">
            <h2>候補と条件ビルダー</h2>
            <Button variant="secondary" onClick={addCondition}><Plus size={16} /> 条件を追加</Button>
          </div>
          <Field label="条件グループ">
            <select
              aria-label="条件グループの一致方法"
              value={draft.ruleTree.operator}
              onChange={(event) =>
                updateDraft({
                  ruleTree: {
                    ...draft.ruleTree,
                    operator: event.target.value as 'and' | 'or'
                  }
                })
              }
            >
              <option value="and">すべて満たす</option>
              <option value="or">いずれかを満たす</option>
            </select>
          </Field>
          <div className="condition-list">
            {draft.ruleTree.conditions.map((condition) => (
              <div className="condition-row" key={condition.id}>
                <input
                  aria-label="条件項目"
                  value={condition.fieldLabel}
                  onChange={(event) => updateCondition(condition.id, { fieldLabel: event.target.value })}
                />
                <select
                  aria-label="条件の判定方法"
                  value={condition.operator}
                  onChange={(event) => updateCondition(condition.id, { operator: event.target.value as SegmentRuleCondition['operator'] })}
                >
                  <option value="eq">等しい</option>
                  <option value="gte">以上</option>
                  <option value="gt">より大きい</option>
                  <option value="lt">未満</option>
                  <option value="between">範囲</option>
                  <option value="contains">含む</option>
                </select>
                <input
                  aria-label="条件値"
                  value={String(condition.value)}
                  onChange={(event) => updateCondition(condition.id, { value: condition.fieldType === 'number' ? Number(event.target.value) : event.target.value })}
                />
                <button type="button" className="icon-button" onClick={() => removeCondition(condition.id)} aria-label="条件を削除">
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
          <section className="detail-section">
            <h3>条件テンプレート</h3>
            <div className="chip-list">
              <button type="button" className="chip" onClick={addCondition}>最近 30 日で接触あり</button>
              <button type="button" className="chip" onClick={addCondition}>購買回数が多い</button>
              <button type="button" className="chip" onClick={addCondition}>高反応見込み</button>
            </div>
          </section>
        </Card>

        <Card>
          <div className="panel-heading">
            <h2>プレビューと件数確認</h2>
            <Button variant="secondary" onClick={refreshPreview}>件数を再計算</Button>
          </div>
          <div className="metrics-grid">
            <Metric label="この条件に当てはまる人数" value={formatNumber(draft.previewSummary?.estimatedAudienceSize)} />
            <Metric label="前回との差分" value={formatNumber(draft.previewSummary?.deltaFromPreviousPreview)} />
          </div>
          {draft.previewSummary?.warnings.map((warning) => (
            <p className={`notice ${warning.severity}`} key={warning.code}>{warning.message}</p>
          ))}
          <section className="detail-section">
            <h3>対象サンプル</h3>
            <p>個人を特定しないサンプルです。実行時は条件に合う顧客IDが出力されます。</p>
            <div className="data-table">
              {draft.previewSummary?.sampleRows.map((row) => (
                <div className="sample-row" key={row.customerKey}>
                  <strong>{row.displayName ?? row.customerKey}</strong>
                  <span>{Object.entries(row.attributes).map(([key, value]) => `${key}: ${value}`).join(' / ')}</span>
                  <small>{row.matchedReasons[0]}</small>
                </div>
              ))}
            </div>
          </section>
        </Card>

        <Card>
          <div className="panel-heading">
            <h2>保存設定と出力先</h2>
            <Badge tone="info">{draft.status}</Badge>
          </div>
          <Field label="セグメント名">
            <input value={draft.name} onChange={(event) => updateDraft({ name: event.target.value })} />
          </Field>
          <Field label="説明">
            <textarea value={draft.description ?? ''} onChange={(event) => updateDraft({ description: event.target.value })} rows={4} />
          </Field>
          <section className="detail-section">
            <h3>出力方法</h3>
            {Object.entries(outputLabels).map(([value, label]) => (
              <label className="check-row" key={value}>
                <input
                  type="checkbox"
                  aria-label={label}
                  checked={draft.outputConfig.outputs.includes(value as SegmentOutputType)}
                  onChange={() => toggleOutput(value as SegmentOutputType)}
                />
                <span>
                  <strong>{label}</strong>
                  <small>{outputHelp[value as SegmentOutputType]}</small>
                </span>
              </label>
            ))}
          </section>
          <Field label="付与するフラグ名">
            <input
              value={draft.outputConfig.flagConfig?.flagColumnName ?? ''}
              onChange={(event) =>
                updateDraft({
                  outputConfig: {
                    ...draft.outputConfig,
                    flagConfig: {
                      tableName: draft.outputConfig.flagConfig?.tableName ?? 'segment_outputs',
                      overwriteMode: draft.outputConfig.flagConfig?.overwriteMode ?? 'overwrite',
                      flagColumnName: event.target.value
                    }
                  }
                })
              }
            />
          </Field>
          {saveResult ? (
            <p className="notice success">
              {saveResult.status === 'queued' ? 'セグメント作成を開始しました。' : 'セグメントを保存しました。'}
              保存先: {saveResult.outputLocation}
            </p>
          ) : null}
        </Card>
      </div>

      <footer className="action-bar">
        <span>エラー {draft.previewSummary?.warnings.filter((warning) => warning.severity === 'error').length ?? 0}</span>
        <strong>{draft.name} / {formatNumber(draft.previewSummary?.estimatedAudienceSize)} 人 / {draft.outputConfig.outputs.map((output) => outputLabels[output]).join(', ')}</strong>
        <Button onClick={save} disabled={submitting}>セグメントを作成</Button>
      </footer>
    </div>
  );
};
