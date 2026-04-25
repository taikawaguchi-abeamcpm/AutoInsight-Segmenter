import { apiRequest, delay, type RequestOptions } from '../client';
import { buildDefaultMapping, mockFabricDataset, nowIso } from '../mockData';
import type { SelectedDatasetContext } from '../../types/dataset';
import type { FabricDataset, SemanticMappingDocument } from '../../types/mapping';

export interface MappingBootstrap {
  dataset: FabricDataset;
  mapping: SemanticMappingDocument;
}

export const mappingApi = {
  async bootstrap(context: SelectedDatasetContext, options: RequestOptions = {}): Promise<MappingBootstrap> {
    await delay(undefined, options.signal);

    return {
      dataset: {
        ...mockFabricDataset,
        id: context.datasetId,
        workspaceId: context.workspaceId,
        displayName: context.datasetName,
        lastSyncedAt: context.lastSyncedAt ?? nowIso()
      },
      mapping: buildDefaultMapping(context.datasetId)
    };
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
