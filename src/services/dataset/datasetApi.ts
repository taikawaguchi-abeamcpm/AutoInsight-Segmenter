import type { FabricConnectionConfig } from '../../types/admin';
import { fabricConnectionApi } from '../admin/fabricConnectionApi';
import { apiRequest, createApiError, delay, makeHash, type RequestOptions } from '../client';
import { mockDatasets, mockPreviews, nowIso } from '../mockData';
import type { AsyncResult } from '../../types/common';
import type { DatasetListItem, DatasetPreview, SelectedDatasetContext } from '../../types/dataset';

const SAMPLE_CONNECTION_ID = 'fabric-conn-marketing';

const getConnectionDatasetId = (connection: FabricConnectionConfig) =>
  `ds-${makeHash({ endpointUrl: connection.endpointUrl, workspaceId: connection.workspaceId, tenantId: connection.tenantId })}`;

const getGraphqlApiName = (endpointUrl: string) => {
  try {
    const url = new URL(endpointUrl);
    const segments = url.pathname.split('/').filter(Boolean);
    const apiIndex = segments.findIndex((segment) => segment.toLowerCase() === 'graphqlapis');
    return apiIndex >= 0 && segments[apiIndex + 1] ? segments[apiIndex + 1] : 'fabric-graphql';
  } catch {
    return 'fabric-graphql';
  }
};

const getConnectionDataset = (connection: FabricConnectionConfig): DatasetListItem => {
  const apiName = getGraphqlApiName(connection.endpointUrl);
  const workspaceId = connection.workspaceId ?? 'workspace未指定';
  const baseName = connection.displayName.replace(/\s*GraphQL\s*$/i, '').trim() || connection.displayName;

  return {
    id: getConnectionDatasetId(connection),
    name: apiName,
    displayName: `${baseName} データセット`,
    workspaceId,
    workspaceName: workspaceId === 'workspace未指定' ? connection.displayName : `Workspace ${workspaceId}`,
    description: `${connection.endpointUrl} に登録された有効な Fabric GraphQL 接続から取得するデータセット候補です。`,
    tags: ['Fabric', 'GraphQL'],
    tableCount: 3,
    lastSyncedAt: connection.lastSuccessAt ?? connection.updatedAt,
    connectionStatus: 'ready',
    recommended: true,
    recommendationScore: 88,
    recommendationReasons: [
      '有効化済みの接続設定に紐づいています',
      'Fabric GraphQL endpoint と Workspace ID が登録されています',
      '分析前にスキーマ確認へ進めます'
    ],
    recentlyUsed: true,
    warningCodes: []
  };
};

const getConnectionPreview = (connection: FabricConnectionConfig): DatasetPreview => {
  const datasetId = getConnectionDatasetId(connection);
  const apiName = getGraphqlApiName(connection.endpointUrl);

  return {
    datasetId,
    ownerName: connection.displayName,
    rowEstimate: undefined,
    columnCount: 0,
    primaryKeyCandidateCount: 0,
    timestampColumnCount: 0,
    sampleAvailable: false,
    topTables: [
      { tableId: `${datasetId}-query`, tableName: `${apiName}.Query`, suggestedRole: 'unknown' },
      { tableId: `${datasetId}-workspace`, tableName: connection.workspaceId ?? 'workspace', suggestedRole: 'unknown' },
      { tableId: `${datasetId}-schema`, tableName: connection.schemaVersion ?? 'schema', suggestedRole: 'unknown' }
    ],
    warnings: []
  };
};

export const datasetApi = {
  async listDatasets(options: RequestOptions = {}): Promise<AsyncResult<DatasetListItem[]>> {
    const response = await apiRequest<AsyncResult<DatasetListItem[]>>('/datasets', {
      signal: options.signal
    });
    if (response) {
      return response;
    }

    await delay(undefined, options.signal);
    const activeConnection = await fabricConnectionApi.getActive();
    const datasets = !activeConnection
      ? []
      : activeConnection.id === SAMPLE_CONNECTION_ID
        ? mockDatasets
        : [getConnectionDataset(activeConnection)];

    return {
      data: datasets,
      pageInfo: {
        hasNextPage: false,
        totalCount: datasets.length
      }
    };
  },

  async getDatasetPreview(datasetId: string, options: RequestOptions = {}): Promise<DatasetPreview> {
    const response = await apiRequest<DatasetPreview>(`/datasets/${encodeURIComponent(datasetId)}/preview`, {
      signal: options.signal
    });
    if (response) {
      return response;
    }

    await delay(undefined, options.signal);
    const activeConnection = await fabricConnectionApi.getActive();
    const preview = mockPreviews[datasetId];
    const activeConnectionPreview =
      activeConnection && activeConnection.id !== SAMPLE_CONNECTION_ID && datasetId === getConnectionDatasetId(activeConnection)
        ? getConnectionPreview(activeConnection)
        : null;

    if (!preview && !activeConnectionPreview) {
      throw createApiError({
        code: 'DATASET_PREVIEW_UNAVAILABLE',
        message: 'Dataset preview is unavailable. Check permissions or connection status.',
        retryable: true,
        targetPath: `dataset/${datasetId}/preview`
      });
    }

    return activeConnectionPreview ?? preview;
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
