import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import joblib
import pandas as pd

from backend import app as api_module
from backend import train_model


class ChurnApiIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp_dir = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temp_dir.name)
        cls.csv_path = cls.root / "customers.csv"
        cls.model_path = cls.root / "model.joblib"
        cls.metrics_path = cls.root / "metrics.json"
        cls.database_path = cls.root / "history.sqlite3"
        api_module.AUTH_DATABASE_PATH = cls.root / "accounts.sqlite3"
        api_module.ORDERS_DATA_PATH = cls.root / "no-orders.csv"
        rows = []
        for index in range(120):
            tenure = index % 60 + 1
            contract = "Month-to-month" if index % 3 else "One year"
            churn = "Yes" if (contract == "Month-to-month" and tenure < 36) else "No"
            rows.append({
                "customerID": f"TEST-{index:04d}",
                "tenure": str(tenure),
                "Contract": contract,
                "MonthlyCharges": 30 + index % 70,
                "Churn": churn,
            })
        pd.DataFrame(rows).to_csv(cls.csv_path, index=False)
        with patch.object(sys, "argv", ["train_model", "--data", str(cls.csv_path), "--orders-data", str(cls.root / "no-orders.csv"), "--model-out", str(cls.model_path), "--metrics-out", str(cls.metrics_path)]):
            train_model.main()
        api_module.ARTIFACT = joblib.load(cls.model_path)
        api_module.DATA_PATH = cls.csv_path
        api_module.MODEL_PATH = cls.model_path
        api_module.METRICS_PATH = cls.metrics_path
        api_module.DATABASE_PATH = cls.database_path
        cls.client = api_module.app.test_client()
        response = cls.client.post("/api/auth/register", json={"name": "Test User", "email": "test@example.test", "password": "temporary-test-password"})
        if response.status_code != 201:
            raise RuntimeError(f"Could not initialize authenticated API test client: {response.get_json()}")

    @classmethod
    def tearDownClass(cls):
        cls.temp_dir.cleanup()

    def setUp(self):
        connection = api_module.db_connection()
        connection.execute("DELETE FROM predictions")
        connection.commit()
        connection.close()

    def test_health_reports_saved_schema_and_dataset(self):
        response = self.client.get("/api/health", headers={"Origin": "http://127.0.0.1:5174"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers.get("Access-Control-Allow-Origin"), "http://127.0.0.1:5174")
        data = response.get_json()["data"]
        self.assertTrue(data["model_available"])
        self.assertTrue(data["dataset_available"])
        self.assertIn("tenure", data["features"])
        self.assertEqual(data["dataset_rows"], 120)

    def test_single_prediction_and_history_use_real_pipeline(self):
        response = self.client.post("/api/predict", json={"customer": {"tenure": 3, "Contract": "Month-to-month", "MonthlyCharges": 80}})
        self.assertEqual(response.status_code, 200)
        prediction = response.get_json()["data"]
        self.assertIn(prediction["predicted_status"], {"Yes", "No"})
        self.assertIsInstance(prediction["churn_probability"], float)
        self.assertIn(prediction["risk_category"], {"Low", "Medium", "High"})
        history = self.client.get("/api/predictions/history")
        self.assertEqual(history.status_code, 200)
        self.assertEqual(history.get_json()["data"]["total"], 1)

    def test_missing_features_return_validation_error(self):
        response = self.client.post("/api/predict", json={"customer": {"tenure": 4}})
        self.assertEqual(response.status_code, 422)
        self.assertIn("Contract", response.get_json()["error"]["message"])

    def test_batch_csv_and_metrics_endpoints(self):
        content = b"customerID,tenure,Contract,MonthlyCharges\nB-1,4,Month-to-month,78\nB-2,48,One year,45\n"
        response = self.client.post("/api/predict/batch", data={"file": (io.BytesIO(content), "batch.csv")}, content_type="multipart/form-data")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["data"]["count"], 2)
        metrics = self.client.get("/api/model/metrics").get_json()["data"]
        self.assertTrue(metrics["available"])
        self.assertEqual(metrics["metrics"]["test_size"] + metrics["metrics"]["train_size"], 120)

    def test_analytics_uses_loaded_dataset_counts(self):
        response = self.client.get("/api/analytics")
        data = response.get_json()["data"]
        self.assertTrue(data["available"])
        self.assertEqual(data["total_customers"], 120)
        self.assertIn("distribution", data["charts"])


if __name__ == "__main__":
    unittest.main()