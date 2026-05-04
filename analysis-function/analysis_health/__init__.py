import json


def main(req):
    return json.dumps(
        {
            "status": "ok",
            "runtime": "python",
            "worker": "autoinsight-analysis",
        },
        ensure_ascii=False,
    )
