import json
import os
import sys
import traceback
from datetime import datetime, timezone
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))


def _utc_now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _failed_result(payload, message, detail=None):
    timestamp = _utc_now()
    mapping = payload.get("mapping") or {}
    dataset = payload.get("dataset") or {}
    config = payload.get("config") or {}
    analysis_job_id = payload.get("analysisJobId") or "job-python-worker-failed"
    run_id = payload.get("runId") or "run-python-worker-failed"

    return {
        "id": analysis_job_id,
        "analysisJobId": analysis_job_id,
        "runId": run_id,
        "datasetId": dataset.get("id") or mapping.get("datasetId") or "unknown",
        "mappingDocumentId": mapping.get("id") or "unknown",
        "mode": config.get("mode") or "custom",
        "status": "failed",
        "progressPercent": 100,
        "message": message,
        "detail": detail,
        "createdAt": timestamp,
        "startedAt": timestamp,
        "completedAt": timestamp,
        "summary": {
            "analyzedRowCount": 0,
            "topFeatureCount": 0,
            "validPatternCount": 0,
            "recommendedSegmentCount": 0,
        },
        "featureImportances": [],
        "interactionPairs": [],
        "goldenPatterns": [],
        "segmentRecommendations": [],
    }


def main(req):
    payload = {}
    try:
        payload = req.get_json() or {}
    except ValueError:
        return json.dumps({"message": "Request body must be JSON."}, ensure_ascii=False)
    if not isinstance(payload, dict):
        return json.dumps({"message": "Request body must be a JSON object."}, ensure_ascii=False)

    try:
        from autoinsight_analysis.worker import build_real_analysis_result

        result = build_real_analysis_result(payload)
        return json.dumps(result, ensure_ascii=False, separators=(",", ":"))
    except Exception as err:
        detail = None
        if os.environ.get("ANALYSIS_WORKER_DEBUG") == "true":
            detail = traceback.format_exc()
        result = _failed_result(
            payload,
            str(err) or "Python analysis worker failed.",
            detail=detail,
        )
        return json.dumps(result, ensure_ascii=False, separators=(",", ":"))
