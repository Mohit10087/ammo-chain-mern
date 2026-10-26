"""
features.py
-----------
Per-transaction feature extraction module for ML Anomaly Detection.
Constructs engineered features without label leakage.

Features:
- quantity: Raw transaction quantity
- quantity_ratio: quantity / typical issue quantity for ammo type
- z_score_recent: (quantity - rolling_mean_10) / (rolling_std_10 + eps)
- minutes_since_last_lot_event: time delta from preceding event on same lot
- events_last_hour_lot: event frequency for same lot in past 60 min
- events_last_day_lot: event frequency for same lot in past 24 hours
- hour_of_day: 0 to 23
- is_off_hours: 1 if hour < 6 or hour >= 20 else 0
- One-hot encoded action types
- One-hot encoded ammo types
"""

import numpy as np
import pandas as pd

AMMO_TYPICAL = {
    "5.56mm": 4000,
    "7.62mm": 2500,
    "9mm": 2000,
    "12.7mm": 600,
    "81mm-mortar": 150,
}

ACTIONS = ["ISSUE_LOT", "TRANSFER_LOT", "CONSUME"]
AMMO_TYPES = ["5.56mm", "7.62mm", "9mm", "12.7mm", "81mm-mortar"]

FEATURE_NAMES = [
    "quantity",
    "quantity_ratio",
    "z_score_recent",
    "minutes_since_last_lot_event",
    "events_last_hour_lot",
    "events_last_day_lot",
    "hour_of_day",
    "is_off_hours",
] + [f"action_{a}" for a in ACTIONS] + [f"ammo_{a}" for a in AMMO_TYPES]


def extract_features(df_transactions, df_lots=None):
    """
    Extracts features for a chronological dataframe of transactions.
    Guarantees no label leakage.
    """
    df = df_transactions.copy()
    df["timestamp"] = pd.to_datetime(df["timestamp"])
    df = df.sort_values("timestamp").reset_index(drop=True)

    # 1. Base quantities & ratios
    df["typical_qty"] = df["ammo_type"].map(lambda a: AMMO_TYPICAL.get(a, 2000))
    df["quantity_ratio"] = df["quantity"] / df["typical_qty"]

    # 2. Time-of-day features
    df["hour_of_day"] = df["timestamp"].dt.hour
    df["is_off_hours"] = df["hour_of_day"].apply(lambda h: 1 if (h < 6 or h >= 20) else 0)

    # 3. Rolling Z-Score per ammo type over previous 10 issues
    z_scores = []
    # Track historical issue quantities per ammo type
    history_per_ammo = {a: [] for a in AMMO_TYPES}

    for idx, row in df.iterrows():
        a = row["ammo_type"]
        q = row["quantity"]
        hist = history_per_ammo.get(a, [])
        if len(hist) >= 3 and row["action"] == "ISSUE_LOT":
            mean_q = np.mean(hist[-10:])
            std_q = np.std(hist[-10:]) + 1e-4
            z = (q - mean_q) / std_q
        else:
            z = 0.0
        z_scores.append(float(z))

        if row["action"] == "ISSUE_LOT":
            if a not in history_per_ammo:
                history_per_ammo[a] = []
            history_per_ammo[a].append(q)

    df["z_score_recent"] = z_scores

    # 4. Lot event inter-arrival times and burst counts
    minutes_since_last = []
    events_last_hour = []
    events_last_day = []

    lot_timestamps = {}  # lot_id -> list of timestamps

    for idx, row in df.iterrows():
        lid = row["lot_id"]
        t = row["timestamp"]

        if lid not in lot_timestamps:
            minutes_since_last.append(9999.0)  # Large default for first event
            events_last_hour.append(0)
            events_last_day.append(0)
            lot_timestamps[lid] = [t]
        else:
            prev_times = lot_timestamps[lid]
            delta_min = (t - prev_times[-1]).total_seconds() / 60.0
            minutes_since_last.append(float(delta_min))

            # Count events in past 1 hr and past 24 hr
            one_hr_ago = t - pd.Timedelta(hours=1)
            one_day_ago = t - pd.Timedelta(hours=24)
            cnt_hr = sum(1 for pt in prev_times if pt >= one_hr_ago)
            cnt_day = sum(1 for pt in prev_times if pt >= one_day_ago)

            events_last_hour.append(cnt_hr)
            events_last_day.append(cnt_day)
            lot_timestamps[lid].append(t)

    df["minutes_since_last_lot_event"] = minutes_since_last
    df["events_last_hour_lot"] = events_last_hour
    df["events_last_day_lot"] = events_last_day

    # 5. One-hot encodings
    for a in ACTIONS:
        df[f"action_{a}"] = (df["action"] == a).astype(int)
    for a in AMMO_TYPES:
        df[f"ammo_{a}"] = (df["ammo_type"] == a).astype(int)

    X = df[FEATURE_NAMES].fillna(0)
    return X, df
