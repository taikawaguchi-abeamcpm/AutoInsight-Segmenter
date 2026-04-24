export type FabricAuthMode = 'obo' | 'service_principal';
export type FabricConnectionStatus = 'unconfigured' | 'ready' | 'needs_attention' | 'error' | 'testing';

export interface FabricConnectionConfig {
  id: string;
  displayName: string;
  endpointUrl: string;
  tenantId: string;
  clientId: string;
  authMode: FabricAuthMode;
  workspaceId?: string;
  schemaVersion?: string;
  status: FabricConnectionStatus;
  isActive: boolean;
  secretConfigured: boolean;
  lastTestedAt?: string;
  lastSuccessAt?: string;
  lastErrorMessage?: string;
  updatedAt: string;
  updatedBy: string;
}

export interface FabricConnectionDraft {
  displayName: string;
  endpointUrl: string;
  tenantId: string;
  clientId: string;
  authMode: FabricAuthMode;
  workspaceId?: string;
  schemaVersion?: string;
  clientSecret?: string;
}

export interface FabricConnectionTestResult {
  status: Exclude<FabricConnectionStatus, 'testing'>;
  message: string;
  testedAt: string;
  queryTypeName?: string;
  correlationId: string;
}
