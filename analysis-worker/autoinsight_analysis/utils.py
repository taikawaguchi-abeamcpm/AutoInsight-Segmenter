import math
import statistics
from datetime import datetime, timezone
from typing import Any


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def is_missing(value: Any) -> bool:
    return value is None or value == ""


def to_number(value: Any) -> float | None:
    if isinstance(value, bool):
        return 1.0 if value else 0.0
    if isinstance(value, (int, float)) and math.isfinite(value):
        return float(value)
    if isinstance(value, str) and value.strip():
        try:
            parsed = float(value)
            return parsed if math.isfinite(parsed) else None
        except ValueError:
            return None
    return None


def to_timestamp(value: Any) -> float | None:
    if isinstance(value, (int, float)) and math.isfinite(value):
        return float(value)
    if isinstance(value, str) and value.strip():
        try:
            text = value.replace("Z", "+00:00")
            return datetime.fromisoformat(text).timestamp() * 1000
        except ValueError:
            return None
    return None


def mean(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def stddev(values: list[float]) -> float:
    return statistics.stdev(values) if len(values) >= 2 else 0.0


def clamp_score(value: float) -> int:
    return max(0, min(100, round(value)))


def format_rate(value: float) -> str:
    return f"{round(value * 1000) / 10}%"


def format_point_delta(value: float) -> str:
    return f"{round(value * 1000) / 10}pt"


def pattern_direction_text(delta: float) -> str:
    return "高い" if delta >= 0 else "低い"
