import { apiRequest, delay, type RequestOptions } from '../client';
import { buildDefaultMapping, mockFabricDataset, nowIso } from '../mockData';
import type { SelectedDatasetContext } from '../../types/dataset';
import type { FabricColumn, FabricDataset, FabricTable, SemanticMappingDocument } from '../../types/mapping';

export interface MappingBootstrap {
  dataset: FabricDataset;
  mapping: SemanticMappingDocument;
}

export interface CategoryValueList {
  tableId: string;
  columnId: string;
  values: Array<{ value: string; count: number }>;
  truncated: boolean;
}

const NON_BUSINESS_FIELD_NAMES = new Set(['items', 'endCursor', 'hasNextPage', 'groupBy', 'nodes', 'edges', 'pageInfo', 'totalCount']);
const VALID_COLUMN_ROLES = new Set(['customer_id', 'event_time', 'target', 'feature', 'excluded']);

const isBusinessColumn = (column: FabricColumn) =>
  column.name.trim().length > 0 &&
  !column.name.startsWith('__') &&
  !NON_BUSINESS_FIELD_NAMES.has(column.name);

const normalizeTable = (table: FabricTable): FabricTable => ({
  ...table,
  columns: table.columns.filter(isBusinessColumn)
});

const fallbackFeatureValueType = (column?: FabricColumn) =>
  column?.dataType === 'integer' || column?.dataType === 'float' ? 'numeric' as const : 'categorical' as const;

const normalizeBootstrap = ({ dataset, mapping }: MappingBootstrap): MappingBootstrap => {
  const normalizedDataset = {
    ...dataset,
    tables: dataset.tables.map(normalizeTable).filter((table) => table.columns.length > 0)
  };
  const tableIds = new Set(normalizedDataset.tables.map((table) => table.id));
  const columnIds = new Set(normalizedDataset.tables.flatMap((table) => table.columns.map((column) => column.id)));
  const columnById = new Map(normalizedDataset.tables.flatMap((table) => table.columns.map((column) => [column.id, column] as const)));

  return {
    dataset: normalizedDataset,
    mapping: {
      ...mapping,
      tableMappings: mapping.tableMappings.filter((table) => tableIds.has(table.tableId)),
      columnMappings: mapping.columnMappings
        .filter((column) => columnIds.has(column.columnId))
        .map((column) => ({
          ...column,
          columnRole: VALID_COLUMN_ROLES.has(column.columnRole) ? column.columnRole : 'feature',
          featureConfig: column.featureConfig
            ? {
                ...column.featureConfig,
                valueType: column.featureConfig.valueType ?? fallbackFeatureValueType(columnById.get(column.columnId)),
                valueLabels: column.featureConfig.valueLabels
              }
            : undefined
        })),
      joinDefinitions: mapping.joinDefinitions.filter(
        (join) =>
          tableIds.has(join.fromTableId) &&
          tableIds.has(join.toTableId) &&
          join.fromColumnIds.every((columnId) => columnIds.has(columnId)) &&
          join.toColumnIds.every((columnId) => columnIds.has(columnId))
      )
    }
  };
};

const hasFeaturePath = (mapping: SemanticMappingDocument, targetTableId: string, featureTableId: string) => {
  if (targetTableId === featureTableId) {
    return true;
  }

  const edges = mapping.joinDefinitions
    .filter((join) => join.fromColumnIds.length > 0 && join.toColumnIds.length > 0)
    .flatMap((join) => [
      [join.fromTableId, join.toTableId],
      [join.toTableId, join.fromTableId]
    ]);
  const visited = new Set<string>([targetTableId]);
  const queue = [targetTableId];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    for (const [from, to] of edges) {
      if (from !== current || visited.has(to)) {
        continue;
      }

      if (to === featureTableId) {
        return true;
      }

      visited.add(to);
      queue.push(to);
    }
  }

  return false;
};

export const mappingApi = {
  async bootstrap(context: SelectedDatasetContext, options: RequestOptions = {}): Promise<MappingBootstrap> {
    const response = await apiRequest<MappingBootstrap>('/mappings/bootstrap', {
      method: 'POST',
      body: JSON.stringify(context),
      signal: options.signal
    });
    if (response) {
      return normalizeBootstrap(response);
    }

    await delay(undefined, options.signal);

    return normalizeBootstrap({
      dataset: {
        ...mockFabricDataset,
        id: context.datasetId,
        workspaceId: context.workspaceId,
        displayName: context.datasetName,
        lastSyncedAt: context.lastSyncedAt ?? nowIso()
      },
      mapping: buildDefaultMapping(context.datasetId)
    });
  },

  async saveDraft(mapping: SemanticMappingDocument, options: RequestOptions = {}): Promise<SemanticMappingDocument> {
    const response = await apiRequest<SemanticMappingDocument>('/mappings/save', {
      method: 'POST',
      body: JSON.stringify(mapping),
      signal: options.signal
    });
    if (response) {
      return response;
    }

    await delay(140, options.signal);

    return {
      ...mapping,
      version: mapping.version + 1,
      updatedAt: nowIso(),
      updatedBy: 'demo.user'
    };
  },

  async getCategoryValues(dataset: FabricDataset, tableId: string, columnId: string, options: RequestOptions = {}): Promise<CategoryValueList> {
    const response = await apiRequest<CategoryValueList>('/mappings/category-values', {
      method: 'POST',
      body: JSON.stringify({ dataset, tableId, columnId, limit: 200 }),
      signal: options.signal
    });
    if (response) {
      return response;
    }

    await delay(120, options.signal);
    const table = dataset.tables.find((item) => item.id === tableId);
    const column = table?.columns.find((item) => item.id === columnId);
    return {
      tableId,
      columnId,
      values: (column?.sampleValues ?? []).map((value) => ({ value: String(value), count: 0 })),
      truncated: false
    };
  },

  async validate(mapping: SemanticMappingDocument, options: RequestOptions = {}): Promise<SemanticMappingDocument> {
    await delay(160, options.signal);
    const targetMappings = mapping.columnMappings.filter((column) => column.columnRole === 'target');
    const targetCount = targetMappings.length;
    const targetMapping = targetMappings[0];
    const enabledFeatureMappings = mapping.columnMappings.filter((column) => column.columnRole === 'feature' && column.featureConfig?.enabled);
    const customerMasterCount = mapping.tableMappings.filter((table) => table.entityRole === 'customer_master').length;
    const issues = mapping.validationIssues.filter((issue) => issue.severity !== 'error');

    if (targetCount !== 1) {
      issues.push({
        id: 'target-count',
        scope: 'mapping',
        severity: 'error',
        code: targetCount === 0 ? 'MISSING_TARGET' : 'MULTIPLE_TARGETS',
        message: '目的変数は 1 件だけ選択してください。',
        blocking: true
      });
    }

    if (customerMasterCount > 1) {
      issues.push({
        id: 'customer-master-count',
        scope: 'mapping',
        severity: 'error',
        code: 'MULTIPLE_CUSTOMER_MASTERS',
        message: '顧客の主軸テーブルは 1 件だけ選択してください。',
        blocking: true
      });
    }

    if (targetMapping && enabledFeatureMappings.length > 0) {
      const disconnectedFeature = enabledFeatureMappings.find(
        (feature) => !hasFeaturePath(mapping, targetMapping.tableId, feature.tableId)
      );

      if (disconnectedFeature) {
        issues.push({
          id: 'feature-join-path',
          scope: 'mapping',
          severity: 'error',
          code: 'FEATURE_TABLE_NOT_CONNECTED',
          message: '目的変数テーブルと特徴量テーブルを同じテーブルにするか、結合条件で接続してください。',
          blocking: true
        });
      }
    }

    return {
      ...mapping,
      status: issues.some((issue) => issue.blocking) ? 'draft' : 'ready',
      validationIssues: issues,
      updatedAt: nowIso()
    };
  }
};
