# Analysis Phase 4 Implementation

Phase 4 adds autopilot analysis behavior on top of the existing Python worker.

Implemented behavior:

- Generate candidate features in the Python worker when `mode = autopilot` and `allowGeneratedFeatures = true`.
- Support profile latest/none features, joined-table count/distinct_count, numeric sum/avg, 30/90 day time-window aggregations, and event recency in days.
- Compare `accuracy`, `explainability`, and `segmentability` candidate feature sets.
- Persist the selected strategy and candidate metrics in `modelMetadata`.
- Send a lightweight browser payload for autopilot by omitting sample values, value labels, validation details, descriptions, and other UI-only metadata.

Notes:

- Current execution still uses the synchronous experiment path, so `FABRIC_ANALYSIS_PAGE_SIZE=500` and `FABRIC_ANALYSIS_MAX_ROWS=5000` remain the default limits.
- Larger production runs should move to a queue or durable worker path before raising row limits.
