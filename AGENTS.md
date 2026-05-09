# Agent Working Guide

This repository is intentionally split into frontend, API, Python analysis, and deployment wrapper areas. Keep changes scoped to the area requested by the task.

## Read First

1. `README.md` for the current repository map and commands.
2. The narrow source area you are changing.
3. The matching files under `docs/design/` only when the task depends on product or workflow behavior.

## Source Areas

- `src/`: React + TypeScript frontend.
- `api/httpApi/`: Azure Functions HTTP entry point. Keep this thin.
- `api/src/`: Node API services and domain logic.
- `analysis-worker/autoinsight_analysis/`: Python analysis engine.
- `analysis-function/`: Azure Functions wrapper for the Python worker.
- `docs/`: design, deployment, and review notes.

## Ignore During Normal Work

Do not inspect or edit these unless the task explicitly asks for artifacts or generated output:

- `node_modules/`
- `api/node_modules/`
- `dist/`
- `review-artifacts/`
- `**/__pycache__/`
- `*.pyc`
- `*.log`
- `*.tsbuildinfo`
- generated `vite.config.js` and `vite.config.d.ts`

## Change Discipline

- Prefer small, localized changes over broad refactors.
- Do not add generated files or verification screenshots to Git.
- Keep large modules moving toward smaller route, service, hook, or algorithm modules.
- When touching backend API behavior, run `npm run build` and `npm --prefix api test` when practical.
- When touching the Python worker, run the relevant Python syntax or worker checks before finishing.
