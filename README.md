# ChurnGuard AI

ChurnGuard is a local customer-retention dashboard built with React, Flask, pandas, and scikit-learn. The current workspace includes **synthetic e-commerce demonstration data** (`dataset/ecommerce_churn_synthetic.csv` and `dataset/ecommerce_orders_synthetic.csv`), not real customer data. The dashboard identifies this clearly. Replace those files with approved data before presenting model results as business findings.

## Current project data

- 2,500 synthetic customer records with `Churn` labels (`1` means churn, `0` means retained).
- An order-history CSV that is joined by `CustomerID` to derive purchase activity and order-value features.
- A saved Random Forest pipeline and holdout evaluation in `models/`.
- SQLite files under `data/` for local account sessions and prediction history.

The saved model was evaluated on a stratified holdout split. Its stored scores describe only the included synthetic dataset and are not evidence of real-world performance. Probability risk bands are Low below 0.40, Medium from 0.40 to below 0.70, and High at or above 0.70; estimated probabilities may not be calibrated.

## Run in VS Code

Use two terminals from the project root.

Backend:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
py -m pip install -r backend\requirements.txt
py backend\app.py
```

Frontend:

```powershell
cd frontend
npm install
npm run dev
```

Open the Vite URL shown in the frontend terminal, normally `http://localhost:5173`. The Flask API runs at `http://127.0.0.1:5000`. Create a local workspace account on first use; account passwords are stored as salted password hashes in SQLite. The frontend uses credentialed local API requests.

## Train the model

Training is explicit and does not run on API requests. From the project root:

```powershell
.\.venv\Scripts\Activate.ps1
py backend\train_model.py
```

The trainer uses the included customer and order CSV paths by default, joins the order features on `CustomerID`, excludes customer identifiers from model features, splits data before fitting preprocessing, and writes the fitted pipeline and test metrics to `models/churn_pipeline.joblib` and `models/model_metrics.json`. The model feature schema and categorical options are saved with the pipeline and drive individual prediction form fields. For different files or target labels:

```powershell
py backend\train_model.py --data dataset\customers.csv --orders-data dataset\orders.csv --target Churn --positive-class 1
```

Use `--orders-data` with a path that does not exist when the customer file has no associated order history. Set `CHURN_DATASET`, `CHURN_ORDERS_DATASET`, `CHURN_MODEL`, `CHURN_METRICS`, `CHURN_DATABASE`, `CHURN_AUTH_DATABASE`, `CORS_ORIGINS`, or `PORT` to configure the local services.

## Included workflows

- Customer overview and e-commerce analytics based on loaded CSVs.
- Individual customer churn scoring using the persisted training pipeline.
- CSV batch review, schema checks, predictions, and result export.
- Holdout accuracy, precision, recall, F1, ROC-AUC, confusion matrix, ROC curve, and permutation feature importance.
- Searchable customer data and SQLite prediction history export.
- Local account registration and sign-in.

Predictions are estimates from historical patterns, not guarantees of future behavior. Feature importance and observed churn rates describe associations, not causes. Avoid uploading personally identifiable or sensitive customer data to this local academic demonstration unless you are authorized to do so.

## Tests

With backend dependencies installed:

```powershell
py -m unittest discover -s tests -v
```

The integration tests create temporary training data and use a temporary account/history database; they do not overwrite the project’s trained model or saved data.
