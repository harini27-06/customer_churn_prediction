"""Train and persist the churn model and its evaluation metadata."""

from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
try:
    from .order_features import merge_order_features
except ImportError:
    from order_features import merge_order_features
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.inspection import permutation_importance
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    accuracy_score,
    average_precision_score,
    classification_report,
    confusion_matrix,
    f1_score,
    make_scorer,
    precision_recall_curve,
    precision_score,
    recall_score,
    roc_auc_score,
    roc_curve,
)
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, LabelEncoder

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATA = ROOT / "dataset" / "ecommerce_churn_synthetic.csv"
DEFAULT_ORDERS_DATA = ROOT / "dataset" / "ecommerce_orders_synthetic.csv"
DEFAULT_MODEL = ROOT / "models" / "churn_pipeline.joblib"
DEFAULT_METRICS = ROOT / "models" / "model_metrics.json"


def normalize_name(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value).strip().lower())


def find_target(columns: list[str], requested: str | None) -> str:
    if requested:
        match = next((name for name in columns if name == requested), None)
        if match is None:
            raise ValueError(f"Target column '{requested}' was not found. Available columns: {columns}")
        return match
    candidates = {"churn", "exited", "iscustomerchurn", "attrition", "target"}
    match = next((name for name in columns if normalize_name(name) in candidates), None)
    if not match:
        raise ValueError("Could not infer the target column. Pass --target with the churn label column name.")
    return match


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA, help="CSV containing customer features and churn labels")
    parser.add_argument("--orders-data", type=Path, default=DEFAULT_ORDERS_DATA, help="Optional ecommerce orders CSV joined by CustomerID")
    parser.add_argument("--target", help="Target column; inferred from common names when omitted")
    parser.add_argument("--positive-class", help="Exact churn-positive label; defaults to a common churn label or the second class")
    parser.add_argument("--model-out", type=Path, default=DEFAULT_MODEL)
    parser.add_argument("--metrics-out", type=Path, default=DEFAULT_METRICS)
    parser.add_argument("--test-size", type=float, default=0.2)
    parser.add_argument("--random-state", type=int, default=42)
    args = parser.parse_args()

    if not 0.1 <= args.test_size <= 0.5:
        raise ValueError("--test-size must be between 0.1 and 0.5")
    frame = pd.read_csv(args.data)
    frame.columns = [str(column).strip() for column in frame.columns]
    if args.orders_data.exists() and "CustomerID" in frame.columns:
        orders = pd.read_csv(args.orders_data)
        orders.columns = [str(column).strip() for column in orders.columns]
        frame = merge_order_features(frame, orders)
        print(f"Joined order history from {args.orders_data.name} for {frame['CustomerID'].nunique():,} customers")
    if frame.empty or frame.shape[1] < 2:
        raise ValueError("The CSV must contain at least one feature column and one target column.")
    target = find_target(list(frame.columns), args.target)
    frame = frame.dropna(subset=[target]).copy()
    labels = frame[target].astype(str).str.strip()
    if labels.nunique() != 2:
        raise ValueError(f"Target '{target}' must contain exactly two non-empty classes; found {labels.nunique()}.")
    label_encoder = LabelEncoder().fit(labels)
    y = label_encoder.transform(labels)
    if args.positive_class and args.positive_class not in label_encoder.classes_:
        raise ValueError(f"Positive class '{args.positive_class}' was not found. Available classes: {list(label_encoder.classes_)}")

    identifiers = [column for column in frame.columns if normalize_name(column) in {"customerid", "userid", "accountid"}]
    feature_columns = [column for column in frame.columns if column != target and column not in identifiers]
    if not feature_columns:
        raise ValueError("No usable feature columns remain after excluding the target and customer identifiers.")
    X = frame[feature_columns].replace(r"^\s*$", np.nan, regex=True)
    numeric_columns = [column for column in feature_columns if pd.api.types.is_numeric_dtype(X[column])]
    for column in feature_columns:
        if column in numeric_columns:
            continue
        converted = pd.to_numeric(X[column], errors="coerce")
        present = X[column].notna().sum()
        if present and converted.notna().sum() / present >= 0.9:
            numeric_columns.append(column)
    categorical_columns = [column for column in feature_columns if column not in numeric_columns]
    for column in numeric_columns:
        X[column] = pd.to_numeric(X[column], errors="coerce")
    if min(np.bincount(y)) < 2:
        raise ValueError("Each target class needs at least two records for a stratified test split.")

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=args.test_size, random_state=args.random_state, stratify=y
    )
    numeric_pipeline = Pipeline([("imputer", SimpleImputer(strategy="median"))])
    categorical_pipeline = Pipeline([
        ("imputer", SimpleImputer(strategy="most_frequent")),
        ("encode", OneHotEncoder(handle_unknown="ignore", sparse_output=False)),
    ])
    preprocess = ColumnTransformer([
        ("numeric", numeric_pipeline, numeric_columns),
        ("categorical", categorical_pipeline, categorical_columns),
    ], remainder="drop")
    pipeline = Pipeline([
        ("preprocess", preprocess),
        ("classifier", RandomForestClassifier(
            n_estimators=300,
            max_features="sqrt",
            class_weight="balanced_subsample",
            random_state=args.random_state,
            n_jobs=-1,
        )),
    ])
    pipeline.fit(X_train, y_train)
    predicted = pipeline.predict(X_test)
    positive_index = next(
        (index for index, value in enumerate(label_encoder.classes_) if value == args.positive_class),
        next((index for index, value in enumerate(label_encoder.classes_) if normalize_name(value) in {"yes", "true", "1", "churn", "exited"}), 1),
    )
    probabilities = pipeline.predict_proba(X_test)[:, positive_index]
    positive_labels = (y_test == positive_index).astype(int)
    try:
        auc = float(roc_auc_score(positive_labels, probabilities))
        fpr, tpr, _ = roc_curve(positive_labels, probabilities)
        roc_points = [{"fpr": float(x), "tpr": float(y_value)} for x, y_value in zip(fpr, tpr)]
    except ValueError:
        auc, roc_points = None, []
    precision_points, recall_points, _ = precision_recall_curve(positive_labels, probabilities)
    try:
        average_precision = float(average_precision_score(positive_labels, probabilities))
    except ValueError:
        average_precision = None
    importance = permutation_importance(
        pipeline,
        X_test,
        y_test,
        n_repeats=5,
        random_state=args.random_state,
        scoring=make_scorer(f1_score, pos_label=positive_index, zero_division=0),
    )
    feature_importance = sorted(
        [{"feature": name, "importance": float(value)} for name, value in zip(feature_columns, importance.importances_mean)],
        key=lambda item: item["importance"], reverse=True,
    )
    matrix = confusion_matrix(y_test, predicted, labels=[0, 1]).tolist()
    metrics = {
        "evaluated_at": datetime.now(timezone.utc).isoformat(),
        "evaluation_type": "stratified holdout test set",
        "test_size": len(y_test),
        "train_size": len(y_train),
        "class_distribution": {str(label_encoder.inverse_transform([index])[0]): int(count) for index, count in enumerate(np.bincount(y))},
        "accuracy": float(accuracy_score(y_test, predicted)),
        "precision": float(precision_score(y_test, predicted, pos_label=positive_index, zero_division=0)),
        "recall": float(recall_score(y_test, predicted, pos_label=positive_index, zero_division=0)),
        "f1": float(f1_score(y_test, predicted, pos_label=positive_index, zero_division=0)),
        "roc_auc": auc,
        "average_precision": average_precision,
        "confusion_matrix": matrix,
        "confusion_labels": [str(label_encoder.classes_[0]), str(label_encoder.classes_[1])],
        "roc_curve": roc_points,
        "precision_recall_curve": [{"recall": float(r), "precision": float(p)} for p, r in zip(precision_points, recall_points)],
        "feature_importance": feature_importance,
        "classification_report": classification_report(y_test, predicted, target_names=[str(value) for value in label_encoder.classes_], output_dict=True, zero_division=0),
    }
    metadata = {
        "target": target,
        "features": feature_columns,
        "numeric_features": numeric_columns,
        "categorical_features": categorical_columns,
        "feature_schema": [
            {
                "name": column,
                "type": "numeric" if column in numeric_columns else "categorical",
                "options": sorted(X[column].dropna().astype(str).unique().tolist())[:150] if column in categorical_columns else [],
            }
            for column in feature_columns
        ],
        "excluded_identifiers": identifiers,
        "classes": [str(value) for value in label_encoder.classes_],
        "positive_class": str(label_encoder.classes_[positive_index]),
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "model_version": "random-forest-v1",
        "training_rows": len(X),
        "missing_values": "Numeric features use training-set median imputation; categorical features use training-set most-frequent imputation.",
    }
    args.model_out.parent.mkdir(parents=True, exist_ok=True)
    args.metrics_out.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump({"pipeline": pipeline, "label_encoder": label_encoder, "metadata": metadata}, args.model_out)
    args.metrics_out.write_text(json.dumps({"metadata": metadata, "metrics": metrics}, indent=2), encoding="utf-8")
    print(f"Saved fitted pipeline: {args.model_out}")
    print(f"Saved holdout evaluation: {args.metrics_out}")
    print(json.dumps({key: metrics[key] for key in ("accuracy", "precision", "recall", "f1", "roc_auc")}, indent=2))


if __name__ == "__main__":
    main()
