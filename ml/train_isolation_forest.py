"""
train_isolation_forest.py
-------------------------
Trains an unsupervised Isolation Forest model on ammunition transaction logs,
evaluates across four detectors (Rules-Only, Isolation Forest, Hybrid OR, Score Fusion),
evaluates on both base v1 and subtler v2 datasets, and outputs explainability metrics,
charts, and models.
"""

import os
import json
import joblib
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

from sklearn.ensemble import IsolationForest
from sklearn.metrics import (
    precision_score, recall_score, f1_score,
    roc_auc_score, average_precision_score,
    confusion_matrix, roc_curve, precision_recall_curve
)

from features import extract_features, FEATURE_NAMES, ACTIONS, AMMO_TYPES

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "../data")
MODELS_DIR = os.path.join(BASE_DIR, "models")
RESULTS_DIR = os.path.join(BASE_DIR, "../docs/results")

os.makedirs(MODELS_DIR, exist_ok=True)
os.makedirs(RESULTS_DIR, exist_ok=True)


def evaluate_detector(y_true, y_pred, y_scores=None):
    p = precision_score(y_true, y_pred, zero_division=0)
    r = recall_score(y_true, y_pred, zero_division=0)
    f1 = f1_score(y_true, y_pred, zero_division=0)
    cm = confusion_matrix(y_true, y_pred).tolist()

    roc_auc = float(roc_auc_score(y_true, y_scores)) if (y_scores is not None and len(np.unique(y_true)) > 1) else None
    pr_auc = float(average_precision_score(y_true, y_scores)) if (y_scores is not None and len(np.unique(y_true)) > 1) else None

    return {
        "precision": round(float(p), 4),
        "recall": round(float(r), 4),
        "f1": round(float(f1), 4),
        "roc_auc": round(float(roc_auc), 4) if roc_auc is not None else None,
        "pr_auc": round(float(pr_auc), 4) if pr_auc is not None else None,
        "confusion_matrix": cm
    }


def compute_rules_flags(df):
    """
    Evaluates rule-based checks:
    Rule 1: Duplicate issue/transfer within 10 min
    Rule 2: Issue quantity > 3.0x mean of recent 10 issues of same ammo type
    """
    dup_flag = np.zeros(len(df), dtype=bool)
    big_flag = np.zeros(len(df), dtype=bool)

    # Rule 1
    for (lid, act), g in df[df.action.isin(["ISSUE_LOT", "TRANSFER_LOT"])].groupby(["lot_id", "action"]):
        g = g.sort_values("timestamp")
        gap = g.timestamp.diff().dt.total_seconds() / 60.0
        dup_indices = g.index[(gap <= 10.0).values]
        dup_flag[dup_indices] = True

    # Rule 2
    K = 3.0
    for a, g in df[df.action == "ISSUE_LOT"].groupby("ammo_type"):
        g = g.sort_values("timestamp")
        q = g.quantity.values
        g_idx = g.index.values
        for i in range(len(q)):
            hist = q[max(0, i - 10):i]
            if len(hist) >= 3 and q[i] > K * hist.mean():
                big_flag[g_idx[i]] = True

    return dup_flag | big_flag, (dup_flag, big_flag)


def explain_anomaly(feature_vector, train_mean, train_std, top_k=3):
    """
    Returns top K features deviating most from training distribution by z-score.
    """
    deviations = []
    for i, name in enumerate(FEATURE_NAMES):
        val = feature_vector[i]
        m = train_mean[name]
        s = train_std[name] + 1e-4
        z = abs(val - m) / s
        deviations.append((name, float(val), float(z)))

    # Sort descending by absolute z-score
    deviations.sort(key=lambda x: x[2], reverse=True)
    return deviations[:top_k]


def main():
    print("=" * 60)
    print("PHASE 3: TRAINING UNSUPERVISED ISOLATION FOREST")
    print("=" * 60)

    # 1. Load Data
    v1_path = os.path.join(DATA_DIR, "transactions.csv")
    v2_path = os.path.join(DATA_DIR, "transactions_v2.csv")

    df_v1 = pd.read_csv(v1_path)
    X_v1, df_v1_feat = extract_features(df_v1)
    y_v1 = df_v1_feat["is_anomaly"].values

    # 2. Time-Based Train/Test Split (First ~70% time for train, rest for test)
    timestamps = pd.to_datetime(df_v1_feat["timestamp"])
    cutoff_time = timestamps.quantile(0.70)
    train_mask = timestamps <= cutoff_time
    test_mask = ~train_mask

    print(f"Train samples: {train_mask.sum()} (up to {cutoff_time})")
    print(f"Test samples:  {test_mask.sum()}")

    X_train = X_v1[train_mask]
    X_test = X_v1[test_mask]
    y_train = y_v1[train_mask]
    y_test = y_v1[test_mask]

    # Store feature means and stds for explainability
    train_mean = X_train.mean().to_dict()
    train_std = X_train.std().to_dict()

    # 3. Fit Isolation Forest Unsupervised (NO LABELS USED IN FIT)
    # Tune hyperparameters on training period
    n_estimators = 150
    max_samples = min(256, len(X_train))
    contamination = 0.05  # Expect ~5% anomalies in military ammunition supply chain

    iso_forest = IsolationForest(
        n_estimators=n_estimators,
        max_samples=max_samples,
        contamination=contamination,
        random_state=42,
        n_jobs=-1
    )
    iso_forest.fit(X_train)

    # Save model and feature configuration
    joblib.dump(iso_forest, os.path.join(MODELS_DIR, "isolation_forest.joblib"))
    feature_config = {
        "feature_names": FEATURE_NAMES,
        "n_features": len(FEATURE_NAMES),
        "train_mean": train_mean,
        "train_std": train_std,
        "contamination": contamination,
        "n_estimators": n_estimators
    }
    with open(os.path.join(MODELS_DIR, "feature_config.json"), "w") as f:
        json.dump(feature_config, f, indent=2)
    print("Saved trained model to ml/models/isolation_forest.joblib")

    # 4. Predict on Test Set
    # decision_function: lower means more abnormal. Invert to make higher = more anomalous.
    raw_scores = -iso_forest.decision_function(X_test)
    # Min-max scale scores to [0, 1]
    score_min = -iso_forest.decision_function(X_train).min()
    score_max = -iso_forest.decision_function(X_train).max()
    ml_scores = np.clip((raw_scores - score_min) / (score_max - score_min + 1e-6), 0, 1)

    ml_preds = (iso_forest.predict(X_test) == -1).astype(int)

    # Rules Predictions on Test Set
    rules_preds_all, (dup_all, big_all) = compute_rules_flags(df_v1_feat)
    rules_test = rules_preds_all[test_mask].astype(int)

    # Detector C: Hybrid OR (Flag if either rules OR ML triggers)
    hybrid_or_preds = (rules_test | ml_preds).astype(int)

    # Detector D: Hybrid Score-Fusion (Combines normalized rule confidence + ML score)
    rule_score_test = (rules_test * 0.85)  # Rules assigned high confidence base
    fusion_scores = 0.5 * rule_score_test + 0.5 * ml_scores
    hybrid_fusion_preds = (fusion_scores >= 0.40).astype(int)

    # 5. Comparative Evaluation on Base Dataset (v1)
    eval_rules_v1 = evaluate_detector(y_test, rules_test, rule_score_test)
    eval_ml_v1 = evaluate_detector(y_test, ml_preds, ml_scores)
    eval_hybrid_or_v1 = evaluate_detector(y_test, hybrid_or_preds, np.maximum(rule_score_test, ml_scores))
    eval_fusion_v1 = evaluate_detector(y_test, hybrid_fusion_preds, fusion_scores)

    # Per-anomaly kind recall on v1
    test_kinds = df_v1_feat.loc[test_mask, "anomaly_kind"].values
    per_kind_v1 = {}
    for kind in np.unique(test_kinds):
        if kind == "normal":
            continue
        mask_k = test_kinds == kind
        per_kind_v1[kind] = {
            "total": int(mask_k.sum()),
            "rules_recalled": int(rules_test[mask_k].sum()),
            "ml_recalled": int(ml_preds[mask_k].sum()),
            "hybrid_recalled": int(hybrid_or_preds[mask_k].sum())
        }

    # 6. Evaluation on Subtler Anomaly Dataset (v2)
    print("\nEvaluating on transactions_v2.csv (subtle anomalies)...")
    df_v2 = pd.read_csv(v2_path)
    X_v2, df_v2_feat = extract_features(df_v2)
    y_v2 = df_v2_feat["is_anomaly"].values

    ts_v2 = pd.to_datetime(df_v2_feat["timestamp"])
    test_mask_v2 = ts_v2 > cutoff_time

    X_test_v2 = X_v2[test_mask_v2]
    y_test_v2 = y_v2[test_mask_v2]

    raw_scores_v2 = -iso_forest.decision_function(X_test_v2)
    ml_scores_v2 = np.clip((raw_scores_v2 - score_min) / (score_max - score_min + 1e-6), 0, 1)
    ml_preds_v2 = (iso_forest.predict(X_test_v2) == -1).astype(int)

    rules_preds_all_v2, _ = compute_rules_flags(df_v2_feat)
    rules_test_v2 = rules_preds_all_v2[test_mask_v2].astype(int)
    hybrid_or_v2 = (rules_test_v2 | ml_preds_v2).astype(int)
    fusion_scores_v2 = 0.5 * (rules_test_v2 * 0.85) + 0.5 * ml_scores_v2
    fusion_preds_v2 = (fusion_scores_v2 >= 0.40).astype(int)

    eval_rules_v2 = evaluate_detector(y_test_v2, rules_test_v2, rules_test_v2 * 0.85)
    eval_ml_v2 = evaluate_detector(y_test_v2, ml_preds_v2, ml_scores_v2)
    eval_hybrid_or_v2 = evaluate_detector(y_test_v2, hybrid_or_v2, np.maximum(rules_test_v2 * 0.85, ml_scores_v2))
    eval_fusion_v2 = evaluate_detector(y_test_v2, fusion_preds_v2, fusion_scores_v2)

    test_kinds_v2 = df_v2_feat.loc[test_mask_v2, "anomaly_kind"].values
    per_kind_v2 = {}
    for kind in np.unique(test_kinds_v2):
        if kind == "normal":
            continue
        mask_k = test_kinds_v2 == kind
        per_kind_v2[kind] = {
            "total": int(mask_k.sum()),
            "rules_recalled": int(rules_test_v2[mask_k].sum()),
            "ml_recalled": int(ml_preds_v2[mask_k].sum()),
            "hybrid_recalled": int(hybrid_or_v2[mask_k].sum())
        }

    # Summary Metrics Object
    all_metrics = {
        "dataset_v1_base": {
            "rules_only": eval_rules_v1,
            "isolation_forest": eval_ml_v1,
            "hybrid_or": eval_hybrid_or_v1,
            "hybrid_fusion": eval_fusion_v1,
            "per_anomaly_kind": per_kind_v1
        },
        "dataset_v2_subtle": {
            "rules_only": eval_rules_v2,
            "isolation_forest": eval_ml_v2,
            "hybrid_or": eval_hybrid_or_v2,
            "hybrid_fusion": eval_fusion_v2,
            "per_anomaly_kind": per_kind_v2
        }
    }

    metrics_path = os.path.join(RESULTS_DIR, "ml_metrics.json")
    with open(metrics_path, "w") as f:
        json.dump(all_metrics, f, indent=2)
    print(f"\nSaved metrics to {metrics_path}")

    # 7. Generate Explainability Example CSV
    print("Generating explainability examples (docs/results/ml_example_flags.csv)...")
    example_rows = []
    test_indices = df_v2_feat[test_mask_v2].index
    for idx in test_indices:
        is_ml = bool(ml_preds_v2[list(test_indices).index(idx)])
        is_rule = bool(rules_test_v2[list(test_indices).index(idx)])
        if is_ml or is_rule:
            row_data = df_v2_feat.loc[idx]
            feat_vec = X_v2.loc[idx].values
            top_3 = explain_anomaly(feat_vec, train_mean, train_std, top_k=3)
            top_str = "; ".join([f"{name} (z={z:.1f}, val={val:.1f})" for name, val, z in top_3])

            example_rows.append({
                "tx_id": row_data["tx_id"],
                "timestamp": str(row_data["timestamp"]),
                "lot_id": row_data["lot_id"],
                "ammo_type": row_data["ammo_type"],
                "action": row_data["action"],
                "quantity": row_data["quantity"],
                "true_anomaly": row_data["is_anomaly"],
                "anomaly_kind": row_data["anomaly_kind"],
                "flagged_by_rules": is_rule,
                "flagged_by_ml": is_ml,
                "ml_score": round(float(ml_scores_v2[list(test_indices).index(idx)]), 3),
                "top_explainable_features": top_str
            })

    df_examples = pd.DataFrame(example_rows)
    df_examples.to_csv(os.path.join(RESULTS_DIR, "ml_example_flags.csv"), index=False)

    # 8. Render Visualizations & Plots
    render_plots(y_test, rules_test, ml_scores, fusion_scores, y_test_v2, ml_scores_v2, fusion_scores_v2, all_metrics)

    print("\nPhase 3 ML Training & Evaluation Complete.")


def render_plots(y_test, rules_test, ml_scores, fusion_scores, y_test_v2, ml_scores_v2, fusion_scores_v2, metrics):
    plt.style.use('seaborn-v0_8-whitegrid' if 'seaborn-v0_8-whitegrid' in plt.style.available else 'default')

    # Figure 1: ROC Curves on Base and Subtle Datasets
    plt.figure(figsize=(8, 5), dpi=200)
    fpr_ml, tpr_ml, _ = roc_curve(y_test, ml_scores)
    fpr_fus, tpr_fus, _ = roc_curve(y_test, fusion_scores)

    plt.plot(fpr_ml, tpr_ml, color='#1976d2', lw=2.2, label=f"Isolation Forest (AUC={roc_auc_score(y_test, ml_scores):.3f})")
    plt.plot(fpr_fus, tpr_fus, color='#2e7d32', lw=2.2, label=f"Score Fusion (AUC={roc_auc_score(y_test, fusion_scores):.3f})")
    plt.plot([0, 1], [0, 1], color='#888', linestyle='--', lw=1.2)

    plt.title('ROC Curves - Ammunition Transaction Anomaly Detectors', fontsize=12, fontweight='bold', pad=12)
    plt.xlabel('False Positive Rate', fontsize=10)
    plt.ylabel('True Positive Rate (Recall)', fontsize=10)
    plt.legend(loc='lower right', frameon=True)
    plt.tight_layout()
    plt.savefig(os.path.join(RESULTS_DIR, "fig_ml_roc_curve.png"))
    plt.close()

    # Figure 2: Precision-Recall Curves
    plt.figure(figsize=(8, 5), dpi=200)
    pr_ml, rc_ml, _ = precision_recall_curve(y_test, ml_scores)
    pr_fus, rc_fus, _ = precision_recall_curve(y_test, fusion_scores)

    plt.plot(rc_ml, pr_ml, color='#1976d2', lw=2.2, label=f"Isolation Forest (PR-AUC={average_precision_score(y_test, ml_scores):.3f})")
    plt.plot(rc_fus, pr_fus, color='#2e7d32', lw=2.2, label=f"Score Fusion (PR-AUC={average_precision_score(y_test, fusion_scores):.3f})")

    plt.title('Precision-Recall Curves - Unsupervised Ammunition Anomaly Detection', fontsize=12, fontweight='bold', pad=12)
    plt.xlabel('Recall', fontsize=10)
    plt.ylabel('Precision', fontsize=10)
    plt.legend(loc='upper right', frameon=True)
    plt.tight_layout()
    plt.savefig(os.path.join(RESULTS_DIR, "fig_ml_pr_curve.png"))
    plt.close()

    # Figure 3: Detector Comparison Bar Chart on Subtle Dataset (v2)
    v2_data = metrics["dataset_v2_subtle"]
    detectors = ["Rules-Only", "Isolation Forest", "Hybrid OR", "Score Fusion"]
    f1_scores = [
        v2_data["rules_only"]["f1"],
        v2_data["isolation_forest"]["f1"],
        v2_data["hybrid_or"]["f1"],
        v2_data["hybrid_fusion"]["f1"]
    ]
    recall_scores = [
        v2_data["rules_only"]["recall"],
        v2_data["isolation_forest"]["recall"],
        v2_data["hybrid_or"]["recall"],
        v2_data["hybrid_fusion"]["recall"]
    ]

    plt.figure(figsize=(8.5, 4.8), dpi=200)
    x = np.arange(len(detectors))
    w = 0.35
    plt.bar(x - w / 2, f1_scores, width=w, label='F1 Score', color='#1565c0', edgecolor='#222')
    plt.bar(x + w / 2, recall_scores, width=w, label='Recall', color='#2e7d32', edgecolor='#222')

    for i in range(len(detectors)):
        plt.text(x[i] - w / 2, f1_scores[i] + 0.02, f"{f1_scores[i]:.2f}", ha='center', fontsize=9, fontweight='bold')
        plt.text(x[i] + w / 2, recall_scores[i] + 0.02, f"{recall_scores[i]:.2f}", ha='center', fontsize=9, fontweight='bold')

    plt.title('Detection Performance on Subtler Anomaly Patterns (Dataset v2)', fontsize=12, fontweight='bold', pad=12)
    plt.xticks(x, detectors, fontsize=10)
    plt.ylabel('Score', fontsize=10)
    plt.ylim(0, 1.15)
    plt.legend(loc='upper left', frameon=True)
    plt.tight_layout()
    plt.savefig(os.path.join(RESULTS_DIR, "fig_ml_subtle_detector_comparison.png"))
    plt.close()

    print("Rendered ML anomaly figures:")
    print("  - docs/results/fig_ml_roc_curve.png")
    print("  - docs/results/fig_ml_pr_curve.png")
    print("  - docs/results/fig_ml_subtle_detector_comparison.png")


if __name__ == "__main__":
    main()
