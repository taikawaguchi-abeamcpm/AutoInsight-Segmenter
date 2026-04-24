import { Cable, CheckCircle2, KeyRound, RefreshCcw, Save, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { fabricConnectionApi } from '../../services/admin/fabricConnectionApi';
import { isApiError } from '../../services/client';
import type { FabricAuthMode, FabricConnectionConfig, FabricConnectionDraft, FabricConnectionStatus, FabricConnectionTestResult } from '../../types/admin';
import { Badge, Button, Card, EmptyState, Field, Metric, formatDateTime } from '../common/ui';

const statusLabel: Record<FabricConnectionStatus, string> = {
  unconfigured: '未設定',
  ready: '接続済み',
  needs_attention: '確認が必要',
  error: '接続エラー',
  testing: '確認中'
};

const statusTone: Record<FabricConnectionStatus, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  unconfigured: 'neutral',
  ready: 'success',
  needs_attention: 'warning',
  error: 'danger',
  testing: 'info'
};

const initialDraft: FabricConnectionDraft = {
  displayName: '',
  endpointUrl: '',
  tenantId: '',
  clientId: '',
  authMode: 'obo',
  workspaceId: '',
  schemaVersion: '',
  clientSecret: ''
};

export const FabricConnectionAdminScreen = ({ onBack }: { onBack: () => void }) => {
  const [connections, setConnections] = useState<FabricConnectionConfig[]>([]);
  const [draft, setDraft] = useState<FabricConnectionDraft>(initialDraft);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<FabricConnectionTestResult | null>(null);

  const activeConnection = useMemo(() => connections.find((connection) => connection.isActive) ?? connections[0] ?? null, [connections]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const nextConnections = await fabricConnectionApi.list();
      setConnections(nextConnections);
      const active = nextConnections.find((connection) => connection.isActive) ?? nextConnections[0];
      if (active) {
        setDraft({
          displayName: active.displayName,
          endpointUrl: active.endpointUrl,
          tenantId: active.tenantId,
          clientId: active.clientId,
          authMode: active.authMode,
          workspaceId: active.workspaceId ?? '',
          schemaVersion: active.schemaVersion ?? '',
          clientSecret: ''
        });
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const updateDraft = (key: keyof FabricConnectionDraft, value: string) => {
    setDraft((current) => ({ ...current, [key]: key === 'authMode' ? (value as FabricAuthMode) : value }));
    setMessage(null);
    setError(null);
    setTestResult(null);
  };

  const testConnection = async () => {
    setTesting(true);
    setError(null);
    setMessage(null);
    try {
      const result = await fabricConnectionApi.test(draft);
      setTestResult(result);
      setMessage(result.message);
    } catch (nextError) {
      setTestResult(null);
      setError(isApiError(nextError) ? `${nextError.message} (${nextError.correlationId})` : '接続確認に失敗しました。');
    } finally {
      setTesting(false);
    }
  };

  const saveConnection = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const saved = await fabricConnectionApi.save(draft);
      setConnections((current) => [saved, ...current.filter((connection) => connection.id !== saved.id).map((connection) => ({ ...connection, isActive: false }))]);
      setDraft((current) => ({ ...current, clientSecret: '' }));
      setMessage('接続設定を保存し、有効な接続として設定しました。');
    } catch (nextError) {
      setError(isApiError(nextError) ? `${nextError.message} (${nextError.correlationId})` : '接続設定を保存できませんでした。');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="screen">
      <header className="screen-header">
        <div>
          <h1>Fabric 接続管理</h1>
          <p>Fabric GraphQL endpoint と認証情報を管理します。</p>
        </div>
        <div className="actions">
          <Button variant="secondary" onClick={() => void load()} disabled={loading}>
            <RefreshCcw size={16} /> 再読み込み
          </Button>
          <Button variant="secondary" onClick={onBack}>
            データセットへ戻る
          </Button>
        </div>
      </header>

      <div className="admin-grid">
        <section className="list-panel">
          {loading ? <EmptyState title="読み込み中" description="保存済みの Fabric 接続設定を確認しています。" /> : null}
          {!loading && connections.length === 0 ? <EmptyState title="接続設定がありません" description="右側のフォームから接続情報を登録してください。" /> : null}
          {connections.map((connection) => (
            <button
              key={connection.id}
              type="button"
              className={`dataset-card ${connection.id === activeConnection?.id ? 'selected' : ''}`}
              onClick={() =>
                setDraft({
                  displayName: connection.displayName,
                  endpointUrl: connection.endpointUrl,
                  tenantId: connection.tenantId,
                  clientId: connection.clientId,
                  authMode: connection.authMode,
                  workspaceId: connection.workspaceId ?? '',
                  schemaVersion: connection.schemaVersion ?? '',
                  clientSecret: ''
                })
              }
            >
              <div>
                <h2>{connection.displayName}</h2>
                <p>{connection.endpointUrl}</p>
              </div>
              <div className="card-row">
                <Badge tone={statusTone[connection.status]}>{statusLabel[connection.status]}</Badge>
                {connection.isActive ? <Badge tone="info">有効</Badge> : null}
                <Badge tone="neutral">{connection.authMode === 'obo' ? 'OBO' : 'Service principal'}</Badge>
              </div>
              <div className="subtle-row">
                <span>{connection.workspaceId ?? 'Workspace 未指定'}</span>
                <span>{formatDateTime(connection.lastSuccessAt)}</span>
              </div>
            </button>
          ))}
        </section>

        <Card className="detail-panel">
          <div className="panel-heading">
            <div>
              <h2>接続情報</h2>
              <p>Client Secret はサーバー側の秘密情報ストアにのみ保存する前提です。</p>
            </div>
            <Badge tone={testResult ? statusTone[testResult.status] : activeConnection ? statusTone[activeConnection.status] : 'neutral'}>
              {testResult ? statusLabel[testResult.status] : activeConnection ? statusLabel[activeConnection.status] : '未設定'}
            </Badge>
          </div>

          <div className="metrics-grid">
            <Metric label="有効接続" value={activeConnection?.displayName ?? '-'} />
            <Metric label="認証方式" value={draft.authMode === 'obo' ? 'OBO' : 'SPN'} />
            <Metric label="Secret" value={activeConnection?.secretConfigured || draft.clientSecret ? '登録済み' : '-'} />
            <Metric label="最終確認" value={formatDateTime(testResult?.testedAt ?? activeConnection?.lastTestedAt)} />
          </div>

          {message ? <p className="notice success">{message}</p> : null}
          {error ? <p className="notice danger">{error}</p> : null}

          <section className="detail-section">
            <h3>基本設定</h3>
            <div className="form-grid">
              <Field label="接続名">
                <input value={draft.displayName} onChange={(event) => updateDraft('displayName', event.target.value)} placeholder="Production Fabric GraphQL" />
              </Field>
              <Field label="Workspace ID">
                <input value={draft.workspaceId} onChange={(event) => updateDraft('workspaceId', event.target.value)} placeholder="ws-..." />
              </Field>
              <Field label="Fabric GraphQL endpoint">
                <input value={draft.endpointUrl} onChange={(event) => updateDraft('endpointUrl', event.target.value)} placeholder="https://api.fabric.microsoft.com/..." />
              </Field>
              <Field label="Schema version">
                <input value={draft.schemaVersion} onChange={(event) => updateDraft('schemaVersion', event.target.value)} placeholder="fabric-schema-YYYY-MM-DD" />
              </Field>
            </div>
          </section>

          <section className="detail-section">
            <h3>認証</h3>
            <div className="form-grid">
              <Field label="認証方式">
                <select value={draft.authMode} onChange={(event) => updateDraft('authMode', event.target.value)}>
                  <option value="obo">On-behalf-of</option>
                  <option value="service_principal">Service principal</option>
                </select>
              </Field>
              <Field label="Tenant ID">
                <input value={draft.tenantId} onChange={(event) => updateDraft('tenantId', event.target.value)} />
              </Field>
              <Field label="Client ID">
                <input value={draft.clientId} onChange={(event) => updateDraft('clientId', event.target.value)} />
              </Field>
              <Field label="Client Secret" help="保存後は値を再表示しません。">
                <input
                  type="password"
                  value={draft.clientSecret}
                  onChange={(event) => updateDraft('clientSecret', event.target.value)}
                  disabled={draft.authMode === 'obo'}
                  placeholder={draft.authMode === 'obo' ? 'OBO方式では不要' : '新規登録または差し替え時のみ入力'}
                />
              </Field>
            </div>
          </section>

          <section className="detail-section">
            <h3>確認項目</h3>
            <div className="status-strip">
              <ShieldCheck size={18} />
              <span>GraphQL API Execute 権限と基礎データソース権限を確認します。</span>
            </div>
            <div className="status-strip">
              <KeyRound size={18} />
              <span>秘密情報はサーバー側で暗号化し、画面には登録状態だけを返します。</span>
            </div>
            <div className="status-strip">
              <CheckCircle2 size={18} />
              <span>疎通確認では introspection または軽量クエリを実行します。</span>
            </div>
          </section>
        </Card>
      </div>

      <footer className="action-bar">
        <span>{connections.length} 件の接続設定</span>
        <strong>{activeConnection ? `${activeConnection.displayName} / ${statusLabel[activeConnection.status]}` : '未設定'}</strong>
        <div className="actions">
          <Button variant="secondary" onClick={testConnection} disabled={testing || saving}>
            <Cable size={16} /> {testing ? '確認中' : '接続確認'}
          </Button>
          <Button onClick={saveConnection} disabled={testing || saving}>
            <Save size={16} /> {saving ? '保存中' : '保存して有効化'}
          </Button>
        </div>
      </footer>
    </div>
  );
};
