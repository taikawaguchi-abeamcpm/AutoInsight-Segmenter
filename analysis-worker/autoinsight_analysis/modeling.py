import math
import random
from typing import Any

from .utils import is_missing, mean, stddev, to_number


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


def autopilot_feature_subset(features: list[dict[str, Any]], strategy: str, limit: int) -> list[dict[str, Any]]:
    if strategy == "explainability":
        ranked = sorted(
            features,
            key=lambda feature: (
                feature.get("plan", {}).get("kind") != "same",
                feature.get("aggregation") not in {"none", "latest", "count"},
                bool(feature.get("timeWindow")),
                feature.get("featureKey"),
            ),
        )
    elif strategy == "segmentability":
        ranked = sorted(
            features,
            key=lambda feature: (
                feature.get("category") not in {"transaction", "behavior", "engagement"},
                feature.get("aggregation") not in {"count", "sum", "avg", "distinct_count"},
                feature.get("featureKey"),
            ),
        )
    else:
        ranked = list(features)
    return ranked[:max(1, limit)]


def score_autopilot_candidate(model: dict[str, Any], features: list[dict[str, Any]], strategy: str, priority: str) -> float:
    auc = model.get("rocAuc")
    pr_auc = model.get("prAuc")
    metric_score = 0.0
    if auc is not None:
        metric_score += max(0.0, auc - 0.5) * 120
    if pr_auc is not None:
        metric_score += pr_auc * 40
    explainability = 100 / math.sqrt(max(1, len(features)))
    segmentability = sum(1 for feature in features if feature.get("category") in {"transaction", "behavior", "engagement"}) / max(1, len(features)) * 100
    reproducibility = 100 - min(80, len(features))

    weights = {
        "explainability": (0.45, 0.35, 0.10, 0.10),
        "segmentability": (0.45, 0.10, 0.35, 0.10),
        "reproducibility": (0.35, 0.15, 0.10, 0.40),
    }.get(priority, (0.55, 0.15, 0.20, 0.10))
    metric_w, explain_w, segment_w, reproducible_w = weights
    strategy_bonus = 5 if strategy == priority or (priority == "balanced" and strategy == "accuracy") else 0
    return (
        metric_score * metric_w
        + explainability * explain_w
        + segmentability * segment_w
        + reproducibility * reproducible_w
        + strategy_bonus
    )


def choose_autopilot_candidate_model(
    rows: list[dict[str, Any]],
    features: list[dict[str, Any]],
    config: dict[str, Any],
    seed: int,
) -> tuple[list[dict[str, Any]], dict[str, Any], list[dict[str, Any]]]:
    if config.get("mode") != "autopilot":
        model = train_feature_importance_model(rows, features, seed)
        return features, model, []

    candidate_limit = max(1, int(config.get("candidateFeatureLimit") or len(features) or 1))
    priority = config.get("businessPriority") or "segmentability"
    strategies = [
        ("accuracy", min(candidate_limit, len(features))),
        ("explainability", min(max(10, candidate_limit // 2), len(features))),
        ("segmentability", min(max(15, candidate_limit), len(features))),
    ]
    candidates = []
    for strategy, limit in strategies:
        subset = autopilot_feature_subset(features, strategy, limit)
        model = train_feature_importance_model(rows, subset, seed)
        candidates.append({
            "strategy": strategy,
            "featureCount": len(subset),
            "score": score_autopilot_candidate(model, subset, strategy, priority),
            "rocAuc": model.get("rocAuc"),
            "prAuc": model.get("prAuc"),
            "validationLogLoss": model.get("validationLogLoss"),
            "features": subset,
            "model": model,
        })

    selected = max(candidates, key=lambda item: item["score"]) if candidates else {
        "strategy": "accuracy",
        "features": features,
        "model": train_feature_importance_model(rows, features, seed),
        "score": 0,
    }
    metadata = [
        {
            "strategy": item["strategy"],
            "featureCount": item["featureCount"],
            "score": round(item["score"], 4),
            "rocAuc": item.get("rocAuc"),
            "prAuc": item.get("prAuc"),
            "validationLogLoss": item.get("validationLogLoss"),
        }
        for item in candidates
    ]
    return selected["features"], selected["model"], metadata
