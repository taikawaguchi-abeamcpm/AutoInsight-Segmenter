import json

import azure.functions as func


def main(_req: func.HttpRequest) -> func.HttpResponse:
    return func.HttpResponse(
        json.dumps({
            "status": "ok",
            "runtime": "python",
            "worker": "autoinsight-analysis",
        }),
        status_code=200,
        mimetype="application/json",
    )
