# Python Analysis Worker Deployment

AutoInsight uses two runtimes in production:

- Static Web Apps managed API: Node.js, used for UI-facing orchestration and persistence.
- Azure Functions Python app: Python, used for preprocessing, training, and analysis.

The Node API does not fall back to JavaScript analysis. It calls the Python worker through `ANALYSIS_WORKER_URL`.

## Azure Resources

Create a Python Azure Function App with:

- Runtime stack: Python
- Python version: 3.11
- Hosting OS: Linux
- HTTP trigger support

The deployed HTTP endpoint is:

```text
https://<python-function-app>.azurewebsites.net/api/analysis/run
```

The health endpoint is anonymous and can be used to verify reachability:

```text
https://<python-function-app>.azurewebsites.net/api/analysis/health
```

## GitHub Secrets

Set these repository secrets to deploy the Python worker from CI with Azure Login / OIDC:

```text
AZURE_ANALYSIS_FUNCTIONAPP_NAME=<python-function-app-name>
AZURE_ANALYSIS_FUNCTIONAPP_RESOURCE_GROUP=<resource-group-name>
AZURE_CLIENT_ID=<managed-identity-or-app-registration-client-id>
AZURE_TENANT_ID=<tenant-id>
AZURE_SUBSCRIPTION_ID=<subscription-id>
```

The workflow packages `analysis-worker/autoinsight_analysis` into `analysis-function/` before deploying.

The worker is packaged as a Python v1-style Azure Functions project:

```text
analysis-function/
  host.json
  requirements.txt
  analysis_health/
    __init__.py
    function.json
  analysis_run/
    __init__.py
    function.json
```

This explicit `function.json` layout avoids decorator-indexing issues where the portal cannot list functions from `function_app.py`.

For a Flex Consumption Function App, the GitHub Actions deployment uses Azure Login and remote build:

```yaml
uses: azure/login@v2
...
uses: Azure/functions-action@v1
with:
  resource-group: <resource-group-name>
  remote-build: true
```

`remote-build: true` lets the deployment action request a remote build for the Python app package when the hosting SKU supports it.

For Flex Consumption apps, do not set `FUNCTIONS_WORKER_RUNTIME` with `az functionapp config appsettings set`. The runtime is part of the Function App site configuration and Azure rejects the same key in app settings with:

```text
Site.SiteConfig.AppSettings.FUNCTIONS_WORKER_RUNTIME ... is invalid.
```

The workflow removes these unsupported settings before deployment if they exist from a previous run:

```text
SCM_DO_BUILD_DURING_DEPLOYMENT=true
ENABLE_ORYX_BUILD=true
```

Do not add them back for the Flex Consumption Function App. The deployment action handles the Flex deployment path itself.

Important:

- `AZURE_ANALYSIS_FUNCTIONAPP_NAME` must be the Python Function App name, not the Static Web App name.
- `AZURE_ANALYSIS_FUNCTIONAPP_RESOURCE_GROUP` must be the resource group that contains the Python Function App.
- The identity used by `AZURE_CLIENT_ID` needs permission to deploy to the Function App. `Contributor` on the Function App or its resource group is sufficient.
- The GitHub workflow needs `id-token: write`; this is already set in `.github/workflows/azure-static-web-apps.yml`.

## Configure OIDC

Create an Entra ID app registration or user-assigned managed identity for GitHub Actions, then add a federated credential:

```text
Issuer: https://token.actions.githubusercontent.com
Subject: repo:<github-owner>/<github-repo>:ref:refs/heads/main
Audience: api://AzureADTokenExchange
```

For this repository, the subject should be:

```text
repo:taikawaguchi-abeamcpm/AutoInsight-Segmenter:ref:refs/heads/main
```

Assign that identity `Contributor` on the Python Function App or its resource group, then set the GitHub secrets listed above.

## Troubleshooting GitHub Actions 401

If the `deploy_analysis_function` job fails with:

```text
Failed to fetch Kudu App Settings.
Unauthorized (CODE: 401)
```

the GitHub Action parsed the publish profile, but Azure Kudu rejected the credentials. Check these items:

1. Open the Python Function App in Azure Portal.
2. Confirm the app name exactly matches `AZURE_ANALYSIS_FUNCTIONAPP_NAME`.
3. Download a fresh publish profile from that Function App.
4. Replace the GitHub secret `AZURE_ANALYSIS_FUNCTIONAPP_PUBLISH_PROFILE` with the full XML content.
5. In the Function App, check `Configuration` -> `General settings`.
6. Enable `SCM Basic Auth Publishing Credentials` if it is disabled.
7. Re-run the GitHub Actions workflow.

If your organization disables SCM basic publishing credentials, use the OIDC based deployment described above instead of publish profiles.

You can validate a publish profile locally without exposing the credentials:

```powershell
$path = "C:\path\to\autoinsight.PublishSettings"
[xml]$xml = Get-Content -LiteralPath $path
$profile = $xml.publishData.publishProfile |
  Where-Object { $_.publishMethod -eq "ZipDeploy" } |
  Select-Object -First 1
$pair = "{0}:{1}" -f $profile.userName, $profile.userPWD
$basic = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes($pair))
$uri = "https://{0}/api/settings" -f $profile.publishUrl
Invoke-WebRequest -Uri $uri -Headers @{ Authorization = "Basic $basic" } -UseBasicParsing
```

If this returns `401`, the publish profile is not valid for Kudu. Re-enable SCM Basic Auth, reset or re-download the publish profile from the same Function App, then update the GitHub secret.

## Static Web Apps App Settings

Set these app settings on the Static Web App API:

```text
ANALYSIS_WORKER_URL=https://<python-function-app>.azurewebsites.net/api/analysis/run
ANALYSIS_WORKER_KEY=<function-key>
```

For local development, you can omit `ANALYSIS_WORKER_URL`; the Node API will run `analysis-worker/run_analysis.py` directly with the local Python executable.

For the current `autoinsight` Function App in Japan East, the URL should use the app's default domain:

```text
ANALYSIS_WORKER_URL=https://autoinsight-d7e5dgd7f7bxdzfj.japaneast-01.azurewebsites.net/api/analysis/run
```

Before testing from AutoInsight, open this URL in a browser:

```text
https://autoinsight-d7e5dgd7f7bxdzfj.japaneast-01.azurewebsites.net/api/analysis/health
```

Expected response:

```json
{"status":"ok","runtime":"python","worker":"autoinsight-analysis"}
```

If the browser cannot open the health URL, fix the Function App deployment, networking, or public access before testing the Static Web App. If the health URL works but `/api/analysis/start` still fails, verify `ANALYSIS_WORKER_URL` and `ANALYSIS_WORKER_KEY` in the Static Web App application settings, then restart or redeploy the Static Web App API.

You can also verify the same reachability from the Static Web Apps managed API:

```text
https://<static-web-app-domain>/api/analysis/worker-health
```

For the current Static Web App:

```text
https://wonderful-water-048492b00.7.azurestaticapps.net/api/analysis/worker-health
```

Expected response:

```json
{
  "configured": true,
  "reachable": true,
  "hasKey": true,
  "status": 200
}
```

If `configured` is `false`, set `ANALYSIS_WORKER_URL` on the Static Web App. If `reachable` is `false`, check the returned `healthUrl` and `message`, then verify Function App public access/networking.

## Failure Behavior

If the Python worker URL is configured and the worker fails, `/api/analysis/start` returns an API error. This is intentional so Python runtime/deployment issues are visible instead of silently using JavaScript analysis.
