import math
import time
from itertools import combinations
from typing import Any

from .fabric_io import fetch_table_rows
from .features import (
    build_feature_descriptors,
    column_id_map,
    config_blocked_keys,
    label_for_value,
    normalize_identifier,
    time_window_to_millis,
)
from .modeling import choose_autopilot_candidate_model, is_numeric_training_feature
from .patterns import (
    build_audience_rows,
    build_golden_patterns,
    build_interaction_pairs,
    is_sequence_mining_feature,
    matches_condition,
    mine_sequential_route_features,
    segment_candidate_rows,
)
from .utils import clamp_score, is_missing, mean, now_iso, stddev, to_number, to_timestamp


def normalize_bool(value: Any, target_config: dict[str, Any] | None = None) -> int | None:
    target_config = target_config or {}
    if is_missing(value):
        return None
    if target_config.get("positiveValue") is not None:
        if str(value) == str(target_config.get("positiveValue")):
            return 1
        if target_config.get("negativeValue") is not None:
            return 0 if str(value) == str(target_config.get("negativeValue")) else None
        return 0
    if target_config.get("negativeValue") is not None and str(value) == str(target_config.get("negativeValue")):
        return 0
    if isinstance(value, bool):
        return 1 if value else 0
    if isinstance(value, (int, float)):
        return 1 if value != 0 else 0

    normalized = str(value).strip().lower()
    if normalized in {"true", "1", "yes", "y", "won", "success", "converted", "成約", "あり", "謌千ｴ・", "縺ゅｊ"}:
        return 1
    if normalized in {"false", "0", "no", "n", "lost", "failure", "not_converted", "未成約", "なし", "譛ｪ謌千ｴ・", "縺ｪ縺・"}:
        return 0
    return None


def percentile(values: list[float], ratio: float) -> float | None:
    if not values:
        return None
    sorted_values = sorted(values)
    index = min(len(sorted_values) - 1, max(0, math.floor((len(sorted_values) - 1) * ratio)))
    return sorted_values[index]


def mode(values: list[Any]) -> Any:
    counts: dict[str, int] = {}
    first_value_by_key: dict[str, Any] = {}
    for value in values:
        key = str(value)
        counts[key] = counts.get(key, 0) + 1
        first_value_by_key.setdefault(key, value)
    if not counts:
        return None
    key = sorted(counts.items(), key=lambda item: item[1], reverse=True)[0][0]
    return first_value_by_key[key]


def resolve_event_time_columns_by_table(mapping: dict[str, Any], dataset: dict[str, Any]) -> dict[str, dict[str, Any]]:
    columns = column_id_map(dataset)
    by_table: dict[str, dict[str, Any]] = {}
    for mapped_column in mapping.get("columnMappings", []):
        if mapped_column.get("columnRole") != "event_time" or mapped_column.get("tableId") in by_table:
            continue
        item = columns.get(mapped_column.get("columnId"))
        if item:
            by_table[mapped_column["tableId"]] = item["column"]
    return by_table


def resolve_target_event_time_column(
    mapping: dict[str, Any],
    dataset: dict[str, Any],
    target: dict[str, Any],
    target_config: dict[str, Any],
) -> dict[str, Any] | None:
    columns = column_id_map(dataset)
    configured = columns.get(target_config.get("eventTimeColumnId"))
    if configured:
        return configured["column"]
    for mapped_column in mapping.get("columnMappings", []):
        if mapped_column.get("tableId") != target["table"]["id"] or mapped_column.get("columnRole") != "event_time":
            continue
        item = columns.get(mapped_column.get("columnId"))
        if item:
            return item["column"]
    return None


def filter_time_safe_features(
    features: list[dict[str, Any]],
    target_event_time_column: dict[str, Any] | None,
    event_time_columns_by_table: dict[str, dict[str, Any]],
    diagnostics: dict[str, Any],
) -> list[dict[str, Any]]:
    safe_features = []
    for feature in features:
        has_time_window = bool(feature.get("timeWindow"))
        source_has_event_time = feature.get("sourceTableId") in event_time_columns_by_table
        time_sensitive = (
            has_time_window
            or is_sequence_mining_feature(feature, event_time_columns_by_table)
            or feature.get("category") in {"behavior", "transaction", "engagement"}
        )
        if has_time_window and not source_has_event_time:
            diagnostics.setdefault("timeUnsafeFeatureKeys", []).append(feature["featureKey"])
            continue
        if time_sensitive and source_has_event_time and not target_event_time_column:
            diagnostics.setdefault("timeUnsafeFeatureKeys", []).append(feature["featureKey"])
            continue
        safe_features.append(feature)
    return safe_features


def resolve_analysis_unit_key_column(
    mapping: dict[str, Any],
    dataset: dict[str, Any],
    target: dict[str, Any],
) -> dict[str, Any] | None:
    columns = column_id_map(dataset)
    target_table_id = target["table"]["id"]

    for mapped_column in mapping.get("columnMappings", []):
        if mapped_column.get("tableId") == target_table_id and mapped_column.get("columnRole") == "customer_id":
            item = columns.get(mapped_column.get("columnId"))
            if item:
                return item["column"]

    target_table_mapping = next(
        (item for item in mapping.get("tableMappings", []) if item.get("tableId") == target_table_id),
        None,
    )
    if target_table_mapping and target_table_mapping.get("entityRole") == "customer_master":
        for column_id in [target_table_mapping.get("primaryKeyColumnId"), target_table_mapping.get("customerJoinColumnId")]:
            item = columns.get(column_id)
            if item:
                return item["column"]

    customer_tables = [
        item for item in mapping.get("tableMappings", [])
        if item.get("entityRole") == "customer_master" and item.get("tableId")
    ]
    for customer_table in customer_tables:
        direct = edge_between(mapping, target_table_id, customer_table["tableId"])
        if not direct:
            continue
        item = columns.get(direct.get("leftColumnId"))
        if item:
            return item["column"]

    return None


def is_count_like_feature(feature: dict[str, Any]) -> bool:
    return feature.get("aggregation") in {"count", "distinct_count"} or feature.get("derivedKind") == "category_value_count"


def display_number(value: float) -> str:
    if abs(value - round(value)) < 1e-9:
        return f"{int(round(value)):,}"
    return f"{round(value, 4):,}"


def numeric_condition_label(feature: dict[str, Any], operator: str, value: float) -> str:
    label = feature["label"]
    if is_count_like_feature(feature):
        count = max(0, int(round(value)))
        if operator == "gte":
            return f"{label} が{count}回以上"
        if operator == "lte":
            if count <= 0:
                return f"{label} なし"
            return f"{label} が{count}回以下"
    suffix = "以下" if operator == "lte" else "以上"
    return f"{label} が{display_number(value)} {suffix}"


def aggregate_values(values: list[Any], feature: dict[str, Any], target_at: float | None = None) -> Any:
    present = []
    for item in values:
        normalized = item if isinstance(item, dict) and "value" in item else {"value": item}
        if not is_missing(normalized.get("value")):
            present.append(normalized)
    present.sort(key=lambda item: item.get("at") if item.get("at") is not None else 0)
    if not present:
        return None

    aggregation = feature.get("aggregation") or "latest"
    if feature.get("derivedKind") == "recency_days":
        dated_values = [item.get("at") for item in present if item.get("at") is not None]
        if target_at is None or not dated_values:
            return None
        latest_at = max(item for item in dated_values if item <= target_at) if any(item <= target_at for item in dated_values) else None
        return round((target_at - latest_at) / (24 * 60 * 60 * 1000), 2) if latest_at is not None else None

    raw_values = [item.get("value") for item in present]
    numeric_values = [value for value in (to_number(item) for item in raw_values) if value is not None]
    numeric_feature = feature.get("valueType") == "numeric"

    if aggregation == "count":
        return len(present)
    if aggregation == "distinct_count":
        return len({str(value) for value in raw_values})
    if numeric_feature:
        if aggregation == "sum":
            return sum(numeric_values)
        if aggregation == "avg":
            return mean(numeric_values)
        if aggregation == "min":
            return min(numeric_values) if numeric_values else None
        if aggregation == "max":
            return max(numeric_values) if numeric_values else None
        return numeric_values[-1] if numeric_values else None

    return raw_values[-1] if aggregation in {"latest", "none"} else mode(raw_values)


def filter_values_for_target_time(
    values: list[dict[str, Any]],
    feature: dict[str, Any],
    target_at: float | None,
    diagnostics: dict[str, Any],
) -> list[dict[str, Any]]:
    window_ms = time_window_to_millis(feature.get("timeWindow"))
    if not values:
        return []

    filtered = []
    for item in values:
        at = item.get("at")
        if at is not None:
            if target_at is None:
                diagnostics["futureFeatureValueCount"] = diagnostics.get("futureFeatureValueCount", 0) + 1
                continue
            if at > target_at:
                diagnostics["futureFeatureValueCount"] = diagnostics.get("futureFeatureValueCount", 0) + 1
                continue
            if window_ms is not None and at < target_at - window_ms:
                diagnostics["outsideWindowFeatureValueCount"] = diagnostics.get("outsideWindowFeatureValueCount", 0) + 1
                continue
        elif window_ms is not None:
            diagnostics["outsideWindowFeatureValueCount"] = diagnostics.get("outsideWindowFeatureValueCount", 0) + 1
            continue
        filtered.append(item)
    return filtered


def derive_category_value_count_features(
    rows: list[dict[str, Any]],
    features: list[dict[str, Any]],
    diagnostics: dict[str, Any],
    max_levels_per_feature: int = 12,
) -> None:
    existing_keys = {feature["featureKey"] for feature in features}
    generated_count = 0
    templates = [
        feature for feature in features
        if feature.get("derivedKind") == "category_value_counts" and feature.get("template")
    ]

    for template in templates:
        template_key = template["featureKey"]
        level_counts: dict[str, dict[str, Any]] = {}
        for row in rows:
            row_values = (row.get("__featureValues") or {}).get(template_key) or []
            seen_in_row = set()
            for item in row_values:
                value = item.get("value")
                if is_missing(value):
                    continue
                key = str(value)
                entry = level_counts.setdefault(key, {"value": value, "rows": 0, "events": 0})
                entry["events"] += 1
                if key not in seen_in_row:
                    entry["rows"] += 1
                    seen_in_row.add(key)

        ranked_levels = sorted(
            level_counts.values(),
            key=lambda item: (item["rows"], item["events"], str(item["value"])),
            reverse=True,
        )[:max_levels_per_feature]

        for level in ranked_levels:
            value = level["value"]
            label = label_for_value(template, value)
            base_key = generated_feature_key(template_key, "eq", value)
            feature_key = make_unique_feature_key(base_key, existing_keys)
            for row in rows:
                row_values = (row.get("__featureValues") or {}).get(template_key) or []
                row[feature_key] = sum(1 for item in row_values if str(item.get("value")) == str(value))
            features.append({
                **{key: value for key, value in template.items() if key not in {"featureKey", "label", "template"}},
                "featureKey": feature_key,
                "label": f"{template.get('label')}: {label}",
                "valueType": "numeric",
                "aggregation": "count",
                "derivedKind": "category_value_count",
                "categoryValue": value,
                "autopilotGenerated": True,
            })
            generated_count += 1

    if generated_count:
        diagnostics["autoDerivedCategoryFeatureCount"] = diagnostics.get("autoDerivedCategoryFeatureCount", 0) + generated_count


def derive_timed_transition_features(
    rows: list[dict[str, Any]],
    features: list[dict[str, Any]],
    event_time_columns_by_table: dict[str, dict[str, Any]],
    diagnostics: dict[str, Any],
    max_features: int = 40,
) -> None:
    existing_keys = {feature["featureKey"] for feature in features}
    generated_count = 0
    gap_days_options = [1, 3, 7]
    min_support = max(3, math.ceil(len(rows) * 0.02))
    sequence_features = [
        feature for feature in features
        if is_sequence_mining_feature(feature, event_time_columns_by_table) and not feature.get("template")
    ]

    for feature in sequence_features:
        candidates: dict[tuple[str, str, int], set[int]] = {}
        for row_index, row in enumerate(rows):
            events = (row.get("__sequenceEvents") or {}).get(feature["featureKey"]) or []
            events = [event for event in events if event.get("at") is not None and not is_missing(event.get("value"))]
            events.sort(key=lambda item: item["at"])
            for left_index, left in enumerate(events):
                for right in events[left_index + 1:]:
                    gap_ms = right["at"] - left["at"]
                    if gap_ms < 0:
                        continue
                    gap_days = gap_ms / (24 * 60 * 60 * 1000)
                    for max_gap_days in gap_days_options:
                        if gap_days <= max_gap_days:
                            key = (str(left["value"]), str(right["value"]), max_gap_days)
                            candidates.setdefault(key, set()).add(row_index)

        ranked = sorted(candidates.items(), key=lambda item: len(item[1]), reverse=True)
        for (left, right, max_gap_days), matched_indexes in ranked:
            if len(matched_indexes) < min_support or generated_count >= max_features:
                continue
            base_key = generated_feature_key("auto_transition", feature["featureKey"], left, right, f"{max_gap_days}d")
            feature_key = make_unique_feature_key(base_key, existing_keys)
            for row_index, row in enumerate(rows):
                row[feature_key] = row_index in matched_indexes
            label = f"{feature.get('label')} {left} -> {right} within {max_gap_days}d"
            features.append({
                "featureKey": feature_key,
                "label": label,
                "sourceTableId": feature.get("sourceTableId"),
                "sourceTableName": feature.get("sourceTableName"),
                "sourceTableDisplayName": feature.get("sourceTableDisplayName"),
                "sourceColumnName": feature.get("sourceColumnName"),
                "dataType": "boolean",
                "valueType": "categorical",
                "category": "derived",
                "aggregation": "none",
                "derivedKind": "timed_transition",
                "autopilotGenerated": True,
                "plan": {"kind": "derived"},
            })
            generated_count += 1
        if generated_count >= max_features:
            break

    if generated_count:
        diagnostics["autoDerivedTransitionFeatureCount"] = diagnostics.get("autoDerivedTransitionFeatureCount", 0) + generated_count


def same_numeric_measure(left: dict[str, Any], right: dict[str, Any]) -> bool:
    left_source = normalize_identifier(left.get("sourceColumnName"))
    right_source = normalize_identifier(right.get("sourceColumnName"))
    if not left_source or left_source != right_source:
        return False
    return left.get("sourceTableId") == right.get("sourceTableId")


def derive_numeric_combination_features(
    rows: list[dict[str, Any]],
    features: list[dict[str, Any]],
    diagnostics: dict[str, Any],
    max_base_features: int = 10,
    max_generated_features: int = 18,
) -> None:
    existing_keys = {feature["featureKey"] for feature in features}
    min_present = max(3, math.ceil(len(rows) * 0.2))
    numeric_features = []
    for feature in features:
        if feature.get("template") or not is_numeric_training_feature(feature):
            continue
        values = [to_number(row.get(feature["featureKey"])) for row in rows]
        present = [value for value in values if value is not None]
        if len(present) >= min_present and stddev(present) > 0:
            numeric_features.append(feature)

    numeric_features = numeric_features[:max_base_features]
    generated_count = 0
    for left, right in combinations(numeric_features, 2):
        if generated_count >= max_generated_features:
            break
        left_category = left.get("category")
        right_category = right.get("category")
        if left_category == "profile" and right_category == "profile":
            continue
        left_key = left["featureKey"]
        right_key = right["featureKey"]
        for kind in ["ratio", "product"]:
            if generated_count >= max_generated_features:
                break
            if kind == "product":
                continue
            if kind == "ratio" and not same_numeric_measure(left, right):
                continue
            left_kind = left.get("derivedKind")
            right_kind = right.get("derivedKind")
            left_aggregation = left.get("aggregation")
            right_aggregation = right.get("aggregation")
            if (
                kind == "product"
                and (
                    "recency_days" in {left_kind, right_kind}
                    or {left_aggregation, right_aggregation} & {"count", "distinct_count"}
                )
            ):
                continue
            base_key = generated_feature_key("auto_combo", left_key, right_key, kind)
            feature_key = make_unique_feature_key(base_key, existing_keys)
            present_values = []
            for row in rows:
                left_value = to_number(row.get(left_key))
                right_value = to_number(row.get(right_key))
                value = None
                if left_value is not None and right_value is not None:
                    if kind == "ratio":
                        value = left_value / right_value if abs(right_value) > 1e-9 else None
                    else:
                        value = left_value * right_value
                row[feature_key] = value
                if value is not None and math.isfinite(value):
                    present_values.append(value)
            if len(present_values) < min_present or stddev(present_values) == 0:
                for row in rows:
                    row.pop(feature_key, None)
                existing_keys.discard(feature_key)
                continue
            operator_label = "豈皮紫" if kind == "ratio" else "x"
            features.append({
                "featureKey": feature_key,
                "label": f"{left.get('label')} / {right.get('label')} {operator_label}",
                "sourceTableDisplayName": left.get("sourceTableDisplayName") or right.get("sourceTableDisplayName"),
                "sourceColumnName": f"{left.get('sourceColumnName')}:{right.get('sourceColumnName')}",
                "dataType": "float",
                "valueType": "numeric",
                "category": "derived",
                "aggregation": kind,
                "derivedKind": f"numeric_{kind}",
                "autopilotGenerated": True,
                "plan": {"kind": "derived"},
            })
            generated_count += 1

    if generated_count:
        diagnostics["autoDerivedNumericComboFeatureCount"] = diagnostics.get("autoDerivedNumericComboFeatureCount", 0) + generated_count


def materialize_analysis_rows(
    connection: dict[str, Any],
    auth: dict[str, Any],
    dataset: dict[str, Any],
    target: dict[str, Any],
    target_config: dict[str, Any],
    features: list[dict[str, Any]],
    event_time_columns_by_table: dict[str, dict[str, Any]],
    analysis_unit_key_column: dict[str, Any] | None = None,
    target_event_time_column: dict[str, Any] | None = None,
    diagnostics: dict[str, Any] | None = None,
    enable_derived_feature_expansion: bool = True,
) -> dict[str, Any]:
    diagnostics = diagnostics if diagnostics is not None else {}
    columns = column_id_map(dataset)
    target_key_column_ids = [feature["plan"].get("targetKeyColumnId") for feature in features if feature["plan"].get("targetKeyColumnId")]
    same_table_columns = [feature["sourceColumnName"] for feature in features if feature["plan"]["kind"] == "same"]
    target_key_columns = [columns[column_id]["column"]["name"] for column_id in target_key_column_ids if column_id in columns]
    analysis_unit_key_name = (analysis_unit_key_column or {}).get("name")
    target_event_time_name = (target_event_time_column or {}).get("name")
    target_fetch_columns = [target["column"]["name"], analysis_unit_key_name, target_event_time_name, *target_key_columns, *same_table_columns]
    target_response = fetch_table_rows(connection, auth, target["table"]["name"], target_fetch_columns)

    rows = []
    for index, raw in enumerate(target_response["rows"]):
        target_value = normalize_bool(raw.get(target["column"]["name"]), target_config)
        if target_value is None:
            continue
        unit_key = raw.get(analysis_unit_key_name) if analysis_unit_key_name else None
        target_at = to_timestamp(raw.get(target_event_time_name)) if target_event_time_name else None
        rows.append({
            "__rowId": index,
            "__unitKey": str(unit_key) if not is_missing(unit_key) else f"row-{index}",
            "__target": target_value,
            "__targetAt": target_at,
            "__sequences": {},
            "__sequenceEvents": {},
            "__featureValues": {},
            "__raw": raw,
        })
    row_by_id = {row["__rowId"]: row for row in rows}

    for feature in [item for item in features if item["plan"]["kind"] == "same"]:
        for row in rows:
            row[feature["featureKey"]] = row["__raw"].get(feature["sourceColumnName"])

    for feature in [item for item in features if item["plan"]["kind"] == "join"]:
        target_key_name = columns.get(feature["plan"].get("targetKeyColumnId"), {}).get("column", {}).get("name")
        feature_key_name = columns.get(feature["plan"].get("featureKeyColumnId"), {}).get("column", {}).get("name")
        if not target_key_name or not feature_key_name:
            continue

        target_rows_by_key: dict[str, list[int]] = {}
        for row in rows:
            key = row["__raw"].get(target_key_name)
            if is_missing(key):
                continue
            target_rows_by_key.setdefault(str(key), []).append(row["__rowId"])
        if not target_rows_by_key:
            continue

        event_time_column_name = (event_time_columns_by_table.get(feature["sourceTableId"]) or {}).get("name")
        feature_response = fetch_table_rows(
            connection,
            auth,
            feature["sourceTableName"],
            [feature_key_name, feature["sourceColumnName"], event_time_column_name],
        )
        feature_values_by_key: dict[str, list[dict[str, Any]]] = {}
        for feature_row in feature_response["rows"]:
            key = feature_row.get(feature_key_name)
            if is_missing(key):
                continue
            feature_values_by_key.setdefault(str(key), []).append({
                "value": feature_row.get(feature["sourceColumnName"]),
                "at": to_timestamp(feature_row.get(event_time_column_name)) if event_time_column_name else None,
            })

        for key, row_ids in target_rows_by_key.items():
            values = feature_values_by_key.get(key, [])
            for row_id in row_ids:
                row = row_by_id.get(row_id)
                if row:
                    row_values = filter_values_for_target_time(values, feature, row.get("__targetAt"), diagnostics)
                    row["__featureValues"][feature["featureKey"]] = row_values
                    ordered_values = [
                        label_for_value(feature, item["value"])
                        for item in sorted(row_values, key=lambda item: item.get("at") if item.get("at") is not None else 0)
                        if not is_missing(item.get("value"))
                    ]
                    aggregated = aggregate_values(row_values, feature, row.get("__targetAt"))
                    row[feature["featureKey"]] = aggregated
                    if is_sequence_mining_feature(feature, event_time_columns_by_table):
                        row["__sequences"][feature["featureKey"]] = ordered_values
                        row["__sequenceEvents"][feature["featureKey"]] = [
                            {"value": label_for_value(feature, item["value"]), "at": item.get("at")}
                            for item in sorted(row_values, key=lambda item: item.get("at") if item.get("at") is not None else 0)
                            if not is_missing(item.get("value"))
                        ]

    if enable_derived_feature_expansion:
        derive_category_value_count_features(rows, features, diagnostics)
        derive_timed_transition_features(rows, features, event_time_columns_by_table, diagnostics)
        derive_numeric_combination_features(rows, features, diagnostics)

    for row in rows:
        row.pop("__raw", None)
        row.pop("__featureValues", None)
        row.pop("__sequenceEvents", None)

    return {"rows": rows, "truncated": target_response["truncated"]}


def collapse_rows_to_analysis_unit(rows: list[dict[str, Any]], features: list[dict[str, Any]]) -> list[dict[str, Any]]:
    groups: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        groups.setdefault(str(row.get("__unitKey") or row.get("__rowId")), []).append(row)

    if len(groups) == len(rows):
        return rows

    collapsed: list[dict[str, Any]] = []
    for index, (unit_key, group_rows) in enumerate(groups.items()):
        positive_times = [row.get("__targetAt") for row in group_rows if row["__target"] == 1 and row.get("__targetAt") is not None]
        all_times = [row.get("__targetAt") for row in group_rows if row.get("__targetAt") is not None]
        cutoff_at = min(positive_times) if positive_times else max(all_times) if all_times else None
        eligible_rows = [
            item for item in group_rows
            if cutoff_at is None or item.get("__targetAt") is None or item.get("__targetAt") <= cutoff_at
        ]
        row: dict[str, Any] = {
            "__rowId": index,
            "__unitKey": unit_key,
            "__target": 1 if any(item["__target"] == 1 for item in group_rows) else 0,
            "__targetAt": cutoff_at,
            "__sequences": {},
        }
        for feature in features:
            feature_key = feature["featureKey"]
            raw_values = [
                {"value": item.get(feature_key), "at": item.get("__targetAt")}
                for item in eligible_rows
                if not is_missing(item.get(feature_key))
            ]
            if raw_values:
                distinct_values = {str(item["value"]) for item in raw_values}
                row[feature_key] = raw_values[0]["value"] if len(distinct_values) == 1 else aggregate_values(raw_values, feature, cutoff_at)

            sequences = [
                (item.get("__sequences") or {}).get(feature_key) or []
                for item in eligible_rows
            ]
            longest_sequence = max(sequences, key=len, default=[])
            if longest_sequence:
                row["__sequences"][feature_key] = longest_sequence
        collapsed.append(row)
    return collapsed


def analyze_numeric_feature(rows: list[dict[str, Any]], feature: dict[str, Any], baseline_rate: float, min_group_count: int) -> dict[str, Any] | None:
    pairs = [
        {"value": number, "target": row["__target"]}
        for row in rows
        for number in [to_number(row.get(feature["featureKey"]))]
        if number is not None
    ]
    if len(pairs) < min_group_count * 2:
        return None
    positives = [item["value"] for item in pairs if item["target"] == 1]
    negatives = [item["value"] for item in pairs if item["target"] == 0]
    if len(positives) < min_group_count or len(negatives) < min_group_count:
        return None

    values = [item["value"] for item in pairs]
    effect = (mean(positives) - mean(negatives)) / (stddev(values) or 1)
    direction = "neutral" if abs(effect) < 0.05 else "positive" if effect > 0 else "negative"
    threshold = percentile(values, 0.25 if direction == "negative" else 0.75)
    if threshold is None:
        return None
    if is_count_like_feature(feature):
        threshold = math.floor(threshold) if direction == "negative" else math.ceil(threshold)
        if direction == "positive":
            threshold = max(1, threshold)
        else:
            threshold = max(0, threshold)

    matched = [item for item in pairs if item["value"] <= threshold] if direction == "negative" else [item for item in pairs if item["value"] >= threshold]
    if len(matched) < min_group_count:
        return None
    matched_rate = sum(1 for item in matched if item["target"] == 1) / len(matched) if matched else 0
    delta = matched_rate - baseline_rate
    value = round(threshold, 4)
    operator = "lte" if direction == "negative" else "gte"

    return {
        "score": clamp_score(abs(effect) * 45 + abs(delta) * 100),
        "direction": direction,
        "pattern": {
            "matchedCount": len(matched),
            "conversionRate": matched_rate,
            "supportRate": len(matched) / len(rows),
            "conversionDelta": delta,
            "lift": matched_rate / baseline_rate if baseline_rate > 0 else None,
            "condition": {
                "featureKey": feature["featureKey"],
                "operator": operator,
                "value": value,
                "label": numeric_condition_label(feature, operator, value),
            },
        },
    }


def analyze_categorical_feature(rows: list[dict[str, Any]], feature: dict[str, Any], baseline_rate: float, min_group_count: int) -> dict[str, Any] | None:
    groups: dict[str, dict[str, int]] = {}
    for row in rows:
        raw = row.get(feature["featureKey"])
        if is_missing(raw):
            continue
        key = str(raw)
        group = groups.setdefault(key, {"count": 0, "positives": 0})
        group["count"] += 1
        group["positives"] += 1 if row["__target"] == 1 else 0

    best = None
    for value, group in groups.items():
        if group["count"] < min_group_count:
            continue
        conversion_rate = group["positives"] / group["count"]
        delta = conversion_rate - baseline_rate
        candidate = {"value": value, "count": group["count"], "conversionRate": conversion_rate, "delta": delta}
        if best is None or abs(candidate["delta"]) > abs(best["delta"]):
            best = candidate
    if not best:
        return None

    direction = "neutral" if abs(best["delta"]) < 0.01 else "positive" if best["delta"] > 0 else "negative"
    return {
        "score": clamp_score(abs(best["delta"]) * 120 * math.sqrt(best["count"] / len(rows))),
        "direction": direction,
        "pattern": {
            "matchedCount": best["count"],
            "conversionRate": best["conversionRate"],
            "supportRate": best["count"] / len(rows),
            "conversionDelta": best["delta"],
            "lift": best["conversionRate"] / baseline_rate if baseline_rate > 0 else None,
            "condition": {
                "featureKey": feature["featureKey"],
                "operator": "eq",
                "value": best["value"],
                "label": f"{feature['label']} 縺・{label_for_value(feature, best['value'])}",
            },
        },
    }


def build_analysis_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    analysis_rows = []

    for row in rows:
        values = {
            key: value
            for key, value in row.items()
            if not key.startswith("__") and value is not None
        }
        analysis_rows.append({
            "rowId": row.get("__rowId"),
            "customerKey": str(row.get("__unitKey") or row.get("__rowId")),
            "targetValue": row.get("__target"),
            "values": values,
        })

    return analysis_rows


def failed_result(
    analysis_job_id: str,
    run_id: str,
    mapping: dict[str, Any],
    dataset: dict[str, Any],
    config: dict[str, Any] | None,
    message: str,
) -> dict[str, Any]:
    timestamp = now_iso()
    return {
        "id": analysis_job_id,
        "analysisJobId": analysis_job_id,
        "runId": run_id,
        "datasetId": dataset.get("id"),
        "mappingDocumentId": mapping.get("id"),
        "mode": (config or {}).get("mode", "custom"),
        "status": "failed",
        "progressPercent": 100,
        "message": message,
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


def build_analysis_summary(mapping: dict[str, Any], dataset: dict[str, Any]) -> dict[str, Any]:
    columns = column_id_map(dataset)
    target_mapping = next(
        (column for column in mapping.get("columnMappings", []) if column.get("columnRole") == "target" or column.get("targetConfig")),
        None,
    )
    target_item = columns.get(target_mapping.get("columnId")) if target_mapping else None
    target_config = (target_mapping or {}).get("targetConfig") or {}
    return {
        "target": {
            "label": target_config.get("label")
            or (target_mapping or {}).get("businessName")
            or (target_item or {}).get("column", {}).get("displayName")
            or "target"
        }
    }


def build_real_analysis_result(payload: dict[str, Any]) -> dict[str, Any]:
    analysis_job_id = payload["analysisJobId"]
    run_id = payload["runId"]
    connection = payload["connection"]
    auth = payload.get("auth") or {}
    mapping = payload["mapping"]
    dataset = payload["dataset"]
    config = payload.get("config") or {}
    summary = build_analysis_summary(mapping, dataset)
    columns = column_id_map(dataset)

    target_mapping = next(
        (column for column in mapping.get("columnMappings", []) if column.get("columnRole") == "target" or column.get("targetConfig")),
        None,
    )
    target = columns.get(target_mapping.get("columnId")) if target_mapping else None
    if not target:
        return failed_result(analysis_job_id, run_id, mapping, dataset, config, "目的変数カラムが見つからないため、実データ分析を開始できませんでした。")

    target_config = dict(target_mapping.get("targetConfig") or {})
    if config.get("mode") == "custom" and str(config.get("targetPositiveValue") or "").strip():
        target_config["positiveValue"] = str(config["targetPositiveValue"]).strip()

    diagnostics: dict[str, Any] = {}
    target = {"table": target["table"], "column": target["column"]}
    features = build_feature_descriptors(mapping, dataset, target, target_config, config, diagnostics)
    event_time_columns_by_table = resolve_event_time_columns_by_table(mapping, dataset)
    target_event_time_column = resolve_target_event_time_column(mapping, dataset, target, target_config)
    diagnostics["targetEventTimeColumn"] = (target_event_time_column or {}).get("name")
    features = filter_time_safe_features(features, target_event_time_column, event_time_columns_by_table, diagnostics)
    if not features:
        return failed_result(analysis_job_id, run_id, mapping, dataset, config, "分析可能な特徴量がありません。目的変数テーブルと同じテーブル、または join 定義で接続できる特徴量を選択してください。")

    analysis_unit = config.get("analysisUnit") or "customer"
    analysis_unit_key_column = resolve_analysis_unit_key_column(mapping, dataset, target) if analysis_unit == "customer" else None
    materialized = materialize_analysis_rows(
        connection,
        auth,
        dataset,
        target,
        target_config,
        features,
        event_time_columns_by_table,
        analysis_unit_key_column,
        target_event_time_column,
        diagnostics,
        config.get("mode") == "autopilot" and config.get("allowGeneratedFeatures", True),
    )
    rows = materialized["rows"]
    features = [feature for feature in features if not feature.get("template")]
    truncated = materialized["truncated"]
    source_row_count = len(rows)
    if analysis_unit == "customer" and analysis_unit_key_column:
        rows = collapse_rows_to_analysis_unit(rows, features)
    if not rows:
        return failed_result(analysis_job_id, run_id, mapping, dataset, config, "目的変数を二値として判定できる行がありませんでした。目的変数の役割または正例・負例の値を確認してください。")

    positive_count = sum(1 for row in rows if row["__target"] == 1)
    baseline_rate = positive_count / len(rows)
    min_group_count = max(3, math.ceil(len(rows) * 0.02))
    importances = []
    random_seed = int(config.get("randomSeed") or 42)
    model_candidate_features = [feature for feature in features if not is_sequence_mining_feature(feature, event_time_columns_by_table)]
    selected_model_features, model_training, autopilot_candidates = choose_autopilot_candidate_model(
        rows,
        model_candidate_features,
        config,
        random_seed,
    )
    if config.get("mode") == "autopilot":
        features = selected_model_features
    diagnostics["autopilotCandidateModels"] = autopilot_candidates
    model_scores = model_training.get("modelFeatureImportances") or model_training.get("featureImportances", {})
    permutation_scores = model_training.get("permutationFeatureImportances") or {}
    hybrid_scores = model_training.get("hybridFeatureImportances") or model_training.get("featureImportances", {})
    importance_method = config.get("importanceMethod") or "hybrid"

    for feature in features:
        if is_sequence_mining_feature(feature, event_time_columns_by_table):
            continue
        missing_count = sum(1 for row in rows if is_missing(row.get(feature["featureKey"])))
        numeric_feature = feature.get("valueType") == "numeric" or feature.get("aggregation") in {"sum", "avg", "count", "distinct_count", "min", "max"}
        analysis = analyze_numeric_feature(rows, feature, baseline_rate, min_group_count) if numeric_feature else analyze_categorical_feature(rows, feature, baseline_rate, min_group_count)
        if not analysis:
            continue
        statistical_score = analysis["score"]
        model_score = model_scores.get(feature["featureKey"])
        permutation_score = permutation_scores.get(feature["featureKey"])
        hybrid_score = hybrid_scores.get(feature["featureKey"])
        if model_score is not None and importance_method == "model_based":
            importance_score = clamp_score(model_score)
        elif permutation_score is not None and importance_method == "permutation":
            importance_score = clamp_score(permutation_score)
        elif hybrid_score is not None and importance_method == "hybrid":
            importance_score = clamp_score(hybrid_score)
        else:
            importance_score = statistical_score
        analysis["score"] = importance_score
        importances.append({
            "feature": feature,
            "analysis": analysis,
            "result": {
                "featureKey": feature["featureKey"],
                "label": feature["label"],
                "category": feature["category"],
                "importanceScore": importance_score,
                "direction": analysis["direction"],
                "aggregation": feature.get("aggregation"),
                "missingRate": missing_count / len(rows),
                "description": f"{feature.get('sourceTableDisplayName')}.{feature.get('sourceColumnName')} を実データ {len(rows):,} 行で集計し、目的変数 {target['column'].get('displayName')} との差を評価しました。",
            },
        })

    importances.extend(mine_sequential_route_features(
        rows,
        features,
        baseline_rate,
        min_group_count,
        event_time_columns_by_table,
        min(5, config.get("patternCount") or 5),
    ))
    importances.sort(key=lambda item: item["result"]["importanceScore"], reverse=True)
    top_importances = importances[: config.get("maxFeatureCount") or 20]
    patterns = build_golden_patterns(
        top_importances,
        rows,
        baseline_rate,
        min_group_count,
        config.get("patternCount") or 5,
        summary["target"]["label"],
    )

    segments = []
    segment_objective = config.get("segmentObjective") or "unconverted_targeting"
    for index, pattern in enumerate([item for item in patterns if (item.get("conversionDelta") or 0) > 0]):
        candidate_rows = segment_candidate_rows(rows, pattern, segment_objective)
        segment = {
            "id": f"segment-real-{index + 1}",
            "name": f"{pattern['title']} 未成果候補",
            "description": "指定条件に一致し、分析データで高い傾向が見られる候補です。初期設定では未成果の対象だけを施策候補にします。",
            "sourcePatternId": pattern["id"],
            "estimatedAudienceSize": len(candidate_rows),
            "estimatedConversionRate": baseline_rate + (pattern.get("conversionDelta") or 0),
            "conditions": pattern["conditions"],
            "useCase": "未成果候補リスト化",
            "priorityScore": clamp_score((pattern.get("conversionDelta") or 0) * 100 + (len(candidate_rows) / len(rows)) * 40 + 50),
            "audienceRows": build_audience_rows(candidate_rows, pattern),
        }
        if segment["estimatedAudienceSize"] > 0:
            segments.append(segment)

    timestamp = now_iso()
    best_delta = patterns[0].get("conversionDelta") if patterns else None
    return {
        "id": analysis_job_id,
        "analysisJobId": analysis_job_id,
        "runId": run_id,
        "datasetId": dataset["id"],
        "mappingDocumentId": mapping["id"],
        "mode": config.get("mode", "custom"),
        "status": "completed",
        "progressPercent": 100,
        "message": f"Fabric 実データ {len(rows):,} 行を集計して Python worker で分析しました。{'上限行数までの集計です。' if truncated else ''}",
        "createdAt": timestamp,
        "startedAt": timestamp,
        "completedAt": timestamp,
        "summary": {
            "analyzedRowCount": len(rows),
            "topFeatureCount": len(top_importances),
            "validPatternCount": len(patterns),
            "recommendedSegmentCount": len(segments),
            "baselineMetricValue": baseline_rate,
            "improvedMetricValue": baseline_rate + best_delta if best_delta is not None else None,
            "improvementRate": ((baseline_rate + best_delta) / baseline_rate - 1) if best_delta is not None and baseline_rate > 0 else None,
        },
        "featureImportances": [item["result"] for item in top_importances],
        "interactionPairs": build_interaction_pairs(patterns, rows),
        "goldenPatterns": patterns,
        "segmentRecommendations": segments,
        "analysisRows": build_analysis_rows(rows),
        "modelMetadata": {
            **{
                key: value
                for key, value in model_training.items()
                if key not in {
                    "featureImportances",
                    "modelFeatureImportances",
                    "permutationFeatureImportances",
                    "hybridFeatureImportances",
                }
            },
            "analysisUnit": analysis_unit,
            "analysisUnitKeyColumn": (analysis_unit_key_column or {}).get("name"),
            "sourceRowCount": source_row_count,
            "blockedFeatureCount": len(config_blocked_keys(config)),
            "autoBlockedFeatureCount": len(diagnostics.get("autoBlockedFeatureKeys", [])),
            "timeUnsafeFeatureCount": len(diagnostics.get("timeUnsafeFeatureKeys", [])),
            "futureFeatureValueCount": diagnostics.get("futureFeatureValueCount", 0),
            "outsideWindowFeatureValueCount": diagnostics.get("outsideWindowFeatureValueCount", 0),
            "targetEventTimeColumn": diagnostics.get("targetEventTimeColumn"),
            "segmentObjective": segment_objective,
            "randomSeed": random_seed,
            "importanceMethod": importance_method,
            "autopilotGeneratedFeatureCount": diagnostics.get("autopilotGeneratedFeatureCount"),
            "autoDerivedCategoryFeatureCount": diagnostics.get("autoDerivedCategoryFeatureCount", 0),
            "autoDerivedTransitionFeatureCount": diagnostics.get("autoDerivedTransitionFeatureCount", 0),
            "autoDerivedNumericComboFeatureCount": diagnostics.get("autoDerivedNumericComboFeatureCount", 0),
            "autopilotCandidateModels": diagnostics.get("autopilotCandidateModels"),
            "autopilotSelectedStrategy": (max(autopilot_candidates, key=lambda item: item.get("score", 0)).get("strategy") if autopilot_candidates else None),
        },
    }


def build_customer_list_result(payload: dict[str, Any]) -> dict[str, Any]:
    connection = payload["connection"]
    auth = payload.get("auth") or {}
    mapping = payload["mapping"]
    dataset = payload["dataset"]
    config = payload.get("config") or {}
    segments = payload.get("segments") or []
    columns = column_id_map(dataset)

    target_mapping = next(
        (column for column in mapping.get("columnMappings", []) if column.get("columnRole") == "target" or column.get("targetConfig")),
        None,
    )
    target = columns.get(target_mapping.get("columnId")) if target_mapping else None
    if not target:
        return {"segments": []}

    target_config = dict(target_mapping.get("targetConfig") or {})
    if config.get("mode") == "custom" and str(config.get("targetPositiveValue") or "").strip():
        target_config["positiveValue"] = str(config["targetPositiveValue"]).strip()

    diagnostics: dict[str, Any] = {}
    target = {"table": target["table"], "column": target["column"]}
    features = build_feature_descriptors(mapping, dataset, target, target_config, config, diagnostics)
    event_time_columns_by_table = resolve_event_time_columns_by_table(mapping, dataset)
    target_event_time_column = resolve_target_event_time_column(mapping, dataset, target, target_config)
    features = filter_time_safe_features(features, target_event_time_column, event_time_columns_by_table, diagnostics)
    analysis_unit = config.get("analysisUnit") or "customer"
    analysis_unit_key_column = resolve_analysis_unit_key_column(mapping, dataset, target) if analysis_unit == "customer" else None
    materialized = materialize_analysis_rows(
        connection,
        auth,
        dataset,
        target,
        target_config,
        features,
        event_time_columns_by_table,
        analysis_unit_key_column,
        target_event_time_column,
        diagnostics,
        config.get("mode") == "autopilot" and config.get("allowGeneratedFeatures", True),
    )
    rows = materialized["rows"]
    features = [feature for feature in features if not feature.get("template")]
    if analysis_unit == "customer" and analysis_unit_key_column:
        rows = collapse_rows_to_analysis_unit(rows, features)

    hydrated_segments = []
    for segment in segments:
        conditions = segment.get("conditions") or []
        matched = [
            row for row in rows
            if all(matches_condition(row, condition) for condition in conditions)
        ]
        hydrated_segments.append({
            **segment,
            "estimatedAudienceSize": len(matched),
            "audienceRows": build_audience_rows(matched, {"conditions": conditions}),
        })

    return {
        "segments": hydrated_segments,
        "analysisRows": build_analysis_rows(rows),
    }
