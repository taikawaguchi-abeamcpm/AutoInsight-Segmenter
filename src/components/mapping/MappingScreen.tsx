import { CheckCircle2, Database, Save, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { isAbortError } from '../../services/client';
import { mappingApi } from '../../services/mapping/mappingApi';
import type { SelectedDatasetContext } from '../../types/dataset';
import type { ColumnSemanticMapping, FabricDataset, FabricTable, SemanticMappingDocument, SemanticColumnRole, SemanticEntityRole } from '../../types/mapping';
import { Badge, Button, Card, EmptyState, Field, formatNumber } from '../common/ui';

const entityLabels: Record<SemanticEntityRole, string> = {
  customer_master: '顧客の基本情報',
  transaction_fact: '購買や成約の履歴',
  event_log: '行動イベント',
  dimension: '補助マスタ',
  excluded: '分析対象外'
};

const columnLabels: Record<SemanticColumnRole, string> = {
  customer_id: '顧客 ID',
  event_time: 'イベント日時',
  target: '目的変数',
  feature: '特徴量',
  segment_key: 'セグメントキー',
  label: '表示ラベル',
  excluded: '分析対象外'
};

export const MappingScreen = ({
  datasetContext,
  onBack,
  onCompleted
}: {
  datasetContext: SelectedDatasetContext;
  onBack: () => void;
  onCompleted: (mapping: SemanticMappingDocument, dataset: FabricDataset) => void;
}) => {
  const [fabricDataset, setFabricDataset] = useState<FabricDataset | null>(null);
  const [mapping, setMapping] = useState<SemanticMappingDocument | null>(null);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [selectedColumnId, setSelectedColumnId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showOnlyUnmapped, setShowOnlyUnmapped] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    mappingApi
      .bootstrap(datasetContext, { signal: controller.signal })
      .then(({ dataset, mapping: draft }) => {
        setFabricDataset(dataset);
        setMapping(draft);
        setSelectedTableId(dataset.tables[0]?.id ?? null);
        setSelectedColumnId(dataset.tables[0]?.columns[0]?.id ?? null);
      })
      .catch((error: unknown) => {
        if (!isAbortError(error)) {
          setFabricDataset(null);
          setMapping(null);
        }
      });

    return () => controller.abort();
  }, [datasetContext]);

  const selectedTable = fabricDataset?.tables.find((table) => table.id === selectedTableId) ?? null;
  const selectedColumn =
    selectedTable?.columns.find((column) => column.id === selectedColumnId) ?? null;
  const selectedColumnMapping = mapping?.columnMappings.find((column) => column.columnId === selectedColumnId) ?? null;

  const filteredTables = useMemo(() => {
    if (!fabricDataset) {
      return [];
    }

    const query = searchQuery.trim().toLowerCase();

    return fabricDataset.tables.filter((table) => {
      const matchesQuery =
        query.length === 0 ||
        table.displayName.toLowerCase().includes(query) ||
        table.name.toLowerCase().includes(query) ||
        table.columns.some((column) => column.name.toLowerCase().includes(query) || column.displayName.toLowerCase().includes(query));
      const tableMapped = mapping?.tableMappings.some((tableMapping) => tableMapping.tableId === table.id && tableMapping.status !== 'unmapped') ?? false;

      return matchesQuery && (!showOnlyUnmapped || !tableMapped);
    });
  }, [fabricDataset, mapping, searchQuery, showOnlyUnmapped]);

  const updateColumnRole = (role: SemanticColumnRole) => {
    if (!mapping || !selectedColumn) {
      return;
    }

    const nextColumnMapping: ColumnSemanticMapping = {
      columnId: selectedColumn.id,
      tableId: selectedColumn.tableId,
      columnRole: role,
      businessName: columnLabels[role],
      source: 'manual',
      status: 'mapped',
      featureConfig:
        role === 'feature'
          ? {
              featureKey: selectedColumn.name,
              label: selectedColumn.displayName,
              dataType: selectedColumn.dataType,
              aggregation: selectedColumn.dataType === 'float' || selectedColumn.dataType === 'integer' ? 'sum' : 'latest',
              missingValuePolicy: selectedColumn.dataType === 'string' ? 'unknown_category' : 'zero_fill',
              enabled: true
            }
          : undefined,
      targetConfig: role === 'target' ? { targetKey: selectedColumn.name, label: selectedColumn.displayName } : undefined
    };

    setMapping({
      ...mapping,
      columnMappings: [
        ...mapping.columnMappings.filter((columnMapping) => columnMapping.columnId !== selectedColumn.id),
        nextColumnMapping
      ]
    });
  };

  const selectTable = (table: FabricTable) => {
    setSelectedTableId(table.id);
    setSelectedColumnId(table.columns[0]?.id ?? null);
  };

  const validateAndContinue = async () => {
    if (!mapping) {
      return;
    }

    const validated = await mappingApi.validate(mapping);
    setMapping(validated);

    if (!validated.validationIssues.some((issue) => issue.blocking) && fabricDataset) {
      onCompleted(validated, fabricDataset);
    }
  };

  const saveDraft = async () => {
    if (!mapping) {
      return;
    }

    setSaving(true);
    setMapping(await mappingApi.saveDraft(mapping));
    setSaving(false);
  };

  const mappedFeatureCount = mapping?.columnMappings.filter((column) => column.columnRole === 'feature').length ?? 0;
  const hasTarget = mapping?.columnMappings.some((column) => column.columnRole === 'target') ?? false;

  return (
    <div className="screen">
      <header className="screen-header">
        <div>
          <h1>セマンティック・マッピング</h1>
          <p>{datasetContext.datasetName} のテーブルとカラムに業務上の意味を付けます。</p>
        </div>
        <div className="actions">
          <Button variant="secondary" onClick={onBack}>戻る</Button>
          <Button variant="secondary" onClick={saveDraft} disabled={!mapping || saving}>
            <Save size={16} /> 下書き保存
          </Button>
          <Button onClick={validateAndContinue} disabled={!mapping}>
            分析へ進む
          </Button>
        </div>
      </header>

      {!fabricDataset || !mapping ? (
        <EmptyState title="スキーマを読み込み中" description="Fabric からテーブルとカラムのメタデータを取得しています。" />
      ) : (
        <div className="mapping-grid">
          <Card>
            <div className="panel-heading">
              <h2>データソース</h2>
              <Badge tone="info">{fabricDataset.tables.length} テーブル</Badge>
            </div>
            <Field label="検索">
              <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="テーブルまたはカラム名" />
            </Field>
            <label className="check-row">
              <input type="checkbox" checked={showOnlyUnmapped} onChange={(event) => setShowOnlyUnmapped(event.target.checked)} />
              未設定だけ表示
            </label>
            <div className="schema-list">
              {filteredTables.map((table: FabricTable) => {
                const tableMapping = mapping.tableMappings.find((item) => item.tableId === table.id);
                return (
                  <div key={table.id} className="schema-table">
                    <button
                      type="button"
                      className={table.id === selectedTableId ? 'selected' : ''}
                      aria-pressed={table.id === selectedTableId}
                      onClick={() => selectTable(table)}
                    >
                      <Database size={16} />
                      <span>{table.displayName}</span>
                      <Badge tone={tableMapping ? 'success' : 'neutral'}>{tableMapping ? entityLabels[tableMapping.entityRole] : '未設定'}</Badge>
                    </button>
                    {table.id === selectedTableId
                      ? table.columns.map((column) => {
                          const columnMapping = mapping.columnMappings.find((item) => item.columnId === column.id);
                          return (
                            <button
                              key={column.id}
                              type="button"
                              className={`column-row ${column.id === selectedColumnId ? 'selected' : ''}`}
                              aria-pressed={column.id === selectedColumnId}
                              onClick={() => setSelectedColumnId(column.id)}
                            >
                              <span className="column-main">
                                <span>{column.displayName}</span>
                                <small>{column.name}</small>
                              </span>
                              <small className="column-type">{column.dataType}</small>
                              {columnMapping ? <Badge tone="info">{columnLabels[columnMapping.columnRole]}</Badge> : null}
                            </button>
                          );
                        })
                      : null}
                  </div>
                );
              })}
            </div>
          </Card>

          <Card>
            <div className="panel-heading">
              <h2>セマンティック・キャンバス</h2>
              <Badge tone={hasTarget ? 'success' : 'warning'}>{hasTarget ? '目的変数あり' : '目的変数未設定'}</Badge>
            </div>
            <div className="role-grid">
              {mapping.tableMappings.map((tableMapping) => {
                const table = fabricDataset.tables.find((item) => item.id === tableMapping.tableId);
                return (
                  <section className="role-card" key={tableMapping.tableId}>
                    <strong>{entityLabels[tableMapping.entityRole]}</strong>
                    <span>{table?.displayName ?? tableMapping.tableId}</span>
                    <small>{formatNumber(table?.rowCount)} 行</small>
                  </section>
                );
              })}
            </div>
            <h3>目的変数</h3>
            <div className="chip-list">
              {mapping.columnMappings.filter((column) => column.columnRole === 'target').map((column) => (
                <span className="chip strong" key={column.columnId}>{column.businessName}</span>
              ))}
            </div>
            <h3>特徴量</h3>
            <div className="chip-list">
              {mapping.columnMappings.filter((column) => column.columnRole === 'feature').map((column) => (
                <span className="chip" key={column.columnId}>
                  {column.businessName}
                  {column.confidence ? <small>{Math.round(column.confidence * 100)}%</small> : null}
                </span>
              ))}
            </div>
            <h3>Join 定義</h3>
            <div className="clean-list">
              {mapping.joinDefinitions.map((join) => (
                <div className="join-row" key={join.id}>
                  <CheckCircle2 size={16} />
                  <span>{join.fromTableId} から {join.toTableId}</span>
                  <Badge tone={join.cardinality === 'many_to_many' ? 'warning' : 'success'}>{join.cardinality}</Badge>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <div className="panel-heading">
              <h2>プロパティ</h2>
              {selectedColumnMapping?.source === 'suggested' ? <Badge tone="info">自動提案</Badge> : null}
            </div>
            {selectedColumn ? (
              <>
                <dl className="definition-list">
                  <dt>物理名</dt>
                  <dd>{selectedColumn.name}</dd>
                  <dt>表示名</dt>
                  <dd>{selectedColumn.displayName}</dd>
                  <dt>データ型</dt>
                  <dd>{selectedColumn.dataType}</dd>
                  <dt>キー</dt>
                  <dd>{selectedColumn.isPrimaryKey ? 'PK' : selectedColumn.isForeignKey ? 'FK' : 'なし'}</dd>
                </dl>
                {selectedColumnMapping?.reason ? <p className="notice"><Sparkles size={16} /> {selectedColumnMapping.reason}</p> : null}
                <Field label="セマンティック役割">
                  <select value={selectedColumnMapping?.columnRole ?? 'excluded'} onChange={(event) => updateColumnRole(event.target.value as SemanticColumnRole)}>
                    {Object.entries(columnLabels).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </Field>
                <div className="sample-list">
                  {(selectedColumn.sampleValues ?? ['マスク済みサンプルは権限確認後に表示']).map((sample) => (
                    <span key={sample}>{sample}</span>
                  ))}
                </div>
              </>
            ) : (
              <EmptyState title="未選択" description="左からカラムを選択してください。" />
            )}
          </Card>
        </div>
      )}

      <footer className="action-bar">
        <span>特徴量 {mappedFeatureCount} 件</span>
        <strong>エラー {mapping?.validationIssues.filter((issue) => issue.severity === 'error').length ?? 0} / 警告 {mapping?.validationIssues.filter((issue) => issue.severity === 'warning').length ?? 0}</strong>
        <Button onClick={validateAndContinue} disabled={!mapping}>分析へ進む</Button>
      </footer>
    </div>
  );
};
