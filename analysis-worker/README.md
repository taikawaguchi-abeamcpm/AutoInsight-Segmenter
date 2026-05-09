# AutoInsight Analysis Worker

The analysis worker owns the data-analysis runtime for AutoInsight Segmenter.
Node/TypeScript code starts jobs and persists results, while this Python worker
fetches Fabric data, materializes features, trains the baseline model, mines
patterns, and returns an `AnalysisResultDocument`-compatible JSON payload.

## Runtime Contract

The deployed Azure Functions wrapper passes request JSON to the worker functions:

```json
{
  "analysisJobId": "job-id",
  "runId": "run-id",
  "connection": {},
  "auth": { "authorization": "Bearer ..." },
  "mapping": {},
  "dataset": {},
  "config": {}
}
```

The worker returns an `AnalysisResultDocument`-compatible dictionary to the
Function App wrapper, which serializes it as JSON for the Node API.

## Responsibilities

- Fabric GraphQL data fetch for analysis rows
- Target normalization and feature materialization
- Join-based aggregation and sequence feature extraction
- Python-side model training with a stdlib logistic-regression baseline
- Statistical and model-based feature importance
- Golden-pattern and segment-recommendation generation

## Configuration

- `ANALYSIS_REMOTE_WORKER_TIMEOUT_MS`: Node API timeout for the deployed Python worker, default 25 seconds so `/api/analysis/start` can return before the Static Web Apps synchronous backend call is cut off
- `ANALYSIS_WORKER_TIMEOUT_MS`: legacy override for the Node API remote worker timeout
- `FABRIC_GRAPHQL_TIMEOUT_MS`: GraphQL request timeout
- `FABRIC_ANALYSIS_PAGE_SIZE`: GraphQL page size, default 500
- `FABRIC_ANALYSIS_MAX_ROWS`: maximum rows per table fetch, default 5,000 for the synchronous experiment path
