import type { AuthSession, OnboardingDraft } from '../../types/auth';
import { apiRequest, createApiError, isApiError } from '../client';

const AUTH_PROVIDER = (import.meta.env.VITE_AUTH_PROVIDER as string | undefined) ?? 'entra';
const AUTH_DEV_MODE = import.meta.env.DEV && import.meta.env.VITE_AUTH_DEV_MODE === 'true';

const devSession = (overrides: Partial<AuthSession['user']> = {}): AuthSession => ({
  authenticated: true,
  principal: {
    identityProvider: 'local',
    externalSubject: 'local-dev-user',
    roles: ['authenticated']
  },
  user: {
    id: 'user-local-dev',
    email: 'developer@example.local',
    displayName: 'Local Developer',
    identityProvider: 'local',
    defaultTenantId: 'tenant-local-dev',
    onboardingComplete: true,
    memberships: [
      {
        id: 'membership-local-dev',
        tenantId: 'tenant-local-dev',
        tenantName: 'Local Workspace',
        role: 'owner',
        status: 'active'
      }
    ],
    ...overrides
  },
  onboardingRequired: false
});

export const signIn = () => {
  const redirect = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  window.location.assign(`/.auth/login/${AUTH_PROVIDER}?post_login_redirect_uri=${encodeURIComponent(redirect || '/')}`);
};

export const signOut = () => {
  window.location.assign('/.auth/logout?post_logout_redirect_uri=/');
};

export const getAuthSession = async (): Promise<AuthSession | null> => {
  if (AUTH_DEV_MODE) {
    return devSession();
  }

  try {
    return await apiRequest<AuthSession>('/me');
  } catch (error) {
    if (isApiError(error) && (error.code === 'AUTH.REQUIRED' || error.code === 'HTTP.401')) {
      return null;
    }

    throw error;
  }
};

export const completeOnboarding = async (draft: OnboardingDraft): Promise<AuthSession> => {
  if (AUTH_DEV_MODE) {
    return devSession({
      displayName: draft.displayName,
      defaultTenantId: `tenant-${draft.tenantName.toLowerCase().replace(/\s+/g, '-')}`,
      memberships: [
        {
          id: 'membership-local-dev',
          tenantId: `tenant-${draft.tenantName.toLowerCase().replace(/\s+/g, '-')}`,
          tenantName: draft.tenantName,
          role: 'owner',
          status: 'active'
        }
      ]
    });
  }

  const session = await apiRequest<AuthSession>('/me/onboarding', {
    method: 'POST',
    body: JSON.stringify(draft)
  });

  if (!session) {
    throw createApiError({
      code: 'AUTH.ONBOARDING_EMPTY_RESPONSE',
      message: 'Registration could not be completed.'
    });
  }

  return session;
};
