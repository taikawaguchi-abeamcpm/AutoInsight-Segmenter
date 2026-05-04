import json
import math
import os
import random
import statistics
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from itertools import combinations
from typing import Any


FABRIC_SCOPE = "https://api.fabric.microsoft.com/.default"
GRAPHQL_TIMEOUT_SECONDS = float(os.environ.get("FABRIC_GRAPHQL_TIMEOUT_MS", "30000")) / 1000
ANALYSIS_PAGE_SIZE = int(os.environ.get("FABRIC_ANALYSIS_PAGE_SIZE", "1000"))
ANALYSIS_MAX_ROWS = int(os.environ.get("FABRIC_ANALYSIS_MAX_ROWS", "100000"))


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
    if normalized in {"true", "1", "yes", "y", "won", "success", "converted", "成約", "あり"}:
        return 1
    if normalized in {"false", "0", "no", "n", "lost", "failure", "not_converted", "未成約", "なし"}:
        return 0
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


def http_json(url: str, body: dict[str, Any], headers: dict[str, str], timeout: float) -> dict[str, Any]:
    data = json.dumps(body).encode("utf-8")
    request = urllib.request.Request(url, data=data, method="POST", headers={
        "Content-Type": "application/json",
        **headers,
    })
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        raw = err.read().decode("utf-8", errors="replace")
        raise RuntimeError(raw or err.reason) from err


def get_bearer_token(connection: dict[str, Any], auth: dict[str, Any]) -> str:
    if connection.get("authMode") == "obo":
        authorization = auth.get("authorization") or ""
        if authorization.lower().startswith("bearer "):
            return authorization[7:].strip()
        raise RuntimeError("OBO authentication requires the user's Fabric bearer token.")

    client_secret = connection.get("clientSecret")
    if not client_secret:
        raise RuntimeError("Service principal authentication requires clientSecret in the analysis worker payload.")

    token_url = f"https://login.microsoftonline.com/{urllib.parse.quote(str(connection.get('tenantId')))}/oauth2/v2.0/token"
    form = urllib.parse.urlencode({
        "client_id": connection.get("clientId"),
        "client_secret": client_secret,
        "grant_type": "client_credentials",
        "scope": FABRIC_SCOPE,
    }).encode("utf-8")
    request = urllib.request.Request(token_url, data=form, method="POST", headers={
        "Content-Type": "application/x-www-form-urlencoded"
    })
    try:
        with urllib.request.urlopen(request, timeout=GRAPHQL_TIMEOUT_SECONDS) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        raw = err.read().decode("utf-8", errors="replace")
        raise RuntimeError(raw or err.reason) from err

    token = payload.get("access_token")
    if not token:
        raise RuntimeError(payload.get("error_description") or payload.get("error") or "Fabric access token could not be acquired.")
    return token


def execute_fabric_graphql(connection: dict[str, Any], auth: dict[str, Any], query: str, variables: dict[str, Any] | None = None) -> dict[str, Any]:
    token = get_bearer_token(connection, auth)
    payload = http_json(
        connection["endpointUrl"],
        {"query": query, "variables": variables},
        {"Authorization": f"Bearer {token}"},
        GRAPHQL_TIMEOUT_SECONDS,
    )
    if payload.get("errors"):
        message = " / ".join(str(item.get("message", item)) for item in payload["errors"])
        raise RuntimeError(message)
    return payload.get("data") or {}


def fetch_table_rows(
    connection: dict[str, Any],
    auth: dict[str, Any],
    table_name: str,
    column_names: list[str],
    page_size: int | None = None,
    max_rows: int | None = None,
) -> dict[str, Any]:
    page_size = page_size or ANALYSIS_PAGE_SIZE
    max_rows = max_rows or ANALYSIS_MAX_ROWS
    selected_columns = list(dict.fromkeys([name for name in column_names if name]))
    if not table_name or not selected_columns:
        return {"rows": [], "truncated": False}

    rows: list[dict[str, Any]] = []
    after = None
    truncated = False
    selection = "\n".join(selected_columns)

    while len(rows) < max_rows:
        first = min(page_size, max_rows - len(rows))
        args = [f"first: {first}"]
        if after:
            args.append(f"after: {json.dumps(after)}")
        query = f"""
        query AutoInsightAnalysisRows {{
          page: {table_name}({", ".join(args)}) {{
            items {{
              {selection}
            }}
            endCursor
            hasNextPage
          }}
        }}
        """
        data = execute_fabric_graphql(connection, auth, query)
        result = data.get("page") or {}
        items = result.get("items") if isinstance(result.get("items"), list) else []
        rows.extend(items)

        if not result.get("hasNextPage") or not result.get("endCursor") or not items:
            break
        after = result["endCursor"]
        truncated = len(rows) >= max_rows

    return {"rows": rows, "truncated": truncated}


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
        "success", "failure", "成約", "受注", "失注", "契約日", "解約", "結果",
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


def is_sequence_mining_feature(feature: dict[str, Any], event_time_columns_by_table: dict[str, Any]) -> bool:
    return (
        feature.get("valueType") == "categorical"
        and feature.get("sourceTableId") in event_time_columns_by_table
        and (
            feature.get("entityRole") in {"transaction_fact", "event_log"}
            or feature.get("category") in {"transaction", "behavior"}
        )
    )


def aggregate_values(values: list[Any], feature: dict[str, Any]) -> Any:
    present = []
    for item in values:
        normalized = item if isinstance(item, dict) and "value" in item else {"value": item}
        if not is_missing(normalized.get("value")):
            present.append(normalized)
    present.sort(key=lambda item: item.get("at") if item.get("at") is not None else 0)
    if not present:
        return None

    aggregation = feature.get("aggregation") or "latest"
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
                    ordered_values = [
                        label_for_value(feature, item["value"])
                        for item in sorted(row_values, key=lambda item: item.get("at") if item.get("at") is not None else 0)
                        if not is_missing(item.get("value"))
                    ]
                    aggregated = aggregate_values(row_values, feature)
                    row[feature["featureKey"]] = aggregated
                    if is_sequence_mining_feature(feature, event_time_columns_by_table):
                        row["__sequences"][feature["featureKey"]] = ordered_values

    for row in rows:
        row.pop("__raw", None)

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
                row[feature_key] = raw_values[0]["value"] if len(distinct_values) == 1 else aggregate_values(raw_values, feature)

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

    matched = [item for item in pairs if item["value"] <= threshold] if direction == "negative" else [item for item in pairs if item["value"] >= threshold]
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
                "label": f"{feature['label']} が {value} {'以下' if direction == 'negative' else '以上'}",
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
                "label": f"{feature['label']} が {label_for_value(feature, best['value'])}",
            },
        },
    }


def is_numeric_training_feature(feature: dict[str, Any]) -> bool:
    return feature.get("valueType") == "numeric" or feature.get("aggregation") in {"sum", "avg", "count", "distinct_count", "min", "max"}


def build_training_matrix(
    rows: list[dict[str, Any]],
    features: list[dict[str, Any]],
    max_categorical_levels: int = 20,
) -> tuple[list[list[float]], list[int], list[dict[str, Any]]]:
    columns: list[dict[str, Any]] = []

    for feature in features:
        feature_key = feature["featureKey"]
        if is_numeric_training_feature(feature):
            values = [to_number(row.get(feature_key)) for row in rows]
            present = [value for value in values if value is not None]
            if len(present) < 2:
                continue
            avg = mean(present)
            scale = stddev(present) or 1
            columns.append({"featureKey": feature_key, "kind": "numeric", "mean": avg, "scale": scale})
            continue

        counts: dict[str, int] = {}
        for row in rows:
            value = row.get(feature_key)
            if not is_missing(value):
                key = str(value)
                counts[key] = counts.get(key, 0) + 1
        for level, count in sorted(counts.items(), key=lambda item: item[1], reverse=True)[:max_categorical_levels]:
            if count >= 2:
                columns.append({"featureKey": feature_key, "kind": "categorical", "level": level})

    if not columns:
        return [], [], []

    matrix: list[list[float]] = []
    labels: list[int] = []
    for row in rows:
        vector = []
        for column in columns:
            value = row.get(column["featureKey"])
            if column["kind"] == "numeric":
                numeric = to_number(value)
                vector.append(0.0 if numeric is None else (numeric - column["mean"]) / column["scale"])
            else:
                vector.append(1.0 if str(value) == column["level"] else 0.0)
        matrix.append(vector)
        labels.append(int(row["__target"]))

    return matrix, labels, columns


def train_logistic_regression(
    matrix: list[list[float]],
    labels: list[int],
    epochs: int = 180,
    learning_rate: float = 0.08,
    l2: float = 0.001,
) -> tuple[list[float], float, float]:
    if not matrix or not matrix[0] or len(set(labels)) < 2:
        return [], 0.0, 0.0

    row_count = len(matrix)
    column_count = len(matrix[0])
    weights = [0.0] * column_count
    bias = 0.0

    for _ in range(epochs):
        gradients = [0.0] * column_count
        bias_gradient = 0.0
        for vector, label in zip(matrix, labels):
            logit = bias + sum(weight * value for weight, value in zip(weights, vector))
            probability = 1 / (1 + math.exp(-max(-35, min(35, logit))))
            error = probability - label
            bias_gradient += error
            for index, value in enumerate(vector):
                gradients[index] += error * value

        bias -= learning_rate * bias_gradient / row_count
        for index in range(column_count):
            gradients[index] = gradients[index] / row_count + l2 * weights[index]
            weights[index] -= learning_rate * gradients[index]

    loss = 0.0
    for vector, label in zip(matrix, labels):
        logit = bias + sum(weight * value for weight, value in zip(weights, vector))
        probability = min(1 - 1e-9, max(1e-9, 1 / (1 + math.exp(-max(-35, min(35, logit))))))
        loss += -(label * math.log(probability) + (1 - label) * math.log(1 - probability))
    return weights, bias, loss / row_count


def sigmoid(value: float) -> float:
    return 1 / (1 + math.exp(-max(-35, min(35, value))))


def predict_probabilities(matrix: list[list[float]], weights: list[float], bias: float) -> list[float]:
    return [
        sigmoid(bias + sum(weight * value for weight, value in zip(weights, vector)))
        for vector in matrix
    ]


def binary_log_loss(labels: list[int], probabilities: list[float]) -> float | None:
    if not labels:
        return None
    loss = 0.0
    for label, probability in zip(labels, probabilities):
        p = min(1 - 1e-9, max(1e-9, probability))
        loss += -(label * math.log(p) + (1 - label) * math.log(1 - p))
    return loss / len(labels)


def roc_auc_score(labels: list[int], probabilities: list[float]) -> float | None:
    positives = sum(1 for label in labels if label == 1)
    negatives = len(labels) - positives
    if positives == 0 or negatives == 0:
        return None

    ranked = sorted(zip(probabilities, labels), key=lambda item: item[0])
    rank_sum = 0.0
    index = 0
    while index < len(ranked):
        next_index = index + 1
        while next_index < len(ranked) and ranked[next_index][0] == ranked[index][0]:
            next_index += 1
        average_rank = (index + 1 + next_index) / 2
        rank_sum += average_rank * sum(1 for _, label in ranked[index:next_index] if label == 1)
        index = next_index

    return (rank_sum - positives * (positives + 1) / 2) / (positives * negatives)


def pr_auc_score(labels: list[int], probabilities: list[float]) -> float | None:
    positives = sum(1 for label in labels if label == 1)
    if positives == 0:
        return None

    ranked = sorted(zip(probabilities, labels), key=lambda item: item[0], reverse=True)
    true_positives = 0
    precision_sum = 0.0
    for index, (_, label) in enumerate(ranked, start=1):
        if label == 1:
            true_positives += 1
            precision_sum += true_positives / index
    return precision_sum / positives


def stratified_train_validation_split(labels: list[int], seed: int, validation_ratio: float = 0.25) -> tuple[list[int], list[int]]:
    train_indexes: list[int] = []
    validation_indexes: list[int] = []
    randomizer = random.Random(seed)

    for label in sorted(set(labels)):
        indexes = [index for index, item in enumerate(labels) if item == label]
        randomizer.shuffle(indexes)
        validation_count = max(1, round(len(indexes) * validation_ratio)) if len(indexes) >= 4 else 0
        validation_indexes.extend(indexes[:validation_count])
        train_indexes.extend(indexes[validation_count:])

    if len(set(labels[index] for index in validation_indexes)) < 2 or len(set(labels[index] for index in train_indexes)) < 2:
        return list(range(len(labels))), []

    return sorted(train_indexes), sorted(validation_indexes)


def normalize_importances(raw_importances: dict[str, float]) -> dict[str, float]:
    max_importance = max(raw_importances.values(), default=0.0)
    return {
        feature_key: (importance / max_importance * 100 if max_importance > 0 else 0.0)
        for feature_key, importance in raw_importances.items()
    }


def rank_percentile_scores(score_maps: list[dict[str, float]]) -> dict[str, float]:
    feature_keys = sorted({key for scores in score_maps for key in scores})
    if not feature_keys:
        return {}

    ranks_by_feature: dict[str, list[float]] = {key: [] for key in feature_keys}
    for scores in score_maps:
        if not scores:
            continue
        ranked = sorted(feature_keys, key=lambda key: scores.get(key, 0.0), reverse=True)
        denominator = max(1, len(ranked) - 1)
        for rank, feature_key in enumerate(ranked):
            ranks_by_feature[feature_key].append(1 - rank / denominator)

    return {
        feature_key: mean(values) * 100 if values else 0.0
        for feature_key, values in ranks_by_feature.items()
    }


def permute_feature_columns(
    validation_matrix: list[list[float]],
    columns: list[dict[str, Any]],
    feature_key: str,
    seed: int,
) -> list[list[float]]:
    column_indexes = [index for index, column in enumerate(columns) if column["featureKey"] == feature_key]
    if not column_indexes or len(validation_matrix) < 2:
        return [list(row) for row in validation_matrix]

    row_order = list(range(len(validation_matrix)))
    random.Random(seed).shuffle(row_order)
    if row_order == list(range(len(validation_matrix))):
        row_order = row_order[1:] + row_order[:1]

    permuted = [list(row) for row in validation_matrix]
    for target_index, source_index in enumerate(row_order):
        for column_index in column_indexes:
            permuted[target_index][column_index] = validation_matrix[source_index][column_index]
    return permuted


def train_feature_importance_model(rows: list[dict[str, Any]], features: list[dict[str, Any]], seed: int = 42) -> dict[str, Any]:
    matrix, labels, columns = build_training_matrix(rows, features)
    if not matrix or not columns or len(set(labels)) < 2:
        return {
            "modelType": "logistic_regression",
            "modelVersion": "python-stdlib-logistic-v2",
            "trainingRowCount": len(rows),
            "trainingFeatureCount": 0,
            "validationRowCount": 0,
            "logLoss": 0.0,
            "validationLogLoss": None,
            "rocAuc": None,
            "prAuc": None,
            "featureImportances": {},
            "modelFeatureImportances": {},
            "permutationFeatureImportances": {},
            "hybridFeatureImportances": {},
        }

    train_indexes, validation_indexes = stratified_train_validation_split(labels, seed)
    train_matrix = [matrix[index] for index in train_indexes]
    train_labels = [labels[index] for index in train_indexes]
    validation_matrix = [matrix[index] for index in validation_indexes]
    validation_labels = [labels[index] for index in validation_indexes]

    weights, bias, loss = train_logistic_regression(train_matrix, train_labels)
    raw_importances: dict[str, float] = {}
    for column, weight in zip(columns, weights):
        feature_key = column["featureKey"]
        raw_importances[feature_key] = raw_importances.get(feature_key, 0.0) + abs(weight)

    model_importances = normalize_importances(raw_importances)
    validation_probabilities = predict_probabilities(validation_matrix, weights, bias) if validation_matrix else []
    validation_loss = binary_log_loss(validation_labels, validation_probabilities) if validation_matrix else None
    roc_auc = roc_auc_score(validation_labels, validation_probabilities) if validation_matrix else None
    pr_auc = pr_auc_score(validation_labels, validation_probabilities) if validation_matrix else None

    permutation_raw: dict[str, float] = {}
    baseline_metric = roc_auc
    baseline_loss = validation_loss
    if validation_matrix and weights:
        for feature_key in sorted({column["featureKey"] for column in columns}):
            permuted = permute_feature_columns(validation_matrix, columns, feature_key, seed + len(feature_key))
            probabilities = predict_probabilities(permuted, weights, bias)
            permuted_auc = roc_auc_score(validation_labels, probabilities)
            permuted_loss = binary_log_loss(validation_labels, probabilities)
            if baseline_metric is not None and permuted_auc is not None:
                permutation_raw[feature_key] = max(0.0, baseline_metric - permuted_auc)
            elif baseline_loss is not None and permuted_loss is not None:
                permutation_raw[feature_key] = max(0.0, permuted_loss - baseline_loss)

    permutation_importances = normalize_importances(permutation_raw)
    hybrid_importances = rank_percentile_scores([model_importances, permutation_importances])
    return {
        "modelType": "logistic_regression",
        "modelVersion": "python-stdlib-logistic-v2",
        "trainingRowCount": len(train_matrix),
        "trainingFeatureCount": len(columns),
        "validationRowCount": len(validation_matrix),
        "logLoss": loss,
        "validationLogLoss": validation_loss,
        "rocAuc": roc_auc,
        "prAuc": pr_auc,
        "featureImportances": hybrid_importances or model_importances,
        "modelFeatureImportances": model_importances,
        "permutationFeatureImportances": permutation_importances,
        "hybridFeatureImportances": hybrid_importances or model_importances,
    }


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
        label = f"行動ルート: {candidate['route']}"
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
            conditions = [entry["condition"] for entry in entries]
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
                "score": clamp_score(delta * 130 * math.sqrt(support_rate) + size * 8),
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
        signature = tuple(
            (condition["featureKey"], condition.get("operator"), str(condition.get("value")), str(condition.get("valueTo")))
            for condition in candidate["conditions"]
        )
        if signature in seen:
            continue
        seen.add(signature)
        title = " かつ ".join(condition["label"] for condition in candidate["conditions"])
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
        if len(patterns) >= pattern_count:
            break
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
        return failed_result(analysis_job_id, run_id, mapping, dataset, config, "分析可能な特徴量がありません。目的変数テーブルと同一テーブル、または join 定義で接続できる特徴量を選択してください。")

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
    )
    rows = materialized["rows"]
    truncated = materialized["truncated"]
    source_row_count = len(rows)
    if analysis_unit == "customer" and analysis_unit_key_column:
        rows = collapse_rows_to_analysis_unit(rows, features)
    if not rows:
        return failed_result(analysis_job_id, run_id, mapping, dataset, config, "目的変数を二値として判定できる行がありませんでした。目的変数の役割または正例/負例の値を確認してください。")

    positive_count = sum(1 for row in rows if row["__target"] == 1)
    baseline_rate = positive_count / len(rows)
    min_group_count = max(3, math.ceil(len(rows) * 0.02))
    importances = []
    random_seed = int(config.get("randomSeed") or 42)
    model_training = train_feature_importance_model(
        rows,
        [feature for feature in features if not is_sequence_mining_feature(feature, event_time_columns_by_table)],
        random_seed,
    )
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
                "description": f"{feature.get('sourceTableDisplayName')}.{feature.get('sourceColumnName')} を実データ {len(rows):,} 行で集約し、目的変数 {target['column'].get('displayName')} との差を評価しました。",
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
            "description": "指定条件に一致し、成果データで高い傾向が見られる候補です。既定では未成果の対象だけを施策候補にします。",
            "sourcePatternId": pattern["id"],
            "estimatedAudienceSize": len(candidate_rows),
            "estimatedConversionRate": baseline_rate + (pattern.get("conversionDelta") or 0),
            "conditions": pattern["conditions"],
            "useCase": "未成果候補リスト化",
            "priorityScore": clamp_score((pattern.get("conversionDelta") or 0) * 100 + (len(candidate_rows) / len(rows)) * 40 + 50),
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
        "message": f"Fabric 実データ {len(rows):,} 行を集約して Python worker で分析しました。{'上限行数までの集計です。' if truncated else ''}",
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
        },
    }


def main() -> None:
    payload = json.loads(sys.stdin.read())
    result = build_real_analysis_result(payload)
    json.dump(result, sys.stdout, ensure_ascii=False, separators=(",", ":"))


if __name__ == "__main__":
    main()
