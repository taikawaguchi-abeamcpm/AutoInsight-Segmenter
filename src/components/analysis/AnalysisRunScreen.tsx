import { AlertTriangle, Play, Save } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { isAbortError, isApiError, makeHash } from '../../services/client';
import { analysisApi, createDefaultConfig } from '../../services/analysis/analysisApi';
import type { AnalysisInputSummary, AnalysisMode, AnalysisRunConfig, AnalysisRunValidation, CustomAnalysisConfig } from '../../types/analysis';
import type { SemanticMappingDocument } from '../../types/mapping';
import type { FabricDataset } from '../../types/mapping';
import { Badge, Button, Card, Field, Metric, formatNumber, formatPercent } from '../common/ui';

const validateConfigLocally = (summary: AnalysisInputSummary, config: AnalysisRunConfig): AnalysisRunValidation => {
  const issues: AnalysisRunValidation['issues'] = [];
  const selectedFeatureCount =
    config.mode === 'custom'
      ? config.selectedFeatureKeys.length
      : summary.features.filter((feature) => !config.blockedColumnKeys.includes(feature.featureKey)).length;

  if (selectedFeatureCount < 1) {
    issues.push({
      id: 'local-no-enabled-features',
      scope: 'analysis',
      severity: 'error',
      code: 'ANALYSIS.NO_ENABLED_FEATURES',
      message: 'Select at least one feature before starting analysis.',
      blocking: true
    });
  }

  if (config.mode === 'custom') {
    if (!config.targetPositiveValue.trim()) {
      issues.push({
        id: 'local-missing-target-positive-value',
        scope: 'analysis',
        severity: 'error',
        code: 'ANALYSIS.MISSING_TARGET_POSITIVE_VALUE',
        message: '目的変数の正解の値を入力してください。',
        blocking: true
      });
    }

    if (config.maxFeatureCount < 1 || config.patternCount < 1) {
      issues.push({
        id: 'local-invalid-count',
        scope: 'analysis',
        severity: 'error',
        code: 'ANALYSIS.INVALID_COUNT',
        message: 'Feature and pattern counts must be greater than zero.',
        blocking: true
      });
    }
  }

  return {
    valid: !issues.some((issue) => issue.blocking),
    estimatedDurationSeconds: config.mode === 'autopilot' ? 180 : 90,
    issues
  };
};

export const AnalysisRunScreen = ({
  mapping,
  fabricDataset,
  onBack,
  onStarted
}: {
  mapping: SemanticMappingDocument;
  fabricDataset: FabricDataset;
  onBack: () => void;
  onStarted: (analysisJobId: string) => void;
}) => {
  const [summary, setSummary] = useState<AnalysisInputSummary | null>(null);
  const [mode, setMode] = useState<AnalysisMode>('custom');
  const [config, setConfig] = useState<AnalysisRunConfig | null>(null);
  const [validation, setValidation] = useState<AnalysisRunValidation | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    analysisApi
      .bootstrap(mapping, fabricDataset, { signal: controller.signal })
      .then((bootstrap) => {
        const defaultConfig = bootstrap.defaultConfig ?? createDefaultConfig(bootstrap.summary, 'custom');
        setSummary(bootstrap.summary);
        setConfig(defaultConfig);
        setValidation(validateConfigLocally(bootstrap.summary, defaultConfig));
        setLoadError(null);
      })
      .catch((error: unknown) => {
        if (!isAbortError(error)) {
          setSummary(null);
          setConfig(null);
          setValidation(null);
          setLoadError(isApiError(error) || error instanceof Error ? error.message : '分析入力を読み込めませんでした。');
        }
      });

    return () => controller.abort();
  }, [fabricDataset, mapping]);

  useEffect(() => {
    if (!summary || !config) {
      return;
    }

    const configHash = makeHash(config);
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      analysisApi
        .validate(summary, config, { signal: controller.signal })
        .then((result) => {
          if (!controller.signal.aborted && makeHash(config) === configHash) {
            setValidation(result);
          }
        })
        .catch((error: unknown) => {
          if (!isAbortError(error)) {
            setValidation(validateConfigLocally(summary, config));
          }
        });
    }, 650);

    setValidation(validateConfigLocally(summary, config));

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [config, summary]);

  const enabledFeatureCount = useMemo(() => {
    if (!summary || !config) {
      return 0;
    }

    if (config.mode === 'custom') {
      return config.selectedFeatureKeys.length;
    }

    return summary.features.filter((feature) => !config.blockedColumnKeys.includes(feature.featureKey)).length;
  }, [config, summary]);

  const switchMode = (nextMode: AnalysisMode) => {
    if (!summary) {
      return;
    }

    const nextConfig = createDefaultConfig(summary, nextMode);
    setMode(nextMode);
    setConfig(nextConfig);
  };

  const updateConfig = (nextConfig: AnalysisRunConfig) => {
    if (!summary) {
      return;
    }

    setConfig(nextConfig);
  };

  const toggleFeature = (featureKey: string) => {
    if (!config || config.mode !== 'custom') {
      return;
    }

    const selected = config.selectedFeatureKeys.includes(featureKey)
      ? config.selectedFeatureKeys.filter((key) => key !== featureKey)
      : [...config.selectedFeatureKeys, featureKey];

    updateConfig({ ...config, selectedFeatureKeys: selected });
  };

  const start = async () => {
    if (!summary || !config) {
      return;
    }

    const localResult = validateConfigLocally(summary, config);
    setValidation(localResult);

    if (!localResult.valid) {
      return;
    }

    const result = await analysisApi.validate(summary, config);
    setValidation(result);

    if (!result.valid) {
      return;
    }

    setSubmitting(true);
    try {
      const started = await analysisApi.start(mapping, config, {}, fabricDataset);
      onStarted(started.analysisJobId);
    } finally {
      setSubmitting(false);
    }
  };

  if (!summary || !config) {
    return <div className="screen"><Card>{loadError ?? '分析入力を読み込んでいます。'}</Card></div>;
  }

  const customConfig = config.mode === 'custom' ? config : null;

  return (
    <div className="screen">
      <header className="screen-header">
        <div>
          <h1>分析条件確認 / 実験開始</h1>
          <p>分析対象と実行条件を確認して実験を開始します。</p>
        </div>
        <div className="actions">
          <Button variant="secondary" onClick={onBack}>意味付けへ戻る</Button>
          <Button variant="secondary"><Save size={16} /> 下書き保存</Button>
          <Button onClick={start} disabled={submitting || validation?.valid === false}>
            <Play size={16} /> 実験を開始
          </Button>
        </div>
      </header>

      <div className="tab-row" role="tablist" aria-label="Analysis mode">
        {(['custom', 'autopilot'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            className={mode === tab ? 'selected' : ''}
            aria-selected={mode === tab}
            onClick={() => switchMode(tab)}
          >
            {tab === 'custom' ? 'カスタム分析' : 'オートパイロット'}
          </button>
        ))}
      </div>

      <div className="two-column">
        <Card>
          <div className="panel-heading">
            <h2>分析対象サマリ</h2>
            <Badge tone="success">{summary.customerTableName}</Badge>
          </div>
          <div className="metrics-grid">
            <Metric label="分析に使える件数" value={formatNumber(summary.dataQuality.eligibleRowCount)} />
            <Metric label="目的変数" value={summary.target.label} />
            <Metric label="有効特徴量" value={enabledFeatureCount} />
            <Metric label="平均欠損率" value={formatPercent(summary.dataQuality.averageMissingRate)} />
          </div>
          <section className="detail-section">
            <h3>特徴量</h3>
            <div className="data-table">
              {summary.features.map((feature) => (
                <label className="feature-row" key={feature.featureKey}>
                  <input
                    type="checkbox"
                    checked={config.mode !== 'custom' || config.selectedFeatureKeys.includes(feature.featureKey)}
                    disabled={config.mode !== 'custom'}
                    onChange={() => toggleFeature(feature.featureKey)}
                  />
                  <span>{feature.label}</span>
                  <Badge tone="neutral">{feature.category}</Badge>
                  <small>{feature.valueType === 'numeric' ? '数値' : 'カテゴリ'} / {feature.aggregation}{feature.timeWindowDays ? ` / ${feature.timeWindowDays}日` : ''}</small>
                  <small>{formatPercent(feature.missingRate)}</small>
                </label>
              ))}
            </div>
          </section>
          <section className="detail-section">
            <h3>事前チェック</h3>
            {validation?.issues.map((issue) => (
              <p className={`notice ${issue.severity}`} key={issue.id}>
                <AlertTriangle size={16} /> {issue.message}
              </p>
            ))}
          </section>
        </Card>

        <Card>
          <div className="panel-heading">
            <h2>実行条件設定</h2>
            <Badge tone={mode === 'custom' ? 'info' : 'success'}>{mode === 'custom' ? '細かく調整' : '自動探索'}</Badge>
          </div>

          {customConfig ? (
            <div className="form-grid">
              <Field label="目的変数の正解の値">
                <input value={customConfig.targetPositiveValue} onChange={(event) => updateConfig({ ...customConfig, targetPositiveValue: event.target.value })} />
              </Field>
              <Field label="モデル方針">
                <select
                  value={customConfig.optimizationPreference}
                  onChange={(event) => updateConfig({ ...customConfig, optimizationPreference: event.target.value as CustomAnalysisConfig['optimizationPreference'] })}
                >
                  <option value="balanced">バランス</option>
                  <option value="explainability">理由が分かりやすい結果を優先</option>
                  <option value="accuracy">精度を優先</option>
                </select>
              </Field>
              <Field label="上限特徴量数">
                <input
                  type="number"
                  min={1}
                  value={customConfig.maxFeatureCount}
                  onChange={(event) => updateConfig({ ...customConfig, maxFeatureCount: Number(event.target.value) })}
                />
              </Field>
              <Field label="注目パターン数">
                <input
                  type="number"
                  min={1}
                  value={customConfig.patternCount}
                  onChange={(event) => updateConfig({ ...customConfig, patternCount: Number(event.target.value) })}
                />
              </Field>
            </div>
          ) : config.mode === 'autopilot' ? (
            <div className="form-grid">
              <Field label="探索時間上限">
                <select
                  value={config.timeBudgetMinutes}
                  onChange={(event) => updateConfig({ ...config, timeBudgetMinutes: Number(event.target.value) as 5 | 10 | 30 | 60 })}
                >
                  <option value={5}>5 分</option>
                  <option value={10}>10 分</option>
                  <option value={30}>30 分</option>
                  <option value={60}>60 分</option>
                </select>
              </Field>
              <Field label="候補特徴量上限">
                <input
                  type="number"
                  min={10}
                  value={config.candidateFeatureLimit}
                  onChange={(event) => updateConfig({ ...config, candidateFeatureLimit: Number(event.target.value) })}
                />
              </Field>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={config.allowGeneratedFeatures}
                  onChange={(event) => updateConfig({ ...config, allowGeneratedFeatures: event.target.checked })}
                />
                自動生成特徴量を含める
              </label>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={config.excludeHighMissingColumns}
                  onChange={(event) => updateConfig({ ...config, excludeHighMissingColumns: event.target.checked })}
                />
                高欠損列を除外
              </label>
            </div>
          ) : null}
        </Card>
      </div>

      <footer className="action-bar">
        <span>エラー {validation?.issues.filter((issue) => issue.severity === 'error').length ?? 0} / 警告 {validation?.issues.filter((issue) => issue.severity === 'warning').length ?? 0}</span>
        <strong>{mode === 'custom' ? 'カスタム分析' : 'オートパイロット'} / {enabledFeatureCount} 特徴量 / 約 {validation?.estimatedDurationSeconds ?? '-'} 秒</strong>
        <Button onClick={start} disabled={submitting || validation?.valid === false}>分析を開始</Button>
      </footer>
    </div>
  );
};
