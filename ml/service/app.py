"""
app.py
------
FastAPI microservice serving real-time Isolation Forest anomaly scores
with explainability feature breakdowns for Ordnance-Chain.
"""

import os
import json
import joblib
import numpy as np
from datetime import datetime
from typing import List, Optional
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI(title="Ordnance-Chain ML Anomaly Scoring Service", version="1.0.0")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.join(BASE_DIR, "../models")

model_path = os.path.join(MODELS_DIR, "isolation_forest.joblib")
config_path = os.path.join(MODELS_DIR, "feature_config.json")

# Load model and config on startup
if os.path.exists(model_path) and os.path.exists(config_path):
    iso_model = joblib.load(model_path)
    with open(config_path, "r") as f:
        config = json.load(f)
else:
    iso_model = None
    config = {}

AMMO_MAP = {
    "5.56x45mm": "5.56mm",
    "5.56mm": "5.56mm",
    "7.62x51mm": "7.62mm",
    "7.62mm": "7.62mm",
    "9x19mm": "9mm",
    "9mm": "9mm",
    "12.7mm": "12.7mm",
    "81mm-mortar": "81mm-mortar"
}

TYPICAL_QTY = {
    "5.56mm": 4000,
    "7.62mm": 2500,
    "9mm": 2000,
    "12.7mm": 600,
    "81mm-mortar": 150
}


class ScoreRequest(BaseModel):
    lotID: Optional[str] = None
    ammoType: str
    action: str
    quantity: float
    timestamp: Optional[str] = None
    recentIssuesSameType: Optional[List[float]] = None
    minutesSinceLastLotEvent: Optional[float] = None
    eventsLastHour: Optional[int] = None
    eventsLastDay: Optional[int] = None


@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "ordnance-ml-anomaly",
        "modelLoaded": iso_model is not None,
        "nFeatures": config.get("n_features", 0)
    }


@app.post("/score")
def score_transaction(req: ScoreRequest):
    if iso_model is None or not config:
        raise HTTPException(status_code=503, detail="Isolation Forest model not loaded")

    ammo = AMMO_MAP.get(req.ammoType, "5.56mm")
    typical = TYPICAL_QTY.get(ammo, 2000)
    q = float(req.quantity)
    q_ratio = q / typical

    # Time of day
    if req.timestamp:
        try:
            dt = datetime.fromisoformat(req.timestamp.replace("Z", "+00:00"))
            hour = dt.hour
        except Exception:
            hour = datetime.utcnow().hour
    else:
        hour = datetime.utcnow().hour

    is_off_hours = 1 if (hour < 6 or hour >= 20) else 0

    # Z-score recent
    recent = req.recentIssuesSameType or []
    if len(recent) >= 3:
        mean_q = float(np.mean(recent[-10:]))
        std_q = float(np.std(recent[-10:])) + 1e-4
        z_score_recent = float((q - mean_q) / std_q)
    else:
        z_score_recent = 0.0

    mins_last = float(req.minutesSinceLastLotEvent if req.minutesSinceLastLotEvent is not None else 9999.0)
    ev_hr = int(req.eventsLastHour if req.eventsLastHour is not None else 0)
    ev_day = int(req.eventsLastDay if req.eventsLastDay is not None else 0)

    # Construct feature vector matching FEATURE_NAMES
    vector = [
        q,
        q_ratio,
        z_score_recent,
        mins_last,
        ev_hr,
        ev_day,
        hour,
        is_off_hours,
        # One-hot actions: ["ISSUE_LOT", "TRANSFER_LOT", "CONSUME"]
        1 if req.action in ["ISSUE_LOT", "ISSUE_TO_DEPOT", "ISSUE_TO_UNIT"] else 0,
        1 if req.action == "TRANSFER_LOT" or req.action == "TRANSFER" else 0,
        1 if req.action in ["CONSUME", "RECORD_CONSUMPTION"] else 0,
        # One-hot ammo: ["5.56mm", "7.62mm", "9mm", "12.7mm", "81mm-mortar"]
        1 if ammo == "5.56mm" else 0,
        1 if ammo == "7.62mm" else 0,
        1 if ammo == "9mm" else 0,
        1 if ammo == "12.7mm" else 0,
        1 if ammo == "81mm-mortar" else 0,
    ]

    feature_names = config.get("feature_names", [])
    import pandas as pd
    X = pd.DataFrame([vector], columns=feature_names)

    # Invert decision function: lower is anomalous in sklearn, so negate it
    raw_score = float(-iso_model.decision_function(X)[0])
    pred = int(iso_model.predict(X)[0])
    is_anomaly = (pred == -1)

    # Normalize score approximately 0-1
    normalized_score = round(float(np.clip(raw_score + 0.5, 0.0, 1.0)), 3)

    # Explainability: Top 3 deviating features
    train_mean = config.get("train_mean", {})
    train_std = config.get("train_std", {})
    feature_names = config.get("feature_names", [])

    deviations = []
    for i, name in enumerate(feature_names):
        val = vector[i]
        m = train_mean.get(name, 0.0)
        s = train_std.get(name, 1.0) + 1e-4
        z = abs(val - m) / s
        deviations.append({
            "feature": name,
            "value": round(float(val), 2),
            "zScore": round(float(z), 2)
        })

    deviations.sort(key=lambda x: x["zScore"], reverse=True)
    top_features = deviations[:3]

    return {
        "isAnomaly": is_anomaly,
        "anomalyScore": normalized_score,
        "topFeatures": top_features,
        "rawScore": round(raw_score, 4),
        "model": "IsolationForest",
        "contamination": config.get("contamination", 0.05)
    }
