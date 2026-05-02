import json
import os
import sys
import traceback
from pathlib import Path

import azure.functions as func


CURRENT_DIR = Path(__file__).resolve().parent
REPO_WORKER_DIR = CURRENT_DIR.parent / "analysis-worker"
if REPO_WORKER_DIR.exists():
    sys.path.insert(0, str(REPO_WORKER_DIR))
sys.path.insert(0, str(CURRENT_DIR))

from autoinsight_analysis.worker import build_real_analysis_result


app = func.FunctionApp(http_auth_level=func.AuthLevel.FUNCTION)


@app.route(route="analysis/run", methods=["POST"])
def run_analysis(req: func.HttpRequest) -> func.HttpResponse:
    try:
        payload = req.get_json()
    except ValueError:
        return func.HttpResponse(
            json.dumps({"message": "Request body must be JSON."}),
            status_code=400,
            mimetype="application/json",
        )

    try:
        result = build_real_analysis_result(payload)
        return func.HttpResponse(
            json.dumps(result, ensure_ascii=False, separators=(",", ":")),
            status_code=200,
            mimetype="application/json",
        )
    except Exception as err:
        body = {
            "message": str(err),
            "code": "ANALYSIS.PYTHON_WORKER_FAILED",
        }
        if os.environ.get("ANALYSIS_WORKER_DEBUG") == "true":
            body["traceback"] = traceback.format_exc()
        return func.HttpResponse(
            json.dumps(body, ensure_ascii=False),
            status_code=500,
            mimetype="application/json",
        )
