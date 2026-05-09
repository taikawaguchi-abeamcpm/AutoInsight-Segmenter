# AutoInsight Segmenter

AutoInsight Segmenter is a React frontend with Azure Static Web Apps API routes and a Python analysis worker. The app connects to Microsoft Fabric data, creates semantic mappings, runs analysis, and turns the results into segment recommendations.

## Repository Map

- `src/`: React + TypeScript frontend screens, services, hooks, and types.
- `api/httpApi/`: Azure Functions HTTP trigger entry point.
- `api/src/`: Node API modules for auth, Fabric access, analysis orchestration, storage, and semantic mapping.
- `analysis-worker/`: Python analysis engine.
- `analysis-function/`: Azure Function App wrapper used to deploy the Python worker.
- `docs/`: design, deployment, and review documents.
- `scripts/`: repository maintenance scripts.

Generated output, dependency folders, logs, build outputs, screenshots, and Python bytecode are intentionally ignored by Git. Keep verification images under `review-artifacts/` or another external artifact location, not in source control.

## Common Commands

```powershell
npm install
npm --prefix api install
npm run build
npm --prefix api test
```

Production deployment is handled by GitHub Actions after changes are pushed to `main`.
The repository does not keep local development server or local deployment wrapper scripts.

## Maintenance

Run the repository hygiene check before committing structural or generated-file cleanup:

```powershell
powershell -ExecutionPolicy Bypass -File ./scripts/check-repo-hygiene.ps1
```

The check fails when generated artifacts are tracked and reports large source files that should be split during follow-up refactoring.
