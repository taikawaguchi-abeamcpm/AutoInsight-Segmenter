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

## Static Web Apps App Settings

Set these app settings on the Static Web App API:

```text
ANALYSIS_WORKER_URL=https://<python-function-app>.azurewebsites.net/api/analysis/run
ANALYSIS_WORKER_KEY=<function-key>
```

For local development, you can omit `ANALYSIS_WORKER_URL`; the Node API will run `analysis-worker/run_analysis.py` directly with the local Python executable.

## Failure Behavior

If the Python worker URL is configured and the worker fails, `/api/analysis/start` returns an API error. This is intentional so Python runtime/deployment issues are visible instead of silently using JavaScript analysis.
