export interface Membership {
  id: string;
  tenantId: string;
  tenantName: string;
  role: 'owner' | 'admin' | 'member' | string;
  status: 'active' | 'invited' | 'disabled' | string;
}

export interface AuthenticatedUser {
  id: string;
  email?: string;
  displayName: string;
  identityProvider: string;
  defaultTenantId?: string;
  onboardingComplete: boolean;
  termsAcceptedAt?: string;
  createdAt?: string;
  updatedAt?: string;
  memberships: Membership[];
}

export interface AuthSession {
  authenticated: boolean;
  principal?: {
    identityProvider: string;
    externalSubject: string;
    roles: string[];
  };
  user: AuthenticatedUser;
  onboardingRequired: boolean;
}

export interface OnboardingDraft {
  displayName: string;
  tenantName: string;
  acceptedTerms: boolean;
}
