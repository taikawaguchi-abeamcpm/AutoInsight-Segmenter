import type { FabricConnectionConfig, FabricConnectionDraft, FabricConnectionTestResult } from '../../types/admin';
import { createApiError, delay, makeHash } from '../client';
import { nowIso } from '../mockData';

const STORAGE_KEY = 'autoinsight.fabricConnections.v1';

const sampleConnection: FabricConnectionConfig = {
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
};

const readConnections = (): FabricConnectionConfig[] | null => {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value ? (JSON.parse(value) as FabricConnectionConfig[]) : null;
  } catch {
    return null;
  }
};

const writeConnections = (connections: FabricConnectionConfig[]) => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(connections));
  } catch {
    // In-memory state still works if storage is unavailable.
  }
};

let savedConnections: FabricConnectionConfig[] = readConnections() ?? [
  sampleConnection
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

  async getActive(): Promise<FabricConnectionConfig | null> {
    await delay(80);
    return savedConnections.find((connection) => connection.isActive && connection.status === 'ready') ?? null;
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
    writeConnections(savedConnections);
    return next;
  },

  async remove(connectionId: string): Promise<FabricConnectionConfig[]> {
    await delay(180);

    const target = savedConnections.find((connection) => connection.id === connectionId);
    if (!target) {
      throw createApiError({
        code: 'CONNECTION.NOT_FOUND',
        message: '削除対象の接続設定が見つかりません。',
        targetPath: `fabricConnection/${connectionId}`
      });
    }

    const remaining = savedConnections.filter((connection) => connection.id !== connectionId);
    savedConnections = target.isActive && remaining.length > 0
      ? remaining.map((connection, index) => ({ ...connection, isActive: index === 0 }))
      : remaining;
    writeConnections(savedConnections);

    return [...savedConnections];
  }
};
