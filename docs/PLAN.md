# Ordnance-Chain: Implementation Plan for Innovations & Capstone Extensions

This plan documents the roadmap and file modifications across all phases of the project. Every new feature is designed to sit cleanly alongside existing code, guarded by configuration flags and dedicated endpoints, preserving full backward compatibility with `npm run test:logic` and the seed/demo workflow.

---

## Phase Breakdown & Git Branches

- **Baseline (`main`)**: Clean initial MERN state with synthetic dataset in `data/`.
- **Phase 1 Branch (`phase-1-merkle`)**: Per-Lot Merkle Tree Audit Layer ($O(\log n)$ block verification).
- **Phase 2 Branch (`phase-2-offline-queue`)**: Offline Store-and-Forward Queue (DDIL Tactical Resilience).
- **Phase 3 Branch (`phase-3-ml-anomaly`)**: Machine Learning Anomaly Detection (Isolation Forest & Explainability).
- **Phase 4 Branch (`phase-4-evaluations`)**: Seasonal-Naive Forecasting, Degradation Evaluation, and Report Assets.

---

## Detailed File Modification / Creation Matrix

### Phase 1: Per-Lot Merkle Tree Audit Layer
- **New Files**:
  - `backend/blockchain/merkle.js`: Pure Merkle tree module with domain separation (`0x00` leaf, `0x01` internal), unpaired node promotion, proof generation (`getProof`), and stateless proof verification (`verifyProof`).
  - `backend/scripts/benchMerkle.js`: Benchmarking script comparing linear chain verification vs. Merkle verification across history sizes ($N = 10, 100, 1000, 10000, 100000$), outputting `docs/results/merkle_benchmark.csv` and two PNG charts.
  - `backend/scripts/testMerkle.js`: Unit and tamper tests (verifying odd/even counts, single leaf, and detecting direct MongoDB tamper).
- **Modified Files**:
  - `backend/models/Block.js`: Add `'MERKLE_CHECKPOINT'` to `txType` enum.
  - `backend/blockchain/smartContracts.js`: Support anchoring `MERKLE_CHECKPOINT` blocks on demand or every $N$ events.
  - `backend/routes/lotRoutes.js`: Add `GET /api/lots/:lotID/merkle-root`, `GET /api/lots/:lotID/proof/:blockIndex`, and `POST /api/verify-proof`.
  - `frontend/src/components/LedgerStrip.jsx` / `frontend/src/pages/LotDetail.jsx`: Add "Verify this block" button that executes in-browser Web Crypto verification, displaying proof path, size in bytes, and cryptographic result badge.

### Phase 2: DDIL Offline Store-and-Forward Queue
- **New Files**:
  - `docs/ALGORITHMS.md`: Clean pseudocode for "Algorithm A.5 Store-and-Forward Queue (Field Unit Side)" and "Algorithm A.6 Server-Side Merge and Conflict Check".
  - `frontend/src/utils/offlineQueue.js`: IndexedDB-backed client queue with UUID `eventId`, `deviceId`, monotonic sequence numbers, timestamps, and Web Crypto HMAC-SHA256 signature.
  - `backend/routes/syncRoutes.js`: `POST /api/sync/batch` implementing HMAC verification, deduplication, sequence gap detection, world-state re-validation, and `CONFLICT_DETECTED` block creation.
  - `backend/scripts/simulateOutage.js`: 5 outage scenarios (short, medium, long, sequence collision, clock-skew), producing `docs/results/offline_scenarios.csv` and a bar chart.
  - `backend/scripts/testOfflineSync.js`: Formal automated verification tests producing `docs/results/offline_verification.csv`.
- **Modified Files**:
  - `backend/models/Block.js`: Add `'CONFLICT_DETECTED'`, `'OFFLINE_SYNC'` txTypes, plus `capturedAt`, `syncedAt`, `deviceId`, `syncBatchId`.
  - `backend/server.js`: Mount `/api/sync` route with rate-limiting and auth middleware.
  - `frontend/src/components/TopBar.jsx`: Online/Offline indicator and pending queue badge.
  - `frontend/src/pages/Scan.jsx`: Capture offline events form (consume, transfer, condition, scan-in/out) and "Sync Offline Queue" action.

### Phase 3: Machine-Learning Anomaly Detection (Isolation Forest)
- **New Files**:
  - `ml/requirements.txt`: Python dependencies (`scikit-learn`, `pandas`, `joblib`, `matplotlib`, `fastapi`, `uvicorn`).
  - `ml/features.py`: Per-transaction feature extraction without label leakage.
  - `ml/train_isolation_forest.py`: Time-based 70/30 train-test split, unsupervised Isolation Forest tuning, evaluation of 4 detectors (Rules, IF, Hybrid OR, Score Fusion), and feature explainability export.
  - `ml/service/app.py`: FastAPI microservice serving `POST /score` and `GET /health`.
  - `ml/Dockerfile`: Docker containerization for the ML microservice.
- **Modified Files**:
  - `data/generate.py`: Extend to emit `data/transactions_v2.csv` with subtle anomaly patterns (moderate 1.8-3x spike, off-hours, burst, unexpected holder) while preserving seed 42 and byte-identical v1 outputs.
  - `backend/services/anomalyService.js`: Integrate HTTP client to call ML microservice (timeout 800ms with silent fallback to rule-based), saving source, score, and top feature deviations on `AnomalyFlag`.
  - `frontend/src/pages/Anomalies.jsx`: Display Source badge ("Rules", "ML", "Both"), ML anomaly score, and top-3 feature contribution explanations.

### Phase 4: Extended Evaluations & Report Artifacts
- **New Files / Artifacts**:
  - `backend/scripts/evalForecast.js`: Seasonal-naive forecaster benchmark vs Naive, MA3, and OLS12, saving `docs/results/forecast_eval.csv`.
  - `backend/scripts/evalDegradation.js`: Threshold sweep script on `sensor_readings.csv` vs `lots_ground_truth.csv`, saving `docs/results/degradation_eval.csv` and chart.
  - `docs/REPORT_SNIPPETS.md`: Ready-to-paste sections with empirical numbers for Section 4.9, 4.10, 7.2.2, 7.2.3, 7.2.4, and Future Work.
  - `docs/diagrams/`: Mermaid diagrams for Merkle proof path, DDIL sync sequence, updated DFD, and ML anomaly scoring.
  - `scripts/verifyAll.sh` / `npm run verify:all`: Single automated script to verify all tests across all phases.
- **Modified Files**:
  - `backend/services/forecastService.js`: Add `seasonalNaive` (12-month lag).
  - `frontend/src/pages/Forecast.jsx`: Render Seasonal-Naive series alongside OLS and MA.
  - `README.md`: Complete update with new architecture, setup instructions, ML serving, benchmarks, and "Honest Limitations" section.

---

## Invariance & Non-Regression Checklist
- [x] `npm run test:logic` must pass after every phase.
- [x] Linear hash chain verification (`verifyChain()`) remains intact and functional.
- [x] Existing demo users, passwords, and seed data (`npm run seed`) work without alteration.
- [x] Fallback mechanisms ensured: offline queue falls back smoothly; ML service gracefully degrades to rules engine if unreachable.
