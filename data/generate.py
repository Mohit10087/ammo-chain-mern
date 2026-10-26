"""
Synthetic data + evaluation for Ordnance-Chain (blockchain ammunition management).
Reproducible: python3 generate.py  (seed fixed). Outputs go to ./out/

Datasets
  1. consumption_history.csv  - monthly consumption per unit x ammo type (36 months)
  2. lots.csv                 - ammunition lots with storage climate profile
  3. sensor_readings.csv      - daily temperature / humidity per lot (180 days)
  4. transactions.csv         - lifecycle events with injected, labelled anomalies
Evaluation (for report / paper)
  - forecast_eval.csv         - rolling-origin MAPE: naive vs 3-mo moving avg vs OLS
  - degradation_eval.csv      - threshold sweep: precision / recall / F1 / lead time
  - anomaly_eval.csv          - rule-based detector precision / recall per rule
  - 3 PNG charts
"""
import os
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

rng = np.random.default_rng(42)
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
os.makedirs(OUT, exist_ok=True)

AMMO = {  # type: (base monthly consumption per unit, typical issue qty per transaction)
    "5.56mm": (9000, 4000),
    "7.62mm": (6000, 2500),
    "9mm": (4500, 2000),
    "12.7mm": (1500, 600),
    "81mm-mortar": (400, 150),
}
UNITS = ["UNIT-ALPHA", "UNIT-BRAVO", "UNIT-CHARLIE"]
DEPOTS = ["DEPOT-01", "DEPOT-02"]

# ---------------------------------------------------------------- 1. consumption
months = pd.period_range("2023-10", periods=36, freq="M")
rows = []
for a, (base, _) in AMMO.items():
    for u in UNITS:
        scale = rng.uniform(0.7, 1.3)
        trend = rng.uniform(0.002, 0.012)           # slow growth per month
        phase = rng.uniform(0, 2 * np.pi)
        for i, m in enumerate(months):
            season = 1 + 0.25 * np.sin(2 * np.pi * i / 12 + phase)   # training-cycle seasonality
            exercise = rng.choice([1.0, 1.8], p=[0.92, 0.08])        # occasional large exercise
            noise = rng.lognormal(0, 0.12)
            q = base * scale * (1 + trend * i) * season * exercise * noise
            rows.append((str(m), u, a, int(round(q))))
cons = pd.DataFrame(rows, columns=["month", "unit", "ammo_type", "rounds_consumed"])
cons.to_csv(f"{OUT}/consumption_history.csv", index=False)

# ---------------------------------------------------------------- 2. lots
CLIMATES = {  # name: (mean temp C, mean RH %, share of lots)
    "controlled": (19, 42, 0.45),
    "temperate": (25, 55, 0.30),
    "hot-dry": (34, 35, 0.10),
    "hot-humid": (33, 78, 0.15),
}
N_LOTS = 80
names = list(CLIMATES)
p = [CLIMATES[n][2] for n in names]
lot_rows = []
for k in range(N_LOTS):
    a = rng.choice(list(AMMO))
    clim = rng.choice(names, p=p)
    lot_rows.append({
        "lot_id": f"LOT-{k+1:04d}",
        "ammo_type": a,
        "quantity": int(rng.integers(2000, 20000)),
        "depot": rng.choice(DEPOTS),
        "climate_profile": clim,
        "manufacture_date": str((pd.Timestamp("2026-03-31") - pd.Timedelta(days=int(rng.integers(30, 900)))).date()),
        "susceptibility": float(np.round(rng.lognormal(0, 0.30), 3)),   # hidden ground truth, NOT given to the detector
    })
lots = pd.DataFrame(lot_rows)

# ---------------------------------------------------------------- 3. sensors
DAYS = 180
start = pd.Timestamp("2026-04-01")
srows = []
for _, L in lots.iterrows():
    mt, mh, _ = CLIMATES[L.climate_profile]
    for d in range(DAYS):
        seasonal = 3 * np.sin(2 * np.pi * d / 365)
        t = mt + seasonal + rng.normal(0, 2.0)
        h = np.clip(mh + rng.normal(0, 6.0), 10, 99)
        if rng.random() < 0.01:                      # rare HVAC failure / heat spike
            t += rng.uniform(8, 15)
        srows.append((L.lot_id, str((start + pd.Timedelta(days=d)).date()), round(float(t), 2), round(float(h), 1)))
sens = pd.DataFrame(srows, columns=["lot_id", "date", "temperature_c", "humidity_pct"])
sens.to_csv(f"{OUT}/sensor_readings.csv", index=False)

# Ground truth: Arrhenius (Ea = 60 kJ/mol) + humidity effect + lot susceptibility + ageing offset.
R, EA, TREF = 8.314, 60000.0, 298.15
def true_rate(t_c, rh, susc):
    tk = t_c + 273.15
    arr = np.exp(-EA / R * (1 / tk - 1 / TREF))
    return arr * (1 + 0.015 * np.maximum(0, rh - 50)) * susc
lots = lots.set_index("lot_id")
true_aging = {}
for lid, g in sens.groupby("lot_id"):
    age0 = (start - pd.Timestamp(lots.loc[lid, "manufacture_date"])).days
    true_aging[lid] = age0 * 0.35 + true_rate(g.temperature_c.values, g.humidity_pct.values, lots.loc[lid, "susceptibility"]).sum()
lots["true_aging_units"] = pd.Series(true_aging)
limit = lots["true_aging_units"].quantile(0.80)       # worst ~20% of lots are truly "unsafe"
lots["truly_unsafe"] = (lots["true_aging_units"] >= limit).astype(int)
lots.reset_index().drop(columns=["susceptibility", "true_aging_units"]).to_csv(f"{OUT}/lots.csv", index=False)
lots.reset_index()[["lot_id", "susceptibility", "true_aging_units", "truly_unsafe"]].to_csv(f"{OUT}/lots_ground_truth.csv", index=False)

# ---------------------------------------------------------------- 4. transactions
tx, t0 = [], pd.Timestamp("2026-04-01 08:00")
tid = 0
lot_ids = list(lots.index)
for _ in range(1500):
    lid = rng.choice(lot_ids)
    a = lots.loc[lid, "ammo_type"]
    typ = AMMO[a][1]
    qty = int(max(10, rng.lognormal(np.log(typ), 0.35)))
    ts = t0 + pd.Timedelta(minutes=int(rng.integers(0, DAYS * 24 * 60)))
    action = rng.choice(["ISSUE_LOT", "TRANSFER_LOT", "CONSUME"], p=[0.35, 0.30, 0.35])
    tid += 1
    tx.append([tid, ts, lid, a, action, qty, 0, "normal"])
normal = pd.DataFrame(tx, columns=["tx_id", "timestamp", "lot_id", "ammo_type", "action", "quantity", "is_anomaly", "anomaly_kind"])

inj = []
for k in range(40):                                    # duplicate issue / transfer within 10 minutes
    r = normal[normal.action.isin(["ISSUE_LOT", "TRANSFER_LOT"])].sample(1, random_state=int(rng.integers(1e9))).iloc[0]
    tid += 1
    inj.append([tid, r.timestamp + pd.Timedelta(minutes=float(rng.uniform(0.5, 9))), r.lot_id, r.ammo_type, r.action, r.quantity, 1, "duplicate"])
for k in range(40):                                    # oversized issue
    lid = rng.choice(lot_ids); a = lots.loc[lid, "ammo_type"]
    tid += 1
    ts = t0 + pd.Timedelta(minutes=int(rng.integers(0, DAYS * 24 * 60)))
    inj.append([tid, ts, lid, a, "ISSUE_LOT", int(AMMO[a][1] * rng.uniform(4, 9)), 1, "oversized"])
tx = pd.concat([normal, pd.DataFrame(inj, columns=normal.columns)]).sort_values("timestamp").reset_index(drop=True)
tx["tx_id"] = np.arange(1, len(tx) + 1)
tx.to_csv(f"{OUT}/transactions.csv", index=False)

# ================================================================= EVALUATION
# ---- A. forecasting: rolling-origin on last 12 months, per (unit, ammo) series
def f_naive(h): return h[-1]
def f_ma3(h): return float(np.mean(h[-3:]))
def f_snaive(h): return h[-12]
def f_ols(h, w=12):
    y = np.asarray(h[-w:], float); x = np.arange(len(y))
    slope, icpt = np.polyfit(x, y, 1)
    return float(icpt + slope * len(y))
res = {"naive": [], "ma3": [], "ols12": [], "seasonal_naive": []}
per_type = {}
for (u, a), g in cons.groupby(["unit", "ammo_type"]):
    y = g.sort_values("month").rounds_consumed.values.astype(float)
    for t in range(24, 36):
        act = y[t]
        for name, fn in (("naive", f_naive), ("ma3", f_ma3), ("ols12", f_ols), ("seasonal_naive", f_snaive)):
            ape = abs(fn(y[:t]) - act) / act * 100
            res[name].append(ape); per_type.setdefault((a, name), []).append(ape)
fe = pd.DataFrame([{"method": k, "MAPE_%": round(np.mean(v), 2), "median_APE_%": round(np.median(v), 2)} for k, v in res.items()])
fe.to_csv(f"{OUT}/forecast_eval.csv", index=False)
fe_type = pd.DataFrame([{"ammo_type": a, "method": m, "MAPE_%": round(np.mean(v), 2)} for (a, m), v in per_type.items()]).pivot(index="ammo_type", columns="method", values="MAPE_%")
fe_type.to_csv(f"{OUT}/forecast_eval_by_ammo.csv")

# ---- B. degradation: simple doubling-per-10C rule score vs hidden truth
def risk_scores(g, ref_temp=25.0):
    dt = g.temperature_c.values; rh = g.humidity_pct.values
    return (2 ** ((dt - ref_temp) / 10) * (1 + 0.015 * np.maximum(0, rh - 50))).sum()
det = sens.groupby("lot_id").apply(risk_scores).rename("raw")
det = (det - det.min()) / (det.max() - det.min()) * 100          # 0-100 risk score
d = lots.join(det)
rows = []
for th in range(30, 95, 5):
    pred = (d["raw"] >= th).astype(int); y = d["truly_unsafe"]
    tp = int(((pred == 1) & (y == 1)).sum()); fp = int(((pred == 1) & (y == 0)).sum()); fn = int(((pred == 0) & (y == 1)).sum())
    pr = tp / (tp + fp) if tp + fp else 0; rc = tp / (tp + fn) if tp + fn else 0
    f1 = 2 * pr * rc / (pr + rc) if pr + rc else 0
    rows.append({"threshold": th, "flagged": int(pred.sum()), "TP": tp, "FP": fp, "FN": fn,
                 "precision": round(pr, 3), "recall": round(rc, 3), "F1": round(f1, 3)})
de = pd.DataFrame(rows); de.to_csv(f"{OUT}/degradation_eval.csv", index=False)
d[["raw", "truly_unsafe"]].rename(columns={"raw": "risk_score"}).to_csv(f"{OUT}/degradation_scores.csv")

# ---- C. anomaly rules
tx2 = tx.copy()
tx2["dup_flag"] = False
tx2["big_flag"] = False
# rule 1: same lot + same action seen within previous 10 minutes
for (lid, act), g in tx2[tx2.action.isin(["ISSUE_LOT", "TRANSFER_LOT"])].groupby(["lot_id", "action"]):
    g = g.sort_values("timestamp")
    gap = g.timestamp.diff().dt.total_seconds() / 60
    tx2.loc[g.index[(gap <= 10).values], "dup_flag"] = True
# rule 2: issue qty > K x mean of previous 10 issues of same ammo type
K = 3.0
for a, g in tx2[tx2.action == "ISSUE_LOT"].groupby("ammo_type"):
    g = g.sort_values("timestamp"); q = g.quantity.values
    for i in range(len(q)):
        hist = q[max(0, i - 10):i]
        if len(hist) >= 5 and q[i] > K * hist.mean():
            tx2.loc[g.index[i], "big_flag"] = True
tx2["flagged"] = tx2.dup_flag | tx2.big_flag
def pr_rc(flag, truth):
    tp = int((flag & truth).sum()); fp = int((flag & ~truth).sum()); fn = int((~flag & truth).sum())
    p_ = tp / (tp + fp) if tp + fp else 0; r_ = tp / (tp + fn) if tp + fn else 0
    return {"TP": tp, "FP": fp, "FN": fn, "precision": round(p_, 3), "recall": round(r_, 3), "F1": round(2 * p_ * r_ / (p_ + r_), 3) if p_ + r_ else 0}
ae = pd.DataFrame([
    {"rule": "duplicate within 10 min", **pr_rc(tx2.dup_flag, tx2.anomaly_kind == "duplicate")},
    {"rule": f"oversized issue (> {K}x recent mean)", **pr_rc(tx2.big_flag, tx2.anomaly_kind == "oversized")},
    {"rule": "combined", **pr_rc(tx2.flagged, tx2.is_anomaly == 1)},
])
ae.to_csv(f"{OUT}/anomaly_eval.csv", index=False)

# ================================================================= CHARTS
plt.rcParams.update({"font.size": 9})
# 1 forecast example
g = cons[(cons.unit == "UNIT-ALPHA") & (cons.ammo_type == "5.56mm")].sort_values("month")
y = g.rounds_consumed.values.astype(float)
ma = [np.nan] * 3 + [np.mean(y[i - 3:i]) for i in range(3, 36)]
ol = [np.nan] * 12 + [f_ols(y[:i]) for i in range(12, 36)]
fig, ax = plt.subplots(figsize=(7.5, 3.6))
ax.plot(range(36), y, "k-", label="actual"); ax.plot(range(36), ma, "--", label="3-mo moving avg"); ax.plot(range(36), ol, ":", label="OLS (12-mo window)")
ax.axvline(24, color="grey", lw=0.8); ax.text(24.2, y.max() * 0.97, "evaluation window", fontsize=8)
ax.set_xlabel("month index"); ax.set_ylabel("rounds consumed"); ax.set_title("One-step-ahead forecasts, UNIT-ALPHA 5.56mm"); ax.legend()
plt.tight_layout(); plt.savefig(f"{OUT}/fig_forecast.png", dpi=200); plt.close()
# 2 degradation sweep
fig, ax = plt.subplots(figsize=(7.5, 3.6))
ax.plot(de.threshold, de.precision, "o-", label="precision"); ax.plot(de.threshold, de.recall, "s-", label="recall"); ax.plot(de.threshold, de.F1, "^-", label="F1")
ax.axvline(70, color="grey", lw=0.8); ax.text(71, 0.62, "default 70", fontsize=8); ax.set_ylim(0.5, 1.0)
ax.set_xlabel("risk-score threshold"); ax.set_ylabel("score"); ax.set_title("Degradation flagging vs hidden ground truth"); ax.legend()
plt.tight_layout(); plt.savefig(f"{OUT}/fig_degradation.png", dpi=200); plt.close()
# 3 anomaly bars
fig, ax = plt.subplots(figsize=(7.5, 3.4))
x = np.arange(len(ae)); w = 0.35
ax.bar(x - w / 2, ae.precision, w, label="precision"); ax.bar(x + w / 2, ae.recall, w, label="recall")
ax.set_xticks(x); ax.set_xticklabels(ae.rule, fontsize=8); ax.set_ylim(0, 1.05); ax.set_title("Rule-based anomaly detection"); ax.legend()
plt.tight_layout(); plt.savefig(f"{OUT}/fig_anomaly.png", dpi=200); plt.close()

print("rows:", {"consumption": len(cons), "lots": len(lots), "sensor": len(sens), "transactions": len(tx)})
print("\nFORECAST (MAPE %)\n", fe.to_string(index=False))
print("\nDEGRADATION\n", de.to_string(index=False))
print("\nANOMALY\n", ae.to_string(index=False))
print("\nunsafe lots:", int(lots.truly_unsafe.sum()), "of", len(lots))
