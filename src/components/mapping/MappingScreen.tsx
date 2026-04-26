import { Database, Plus, Save, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { isAbortError } from '../../services/client';
import { mappingApi } from '../../services/mapping/mappingApi';
import type { SelectedDatasetContext } from '../../types/dataset';
import type {
  ColumnSemanticMapping,
  FabricColumn,
  FabricDataset,
  FabricTable,
  JoinDefinition,
  SemanticColumnRole,
  SemanticEntityRole,
  SemanticMappingDocument,
  TableSemanticMapping
} from '../../types/mapping';
import { Badge, Button, Card, EmptyState, Field, formatNumber } from '../common/ui';

type MappingTab = 'tables' | 'columns' | 'joins' | 'roles';

const entityLabels: Record<SemanticEntityRole, string> = {
  customer_master: '顧客・企業マスタ',
  transaction_fact: '取引・実績',
  event_log: '活動・イベント',
  dimension: '補助マスタ',
  excluded: '分析対象外'
};

const columnLabels: Record<SemanticColumnRole, string> = {
  customer_id: '顧客ID',
  event_time: '日時',
  target: '目的変数',
  feature: '特徴量',
  excluded: '分析対象外'
};

const roleTone: Record<SemanticColumnRole, 'success' | 'warning' | 'info' | 'neutral' | 'danger'> = {
  customer_id: 'success',
  event_time: 'neutral',
  target: 'warning',
  feature: 'info',
  excluded: 'neutral'
};

const entityRoleOptions = Object.entries(entityLabels) as Array<[SemanticEntityRole, string]>;
const columnRoleOptions = Object.entries(columnLabels) as Array<[SemanticColumnRole, string]>;

const fallbackColumnRole = (column: FabricColumn): SemanticColumnRole => {
  const name = column.name.toLowerCase();
  if (/^id$|(^|_)(customer|account|user|member).*id$/.test(name)) return 'customer_id';
  if (/(created|updated|ordered|event|date|time|timestamp|at)$/.test(name)) return 'event_time';
  if (/(converted|conversion|purchased|churn|target|is_.*|flag)$/.test(name)) return 'target';
  return 'feature';
};

const defaultTableMapping = (table: FabricTable): TableSemanticMapping => ({
  tableId: table.id,
  entityRole: 'dimension',
  businessName: table.displayName,
  description: '',
  primaryKeyColumnId: table.columns.find((column) => column.isPrimaryKey)?.id,
  customerJoinColumnId: table.columns.find((column) => column.isForeignKey || /customer|account|user|member/i.test(column.name))?.id,
  source: 'manual',
  status: 'mapped'
});

const defaultColumnMapping = (table: FabricTable, column: FabricColumn, role = fallbackColumnRole(column)): ColumnSemanticMapping => ({
  columnId: column.id,
  tableId: table.id,
  columnRole: role,
  businessName: column.displayName,
  description: '',
  source: 'manual',
  status: 'mapped',
  featureConfig:
    role === 'feature'
      ? {
          featureKey: column.name,
          label: column.displayName,
          dataType: column.dataType,
          aggregation: column.dataType === 'float' || column.dataType === 'integer' ? 'sum' : 'latest',
          missingValuePolicy: column.dataType === 'string' ? 'unknown_category' : 'zero_fill',
          enabled: true
        }
      : undefined,
  targetConfig: role === 'target' ? { targetKey: column.name, label: column.displayName } : undefined
});

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
  const [activeTab, setActiveTab] = useState<MappingTab>('tables');
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

  const tableById = useMemo(
    () => new Map(fabricDataset?.tables.map((table) => [table.id, table]) ?? []),
    [fabricDataset]
  );
  const allColumns = useMemo(
    () => fabricDataset?.tables.flatMap((table) => table.columns.map((column) => ({ table, column }))) ?? [],
    [fabricDataset]
  );
  const columnById = useMemo(
    () => new Map(allColumns.map(({ table, column }) => [column.id, { table, column }])),
    [allColumns]
  );

  const selectedTable = selectedTableId ? tableById.get(selectedTableId) ?? null : null;
  const selectedColumn = selectedColumnId ? columnById.get(selectedColumnId)?.column ?? null : null;
  const selectedColumnTable = selectedColumnId ? columnById.get(selectedColumnId)?.table ?? null : null;
  const selectedTableMapping =
    mapping && selectedTable ? mapping.tableMappings.find((table) => table.tableId === selectedTable.id) ?? defaultTableMapping(selectedTable) : null;
  const selectedColumnMapping =
    mapping && selectedColumn && selectedColumnTable
      ? mapping.columnMappings.find((column) => column.columnId === selectedColumn.id) ?? defaultColumnMapping(selectedColumnTable, selectedColumn)
      : null;

  const filteredTables = useMemo(() => {
    if (!fabricDataset) {
      return [];
    }

    const query = searchQuery.trim().toLowerCase();

    return fabricDataset.tables.filter((table) => {
      const tableMapping = mapping?.tableMappings.find((item) => item.tableId === table.id);
      const tableMapped = tableMapping?.status !== 'unmapped';
      const matchesQuery =
        query.length === 0 ||
        [table.displayName, table.name, tableMapping?.businessName, tableMapping?.description]
          .filter(Boolean)
          .some((value) => value?.toLowerCase().includes(query)) ||
        table.columns.some((column) => column.name.toLowerCase().includes(query) || column.displayName.toLowerCase().includes(query));

      return matchesQuery && (!showOnlyUnmapped || !tableMapped);
    });
  }, [fabricDataset, mapping, searchQuery, showOnlyUnmapped]);

  const upsertTableMapping = (table: FabricTable, patch: Partial<TableSemanticMapping>) => {
    if (!mapping) return;
    const current = mapping.tableMappings.find((item) => item.tableId === table.id) ?? defaultTableMapping(table);
    const next = { ...current, ...patch, source: 'manual' as const, status: 'mapped' as const };

    setMapping({
      ...mapping,
      tableMappings: [...mapping.tableMappings.filter((item) => item.tableId !== table.id), next],
      updatedAt: new Date().toISOString()
    });
  };

  const upsertColumnMapping = (table: FabricTable, column: FabricColumn, patch: Partial<ColumnSemanticMapping>) => {
    if (!mapping) return;
    const current = mapping.columnMappings.find((item) => item.columnId === column.id) ?? defaultColumnMapping(table, column);
    const role = patch.columnRole ?? current.columnRole;
    const businessName = patch.businessName ?? current.businessName ?? column.displayName;
    const next: ColumnSemanticMapping = {
      ...current,
      ...patch,
      tableId: table.id,
      columnId: column.id,
      columnRole: role,
      businessName,
      source: 'manual',
      status: 'mapped',
      featureConfig:
        role === 'feature'
          ? {
              featureKey: current.featureConfig?.featureKey ?? column.name,
              label: businessName,
              dataType: column.dataType,
              aggregation: current.featureConfig?.aggregation ?? (column.dataType === 'float' || column.dataType === 'integer' ? 'sum' : 'latest'),
              missingValuePolicy: current.featureConfig?.missingValuePolicy ?? (column.dataType === 'string' ? 'unknown_category' : 'zero_fill'),
              enabled: true
            }
          : undefined,
      targetConfig:
        role === 'target'
          ? {
              targetKey: current.targetConfig?.targetKey ?? column.name,
              label: businessName,
              positiveValue: current.targetConfig?.positiveValue,
              negativeValue: current.targetConfig?.negativeValue,
              eventTimeColumnId: current.targetConfig?.eventTimeColumnId,
              evaluationWindow: current.targetConfig?.evaluationWindow
            }
          : undefined
    };

    const withoutCurrent = mapping.columnMappings.filter((item) => item.columnId !== column.id);
    const withoutOtherTargets = role === 'target' ? withoutCurrent.map((item) => (item.columnRole === 'target' ? { ...item, columnRole: 'feature' as const, targetConfig: undefined } : item)) : withoutCurrent;

    setMapping({
      ...mapping,
      columnMappings: [...withoutOtherTargets, next],
      updatedAt: new Date().toISOString()
    });
  };

  const selectTable = (table: FabricTable) => {
    setSelectedTableId(table.id);
    setSelectedColumnId(table.columns[0]?.id ?? null);
    setActiveTab('tables');
  };

  const selectColumn = (table: FabricTable, column: FabricColumn) => {
    setSelectedTableId(table.id);
    setSelectedColumnId(column.id);
    setActiveTab('columns');
  };

  const applySelectedTableFeatures = () => {
    if (!mapping || !selectedTable) return;
    const nextColumnMappings = new Map(mapping.columnMappings.map((column) => [column.columnId, column]));

    selectedTable.columns.forEach((column) => {
      const current = nextColumnMappings.get(column.id) ?? defaultColumnMapping(selectedTable, column);
      if (current.columnRole !== 'target' && current.columnRole !== 'customer_id' && current.columnRole !== 'event_time') {
        nextColumnMappings.set(column.id, defaultColumnMapping(selectedTable, column, 'feature'));
      }
    });

    setMapping({ ...mapping, columnMappings: [...nextColumnMappings.values()], updatedAt: new Date().toISOString() });
  };

  const clearSelectedTableFeatures = () => {
    if (!mapping || !selectedTable) return;
    const selectedColumnIds = new Set(selectedTable.columns.map((column) => column.id));
    setMapping({
      ...mapping,
      columnMappings: mapping.columnMappings.map((column) =>
        selectedColumnIds.has(column.columnId) && column.columnRole === 'feature'
          ? { ...column, columnRole: 'excluded', featureConfig: undefined }
          : column
      ),
      updatedAt: new Date().toISOString()
    });
  };

  const addJoin = () => {
    if (!mapping || !fabricDataset || fabricDataset.tables.length < 2) return;
    const fromTable = selectedTable ?? fabricDataset.tables[0];
    const toTable = fabricDataset.tables.find((table) => table.id !== fromTable.id) ?? fabricDataset.tables[1];
    const fromColumn = fromTable.columns.find((column) => /customer|account|id/i.test(column.name)) ?? fromTable.columns[0];
    const toColumn = toTable.columns.find((column) => /customer|account|id/i.test(column.name)) ?? toTable.columns[0];
    if (!fromColumn || !toColumn) return;

    const join: JoinDefinition = {
      id: `join-${Date.now()}`,
      fromTableId: fromTable.id,
      fromColumnIds: [fromColumn.id],
      toTableId: toTable.id,
      toColumnIds: [toColumn.id],
      joinType: 'left',
      cardinality: 'many_to_one',
      source: 'manual'
    };

    setMapping({ ...mapping, joinDefinitions: [...mapping.joinDefinitions, join], updatedAt: new Date().toISOString() });
  };

  const updateJoin = (joinId: string, patch: Partial<JoinDefinition>) => {
    if (!mapping) return;
    setMapping({
      ...mapping,
      joinDefinitions: mapping.joinDefinitions.map((join) => (join.id === joinId ? { ...join, ...patch, source: 'manual' } : join)),
      updatedAt: new Date().toISOString()
    });
  };

  const removeJoin = (joinId: string) => {
    if (!mapping) return;
    setMapping({
      ...mapping,
      joinDefinitions: mapping.joinDefinitions.filter((join) => join.id !== joinId),
      updatedAt: new Date().toISOString()
    });
  };

  const validateAndContinue = async () => {
    if (!mapping || !fabricDataset) return;
    const validated = await mappingApi.validate(mapping);
    setMapping(validated);

    if (!validated.validationIssues.some((issue) => issue.blocking)) {
      onCompleted(validated, fabricDataset);
    }
  };

  const saveDraft = async () => {
    if (!mapping) return;
    setSaving(true);
    setMapping(await mappingApi.saveDraft(mapping));
    setSaving(false);
  };

  const targetMapping = mapping?.columnMappings.find((column) => column.columnRole === 'target') ?? null;
  const featureMappings = mapping?.columnMappings.filter((column) => column.columnRole === 'feature') ?? [];
  const warningCount = mapping?.validationIssues.filter((issue) => issue.severity === 'warning').length ?? 0;
  const errorCount = mapping?.validationIssues.filter((issue) => issue.severity === 'error').length ?? 0;

  if (!fabricDataset || !mapping) {
    return (
      <div className="screen">
        <Card>Fabric からテーブルとカラムのメタデータを読み込んでいます。</Card>
      </div>
    );
  }

  return (
    <div className="screen">
      <header className="screen-header">
        <div>
          <h1>データセットの意味付け</h1>
          <p>テーブル・列名の意味付け、結合条件の指定、目的変数・特徴量を選択します。</p>
        </div>
        <div className="actions">
          <Button variant="secondary" onClick={onBack}>戻る</Button>
          <Button variant="secondary" onClick={saveDraft} disabled={saving}>
            <Save size={16} /> 下書き保存
          </Button>
          <Button onClick={validateAndContinue}>分析へ進む</Button>
        </div>
      </header>

      <div className="mapping-workspace">
        <Card className="mapping-source-panel">
          <div className="panel-heading">
            <h2>データソース</h2>
            <Badge tone="info">{fabricDataset.tables.length} テーブル</Badge>
          </div>
          <Field label="検索">
            <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="テーブル名、論理名" />
          </Field>
          <label className="check-row">
            <input type="checkbox" checked={showOnlyUnmapped} onChange={(event) => setShowOnlyUnmapped(event.target.checked)} />
            未設定の列のみ表示
          </label>

          <div className="source-tree">
            {filteredTables.map((table) => {
              const tableMapping = mapping.tableMappings.find((item) => item.tableId === table.id);
              const expanded = table.id === selectedTableId;
              return (
                <section className="source-table" key={table.id}>
                  <button type="button" className={expanded ? 'selected' : ''} onClick={() => selectTable(table)}>
                    <Database size={16} />
                    <span>
                      <strong>{tableMapping?.businessName ?? table.displayName}</strong>
                      <small>{table.name}</small>
                    </span>
                    <Badge tone="success">{entityLabels[tableMapping?.entityRole ?? 'dimension']}</Badge>
                  </button>
                  {expanded ? (
                    <div className="source-columns">
                      {table.columns.map((column) => {
                        const columnMapping = mapping.columnMappings.find((item) => item.columnId === column.id);
                        const role = columnMapping?.columnRole ?? 'excluded';
                        return (
                          <button
                            type="button"
                            className={column.id === selectedColumnId ? 'selected' : ''}
                            key={column.id}
                            onClick={() => selectColumn(table, column)}
                          >
                            <span>
                              <strong>{columnMapping?.businessName ?? column.displayName}</strong>
                              <small>{column.name} / {column.dataType}</small>
                            </span>
                            <Badge tone={roleTone[role]}>{columnLabels[role]}</Badge>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </section>
              );
            })}
          </div>
        </Card>

        <div className="mapping-editor">
          <div className="mapping-tabs" role="tablist" aria-label="マッピング編集">
            {([
              ['tables', 'テーブル意味付け'],
              ['columns', 'カラム意味付け'],
              ['joins', '結合条件'],
              ['roles', '目的変数・特徴量']
            ] as Array<[MappingTab, string]>).map(([tab, label]) => (
              <button key={tab} type="button" className={activeTab === tab ? 'selected' : ''} onClick={() => setActiveTab(tab)}>
                {label}
              </button>
            ))}
          </div>

          {activeTab === 'tables' ? (
            <Card className="editor-panel">
              <div className="panel-heading">
                <h2>テーブルの意味付け</h2>
                {selectedTableMapping ? <Badge tone="success">{entityLabels[selectedTableMapping.entityRole]}</Badge> : null}
              </div>
              {selectedTable && selectedTableMapping ? (
                <div className="editor-form">
                  <div className="definition-list">
                    <dt>物理名</dt>
                    <dd>{selectedTable.name}</dd>
                    <dt>行数</dt>
                    <dd>{formatNumber(selectedTable.rowCount)}</dd>
                  </div>
                  <Field label="名前">
                    <input value={selectedTableMapping.businessName} onChange={(event) => upsertTableMapping(selectedTable, { businessName: event.target.value })} />
                  </Field>
                  <Field label="補足">
                    <textarea
                      value={selectedTableMapping.description ?? ''}
                      onChange={(event) => upsertTableMapping(selectedTable, { description: event.target.value })}
                      rows={4}
                      placeholder="例: 企業マスタ。営業活動と顧客IDで結合する。"
                    />
                  </Field>
                  <Field label="テーブル種別">
                    <select value={selectedTableMapping.entityRole} onChange={(event) => upsertTableMapping(selectedTable, { entityRole: event.target.value as SemanticEntityRole })}>
                      {entityRoleOptions.map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </Field>
                </div>
              ) : (
                <EmptyState title="テーブル未選択" description="左の一覧からテーブルを選択してください。" />
              )}
            </Card>
          ) : null}

          {activeTab === 'columns' ? (
            <Card className="editor-panel">
              <div className="panel-heading">
                <h2>カラムの意味付け</h2>
                {selectedColumnMapping ? <Badge tone={roleTone[selectedColumnMapping.columnRole]}>{columnLabels[selectedColumnMapping.columnRole]}</Badge> : null}
              </div>
              {selectedColumn && selectedColumnTable && selectedColumnMapping ? (
                <div className="editor-form">
                  <div className="definition-list">
                    <dt>テーブル</dt>
                    <dd>{selectedTableMapping?.businessName ?? selectedColumnTable.displayName}</dd>
                    <dt>物理名</dt>
                    <dd>{selectedColumn.name}</dd>
                    <dt>型</dt>
                    <dd>{selectedColumn.dataType}</dd>
                    <dt>キー</dt>
                    <dd>{selectedColumn.isPrimaryKey ? 'PK' : selectedColumn.isForeignKey ? 'FK' : 'なし'}</dd>
                  </div>
                  <Field label="名前">
                    <input value={selectedColumnMapping.businessName} onChange={(event) => upsertColumnMapping(selectedColumnTable, selectedColumn, { businessName: event.target.value })} />
                  </Field>
                  <Field label="補足">
                    <textarea
                      value={selectedColumnMapping.description ?? ''}
                      onChange={(event) => upsertColumnMapping(selectedColumnTable, selectedColumn, { description: event.target.value })}
                      rows={4}
                      placeholder="例: 活動種別。訪問、電話、メールなどを表す。"
                    />
                  </Field>
                  <Field label="役割">
                    <select value={selectedColumnMapping.columnRole} onChange={(event) => upsertColumnMapping(selectedColumnTable, selectedColumn, { columnRole: event.target.value as SemanticColumnRole })}>
                      {columnRoleOptions.map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </Field>
                </div>
              ) : (
                <EmptyState title="列が未選択" description="左の一覧から列を選択してください。" />
              )}
            </Card>
          ) : null}

          {activeTab === 'joins' ? (
            <Card className="editor-panel">
              <div className="panel-heading">
                <h2>テーブル間の結合条件</h2>
                <Button variant="secondary" onClick={addJoin}><Plus size={16} /> 結合を追加</Button>
              </div>
              <div className="join-editor-list">
                {mapping.joinDefinitions.length === 0 ? <EmptyState title="結合条件なし" description="企業マスタと活動テーブルなどの紐付けを追加してください。" /> : null}
                {mapping.joinDefinitions.map((join) => {
                  const fromTable = tableById.get(join.fromTableId);
                  const toTable = tableById.get(join.toTableId);
                  return (
                    <section className="join-editor-row" key={join.id}>
                      <Field label="結合元テーブル">
                        <select value={join.fromTableId} onChange={(event) => {
                          const table = tableById.get(event.target.value);
                          updateJoin(join.id, { fromTableId: event.target.value, fromColumnIds: table?.columns[0] ? [table.columns[0].id] : [] });
                        }}>
                          {fabricDataset.tables.map((table) => <option key={table.id} value={table.id}>{table.displayName}</option>)}
                        </select>
                      </Field>
                      <Field label="結合元の列">
                        <select value={join.fromColumnIds[0] ?? ''} onChange={(event) => updateJoin(join.id, { fromColumnIds: [event.target.value] })}>
                          {(fromTable?.columns ?? []).map((column) => <option key={column.id} value={column.id}>{column.displayName}</option>)}
                        </select>
                      </Field>
                      <Field label="結合先テーブル">
                        <select value={join.toTableId} onChange={(event) => {
                          const table = tableById.get(event.target.value);
                          updateJoin(join.id, { toTableId: event.target.value, toColumnIds: table?.columns[0] ? [table.columns[0].id] : [] });
                        }}>
                          {fabricDataset.tables.map((table) => <option key={table.id} value={table.id}>{table.displayName}</option>)}
                        </select>
                      </Field>
                      <Field label="結合先の列">
                        <select value={join.toColumnIds[0] ?? ''} onChange={(event) => updateJoin(join.id, { toColumnIds: [event.target.value] })}>
                          {(toTable?.columns ?? []).map((column) => <option key={column.id} value={column.id}>{column.displayName}</option>)}
                        </select>
                      </Field>
                      <Field label="結合種別">
                        <select value={join.joinType} onChange={(event) => updateJoin(join.id, { joinType: event.target.value as JoinDefinition['joinType'] })}>
                          <option value="left">left</option>
                          <option value="inner">inner</option>
                        </select>
                      </Field>
                      <Field label="多重度">
                        <select value={join.cardinality} onChange={(event) => updateJoin(join.id, { cardinality: event.target.value as JoinDefinition['cardinality'] })}>
                          <option value="many_to_one">many_to_one</option>
                          <option value="one_to_many">one_to_many</option>
                          <option value="one_to_one">one_to_one</option>
                          <option value="many_to_many">many_to_many</option>
                        </select>
                      </Field>
                      <button type="button" className="icon-button" onClick={() => removeJoin(join.id)} aria-label="結合条件を削除">
                        <Trash2 size={16} />
                      </button>
                    </section>
                  );
                })}
              </div>
            </Card>
          ) : null}

          {activeTab === 'roles' ? (
            <Card className="editor-panel">
              <div className="panel-heading">
                <h2>目的変数と特徴量</h2>
                <Badge tone={targetMapping ? 'success' : 'warning'}>{targetMapping ? '目的変数設定済み' : '目的変数未設定'}</Badge>
              </div>
              <div className="role-assignment-grid">
                <section>
                  <h3>目的変数</h3>
                  <Field label="目的変数の列">
                    <select
                      value={targetMapping?.columnId ?? ''}
                      onChange={(event) => {
                        const item = columnById.get(event.target.value);
                        if (item) upsertColumnMapping(item.table, item.column, { columnRole: 'target' });
                      }}
                    >
                      <option value="">未設定</option>
                      {allColumns.map(({ table, column }) => (
                        <option key={column.id} value={column.id}>{table.displayName} / {column.displayName}</option>
                      ))}
                    </select>
                  </Field>
                </section>
                <section>
                  <h3>特徴量の一括指定</h3>
                  <div className="actions">
                    <Button variant="secondary" onClick={applySelectedTableFeatures} disabled={!selectedTable}>選択テーブルを特徴量にする</Button>
                    <Button variant="secondary" onClick={clearSelectedTableFeatures} disabled={!selectedTable}>選択テーブルの特徴量を解除</Button>
                  </div>
                  <p className="subtle-text">顧客ID、日時、目的変数に設定済みの列は一括指定の対象外です。</p>
                </section>
              </div>
              <div className="feature-check-list">
                {allColumns.map(({ table, column }) => {
                  const columnMapping = mapping.columnMappings.find((item) => item.columnId === column.id) ?? defaultColumnMapping(table, column, 'excluded');
                  const checked = columnMapping.columnRole === 'feature';
                  return (
                    <label className="feature-check-row" key={column.id}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={columnMapping.columnRole === 'target'}
                        onChange={(event) => upsertColumnMapping(table, column, { columnRole: event.target.checked ? 'feature' : 'excluded' })}
                      />
                      <span>
                        <strong>{columnMapping.businessName}</strong>
                        <small>{table.displayName} / {column.name}</small>
                      </span>
                      <Badge tone={roleTone[columnMapping.columnRole]}>{columnLabels[columnMapping.columnRole]}</Badge>
                    </label>
                  );
                })}
              </div>
            </Card>
          ) : null}
        </div>
      </div>

      <footer className="action-bar mapping-action-bar">
        <span>特徴量 {featureMappings.length} 件</span>
        <strong>エラー {errorCount} / 警告 {warningCount}</strong>
        <Button onClick={validateAndContinue}>分析へ進む</Button>
      </footer>
    </div>
  );
};
