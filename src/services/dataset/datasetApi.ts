import { createApiError, delay, type RequestOptions } from '../client';
import { mockDatasets, mockPreviews, nowIso } from '../mockData';
import type { AsyncResult } from '../../types/common';
import type { DatasetListItem, DatasetPreview, SelectedDatasetContext } from '../../types/dataset';

export const datasetApi = {
  async listDatasets(options: RequestOptions = {}): Promise<AsyncResult<DatasetListItem[]>> {
    await delay(undefined, options.signal);

    return {
      data: mockDatasets,
      pageInfo: {
        hasNextPage: false,
        totalCount: mockDatasets.length
      }
    };
  },

  async getDatasetPreview(datasetId: string, options: RequestOptions = {}): Promise<DatasetPreview> {
    await delay(undefined, options.signal);
    const preview = mockPreviews[datasetId];

    if (!preview) {
      throw createApiError({
        code: 'DATASET_PREVIEW_UNAVAILABLE',
        message: 'Dataset preview is unavailable. Check permissions or connection status.',
        retryable: true,
        targetPath: `dataset/${datasetId}/preview`
      });
    }

    return preview;
  },

  async selectDataset(dataset: DatasetListItem, options: RequestOptions = {}): Promise<SelectedDatasetContext> {
    await delay(120, options.signal);

    return {
      datasetId: dataset.id,
      datasetName: dataset.displayName,
      workspaceId: dataset.workspaceId,
      workspaceName: dataset.workspaceName,
      connectionStatus: dataset.connectionStatus,
      lastSyncedAt: dataset.lastSyncedAt ?? nowIso(),
      tableCount: dataset.tableCount
    };
  }
};
