import math
from itertools import combinations
from typing import Any

from .utils import clamp_score, format_point_delta, format_rate, pattern_direction_text, to_number

def is_sequence_mining_feature(feature: dict[str, Any], event_time_columns_by_table: dict[str, Any]) -> bool:
    return (
        feature.get("valueType") == "categorical"
        and feature.get("sourceTableId") in event_time_columns_by_table
        and (
            feature.get("entityRole") in {"transaction_fact", "event_log"}
            or feature.get("category") in {"transaction", "behavior"}
        )
    )



def matches_condition(row: dict[str, Any], condition: dict[str, Any]) -> bool:
    value = row.get(condition["featureKey"])
    operator = condition.get("operator")
    if operator == "eq":
        return str(value) == str(condition.get("value"))
    if operator == "neq":
        return str(value) != str(condition.get("value"))
    numeric = to_number(value)
    if numeric is None:
        return False
    if operator == "gt":
        return numeric > condition.get("value")
    if operator == "gte":
        return numeric >= condition.get("value")
    if operator == "lt":
        return numeric < condition.get("value")
    if operator == "lte":
        return numeric <= condition.get("value")
    if operator == "between":
        return condition.get("value") <= numeric <= condition.get("valueTo")
    return False


def comparable_condition_value(value: Any) -> str:
    text = str(value).strip().lower()
    return text[:-2] if text.endswith(".0") else text


def condition_feature_label(condition: dict[str, Any]) -> str:
    label = str(condition.get("label") or condition.get("featureKey") or "")
    return label.split(" 縺・", 1)[0].strip()


def semantic_condition_key(condition: dict[str, Any]) -> tuple[Any, ...]:
    feature = condition_feature_label(condition)
    count_feature, separator, count_value = feature.partition(":")
    numeric_value = to_number(condition.get("value"))

    if (
        separator
        and count_feature.strip().endswith("蛻･蝗樊焚")
        and condition.get("operator") in {"gt", "gte"}
        and numeric_value is not None
        and numeric_value >= 1
    ):
        base_feature = count_feature.strip()[:-len("蛻･蝗樊焚")].strip()
        return ("category_presence", base_feature, comparable_condition_value(count_value))

    if condition.get("operator") == "eq":
        return ("category_presence", feature, comparable_condition_value(condition.get("value")))

    return (
        "raw",
        str(condition.get("featureKey") or ""),
        str(condition.get("operator") or ""),
        comparable_condition_value(condition.get("value")),
        comparable_condition_value(condition.get("valueTo")),
    )


def row_signature_for_conditions(rows: list[dict[str, Any]], conditions: list[dict[str, Any]]) -> tuple[Any, ...]:
    return tuple(
        row.get("__rowId")
        for row in rows
        if all(matches_condition(row, condition) for condition in conditions)
    )


def condition_signature(rows: list[dict[str, Any]], condition: dict[str, Any]) -> tuple[Any, ...]:
    return row_signature_for_conditions(rows, [condition])


def compact_equivalent_conditions(rows: list[dict[str, Any]], conditions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    compacted = []
    seen: dict[tuple[Any, ...], tuple[Any, ...]] = {}
    for condition in conditions:
        semantic_key = semantic_condition_key(condition)
        matched_rows = condition_signature(rows, condition)
        if seen.get(semantic_key) == matched_rows:
            continue
        seen[semantic_key] = matched_rows
        compacted.append(condition)

    changed = True
    while changed and len(compacted) > 1:
        changed = False
        current_signature = row_signature_for_conditions(rows, compacted)
        for index in range(len(compacted)):
            reduced = compacted[:index] + compacted[index + 1:]
            if reduced and row_signature_for_conditions(rows, reduced) == current_signature:
                compacted = reduced
                changed = True
                break

    return compacted


def pattern_signature(rows: list[dict[str, Any]], conditions: list[dict[str, Any]]) -> tuple[Any, ...]:
    return (
        tuple(sorted(semantic_condition_key(condition) for condition in conditions)),
        row_signature_for_conditions(rows, conditions),
    )


def mine_sequential_route_features(
    rows: list[dict[str, Any]],
    features: list[dict[str, Any]],
    baseline_rate: float,
    min_group_count: int,
    event_time_columns_by_table: dict[str, Any],
    max_routes: int,
) -> list[dict[str, Any]]:
    candidates = []
    route_lengths = [2, 3]
    for feature in [item for item in features if is_sequence_mining_feature(item, event_time_columns_by_table)]:
        groups: dict[str, dict[str, Any]] = {}
        for row_index, row in enumerate(rows):
            sequence = (row.get("__sequences") or {}).get(feature["featureKey"]) or []
            if len(sequence) < 2:
                continue
            row_routes = set()
            for length in route_lengths:
                if len(sequence) < length:
                    continue
                for index in range(0, len(sequence) - length + 1):
                    row_routes.add(" -> ".join(sequence[index:index + length]))
            for route in row_routes:
                group = groups.setdefault(route, {"count": 0, "positives": 0, "rowIndexes": []})
                group["count"] += 1
                group["positives"] += 1 if row["__target"] == 1 else 0
                group["rowIndexes"].append(row_index)

        for route, group in groups.items():
            if group["count"] < min_group_count:
                continue
            conversion_rate = group["positives"] / group["count"]
            delta = conversion_rate - baseline_rate
            if delta <= 0:
                continue
            candidates.append({"feature": feature, "route": route, "group": group, "conversionRate": conversion_rate, "delta": delta})

    candidates.sort(key=lambda item: item["delta"] * math.sqrt(item["group"]["count"]), reverse=True)
    results = []
    for index, candidate in enumerate(candidates[:max_routes]):
        feature_key = f"seq_route_{index + 1}"
        matched_row_indexes = set(candidate["group"]["rowIndexes"])
        for row_index, row in enumerate(rows):
            row[feature_key] = row_index in matched_row_indexes
        score = clamp_score(65 + candidate["delta"] * 120 * math.sqrt(candidate["group"]["count"] / len(rows)))
        label = f"陦悟虚繝ｫ繝ｼ繝・ {candidate['route']}"
        results.append({
            "feature": {
                "featureKey": feature_key,
                "label": label,
                "category": "derived",
                "aggregation": "none",
                "valueType": "categorical",
                "sourceTableDisplayName": candidate["feature"].get("sourceTableDisplayName"),
                "sourceColumnName": candidate["feature"].get("sourceColumnName"),
            },
            "analysis": {
                "score": score,
                "direction": "positive",
                "pattern": {
                    "matchedCount": candidate["group"]["count"],
                    "conversionRate": candidate["conversionRate"],
                    "supportRate": candidate["group"]["count"] / len(rows),
                    "conversionDelta": candidate["delta"],
                    "lift": candidate["conversionRate"] / baseline_rate if baseline_rate > 0 else None,
                    "condition": {
                        "featureKey": feature_key,
                        "operator": "eq",
                        "value": True,
                        "label": label,
                    },
                },
            },
            "result": {
                "featureKey": feature_key,
                "label": label,
                "category": "derived",
                "importanceScore": score,
                "direction": "positive",
                "aggregation": "none",
                "missingRate": 0,
                "description": (
                    f"{candidate['feature'].get('sourceTableDisplayName')}.{candidate['feature'].get('sourceColumnName')} "
                    f"の時系列から抽出した行動パターンです。成果率は全体平均より {format_point_delta(candidate['delta'])} 高いです。"
                ),
            },
        })
    return results


def build_interaction_pairs(patterns: list[dict[str, Any]], rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if len(patterns) < 2:
        return []
    left, right = patterns[0], patterns[1]
    matched = [
        row for row in rows
        if matches_condition(row, left["conditions"][0]) and matches_condition(row, right["conditions"][0])
    ]
    if not matched:
        return []
    rate = sum(1 for row in matched if row["__target"] == 1) / len(matched)
    return [{
        "leftFeatureKey": left["conditions"][0]["featureKey"],
        "rightFeatureKey": right["conditions"][0]["featureKey"],
        "synergyScore": clamp_score(rate * 100),
        "summary": f"{left['conditions'][0]['label']} と {right['conditions'][0]['label']} を同時に満たす {len(matched):,} 行の成果率は {round(rate * 1000) / 10}% です。",
    }]


def build_golden_patterns(
    top_importances: list[dict[str, Any]],
    rows: list[dict[str, Any]],
    baseline_rate: float,
    min_group_count: int,
    pattern_count: int,
    target_label: str,
) -> list[dict[str, Any]]:
    condition_entries = []
    candidates = []

    for item in top_importances:
        pattern = item["analysis"]["pattern"]
        if pattern["matchedCount"] < min_group_count:
            continue
        condition = pattern["condition"]
        score = item["result"]["importanceScore"]
        condition_entries.append({
            "condition": condition,
            "score": score,
            "featureKey": condition["featureKey"],
        })
        candidates.append({
            "conditions": [condition],
            "matchedCount": pattern["matchedCount"],
            "conversionRate": pattern["conversionRate"],
            "supportRate": pattern["supportRate"],
            "conversionDelta": pattern["conversionDelta"],
            "lift": pattern["lift"],
            "score": score,
        })

    for size in (2, 3):
        for entries in combinations(condition_entries[:10], size):
            feature_keys = [entry["featureKey"] for entry in entries]
            if len(set(feature_keys)) != len(feature_keys):
                continue
            conditions = compact_equivalent_conditions(rows, [entry["condition"] for entry in entries])
            if len(conditions) < 2:
                continue
            matched = [row for row in rows if all(matches_condition(row, condition) for condition in conditions)]
            if len(matched) < min_group_count:
                continue
            conversion_rate = sum(1 for row in matched if row["__target"] == 1) / len(matched)
            delta = conversion_rate - baseline_rate
            if delta <= 0:
                continue
            support_rate = len(matched) / len(rows)
            candidates.append({
                "conditions": conditions,
                "matchedCount": len(matched),
                "conversionRate": conversion_rate,
                "supportRate": support_rate,
                "conversionDelta": delta,
                "lift": conversion_rate / baseline_rate if baseline_rate > 0 else None,
                "score": clamp_score(delta * 130 * math.sqrt(support_rate) + len(conditions) * 8),
            })

    candidates.sort(
        key=lambda item: (
            item["conversionDelta"] > 0,
            abs(item["conversionDelta"]) * math.sqrt(item["matchedCount"]),
            item["score"],
            -len(item["conditions"]),
        ),
        reverse=True,
    )

    patterns = []
    seen = set()
    for candidate in candidates:
        signature = pattern_signature(rows, candidate["conditions"])
        if signature in seen:
            continue
        seen.add(signature)
        title = " 縺九▽ ".join(condition["label"] for condition in candidate["conditions"])
        patterns.append({
            "id": f"pattern-real-{len(patterns) + 1}",
            "title": title,
            "conditions": candidate["conditions"],
            "supportRate": candidate["supportRate"],
            "lift": candidate["lift"],
            "conversionDelta": candidate["conversionDelta"],
            "confidence": min(0.95, max(0.35, candidate["score"] / 100)),
            "matchedCount": candidate["matchedCount"],
            "description": (
                f"{title} の {candidate['matchedCount']:,} 件では、{target_label} の比率が "
                f"{format_rate(candidate['conversionRate'])} でした。全体平均 {format_rate(baseline_rate)} より "
                f"{format_point_delta(abs(candidate['conversionDelta']))} {pattern_direction_text(candidate['conversionDelta'])}条件です。"
            ),
            "recommendedAction": f"{title} を条件にしたセグメントで施策検証してください。",
        })
    return patterns


def segment_candidate_rows(rows: list[dict[str, Any]], pattern: dict[str, Any], objective: str) -> list[dict[str, Any]]:
    matched = [
        row for row in rows
        if all(matches_condition(row, condition) for condition in pattern["conditions"])
    ]
    if objective == "all_matching":
        return matched
    if objective == "success_profile":
        return [row for row in matched if row["__target"] == 1]
    return [row for row in matched if row["__target"] != 1]


def build_audience_rows(candidate_rows: list[dict[str, Any]], pattern: dict[str, Any]) -> list[dict[str, Any]]:
    feature_keys = [condition.get("featureKey") for condition in pattern.get("conditions", []) if condition.get("featureKey")]
    matched_reasons = [condition.get("label") for condition in pattern.get("conditions", []) if condition.get("label")]
    audience_rows = []

    for row in candidate_rows:
        attributes = {
            feature_key: row.get(feature_key)
            for feature_key in feature_keys
            if row.get(feature_key) is not None
        }
        audience_rows.append({
            "customerKey": str(row.get("__unitKey") or row.get("__rowId")),
            "targetValue": row.get("__target"),
            "attributes": attributes,
            "matchedReasons": matched_reasons,
        })

    return audience_rows


