import json
import math
import os
import statistics
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
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


def build_feature_descriptors(
    mapping: dict[str, Any],
    dataset: dict[str, Any],
    target: dict[str, Any],
    config: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    columns = column_id_map(dataset)
    table_mapping_by_id = {table["tableId"]: table for table in mapping.get("tableMappings", [])}
    selected_keys = set(config.get("selectedFeatureKeys", [])) if config and config.get("mode") == "custom" else None
    features: list[dict[str, Any]] = []

    for mapped_column in mapping.get("columnMappings", []):
        feature_config = mapped_column.get("featureConfig") or {}
        if mapped_column.get("columnRole") != "feature" or not feature_config.get("enabled"):
            continue
        if selected_keys is not None and feature_config.get("featureKey") not in selected_keys:
            continue
        item = columns.get(mapped_column.get("columnId"))
        if not item:
            continue
        plan = find_feature_plan(mapping, dataset, target["table"]["id"], item["table"]["id"])
        if not plan:
            continue
        table_mapping = table_mapping_by_id.get(item["table"]["id"]) or {}
        data_type = item["column"].get("dataType")
        features.append({
            "featureKey": feature_config.get("featureKey"),
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


def materialize_analysis_rows(
    connection: dict[str, Any],
    auth: dict[str, Any],
    dataset: dict[str, Any],
    target: dict[str, Any],
    target_config: dict[str, Any],
    features: list[dict[str, Any]],
    event_time_columns_by_table: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    columns = column_id_map(dataset)
    target_key_column_ids = [feature["plan"].get("targetKeyColumnId") for feature in features if feature["plan"].get("targetKeyColumnId")]
    same_table_columns = [feature["sourceColumnName"] for feature in features if feature["plan"]["kind"] == "same"]
    target_key_columns = [columns[column_id]["column"]["name"] for column_id in target_key_column_ids if column_id in columns]
    target_fetch_columns = [target["column"]["name"], *target_key_columns, *same_table_columns]
    target_response = fetch_table_rows(connection, auth, target["table"]["name"], target_fetch_columns)

    rows = []
    for index, raw in enumerate(target_response["rows"]):
        target_value = normalize_bool(raw.get(target["column"]["name"]), target_config)
        if target_value is None:
            continue
        rows.append({"__rowId": index, "__target": target_value, "__sequences": {}, "__raw": raw})
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
            ordered_values = [
                label_for_value(feature, item["value"])
                for item in sorted(values, key=lambda item: item.get("at") if item.get("at") is not None else 0)
                if not is_missing(item.get("value"))
            ]
            aggregated = aggregate_values(values, feature)
            for row_id in row_ids:
                row = row_by_id.get(row_id)
                if row:
                    row[feature["featureKey"]] = aggregated
                    if is_sequence_mining_feature(feature, event_time_columns_by_table):
                        row["__sequences"][feature["featureKey"]] = ordered_values

    for row in rows:
        row.pop("__raw", None)

    return {"rows": rows, "truncated": target_response["truncated"]}


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
) -> tuple[list[float], float]:
    if not matrix or not matrix[0] or len(set(labels)) < 2:
        return [], 0.0

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
    return weights, loss / row_count


def train_feature_importance_model(rows: list[dict[str, Any]], features: list[dict[str, Any]]) -> dict[str, Any]:
    matrix, labels, columns = build_training_matrix(rows, features)
    weights, loss = train_logistic_regression(matrix, labels)
    raw_importances: dict[str, float] = {}
    for column, weight in zip(columns, weights):
        feature_key = column["featureKey"]
        raw_importances[feature_key] = raw_importances.get(feature_key, 0.0) + abs(weight)

    max_importance = max(raw_importances.values(), default=0.0)
    normalized = {
        feature_key: (importance / max_importance * 100 if max_importance > 0 else 0.0)
        for feature_key, importance in raw_importances.items()
    }
    return {
        "modelType": "logistic_regression",
        "modelVersion": "python-stdlib-logistic-v1",
        "trainingRowCount": len(rows),
        "trainingFeatureCount": len(columns),
        "logLoss": loss,
        "featureImportances": normalized,
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

    target = {"table": target["table"], "column": target["column"]}
    features = build_feature_descriptors(mapping, dataset, target, config)
    if not features:
        return failed_result(analysis_job_id, run_id, mapping, dataset, config, "分析可能な特徴量がありません。目的変数テーブルと同一テーブル、または join 定義で接続できる特徴量を選択してください。")

    target_config = dict(target_mapping.get("targetConfig") or {})
    if config.get("mode") == "custom" and str(config.get("targetPositiveValue") or "").strip():
        target_config["positiveValue"] = str(config["targetPositiveValue"]).strip()

    event_time_columns_by_table = resolve_event_time_columns_by_table(mapping, dataset)
    materialized = materialize_analysis_rows(connection, auth, dataset, target, target_config, features, event_time_columns_by_table)
    rows = materialized["rows"]
    truncated = materialized["truncated"]
    if not rows:
        return failed_result(analysis_job_id, run_id, mapping, dataset, config, "目的変数を二値として判定できる行がありませんでした。目的変数の役割または正例/負例の値を確認してください。")

    positive_count = sum(1 for row in rows if row["__target"] == 1)
    baseline_rate = positive_count / len(rows)
    min_group_count = max(3, math.ceil(len(rows) * 0.02))
    importances = []
    model_training = train_feature_importance_model(
        rows,
        [feature for feature in features if not is_sequence_mining_feature(feature, event_time_columns_by_table)],
    )
    model_scores = model_training["featureImportances"]
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
        if model_score is not None and importance_method == "model_based":
            importance_score = clamp_score(model_score)
        elif model_score is not None and importance_method == "hybrid":
            importance_score = clamp_score(statistical_score * 0.55 + model_score * 0.45)
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
    patterns = []
    for index, item in enumerate([entry for entry in top_importances if entry["analysis"]["pattern"]["matchedCount"] >= min_group_count][: config.get("patternCount") or 5]):
        pattern = item["analysis"]["pattern"]
        condition = pattern["condition"]
        patterns.append({
            "id": f"pattern-real-{index + 1}",
            "title": condition["label"],
            "conditions": [condition],
            "supportRate": pattern["supportRate"],
            "lift": pattern["lift"],
            "conversionDelta": pattern["conversionDelta"],
            "confidence": min(0.95, max(0.35, item["result"]["importanceScore"] / 100)),
            "description": (
                f"{condition['label']} の {pattern['matchedCount']:,} 行では、{summary['target']['label']} の比率が "
                f"{format_rate(pattern['conversionRate'])} でした。全体平均 {format_rate(baseline_rate)} より "
                f"{format_point_delta(abs(pattern['conversionDelta']))} {pattern_direction_text(pattern['conversionDelta'])}条件です。"
            ),
            "recommendedAction": f"{condition['label']} を条件にしたセグメントで施策検証してください。",
        })

    segments = []
    for index, pattern in enumerate([item for item in patterns if (item.get("conversionDelta") or 0) > 0]):
        candidate_rows = [
            row for row in rows
            if row["__target"] != 1 and all(matches_condition(row, condition) for condition in pattern["conditions"])
        ]
        segment = {
            "id": f"segment-real-{index + 1}",
            "name": f"{pattern['conditions'][0]['label']} 未成果候補",
            "description": "目的変数が成果値ではないデータのうち、成果データに多い傾向へ近い候補です。",
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
            key: value
            for key, value in model_training.items()
            if key != "featureImportances"
        },
    }


def main() -> None:
    payload = json.loads(sys.stdin.read())
    result = build_real_analysis_result(payload)
    json.dump(result, sys.stdout, ensure_ascii=False, separators=(",", ":"))


if __name__ == "__main__":
    main()
