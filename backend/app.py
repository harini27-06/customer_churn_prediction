"""ChurnGuard AI API. All predictions come from the persisted sklearn pipeline."""

from __future__ import annotations

import csv
import io
import json
import logging
import os
import re
import secrets
import sqlite3
from functools import lru_cache, wraps
from datetime import datetime, timedelta, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from flask import Flask, jsonify, request, Response, session
from flask_cors import CORS
from werkzeug.exceptions import BadRequest
from werkzeug.security import check_password_hash, generate_password_hash
try:
    from .order_features import ORDER_FEATURES, merge_order_features, summarize_orders
except ImportError:
    from order_features import ORDER_FEATURES, merge_order_features, summarize_orders

ROOT = Path(__file__).resolve().parents[1]
MODEL_PATH = Path(os.getenv("CHURN_MODEL", ROOT / "models" / "churn_pipeline.joblib"))
METRICS_PATH = Path(os.getenv("CHURN_METRICS", ROOT / "models" / "model_metrics.json"))
DATA_PATH = Path(os.getenv("CHURN_DATASET", ROOT / "dataset" / "ecommerce_churn_synthetic.csv"))
ORDERS_DATA_PATH = Path(os.getenv("CHURN_ORDERS_DATASET", ROOT / "dataset" / "ecommerce_orders_synthetic.csv"))
DATABASE_PATH = Path(os.getenv("CHURN_DATABASE", ROOT / "data" / "prediction_history.sqlite3"))
AUTH_DATABASE_PATH = Path(os.getenv("CHURN_AUTH_DATABASE", ROOT / "data" / "accounts.sqlite3"))
MAX_UPLOAD_BYTES = 16 * 1024 * 1024
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("churnguard")

app = Flask(__name__)
secret_path = AUTH_DATABASE_PATH.parent / ".churnguard_session_secret"
secret_path.parent.mkdir(parents=True, exist_ok=True)
try:
    with secret_path.open("x", encoding="utf-8") as secret_file:
        secret_file.write(secrets.token_urlsafe(48))
except FileExistsError:
    pass
app.secret_key = os.getenv("CHURNGUARD_SECRET_KEY") or secret_path.read_text(encoding="utf-8").strip()
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=os.getenv("SESSION_COOKIE_SECURE", "false").lower() == "true",
    PERMANENT_SESSION_LIFETIME=timedelta(hours=12),
)
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_BYTES
CORS(app, supports_credentials=True, resources={r"/api/*": {"origins": os.getenv("CORS_ORIGINS", r"https?://(localhost|127\.0\.0\.1)(:\d+)?").split(",") if os.getenv("CORS_ORIGINS") else r"https?://(localhost|127\.0\.0\.1)(:\d+)?"}})


def load_artifact():
    if not MODEL_PATH.exists():
        return None
    try:
        return joblib.load(MODEL_PATH)
    except Exception:
        logger.exception("Could not load model artifact")
        return None


ARTIFACT = load_artifact()


@lru_cache(maxsize=8)
def cached_csv(path: str, modified_ns: int) -> pd.DataFrame:
    return pd.read_csv(path).rename(columns=lambda name: str(name).strip())


@lru_cache(maxsize=4)
def cached_order_summaries(path: str, modified_ns: int) -> pd.DataFrame:
    return summarize_orders(cached_csv(path, modified_ns))


def get_dataset() -> pd.DataFrame | None:
    if not DATA_PATH.exists():
        return None
    try:
        return cached_csv(str(DATA_PATH.resolve()), DATA_PATH.stat().st_mtime_ns).copy()
    except Exception:
        logger.exception("Could not read configured dataset")
        return None


def get_orders_dataset() -> pd.DataFrame | None:
    if not ORDERS_DATA_PATH.exists():
        return None
    try:
        return cached_csv(str(ORDERS_DATA_PATH.resolve()), ORDERS_DATA_PATH.stat().st_mtime_ns).copy()
    except Exception:
        logger.exception("Could not read configured orders dataset")
        return None


def get_order_summaries() -> pd.DataFrame | None:
    if not ORDERS_DATA_PATH.exists():
        return None
    try:
        return cached_order_summaries(str(ORDERS_DATA_PATH.resolve()), ORDERS_DATA_PATH.stat().st_mtime_ns)
    except Exception:
        logger.exception("Could not summarize configured order history")
        return None


def get_customer_dataset() -> pd.DataFrame | None:
    customers = get_dataset()
    orders = get_orders_dataset()
    if customers is not None and orders is not None:
        try:
            return merge_order_features(customers, orders, get_order_summaries())
        except (ValueError, KeyError):
            logger.exception("Could not join order history to customers")
    return customers


def db_connection():
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("""CREATE TABLE IF NOT EXISTS predictions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL,
        customer_id TEXT,
        predicted_label TEXT NOT NULL,
        probability REAL,
        risk TEXT,
        model_version TEXT,
        details_json TEXT NOT NULL
    )""")
    connection.commit()
    return connection


def as_json_value(value):
    if pd.isna(value):
        return None
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        return float(value)
    if isinstance(value, (np.bool_,)):
        return bool(value)
    return value.item() if isinstance(value, np.generic) else value


def risk_for(probability):
    if probability is None:
        return None
    if probability >= 0.7:
        return "High"
    if probability >= 0.4:
        return "Medium"
    return "Low"


def predict_rows(rows: list[dict], persist: bool = True) -> list[dict]:
    if ARTIFACT is None:
        raise RuntimeError("No trained model is available. Train a model from your labeled dataset first.")
    metadata = ARTIFACT["metadata"]
    features = metadata["features"]
    resolved_rows = [dict(row) for row in rows]
    needs_order_features = any(feature in ORDER_FEATURES and any(feature not in row for row in resolved_rows) for feature in features)
    if needs_order_features:
        orders = get_orders_dataset()
        if orders is not None:
            try:
                order_summaries = get_order_summaries()
                if order_summaries is None:
                    raise ValueError("Could not prepare order history.")
                order_summaries = order_summaries.copy()
                order_summaries["_customer_key"] = order_summaries["CustomerID"].astype(str)
                summaries_by_customer = order_summaries.set_index("_customer_key").to_dict(orient="index")
            except (ValueError, KeyError):
                logger.exception("Could not prepare order history for prediction")
                summaries_by_customer = {}
        else:
            summaries_by_customer = {}
        for row in resolved_rows:
            customer_id = next((row.get(key) for key in row if key.lower().replace("_", "") in {"customerid", "userid", "accountid"}), None)
            summary = summaries_by_customer.get(str(customer_id), {})
            fallback_features = {
                "TotalOrders": "Frequency",
                "DeliveredOrders": "Frequency",
                "OrderRevenue": "MonetaryValue",
                "OrderAverageValue": "AverageOrderValue",
                "DaysSinceLastOrder": "RecencyDays",
                "DistinctOrderCategories": "DistinctCategories",
                "AverageOrderDiscount": "MeanDiscountPercent",
            }
            for feature in ORDER_FEATURES:
                if feature in features and feature not in row:
                    row[feature] = summary.get(feature, row.get(fallback_features.get(feature, ""), 0))
    missing = [feature for feature in features if any(feature not in row for row in resolved_rows)]
    if missing:
        raise ValueError(f"Missing required model feature columns: {sorted(set(missing))}")
    frame = pd.DataFrame([{name: row.get(name) for name in features} for row in resolved_rows], columns=features)
    for name in metadata.get("numeric_features", []):
        invalid = frame[name].notna() & pd.to_numeric(frame[name], errors="coerce").isna()
        if invalid.any():
            raise ValueError(f"Feature '{name}' must contain numeric values; invalid row positions: {list(frame.index[invalid] + 1)}")
        frame[name] = pd.to_numeric(frame[name], errors="coerce")
    pipeline = ARTIFACT["pipeline"]
    encoded = pipeline.predict(frame)
    classes = [str(value) for value in metadata["classes"]]
    labels = ARTIFACT["label_encoder"].inverse_transform(encoded.astype(int)).astype(str)
    try:
        probabilities = pipeline.predict_proba(frame)
        positive_index = classes.index(str(metadata["positive_class"]))
        churn_probabilities = probabilities[:, positive_index]
    except (AttributeError, ValueError, KeyError):
        churn_probabilities = [None] * len(rows)
    results = []
    records = []
    for row, label, probability in zip(resolved_rows, labels, churn_probabilities):
        churn_probability = None if probability is None else float(probability)
        record = {
            "predicted_status": str(label),
            "positive_class": str(metadata["positive_class"]),
            "churn_probability": churn_probability,
            "risk_category": risk_for(churn_probability),
            "model_version": metadata.get("model_version"),
            "customer_id": next((row.get(key) for key in row if key.lower().replace("_", "") in {"customerid", "userid", "accountid"}), None),
            "prediction_id": None,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        if persist:
            records.append((record["created_at"], None if record["customer_id"] is None else str(record["customer_id"]), record["predicted_status"], churn_probability, record["risk_category"], record["model_version"], "{}"))
        results.append(record)
    if records:
        connection = db_connection()
        connection.executemany(
            "INSERT INTO predictions (created_at, customer_id, predicted_label, probability, risk, model_version, details_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
            records,
        )
        connection.commit()
        connection.close()
    return results


def error(message: str, status: int):
    return jsonify({"success": False, "error": {"message": message}}), status


def account_connection():
    AUTH_DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(AUTH_DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("""CREATE TABLE IF NOT EXISTS accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
    )""")
    connection.commit()
    return connection


def account_for_session():
    account_id = session.get("account_id")
    if not account_id:
        return None
    connection = account_connection()
    account = connection.execute("SELECT id, name, email FROM accounts WHERE id = ?", (account_id,)).fetchone()
    connection.close()
    if account is None:
        session.clear()
        return None
    return dict(account)


def require_auth(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if account_for_session() is None:
            return error("Please sign in to continue.", 401)
        return view(*args, **kwargs)
    return wrapped


@app.get("/api/auth/session")
def auth_session():
    account = account_for_session()
    return jsonify({"success": True, "data": {"authenticated": account is not None, "account": account}})


@app.post("/api/auth/register")
def auth_register():
    payload = request.get_json(silent=True) or {}
    name = str(payload.get("name", "")).strip()
    email = str(payload.get("email", "")).strip().lower()
    password = str(payload.get("password", ""))
    if len(name) < 2 or len(name) > 80:
        return error("Enter your name (2 to 80 characters).", 400)
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
        return error("Enter a valid email address.", 400)
    if len(password) < 8:
        return error("Choose a password with at least 8 characters.", 400)
    connection = account_connection()
    try:
        cursor = connection.execute(
            "INSERT INTO accounts (name, email, password_hash, created_at) VALUES (?, ?, ?, ?)",
            (name, email, generate_password_hash(password), datetime.now(timezone.utc).isoformat()),
        )
        connection.commit()
        account = {"id": cursor.lastrowid, "name": name, "email": email}
    except sqlite3.IntegrityError:
        connection.close()
        return error("An account with this email already exists. Sign in instead.", 409)
    connection.close()
    session.clear()
    session["account_id"] = account["id"]
    session.permanent = True
    return jsonify({"success": True, "data": {"account": account}}), 201


@app.post("/api/auth/login")
def auth_login():
    payload = request.get_json(silent=True) or {}
    email = str(payload.get("email", "")).strip().lower()
    password = str(payload.get("password", ""))
    connection = account_connection()
    account = connection.execute("SELECT id, name, email, password_hash FROM accounts WHERE email = ?", (email,)).fetchone()
    connection.close()
    if account is None or not check_password_hash(account["password_hash"], password):
        return error("Email or password is incorrect.", 401)
    session.clear()
    session["account_id"] = account["id"]
    session.permanent = True
    return jsonify({"success": True, "data": {"account": {"id": account["id"], "name": account["name"], "email": account["email"]}}})


@app.post("/api/auth/logout")
def auth_logout():
    session.clear()
    return jsonify({"success": True, "data": {"signed_out": True}})


@app.errorhandler(413)
def too_large(_error):
    return error("Upload exceeds the 16 MB limit.", 413)


@app.get("/api/health")
def health():
    dataset = get_dataset()
    orders = get_orders_dataset()
    return jsonify({
        "success": True,
        "data": {
            "backend": "connected",
            "model_available": ARTIFACT is not None,
            "dataset_available": dataset is not None,
            "dataset_rows": 0 if dataset is None else len(dataset),
            "model_version": None if ARTIFACT is None else ARTIFACT["metadata"].get("model_version"),
            "trained_at": None if ARTIFACT is None else ARTIFACT["metadata"].get("trained_at"),
            "features": [] if ARTIFACT is None else ARTIFACT["metadata"].get("features", []),
            "feature_schema": [] if ARTIFACT is None else ARTIFACT["metadata"].get("feature_schema", []),
            "target": None if ARTIFACT is None else ARTIFACT["metadata"].get("target"),
            "positive_class": None if ARTIFACT is None else ARTIFACT["metadata"].get("positive_class"),
            "dataset_name": DATA_PATH.name if dataset is not None else None,
            "orders_available": orders is not None,
            "orders_dataset_name": ORDERS_DATA_PATH.name if orders is not None else None,
        },
    })


@app.get("/api/analytics")
@require_auth
def analytics():
    frame = get_dataset()
    if frame is None:
        return jsonify({"success": True, "data": {"available": False, "message": "Add a labeled CSV at dataset/ecommerce_churn_synthetic.csv or configure CHURN_DATASET to populate analytics.", "columns": [], "total_customers": 0, "churn_count": 0, "retained_count": 0, "churn_rate": None, "retention_rate": None, "charts": {}, "sample": []}})
    orders = get_orders_dataset()
    if orders is not None:
        try:
            frame = merge_order_features(frame, orders, get_order_summaries())
        except (ValueError, KeyError):
            logger.exception("Could not join order history to analytics")
    target = None if ARTIFACT is None else ARTIFACT["metadata"].get("target")
    if target not in frame.columns:
        target = next((column for column in frame.columns if str(column).strip().lower() in {"churn", "exited", "attrition"}), None)
    total = int(len(frame))
    filter_options = {}
    for key, candidates in {
        "churn": [target] if target else [],
        "contract": ["Contract", "contract", "Membership"],
        "payment_method": ["PaymentMethod", "Payment Method", "payment_method", "PreferredPaymentMethod"],
    }.items():
        column = next((name for name in candidates if name in frame.columns), None)
        if column:
            filter_options[key] = sorted(frame[column].dropna().astype(str).unique().tolist())
    churned = retained = None
    charts = {}
    if target:
        values = frame[target].astype(str).str.strip()
        positive = str(ARTIFACT["metadata"].get("positive_class")) if ARTIFACT is not None and ARTIFACT["metadata"].get("target") == target else next((str(value) for value in values.unique() if str(value).lower() in {"yes", "true", "1", "churn", "exited"}), None)
        if positive is not None:
            churned = int((values == positive).sum())
            retained = total - churned
            charts["distribution"] = [{"name": "Churned", "value": churned}, {"name": "Retained", "value": retained}]
            membership = next((column for column in frame.columns if column.lower() in {"contract", "membership"}), None)
            contract = membership
            if contract:
                charts["contract"] = []
                for category, group in frame.assign(_churn=values == positive).groupby(contract, dropna=False):
                    charts["contract"].append({"name": str(category), "churn_rate": round(float(group["_churn"].mean() * 100), 2), "customers": int(len(group))})
            for column, key in (("PreferredPaymentMethod", "payment_method"), ("PreferredCategory", "category")):
                if column in frame.columns:
                    grouped_frame = frame.assign(_churn=values == positive)
                    charts[key] = [{"name": str(category), "churn_rate": round(float(group["_churn"].mean() * 100), 2), "customers": int(len(group))} for category, group in grouped_frame.groupby(column, dropna=False)]
            frequency = next((column for column in frame.columns if column.lower() in {"frequency", "orders"}), None)
            if frequency:
                amounts = pd.to_numeric(frame[frequency], errors="coerce")
                groups = pd.cut(amounts, bins=[-np.inf, 2, 5, 10, 20, np.inf], labels=["1–2", "3–5", "6–10", "11–20", "20+"])
                grouped = pd.DataFrame({"group": groups, "churned": (values == positive).astype(int)}).dropna().groupby("group", observed=False).agg(customers=("churned", "size"), churn_rate=("churned", "mean"))
                charts["tenure"] = [{"name": str(index), "customers": int(row.customers), "churn_rate": round(float(row.churn_rate * 100), 2)} for index, row in grouped.iterrows()]
            tenure = next((column for column in frame.columns if column.lower() in {"tenure", "tenuremonths"}), None)
            if tenure:
                numeric_tenure = pd.to_numeric(frame[tenure], errors="coerce")
                buckets = pd.cut(numeric_tenure, bins=[-1, 12, 24, 48, 72, np.inf], labels=["0-12", "13-24", "25-48", "49-72", "73+"])
                grouped = pd.DataFrame({"group": buckets, "churned": (values == positive).astype(int)}).dropna().groupby("group", observed=False).agg(customers=("churned", "size"), churn_rate=("churned", "mean"))
                charts["tenure"] = [{"name": str(index), "customers": int(row.customers), "churn_rate": round(float(row.churn_rate * 100), 2)} for index, row in grouped.iterrows()]
            charges = next((column for column in frame.columns if column.lower().replace("_", "") == "monthlycharges"), None)
            if charges:
                charge_values = pd.to_numeric(frame[charges], errors="coerce")
                charge_groups = pd.cut(charge_values, bins=[-np.inf, 30, 60, 90, 120, np.inf], labels=["≤30", "31-60", "61-90", "91-120", "120+"])
                grouped = pd.DataFrame({"group": charge_groups, "churned": (values == positive).astype(int)}).dropna().groupby("group", observed=False).agg(customers=("churned", "size"), churn_rate=("churned", "mean"))
                charts["monthly_charge_groups"] = [{"name": str(index), "customers": int(row.customers), "churn_rate": round(float(row.churn_rate * 100), 2)} for index, row in grouped.iterrows()]
    for column, key in [("MonthlyCharges", "monthly_charges"), ("Monthly Charges", "monthly_charges"), ("AverageOrderValue", "monthly_charges"), ("PaymentMethod", "payment_method"), ("Payment Method", "payment_method"), ("InternetService", "internet_service"), ("Internet Service", "internet_service")]:
        if column in frame.columns and key not in charts:
            if target and key in {"payment_method", "internet_service"} and churned is not None:
                tmp = frame.assign(_churn=frame[target].astype(str).str.strip() == positive)
                charts[key] = [{"name": str(category), "churn_rate": round(float(group["_churn"].mean() * 100), 2), "customers": int(len(group))} for category, group in tmp.groupby(column, dropna=False)]
            elif key == "monthly_charges":
                values_numeric = pd.to_numeric(frame[column], errors="coerce")
                charts[key] = [{"name": "Churned", "average": round(float(values_numeric[frame[target].astype(str).str.strip() == positive].mean()), 2)}, {"name": "Retained", "average": round(float(values_numeric[frame[target].astype(str).str.strip() != positive].mean()), 2)}] if target and churned is not None else []
    order_summary = None
    if orders is not None:
        order_copy = orders.copy()
        order_copy["OrderDate"] = pd.to_datetime(order_copy["OrderDate"], errors="coerce")
        order_copy["TotalAmount"] = pd.to_numeric(order_copy["TotalAmount"], errors="coerce").fillna(0)
        delivered_orders = order_copy[order_copy["OrderStatus"].astype(str).str.lower() == "delivered"]
        charts["sales_by_month"] = [{"name": str(month), "sales": round(float(amount), 2)} for month, amount in delivered_orders.dropna(subset=["OrderDate"]).groupby(delivered_orders["OrderDate"].dt.to_period("M"))["TotalAmount"].sum().items()]
        if "ProductCategory" in delivered_orders:
            charts["sales_by_category"] = [{"name": str(category), "sales": round(float(amount), 2)} for category, amount in delivered_orders.groupby("ProductCategory")["TotalAmount"].sum().sort_values(ascending=False).items()]
        per_order = delivered_orders.groupby("OrderID")["TotalAmount"].sum()
        order_summary = {
            "total_orders": int(order_copy["OrderID"].nunique()),
            "delivered_orders": int(delivered_orders["OrderID"].nunique()),
            "returned_orders": int((order_copy["OrderStatus"].astype(str).str.lower() == "returned").sum()),
            "cancelled_orders": int((order_copy["OrderStatus"].astype(str).str.lower() == "cancelled").sum()),
            "sales_revenue": round(float(delivered_orders["TotalAmount"].sum()), 2),
            "average_order_value": round(float(per_order.mean()), 2) if len(per_order) else 0,
        }
    return jsonify({"success": True, "data": {
        "available": True, "message": None, "columns": list(frame.columns), "total_customers": total,
        "churn_count": churned, "retained_count": retained,
        "churn_rate": None if churned is None or total == 0 else round(churned / total * 100, 2),
        "retention_rate": None if retained is None or total == 0 else round(retained / total * 100, 2),
        "target": target, "charts": charts, "filter_options": filter_options, "orders": order_summary,
        "sample": frame.head(5).astype(object).where(pd.notna(frame.head(5)), None).to_dict(orient="records"),
    }})


@app.get("/api/customers")
@require_auth
def customers():
    frame = get_customer_dataset()
    if frame is None:
        return jsonify({"success": True, "data": {"rows": [], "total": 0, "page": 1, "page_size": 25, "columns": []}})
    try:
        page = max(1, int(request.args.get("page", 1)))
        page_size = min(100, max(1, int(request.args.get("page_size", 25))))
    except ValueError:
        return error("page and page_size must be integers.", 400)
    query = request.args.get("search", "").strip().lower()
    if query:
        mask = frame.astype(str).apply(lambda column: column.str.lower().str.contains(query, regex=False)).any(axis=1)
        frame = frame[mask]
    filter_columns = {
        "churn": [str(ARTIFACT["metadata"].get("target"))] if ARTIFACT else ["Churn", "churn"],
        "contract": ["Contract", "contract", "Membership"],
        "payment_method": ["PaymentMethod", "Payment Method", "payment_method", "PreferredPaymentMethod"],
    }
    for param_name, possible_columns in filter_columns.items():
        value = request.args.get(param_name)
        column = next((name for name in possible_columns if name in frame.columns), None)
        if value and column:
            frame = frame[frame[column].astype(str).str.lower() == value.lower()]
    for param_name, candidates in [("tenure_min", ["tenure", "tenuremonths"]), ("tenure_max", ["tenure", "tenuremonths"]), ("monthly_min", ["monthlycharges", "monthly_charges"]), ("monthly_max", ["monthlycharges", "monthly_charges"] )]:
        value = request.args.get(param_name)
        column = next((name for name in frame.columns if name.lower().replace(" ", "").replace("_", "") in candidates), None)
        if value and column:
            try:
                threshold = float(value)
            except ValueError:
                return error(f"{param_name} must be numeric.", 400)
            numeric = pd.to_numeric(frame[column], errors="coerce")
            frame = frame[numeric >= threshold] if param_name.endswith("min") else frame[numeric <= threshold]
    total = len(frame)
    sort = request.args.get("sort")
    if sort in frame.columns:
        frame = frame.sort_values(sort, ascending=request.args.get("direction", "asc") != "desc", na_position="last")
    start = (page - 1) * page_size
    rows = frame.iloc[start:start + page_size].astype(object).where(pd.notna(frame.iloc[start:start + page_size]), None).to_dict(orient="records")
    return jsonify({"success": True, "data": {"rows": rows, "total": total, "page": page, "page_size": page_size, "columns": list(frame.columns)}})


@app.post("/api/predict")
@require_auth
def predict():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict) or not isinstance(payload.get("customer"), dict):
        return error("Send JSON in the form {\"customer\": { ...model features... }}.", 400)
    try:
        return jsonify({"success": True, "data": predict_rows([payload["customer"]])[0]})
    except RuntimeError as exc:
        return error(str(exc), 503)
    except ValueError as exc:
        return error(str(exc), 422)
    except Exception:
        logger.exception("Prediction failed")
        return error("Prediction could not be completed. Check the input values and model status.", 500)


@app.post("/api/predict/batch")
@require_auth
def predict_batch():
    if ARTIFACT is None:
        return error("No trained model is available. Train a model from your labeled dataset first.", 503)
    if request.files.get("file"):
        upload = request.files["file"]
        if not upload.filename or Path(upload.filename).suffix.lower() != ".csv":
            return error("Upload a .csv file.", 400)
        try:
            content = upload.stream.read(MAX_UPLOAD_BYTES + 1)
            if len(content) > MAX_UPLOAD_BYTES:
                return error("Upload exceeds the 16 MB limit.", 413)
            frame = pd.read_csv(io.BytesIO(content))
        except Exception:
            return error("The uploaded file could not be parsed as a CSV.", 400)
    else:
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict) or not isinstance(payload.get("customers"), list):
            return error("Send a CSV file or JSON in the form {\"customers\": [...]}.", 400)
        frame = pd.DataFrame(payload["customers"])
    if frame.empty:
        return error("The uploaded dataset contains no customer rows.", 400)
    if len(frame) > 10000:
        return error("A batch may contain at most 10,000 rows.", 413)
    features = ARTIFACT["metadata"]["features"]
    missing = [column for column in features if column not in frame.columns and column not in ORDER_FEATURES]
    if missing:
        return error(f"Missing required model columns: {missing}", 422)
    rows = frame.to_dict(orient="records")
    try:
        predictions = predict_rows(rows)
    except ValueError as exc:
        return error(str(exc), 422)
    results = [{**{key: as_json_value(value) for key, value in row.items()}, **prediction} for row, prediction in zip(rows, predictions)]
    return jsonify({"success": True, "data": {"results": results, "count": len(results), "model_version": ARTIFACT["metadata"].get("model_version")}})


@app.get("/api/model/metrics")
@require_auth
def model_metrics():
    if not METRICS_PATH.exists():
        return jsonify({"success": True, "data": {"available": False, "message": "No holdout evaluation is available. Train a model to generate test-set metrics."}})
    try:
        payload = json.loads(METRICS_PATH.read_text(encoding="utf-8"))
        return jsonify({"success": True, "data": {"available": True, **payload}})
    except Exception:
        logger.exception("Metrics file could not be loaded")
        return error("Model evaluation metadata could not be read.", 500)


@app.get("/api/predictions/history")
@require_auth
def prediction_history():
    try:
        page = max(1, int(request.args.get("page", 1)))
        page_size = min(100, max(1, int(request.args.get("page_size", 25))))
    except ValueError:
        return error("page and page_size must be integers.", 400)
    query = request.args.get("search", "").strip()
    connection = db_connection()
    where, params = ("WHERE customer_id LIKE ? OR predicted_label LIKE ?", [f"%{query}%", f"%{query}%"]) if query else ("", [])
    total = connection.execute(f"SELECT COUNT(*) FROM predictions {where}", params).fetchone()[0]
    rows = connection.execute(f"SELECT * FROM predictions {where} ORDER BY id DESC LIMIT ? OFFSET ?", [*params, page_size, (page - 1) * page_size]).fetchall()
    connection.close()
    records = [dict(row) for row in rows]
    for row in records:
        row["details"] = json.loads(row.pop("details_json"))
    return jsonify({"success": True, "data": {"rows": records, "total": total, "page": page, "page_size": page_size}})


@app.get("/api/predictions/history.csv")
@require_auth
def export_history():
    connection = db_connection()
    rows = connection.execute("SELECT created_at, customer_id, predicted_label, probability, risk, model_version FROM predictions ORDER BY id DESC").fetchall()
    connection.close()
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["created_at", "customer_id", "predicted_status", "churn_probability", "risk_category", "model_version"])
    writer.writerows([tuple(row) for row in rows])
    return Response(output.getvalue(), mimetype="text/csv", headers={"Content-Disposition": "attachment; filename=prediction-history.csv"})


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.getenv("PORT", "5000")), debug=os.getenv("FLASK_DEBUG", "false").lower() == "true")
