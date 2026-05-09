const { makeHash, nowIso } = require('./http');

const getStore = () => require('./cosmosStore');

const readHeader = (req, name) => {
  const headers = req.headers || {};
  const lowerName = name.toLowerCase();

  if (typeof headers.get === 'function') {
    return headers.get(name) || headers.get(lowerName);
  }

  return headers[name] || headers[lowerName];
};

const claimValue = (claims, names) => {
  const normalizedNames = names.map((name) => name.toLowerCase());
  const match = (claims || []).find((claim) => {
    const type = String(claim.typ || claim.type || '').toLowerCase();
    return normalizedNames.includes(type) || normalizedNames.some((name) => type.endsWith(`/${name}`));
  });

  return match?.val || match?.value;
};

const decodeStaticWebAppPrincipal = (req) => {
  const encoded = readHeader(req, 'x-ms-client-principal');
  if (!encoded) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
  } catch {
    throw Object.assign(new Error('Authentication principal is invalid.'), {
      status: 401,
      code: 'AUTH.PRINCIPAL_INVALID'
    });
  }
};

const normalizePrincipal = (principal) => {
  if (!principal) {
    return null;
  }

  const claims = principal.claims || [];
  const email =
    claimValue(claims, ['emails', 'email', 'preferred_username', 'upn']) ||
    (String(principal.userDetails || '').includes('@') ? principal.userDetails : undefined);
  const displayName =
    claimValue(claims, ['name', 'given_name']) ||
    principal.userDetails ||
    email ||
    'Authenticated user';
  const externalSubject = principal.userId || claimValue(claims, ['sub', 'oid']);

  if (!externalSubject) {
    throw Object.assign(new Error('Authentication principal is missing a stable user id.'), {
      status: 401,
      code: 'AUTH.SUBJECT_MISSING'
    });
  }

  return {
    identityProvider: principal.identityProvider || 'unknown',
    externalSubject,
    email,
    displayName,
    roles: principal.userRoles || [],
    claims
  };
};

const resolvePrincipal = (req) => normalizePrincipal(decodeStaticWebAppPrincipal(req));

const requirePrincipal = (req) => {
  const principal = resolvePrincipal(req);
  if (!principal) {
    throw Object.assign(new Error('Authentication is required.'), {
      status: 401,
      code: 'AUTH.REQUIRED'
    });
  }

  return principal;
};

const userIdForPrincipal = (principal) =>
  `user-${makeHash({ provider: principal.identityProvider, subject: principal.externalSubject })}`;

const publicUser = (user, memberships) => ({
  id: user.id,
  email: user.email,
  displayName: user.displayName,
  identityProvider: user.identityProvider,
  defaultTenantId: user.defaultTenantId,
  onboardingComplete: Boolean(user.onboardingComplete),
  termsAcceptedAt: user.termsAcceptedAt,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
  memberships: memberships.map((membership) => ({
    id: membership.id,
    tenantId: membership.tenantId,
    tenantName: membership.tenantName,
    role: membership.role,
    status: membership.status
  }))
});

const getOrCreateUserSession = async (req) => {
  const principal = requirePrincipal(req);
  const { queryAll, upsert } = getStore();
  const userId = userIdForPrincipal(principal);
  const now = nowIso();

  const existingUser = (await queryAll('users', {
    query: 'SELECT * FROM c WHERE c.id = @id',
    parameters: [{ name: '@id', value: userId }]
  }))[0];

  const user = await upsert('users', {
    ...(existingUser || {}),
    id: userId,
    partitionKey: userId,
    identityProvider: principal.identityProvider,
    externalSubject: principal.externalSubject,
    email: principal.email || existingUser?.email,
    displayName: existingUser?.displayName || principal.displayName,
    roles: principal.roles,
    createdAt: existingUser?.createdAt || now,
    lastLoginAt: now,
    updatedAt: now
  });

  const memberships = await queryAll('memberships', {
    query: 'SELECT * FROM c WHERE c.userId = @userId ORDER BY c.updatedAt DESC',
    parameters: [{ name: '@userId', value: user.id }]
  });

  return {
    authenticated: true,
    principal: {
      identityProvider: principal.identityProvider,
      externalSubject: principal.externalSubject,
      roles: principal.roles
    },
    user: publicUser(user, memberships),
    onboardingRequired: !user.onboardingComplete || memberships.length === 0
  };
};

const completeOnboarding = async (req, body) => {
  const session = await getOrCreateUserSession(req);
  const { queryAll, upsert } = getStore();
  const now = nowIso();
  const displayName = String(body.displayName || session.user.displayName || '').trim();
  const tenantName = String(body.tenantName || '').trim();

  if (!displayName) {
    throw Object.assign(new Error('Display name is required.'), {
      status: 400,
      code: 'VALIDATION.DISPLAY_NAME_REQUIRED'
    });
  }

  if (!tenantName) {
    throw Object.assign(new Error('Organization name is required.'), {
      status: 400,
      code: 'VALIDATION.TENANT_NAME_REQUIRED'
    });
  }

  if (body.acceptedTerms !== true) {
    throw Object.assign(new Error('Terms acceptance is required.'), {
      status: 400,
      code: 'VALIDATION.TERMS_REQUIRED'
    });
  }

  const existingMembership = (await queryAll('memberships', {
    query: 'SELECT * FROM c WHERE c.userId = @userId AND c.status = "active"',
    parameters: [{ name: '@userId', value: session.user.id }]
  }))[0];
  const tenantId = existingMembership?.tenantId || `tenant-${makeHash({ owner: session.user.id, tenantName })}`;
  const membershipId = existingMembership?.id || `membership-${makeHash({ tenantId, userId: session.user.id })}`;

  const tenant = await upsert('tenants', {
    id: tenantId,
    partitionKey: tenantId,
    name: tenantName,
    status: 'active',
    plan: 'standard',
    createdAt: existingMembership?.createdAt || now,
    updatedAt: now
  });

  await upsert('memberships', {
    id: membershipId,
    partitionKey: tenant.id,
    tenantId: tenant.id,
    tenantName: tenant.name,
    userId: session.user.id,
    role: existingMembership?.role || 'owner',
    status: 'active',
    createdAt: existingMembership?.createdAt || now,
    updatedAt: now
  });

  await upsert('users', {
    id: session.user.id,
    partitionKey: session.user.id,
    identityProvider: session.user.identityProvider,
    externalSubject: session.principal.externalSubject,
    email: session.user.email,
    displayName,
    defaultTenantId: tenant.id,
    onboardingComplete: true,
    termsAcceptedAt: session.user.termsAcceptedAt || now,
    createdAt: session.user.createdAt || now,
    updatedAt: now
  });

  await upsert('auditLogs', {
    id: `audit-${makeHash({ action: 'user.onboarded', userId: session.user.id, now })}`,
    partitionKey: tenant.id,
    tenantId: tenant.id,
    userId: session.user.id,
    action: 'user.onboarded',
    target: tenant.id,
    createdAt: now,
    updatedAt: now
  });

  return getOrCreateUserSession(req);
};

module.exports = {
  completeOnboarding,
  getOrCreateUserSession,
  requirePrincipal,
  resolvePrincipal
};
