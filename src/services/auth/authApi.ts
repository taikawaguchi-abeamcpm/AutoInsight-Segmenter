import type { AuthSession, OnboardingDraft } from '../../types/auth';
import { apiRequest, createApiError, isApiError } from '../client';

const AUTH_PROVIDER = (import.meta.env.VITE_AUTH_PROVIDER as string | undefined) ?? 'entra';

export const signIn = () => {
  const redirect = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  window.location.assign(`/.auth/login/${AUTH_PROVIDER}?post_login_redirect_uri=${encodeURIComponent(redirect || '/')}`);
};

export const signOut = () => {
  window.location.assign('/.auth/logout?post_logout_redirect_uri=/');
};

export const getAuthSession = async (): Promise<AuthSession | null> => {
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
