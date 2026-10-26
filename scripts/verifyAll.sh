#!/usr/bin/env bash
set -e

# verifyAll.sh
# Comprehensive verification script across all phases and innovations of Ordnance-Chain

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
DOCS_RESULTS="$ROOT_DIR/docs/results"

echo "================================================================="
echo "       ORDNANCE-CHAIN: FULL-STACK VERIFICATION & BENCHMARK SUITE"
echo "================================================================="
echo "Working directory: $ROOT_DIR"
echo "Timestamp: $(date)"
echo ""

# 1. Logic Smoke Tests
echo "--- [1/6] Running Core Logic Smoke Tests ---"
cd "$BACKEND_DIR"
node scripts/testLogic.js
echo ""

# 2. Phase 1: Merkle Tree Pure & MongoDB Tamper Tests
echo "--- [2/6] Running Phase 1 Merkle Unit & Direct Tamper Tests ---"
node scripts/testMerkle.js
echo ""

# 3. Phase 2: DDIL Offline Store-and-Forward Queue Formal Tests & Outage Harness
echo "--- [3/6] Running Phase 2 DDIL Offline Queue Formal Verification ---"
node scripts/testOfflineSync.js
echo ""
echo "--- Running DDIL 5 Outage Scenarios Simulation ---"
node scripts/simulateOutage.js
echo ""

# 4. Phase 3: Machine Learning Anomaly Detection Tests
echo "--- [4/6] Running Phase 3 ML Anomaly Detection Tests ---"
node scripts/testMLAnomaly.js
echo ""

# 5. Phase 4: Demand Forecasting & Degradation Model Evaluations
echo "--- [5/6] Running Phase 4 Forecasting & Degradation Evaluations ---"
node scripts/evalForecast.js
echo ""
node scripts/evalDegradation.js
echo ""

# 6. Artifact Verification Check
echo "--- [6/6] Verifying Required Benchmark Artifacts in docs/results/ ---"
REQUIRED_FILES=(
  "merkle_benchmark.csv"
  "fig_merkle_verification_time.png"
  "fig_merkle_proof_size.png"
  "offline_verification.csv"
  "offline_scenarios.csv"
  "fig_offline_scenarios.png"
  "ml_metrics.json"
  "ml_example_flags.csv"
  "fig_ml_roc_curve.png"
  "fig_ml_pr_curve.png"
  "fig_ml_subtle_detector_comparison.png"
  "forecast_eval.csv"
  "forecast_eval_by_ammo.csv"
  "degradation_eval.csv"
)

MISSING_COUNT=0
for f in "${REQUIRED_FILES[@]}"; do
  if [ -f "$DOCS_RESULTS/$f" ]; then
    echo "  [FOUND] docs/results/$f"
  else
    echo "  [MISSING] docs/results/$f"
    MISSING_COUNT=$((MISSING_COUNT + 1))
  fi
done

echo ""
if [ $MISSING_COUNT -eq 0 ]; then
  echo "================================================================="
  echo "  SUCCESS: ALL 14 EMPIRICAL BENCHMARK ARTIFACTS VERIFIED PRESENT!"
  echo "  ALL TESTS PASSED CLEANLY ACROSS PHASES 1, 2, 3, AND 4."
  echo "================================================================="
else
  echo "================================================================="
  echo "  WARNING: $MISSING_COUNT benchmark artifacts are missing."
  echo "================================================================="
  exit 1
fi
