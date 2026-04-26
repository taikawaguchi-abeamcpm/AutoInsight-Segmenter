# AutoInsight Analysis Worker

The analysis worker owns the data-analysis runtime for AutoInsight Segmenter.
Node/TypeScript code starts jobs and persists results, while this Python worker
fetches Fabric data, materializes features, trains the baseline model, mines
patterns, and returns an `AnalysisResultDocument`-compatible JSON payload.

## Runtime Contract

Input is read from stdin as JSON:

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

Output is written to stdout as JSON. Any stderr output with a non-zero exit code
is treated as an API failure by `api/src/analysisEngine.js`.

## Responsibilities

- Fabric GraphQL data fetch for analysis rows
- Target normalization and feature materialization
- Join-based aggregation and sequence feature extraction
- Python-side model training with a stdlib logistic-regression baseline
- Statistical and model-based feature importance
- Golden-pattern and segment-recommendation generation

## Configuration

- `PYTHON_EXECUTABLE`: optional path used by the Node adapter
- `ANALYSIS_WORKER_TIMEOUT_MS`: Node adapter timeout, default 15 minutes
- `FABRIC_GRAPHQL_TIMEOUT_MS`: GraphQL request timeout
- `FABRIC_ANALYSIS_PAGE_SIZE`: GraphQL page size
- `FABRIC_ANALYSIS_MAX_ROWS`: maximum rows per table fetch
