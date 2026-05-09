import json
from datetime import datetime, timezone


def _utc_now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def main(req, analysisQueueItem):
    try:
        payload = req.get_json() or {}
    except ValueError:
        return json.dumps({"message": "Request body must be JSON."}, ensure_ascii=False)

    required = ["analysisJobId", "payloadUrl", "callbackUrl", "token"]
    missing = [key for key in required if not payload.get(key)]
    if missing:
        return json.dumps({
            "message": f"Missing required enqueue field(s): {', '.join(missing)}"
        }, ensure_ascii=False)

    queue_item = {
        "analysisJobId": payload["analysisJobId"],
        "payloadUrl": payload["payloadUrl"],
        "callbackUrl": payload["callbackUrl"],
        "token": payload["token"],
        "queuedAt": payload.get("queuedAt") or _utc_now(),
    }
    analysisQueueItem.set(json.dumps(queue_item, ensure_ascii=False, separators=(",", ":")))

    return json.dumps({
        "accepted": True,
        "analysisJobId": queue_item["analysisJobId"],
        "queuedAt": queue_item["queuedAt"],
    }, ensure_ascii=False, separators=(",", ":"))
