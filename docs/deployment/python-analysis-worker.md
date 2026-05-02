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

## GitHub Secrets

Set these repository secrets to deploy the Python worker from CI:

```text
AZURE_ANALYSIS_FUNCTIONAPP_NAME=<python-function-app-name>
AZURE_ANALYSIS_FUNCTIONAPP_PUBLISH_PROFILE=<publish-profile-xml>
```

The workflow packages `analysis-worker/autoinsight_analysis` into `analysis-function/` before deploying.

Important:

- `AZURE_ANALYSIS_FUNCTIONAPP_NAME` must be the Python Function App name, not the Static Web App name.
- `AZURE_ANALYSIS_FUNCTIONAPP_PUBLISH_PROFILE` must be downloaded from that same Python Function App.
- Do not use the Static Web App deployment token or Static Web App publish settings for this secret.
- Paste the full publish profile XML, including the outer `<publishData>` element.

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

If your organization disables SCM basic publishing credentials, use an Azure service principal or OIDC based deployment instead of publish profiles.

## Static Web Apps App Settings

Set these app settings on the Static Web App API:

```text
ANALYSIS_WORKER_URL=https://<python-function-app>.azurewebsites.net/api/analysis/run
ANALYSIS_WORKER_KEY=<function-key>
```

For local development, you can omit `ANALYSIS_WORKER_URL`; the Node API will run `analysis-worker/run_analysis.py` directly with the local Python executable.

## Failure Behavior

If the Python worker URL is configured and the worker fails, `/api/analysis/start` returns an API error. This is intentional so Python runtime/deployment issues are visible instead of silently using JavaScript analysis.
