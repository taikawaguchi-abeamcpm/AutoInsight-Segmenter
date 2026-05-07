# Microsoft Entra External ID setup

This app delegates authentication to Microsoft Entra External ID and stores only app-specific membership data in Cosmos DB.

## App behavior

- The React app loads anonymously so it can show the login / registration screen.
- `/api/*` is protected by Azure Static Web Apps route authorization.
- Azure Functions read the authenticated user from the `x-ms-client-principal` header.
- On first login, `GET /api/me` creates a `users` record.
- `POST /api/me/onboarding` creates the initial `tenants` and `memberships` records.

## Azure setup

1. Create or select a Microsoft Entra External ID tenant.
2. Create an app registration for the Static Web App.
3. Add this redirect URI:

```text
https://<static-web-app-hostname>/.auth/login/entra/callback
```

4. Create a client secret.
5. Add Static Web App application settings:

```text
ENTRA_EXTERNAL_ID_CLIENT_ID=<application-client-id>
ENTRA_EXTERNAL_ID_CLIENT_SECRET=<client-secret>
```

6. Add the custom OpenID Connect provider to `staticwebapp.config.json`.

```json
{
  "auth": {
    "identityProviders": {
      "customOpenIdConnectProviders": {
        "entra": {
          "registration": {
            "clientIdSettingName": "ENTRA_EXTERNAL_ID_CLIENT_ID",
            "clientCredential": {
              "clientSecretSettingName": "ENTRA_EXTERNAL_ID_CLIENT_SECRET"
            },
            "openIdConnectConfiguration": {
              "wellKnownOpenIdConfiguration": "https://<tenant-name>.ciamlogin.com/<tenant-id>/v2.0/.well-known/openid-configuration"
            }
          },
          "login": {
            "nameClaimType": "name",
            "scopes": ["openid", "profile", "email"]
          }
        }
      }
    }
  }
}
```

Keep the provider key as `entra`, or set `VITE_AUTH_PROVIDER` to the provider key used in the Static Web Apps config.

## Cosmos containers

The API creates these containers automatically when the configured Cosmos identity has permission:

```text
users
tenants
memberships
auditLogs
```

Each user is keyed from the identity provider and stable External ID subject. Application roles are stored in `memberships`; do not rely on identity provider claims alone for data authorization.

## Local development

For local API work, copy `api/local.settings.sample.json` to `api/local.settings.json`. The sample enables a local development principal:

```text
AUTH_DEV_USER_ENABLED=true
AUTH_DEV_USER_EMAIL=developer@example.local
AUTH_DEV_USER_NAME=Local Developer
```

Disable `AUTH_DEV_USER_ENABLED` outside local development.

For Vite-only UI development without Static Web Apps auth or the Functions API, start Vite with:

```text
VITE_AUTH_DEV_MODE=true
```

Use this only for UI development. API authorization is not exercised in this mode.
