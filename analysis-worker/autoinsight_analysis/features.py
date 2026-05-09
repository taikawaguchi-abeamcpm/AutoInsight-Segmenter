from typing import Any

from .modeling import is_numeric_training_feature
from .utils import is_missing, to_number

def column_id_map(dataset: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {
        column["id"]: {"table": table, "column": column}
        for table in dataset.get("tables", [])
        for column in table.get("columns", [])
    }


def edge_between(mapping: dict[str, Any], left_table_id: str, right_table_id: str) -> dict[str, Any] | None:
    for join in mapping.get("joinDefinitions", []):
        forward = join.get("fromTableId") == left_table_id and join.get("toTableId") == right_table_id
        reverse = join.get("fromTableId") == right_table_id and join.get("toTableId") == left_table_id
        if not (forward or reverse):
            continue
        if len(join.get("fromColumnIds", [])) != 1 or len(join.get("toColumnIds", [])) != 1:
            return None
        if forward:
            return {"leftColumnId": join["fromColumnIds"][0], "rightColumnId": join["toColumnIds"][0], "join": join}
        return {"leftColumnId": join["toColumnIds"][0], "rightColumnId": join["fromColumnIds"][0], "join": join}
    return None


def find_feature_plan(mapping: dict[str, Any], dataset: dict[str, Any], target_table_id: str, feature_table_id: str) -> dict[str, Any] | None:
    if target_table_id == feature_table_id:
        return {"kind": "same"}

    direct = edge_between(mapping, target_table_id, feature_table_id)
    if direct:
        return {
            "kind": "join",
            "targetKeyColumnId": direct["leftColumnId"],
            "featureKeyColumnId": direct["rightColumnId"],
        }

    for hub in dataset.get("tables", []):
        if hub.get("id") in {target_table_id, feature_table_id}:
            continue
        target_to_hub = edge_between(mapping, target_table_id, hub["id"])
        feature_to_hub = edge_between(mapping, feature_table_id, hub["id"])
        if target_to_hub and feature_to_hub:
            return {
                "kind": "join",
                "targetKeyColumnId": target_to_hub["leftColumnId"],
                "featureKeyColumnId": feature_to_hub["leftColumnId"],
                "hubTableId": hub["id"],
            }
    return None


def category_for_table(table_name: str = "") -> str:
    name = table_name.lower()
    transaction_terms = ("order", "purchase", "transaction", "sales", "invoice", "contract", "deal", "opportunity")
    behavior_terms = ("event", "log", "click", "web", "visit", "activity", "engagement", "appointment", "task", "call", "meeting", "interaction")
    if any(term in name for term in transaction_terms):
        return "transaction"
    if any(term in name for term in behavior_terms):
        return "behavior"
    return "profile"


def category_for_entity_role(role: str | None, table_name: str) -> str:
    if role == "transaction_fact":
        return "transaction"
    if role == "event_log":
        return "behavior"
    return category_for_table(table_name)


def label_for_value(feature: dict[str, Any], value: Any) -> str:
    return str((feature.get("valueLabels") or {}).get(str(value), value))


def is_placeholder_label(value: Any, column: dict[str, Any]) -> bool:
    normalized = normalize_identifier(value)
    if not normalized:
        return True
    column_tokens = {
        normalize_identifier(column.get("id")),
        normalize_identifier(column.get("name")),
        normalize_identifier(column.get("displayName")),
    }
    return normalized in column_tokens or normalized.startswith("col")


def column_label(mapped_column: dict[str, Any], column: dict[str, Any]) -> str:
    feature_config = mapped_column.get("featureConfig") or {}
    for candidate in [
        mapped_column.get("businessName"),
        feature_config.get("label"),
        column.get("displayName"),
        column.get("name"),
        column.get("id"),
    ]:
        if candidate and not is_placeholder_label(candidate, column):
            return str(candidate).replace("_", " ").strip()
    fallback = str(column.get("displayName") or column.get("name") or column.get("id") or "feature")
    return fallback.replace("_", " ").strip()


def feature_label(
    base_label: str,
    aggregation: str | None,
    window: dict[str, Any] | None = None,
    derived_kind: str | None = None,
    category: str | None = None,
) -> str:
    window_text = time_window_label(window)
    if derived_kind == "recency_days":
        return f"{base_label}縺九ｉ縺ｮ邨碁℃譌･謨ｰ{window_text}"
    if derived_kind == "category_value_counts":
        return f"{base_label}蛻･蝗樊焚{window_text}"
    aggregation_labels = {
        "count": "回数",
        "distinct_count": "種類数",
        "sum": "合計",
        "avg": "平均",
        "min": "最小",
        "max": "最大",
    }
    if aggregation == "latest" and category in {"behavior", "transaction", "engagement"}:
        return f"逶ｴ霑代・{base_label}{window_text}"
    if aggregation in {None, "none", "latest"}:
        return f"{base_label}{window_text}"
    return f"{base_label} {aggregation_labels.get(str(aggregation), str(aggregation))}{window_text}"


def config_blocked_keys(config: dict[str, Any] | None) -> set[str]:
    if not config:
        return set()
    return {str(item) for item in config.get("blockedColumnKeys", []) if item is not None}


def normalize_identifier(value: Any) -> str:
    return "".join(char for char in str(value or "").strip().lower() if char.isalnum())


def time_window_to_millis(window: dict[str, Any] | None) -> float | None:
    if not window:
        return None
    value = to_number(window.get("value"))
    if value is None or value <= 0:
        return None
    unit = str(window.get("unit") or "day").lower()
    days = value * 7 if unit == "week" else value * 30 if unit == "month" else value
    return days * 24 * 60 * 60 * 1000


def time_window_label(window: dict[str, Any] | None) -> str:
    if not window:
        return ""
    value = window.get("value")
    unit = str(window.get("unit") or "day").lower()
    unit_label = "日" if unit == "day" else "週" if unit == "week" else "か月"
    return f" 直近{value}{unit_label}"


def is_leakage_like_feature(
    mapped_column: dict[str, Any],
    feature_config: dict[str, Any],
    item: dict[str, Any],
    target: dict[str, Any],
    target_config: dict[str, Any],
) -> bool:
    if mapped_column.get("columnId") == target["column"].get("id"):
        return True

    target_terms = [
        target["column"].get("name"),
        target["column"].get("displayName"),
        target_config.get("targetKey"),
        target_config.get("label"),
    ]
    target_tokens = {normalize_identifier(term) for term in target_terms if normalize_identifier(term)}
    feature_terms = [
        item["column"].get("name"),
        item["column"].get("displayName"),
        mapped_column.get("businessName"),
        feature_config.get("featureKey"),
        feature_config.get("label"),
    ]
    feature_tokens = {normalize_identifier(term) for term in feature_terms if normalize_identifier(term)}

    for token in feature_tokens:
        if token in target_tokens:
            return True
        if any(len(target_token) >= 4 and target_token in token for target_token in target_tokens):
            return True

    text = " ".join(str(term or "").lower() for term in feature_terms)
    post_outcome_terms = (
        "converted", "conversion", "outcome", "result", "won", "lost", "closed",
        "contract_date", "close_date", "cancelled", "canceled", "churned",
        "success", "failure", "sales", "revenue", "amount", "profit", "margin",
        "order_total", "purchase_total", "paid", "payment", "成約", "受注", "失注",
        "契約日", "解約", "結果", "成果", "成功", "失敗", "達成", "完了", "売上",
        "販売", "販売額", "販売金額", "購入", "購入金額", "注文額", "受注金額",
        "粗利", "利益", "入金", "支払",
    )
    return any(term in text for term in post_outcome_terms)


def build_feature_descriptors(
    mapping: dict[str, Any],
    dataset: dict[str, Any],
    target: dict[str, Any],
    target_config: dict[str, Any],
    config: dict[str, Any] | None,
    diagnostics: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    columns = column_id_map(dataset)
    table_mapping_by_id = {table["tableId"]: table for table in mapping.get("tableMappings", [])}
    selected_keys = set(config.get("selectedFeatureKeys", [])) if config and config.get("mode") == "custom" else None
    blocked_keys = config_blocked_keys(config)
    if config and config.get("mode") == "autopilot" and config.get("allowGeneratedFeatures", True):
        return build_autopilot_feature_descriptors(mapping, dataset, target, target_config, config, diagnostics)

    features: list[dict[str, Any]] = []

    for mapped_column in mapping.get("columnMappings", []):
        feature_config = mapped_column.get("featureConfig") or {}
        if mapped_column.get("columnRole") != "feature" or not feature_config.get("enabled"):
            continue
        feature_key = feature_config.get("featureKey")
        if str(feature_key) in blocked_keys or str(mapped_column.get("columnId")) in blocked_keys:
            continue
        if selected_keys is not None and feature_config.get("featureKey") not in selected_keys:
            continue
        item = columns.get(mapped_column.get("columnId"))
        if not item:
            continue
        if is_leakage_like_feature(mapped_column, feature_config, item, target, target_config):
            if diagnostics is not None:
                diagnostics.setdefault("autoBlockedFeatureKeys", []).append(str(feature_key or mapped_column.get("columnId")))
            continue
        plan = find_feature_plan(mapping, dataset, target["table"]["id"], item["table"]["id"])
        if not plan:
            continue
        table_mapping = table_mapping_by_id.get(item["table"]["id"]) or {}
        data_type = item["column"].get("dataType")
        features.append({
            "featureKey": feature_key,
            "label": feature_config.get("label") or mapped_column.get("businessName"),
            "sourceColumnName": item["column"].get("name"),
            "sourceColumnId": item["column"].get("id"),
            "sourceTableId": item["table"].get("id"),
            "sourceTableName": item["table"].get("name"),
            "sourceTableDisplayName": item["table"].get("displayName"),
            "dataType": data_type,
            "valueType": feature_config.get("valueType") or ("numeric" if data_type in {"integer", "float"} else "categorical"),
            "valueLabels": feature_config.get("valueLabels"),
            "entityRole": table_mapping.get("entityRole"),
            "category": category_for_entity_role(table_mapping.get("entityRole"), item["table"].get("name", "")),
            "aggregation": feature_config.get("aggregation"),
            "timeWindow": feature_config.get("timeWindow"),
            "plan": plan,
        })
    return features


def mapped_column_by_id(mapping: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {
        item.get("columnId"): item
        for item in mapping.get("columnMappings", [])
        if item.get("columnId")
    }


def is_id_like_column(column: dict[str, Any]) -> bool:
    name = str(column.get("name") or "").lower()
    return column.get("isPrimaryKey") or name == "id" or name.endswith("_id") or name.endswith("id")


def is_autopilot_candidate_column(
    mapped_column: dict[str, Any],
    column: dict[str, Any],
    target: dict[str, Any],
) -> bool:
    if column.get("id") == target["column"].get("id"):
        return False
    if mapped_column.get("columnRole") in {"target", "excluded", "customer_id"}:
        return False
    if column.get("dataType") == "array":
        return False
    if is_id_like_column(column) and mapped_column.get("columnRole") != "event_time":
        return False
    return True


def autopilot_time_windows_for_feature(table_category: str, has_event_time: bool) -> list[dict[str, Any] | None]:
    if not has_event_time or table_category == "profile":
        return [None]
    return [
        {"unit": "day", "value": 30},
        {"unit": "day", "value": 90},
    ]


def autopilot_feature_key(column: dict[str, Any], aggregation: str, window: dict[str, Any] | None, derived_kind: str | None = None) -> str:
    base = normalize_identifier(column.get("name")) or normalize_identifier(column.get("id")) or "feature"
    suffix = derived_kind or aggregation
    if window:
        suffix = f"{suffix}_{int(window.get('value') or 0)}{str(window.get('unit') or 'day')[0]}"
    return f"auto_{base}_{suffix}"


def generated_feature_key(prefix: str, *parts: Any, limit: int = 80) -> str:
    tokens = [normalize_identifier(part) for part in parts]
    key = "_".join([prefix, *[token for token in tokens if token]])[:limit]
    return key or prefix


def make_unique_feature_key(base_key: str, existing_keys: set[str]) -> str:
    key = base_key
    index = 2
    while key in existing_keys:
        key = f"{base_key}_{index}"
        index += 1
    existing_keys.add(key)
    return key


def build_autopilot_feature_descriptors(
    mapping: dict[str, Any],
    dataset: dict[str, Any],
    target: dict[str, Any],
    target_config: dict[str, Any],
    config: dict[str, Any],
    diagnostics: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    columns = column_id_map(dataset)
    mapped_by_column = mapped_column_by_id(mapping)
    table_mapping_by_id = {table["tableId"]: table for table in mapping.get("tableMappings", [])}
    blocked_keys = config_blocked_keys(config)
    event_time_columns = resolve_event_time_columns_by_table(mapping, dataset)
    candidate_limit = max(1, int(config.get("candidateFeatureLimit") or 80))
    generated: list[dict[str, Any]] = []
    seen_keys: set[str] = set()

    def add_feature(item: dict[str, Any], aggregation: str, window: dict[str, Any] | None = None, derived_kind: str | None = None) -> None:
        column = item["column"]
        mapped_column = mapped_by_column.get(column.get("id")) or {}
        table = item["table"]
        table_mapping = table_mapping_by_id.get(table.get("id")) or {}
        table_category = category_for_entity_role(table_mapping.get("entityRole"), table.get("name", ""))
        feature_key = autopilot_feature_key(column, aggregation, window, derived_kind)
        if feature_key in seen_keys or feature_key in blocked_keys or str(column.get("id")) in blocked_keys:
            return
        if is_leakage_like_feature(mapped_column, {"featureKey": feature_key, "label": column.get("displayName")}, item, target, target_config):
            if diagnostics is not None:
                diagnostics.setdefault("autoBlockedFeatureKeys", []).append(feature_key)
            return
        plan = find_feature_plan(mapping, dataset, target["table"]["id"], table["id"])
        if not plan:
            return
        seen_keys.add(feature_key)
        data_type = column.get("dataType")
        value_type = "numeric" if data_type in {"integer", "float", "boolean"} or aggregation in {"count", "distinct_count"} or derived_kind in {"recency_days", "category_value_counts"} else "categorical"
        base_label = column_label(mapped_column, column)
        generated.append({
            "featureKey": feature_key,
            "label": feature_label(base_label, aggregation, window, derived_kind, table_category),
            "sourceColumnName": column.get("name"),
            "sourceColumnId": column.get("id"),
            "sourceTableId": table.get("id"),
            "sourceTableName": table.get("name"),
            "sourceTableDisplayName": table.get("displayName"),
            "dataType": data_type,
            "valueType": value_type,
            "valueLabels": None,
            "entityRole": table_mapping.get("entityRole"),
            "category": table_category,
            "aggregation": aggregation,
            "timeWindow": window,
            "derivedKind": derived_kind,
            "template": derived_kind == "category_value_counts",
            "autopilotGenerated": True,
            "plan": plan,
        })

    for table in dataset.get("tables", []):
        table_mapping = table_mapping_by_id.get(table.get("id")) or {}
        table_category = category_for_entity_role(table_mapping.get("entityRole"), table.get("name", ""))
        table_has_event_time = table.get("id") in event_time_columns
        for column in table.get("columns", []):
            mapped_column = mapped_by_column.get(column.get("id")) or {}
            if not is_autopilot_candidate_column(mapped_column, column, target):
                continue
            if mapped_column.get("columnRole") == "event_time":
                if table.get("id") != target["table"].get("id") and table_has_event_time:
                    add_feature({"table": table, "column": column}, "latest", None, "recency_days")
                continue

            item = {"table": table, "column": column}
            data_type = column.get("dataType")
            same_table = table.get("id") == target["table"].get("id")
            windows = autopilot_time_windows_for_feature(table_category, table_has_event_time)
            if same_table:
                add_feature(item, "latest" if data_type in {"integer", "float", "boolean"} else "none")
                continue

            add_feature(item, "count")
            if data_type in {"integer", "float"}:
                for aggregation in ["sum", "avg"]:
                    for window in windows:
                        add_feature(item, aggregation, window)
            elif data_type in {"string", "boolean"}:
                add_feature(item, "distinct_count")
                add_feature(item, "count", None, "category_value_counts")
                for window in windows:
                    if window:
                        add_feature(item, "count", window)
                        add_feature(item, "count", window, "category_value_counts")
                add_feature(item, "latest")

            if len(generated) >= candidate_limit:
                break
        if len(generated) >= candidate_limit:
            break

    if diagnostics is not None:
        diagnostics["autopilotGeneratedFeatureCount"] = len(generated)
    return generated[:candidate_limit]


