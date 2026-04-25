import { apiRequest, delay, type RequestOptions } from '../client';
import { buildDefaultMapping, mockFabricDataset, nowIso } from '../mockData';
import type { SelectedDatasetContext } from '../../types/dataset';
import type { FabricColumn, FabricDataset, FabricTable, SemanticMappingDocument } from '../../types/mapping';

export interface MappingBootstrap {
  dataset: FabricDataset;
  mapping: SemanticMappingDocument;
}

const NON_BUSINESS_FIELD_NAMES = new Set(['items', 'endCursor', 'hasNextPage', 'groupBy', 'nodes', 'edges', 'pageInfo', 'totalCount']);

const isBusinessColumn = (column: FabricColumn) =>
  column.name.trim().length > 0 &&
  !column.name.startsWith('__') &&
  !NON_BUSINESS_FIELD_NAMES.has(column.name);

const normalizeTable = (table: FabricTable): FabricTable => ({
  ...table,
  columns: table.columns.filter(isBusinessColumn)
});

const normalizeBootstrap = ({ dataset, mapping }: MappingBootstrap): MappingBootstrap => {
  const normalizedDataset = {
    ...dataset,
    tables: dataset.tables.map(normalizeTable).filter((table) => table.columns.length > 0)
  };
  const tableIds = new Set(normalizedDataset.tables.map((table) => table.id));
  const columnIds = new Set(normalizedDataset.tables.flatMap((table) => table.columns.map((column) => column.id)));

  return {
    dataset: normalizedDataset,
    mapping: {
      ...mapping,
      tableMappings: mapping.tableMappings.filter((table) => tableIds.has(table.tableId)),
      columnMappings: mapping.columnMappings.filter((column) => columnIds.has(column.columnId)),
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

  async validate(mapping: SemanticMappingDocument, options: RequestOptions = {}): Promise<SemanticMappingDocument> {
    await delay(160, options.signal);
    const targetCount = mapping.columnMappings.filter((column) => column.columnRole === 'target').length;
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

    if (customerMasterCount !== 1) {
      issues.push({
        id: 'customer-master-count',
        scope: 'mapping',
        severity: 'error',
        code: 'MISSING_CUSTOMER_MASTER',
        message: '顧客の主軸テーブルを 1 件選択してください。',
        blocking: true
      });
    }

    return {
      ...mapping,
      status: issues.some((issue) => issue.blocking) ? 'draft' : 'ready',
      validationIssues: issues,
      updatedAt: nowIso()
    };
  }
};
