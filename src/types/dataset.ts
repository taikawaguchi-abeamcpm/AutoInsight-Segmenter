export type DatasetConnectionStatus = 'ready' | 'warning' | 'error' | 'forbidden' | 'syncing';

export type DatasetWarningCode =
  | 'NO_PRIMARY_KEY'
  | 'NO_TIMESTAMP_COLUMN'
  | 'LOW_TABLE_COUNT'
  | 'SYNC_DELAYED'
  | 'ACCESS_LIMITED'
  | 'SCHEMA_PREVIEW_UNAVAILABLE';

export type DatasetSelectionStatus =
  | 'idle'
  | 'loadingList'
  | 'ready'
  | 'loadingPreview'
  | 'submitting'
  | 'empty'
  | 'error';

export interface FabricWorkspaceSummary {
  id: string;
  name: string;
  region?: string;
}

export interface DatasetListItem {
  id: string;
  connectionId?: string;
  secretConfigured?: boolean;
  name: string;
  displayName: string;
  workspaceId: string;
  workspaceName: string;
  description?: string;
  tags: string[];
  tableCount: number;
  lastSyncedAt?: string;
  connectionStatus: DatasetConnectionStatus;
  recommended: boolean;
  recommendationScore?: number;
  recommendationReasons: string[];
  recentlyUsed: boolean;
  warningCodes: DatasetWarningCode[];
}

export interface DatasetPreview {
  datasetId: string;
  ownerName?: string;
  rowEstimate?: number;
  columnCount: number;
  primaryKeyCandidateCount: number;
  timestampColumnCount: number;
  sampleAvailable: boolean;
  topTables: DatasetTablePreview[];
  warnings: DatasetWarning[];
}

export interface DatasetTablePreview {
  tableId: string;
  tableName: string;
  rowCount?: number;
  suggestedRole?: 'customer' | 'transaction' | 'event' | 'unknown';
}

export interface DatasetWarning {
  code: DatasetWarningCode;
  severity: 'info' | 'warning' | 'error';
  message: string;
}

export interface SelectedDatasetContext {
  datasetId: string;
  datasetName: string;
  workspaceId: string;
  workspaceName: string;
  connectionStatus: DatasetConnectionStatus;
  lastSyncedAt?: string;
  tableCount: number;
}
