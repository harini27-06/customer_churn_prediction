"""Customer level summaries derived from the ecommerce order history."""

from __future__ import annotations

import pandas as pd


ORDER_FEATURES = [
    "TotalOrders",
    "DeliveredOrders",
    "ReturnedOrders",
    "CancelledOrders",
    "OrderRevenue",
    "OrderAverageValue",
    "DaysSinceLastOrder",
    "DistinctOrderCategories",
    "AverageOrderDiscount",
]


def summarize_orders(orders: pd.DataFrame) -> pd.DataFrame:
    """Return order activity per customer; sales metrics count delivered orders only."""
    required = {"CustomerID", "OrderID", "OrderDate", "OrderStatus", "TotalAmount"}
    missing = required - set(orders.columns)
    if missing:
        raise ValueError(f"Orders file is missing required columns: {sorted(missing)}")
    frame = orders.copy()
    frame["OrderDate"] = pd.to_datetime(frame["OrderDate"], errors="coerce")
    frame["TotalAmount"] = pd.to_numeric(frame["TotalAmount"], errors="coerce").fillna(0)
    frame["OrderStatus"] = frame["OrderStatus"].astype(str).str.strip().str.lower()
    as_of = frame["OrderDate"].max()
    delivered = frame[frame["OrderStatus"] == "delivered"]
    summaries = frame.groupby("CustomerID", dropna=False).agg(
        TotalOrders=("OrderID", "nunique"),
        ReturnedOrders=("OrderStatus", lambda values: int((values == "returned").sum())),
        CancelledOrders=("OrderStatus", lambda values: int((values == "cancelled").sum())),
        LatestOrderDate=("OrderDate", "max"),
        DistinctOrderCategories=("ProductCategory", "nunique") if "ProductCategory" in frame else ("OrderID", "nunique"),
        AverageOrderDiscount=("DiscountPercent", "mean") if "DiscountPercent" in frame else ("TotalAmount", lambda _values: 0.0),
    )
    delivered_summary = delivered.groupby("CustomerID").agg(
        DeliveredOrders=("OrderID", "nunique"),
        OrderRevenue=("TotalAmount", "sum"),
        OrderAverageValue=("TotalAmount", "mean"),
    )
    summaries = summaries.join(delivered_summary).fillna({"DeliveredOrders": 0, "OrderRevenue": 0, "OrderAverageValue": 0})
    summaries["DaysSinceLastOrder"] = (as_of - summaries.pop("LatestOrderDate")).dt.days.fillna(0).astype(int)
    summaries.index.name = "CustomerID"
    return summaries.reset_index()


def merge_order_features(customers: pd.DataFrame, orders: pd.DataFrame, summaries: pd.DataFrame | None = None) -> pd.DataFrame:
    """Add order summaries to labeled customer rows using their shared customer ID."""
    if "CustomerID" not in customers.columns:
        raise ValueError("Customer dataset must include CustomerID to join order history.")
    summaries = summarize_orders(orders) if summaries is None else summaries
    merged = customers.merge(summaries, on="CustomerID", how="left", validate="one_to_one")
    for column in ORDER_FEATURES:
        if column in {"TotalOrders", "DeliveredOrders", "ReturnedOrders", "CancelledOrders", "DistinctOrderCategories", "DaysSinceLastOrder"}:
            merged[column] = merged[column].fillna(0).astype(int)
        else:
            merged[column] = merged[column].fillna(0)
    return merged
