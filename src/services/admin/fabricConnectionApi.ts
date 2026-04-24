import type { FabricConnectionConfig, FabricConnectionDraft, FabricConnectionTestResult } from '../../types/admin';
import { createApiError, delay, makeHash } from '../client';
import { nowIso } from '../mockData';

let savedConnections: FabricConnectionConfig[] = [
  {
    id: 'fabric-conn-marketing',
    displayName: 'Marketing Fabric GraphQL',
    endpointUrl: 'https://api.fabric.microsoft.com/v1/workspaces/ws-marketing/graphqlApis/customer-insight/graphql',
    tenantId: 'contoso-tenant-id',
    clientId: 'autoinsight-app-client-id',
    authMode: 'obo',
    workspaceId: 'ws-marketing',
    schemaVersion: 'fabric-schema-2026-04-24',
    status: 'ready',
    isActive: true,
    secretConfigured: false,
    lastTestedAt: '2026-04-24T04:30:00Z',
    lastSuccessAt: '2026-04-24T04:30:00Z',
    updatedAt: '2026-04-24T04:30:00Z',
    updatedBy: 'admin@example.com'
  }
];

const validateDraft = (draft: FabricConnectionDraft) => {
  if (!draft.displayName.trim()) {
    throw createApiError({
      code: 'VALIDATION.DISPLAY_NAME_REQUIRED',
      message: '接続名を入力してください。',
      targetPath: 'displayName'
    });
  }

  if (!draft.endpointUrl.startsWith('https://')) {
    throw createApiError({
      code: 'VALIDATION.ENDPOINT_URL_INVALID',
      message: 'Fabric GraphQL endpoint は https:// で始まるURLを入力してください。',
      targetPath: 'endpointUrl'
    });
  }

  if (!draft.tenantId.trim() || !draft.clientId.trim()) {
    throw createApiError({
      code: 'VALIDATION.AUTH_REQUIRED',
      message: 'Tenant ID と Client ID を入力してください。',
      targetPath: 'auth'
    });
  }

  if (draft.authMode === 'service_principal' && !draft.clientSecret?.trim()) {
    throw createApiError({
      code: 'VALIDATION.SECRET_REQUIRED',
      message: 'Service principal 方式では Client Secret の登録が必要です。',
      targetPath: 'clientSecret'
    });
  }
};

export const fabricConnectionApi = {
  async list(): Promise<FabricConnectionConfig[]> {
    await delay(140);
    return [...savedConnections];
  },

  async test(draft: FabricConnectionDraft): Promise<FabricConnectionTestResult> {
    await delay(460);
    validateDraft(draft);

    return {
      status: 'ready',
      message: 'Fabric GraphQL endpoint への疎通と認証設定を確認しました。',
      testedAt: nowIso(),
      queryTypeName: 'Query',
      correlationId: `corr-${makeHash({ endpointUrl: draft.endpointUrl, testedAt: Date.now() })}`
    };
  },

  async save(draft: FabricConnectionDraft): Promise<FabricConnectionConfig> {
    await delay(260);
    validateDraft(draft);

    const now = nowIso();
    const id = `fabric-conn-${makeHash({ endpointUrl: draft.endpointUrl, tenantId: draft.tenantId })}`;
    const existing = savedConnections.find((connection) => connection.id === id);
    const next: FabricConnectionConfig = {
      id,
      displayName: draft.displayName.trim(),
      endpointUrl: draft.endpointUrl.trim(),
      tenantId: draft.tenantId.trim(),
      clientId: draft.clientId.trim(),
      authMode: draft.authMode,
      workspaceId: draft.workspaceId?.trim() || undefined,
      schemaVersion: draft.schemaVersion?.trim() || undefined,
      status: 'ready',
      isActive: true,
      secretConfigured: draft.authMode === 'service_principal' ? true : existing?.secretConfigured ?? false,
      lastTestedAt: now,
      lastSuccessAt: now,
      updatedAt: now,
      updatedBy: 'admin@example.com'
    };

    savedConnections = [next, ...savedConnections.filter((connection) => connection.id !== id).map((connection) => ({ ...connection, isActive: false }))];
    return next;
  }
};
