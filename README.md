# Ordnance-Chain

**Blockchain-Enabled Smart-Contract-Based Ammunition Management System — Capstone & Research Edition**

Ordnance-Chain is a permissioned, tamper-evident ammunition lifecycle ledger (procurement → issue → lateral transfer → consumption → disposal), featuring smart-contract-equivalent business logic, automated replenishment triggers, Arrhenius degradation scoring, demand forecasting, and role-based tactical dispatch consoles.

This codebase contains the complete production implementation and empirical verification for **four major architectural innovations** engineered to address military operational challenges:
1. **Per-Lot Merkle Tree Audit Layer** ($O(\log n)$ block audit proofs via RFC 6962 domain separation and in-browser Web Crypto verification).
2. **Offline Store-and-Forward Queue for DDIL Tactical Resilience** (IndexedDB client queue, monotonic sequence counters, HMAC-SHA256 authentication, and audited `CONFLICT_DETECTED` ledger blocks).
3. **Dual-Layer Machine Learning Anomaly Detection** (FastAPI Isolation Forest microservice with distributional feature z-scores, 800ms Node.js abort fallback, and superior recall on subtle burst/off-hours evasions).
4. **Seasonal-Naive Demand Forecasting & Arrhenius Degradation Sweep** (Annual training-cycle seasonal forecaster achieving 20.93% MAPE and empirical degradation threshold sweep achieving 0.757 F1-score).

---

## 1. Core Architectural Innovations

### 1.1 Per-Lot Merkle Tree Audit Layer (Phase 1)
- **Challenge**: In a global hash chain with $N \ge 10^5$ blocks, verifying the integrity of a specific lot's history on bandwidth-constrained field terminals requires $O(N)$ sequential hash recalculations.
- **Solution**: A per-lot hierarchical Merkle tree (`backend/blockchain/merkle.js`) anchored into the ledger via `MERKLE_CHECKPOINT` blocks.
- **Security**: Strict RFC 6962 domain separation (`0x00` leaf prefix, `0x01` internal node prefix) and odd-node elevation to prevent second-preimage collision attacks (CVE-2012-2459).
- **Client Execution**: In-browser Web Crypto proof inspector (`frontend/src/utils/webCryptoMerkle.js`) renders full cryptographic proof paths and byte payloads directly in the user interface.
- **Empirical Result**: Demonstrates up to **9,560.2$\times$ speedup** over linear chain traversal at 100,000 blocks, requiring only 544 bytes for a complete audit proof (`docs/results/merkle_benchmark.csv`).

### 1.2 DDIL Tactical Store-and-Forward Queue (Phase 2)
- **Challenge**: Forward artillery and infantry units operate in Disconnected, Intermittent, and Limited-Bandwidth (DDIL) tactical environments where central servers are unreachable.
- **Solution**: A resilient store-and-forward architecture (`frontend/src/utils/offlineQueue.js` and `backend/services/syncService.js`).
- **Cryptographic Authentication**: Offline events are queued in client IndexedDB and signed via Web Crypto HMAC-SHA256 with monotonic per-device sequence numbers ($s \in \mathbb{N}^+$).
- **Zero Silent Data Loss**: Upon link restoration, the server enforces idempotency, validates sequence monotonicity, and reconciles state. If concurrent world-state collisions occur, the server creates an immutable `CONFLICT_DETECTED` block on the ledger rather than silently dropping data.
- **Empirical Result**: 100% transaction preservation and reconciliation across simulated short (10 events), medium (25 events), and long (60 events) comms outages (`docs/results/offline_scenarios.csv`).

### 1.3 Dual-Layer ML Anomaly Detection (Phase 3)
- **Challenge**: Deterministic rules (e.g. quantity $> 3\times$ mean) are completely blind to distributed evasion tactics such as rapid small-quantity burst issues or off-hours siphoning.
- **Solution**: A dual-layer hybrid detector combining deterministic rules with an unsupervised Isolation Forest microservice (`ml/service/app.py`).
- **Resilience**: Node.js communicates with FastAPI using an `AbortSignal.timeout(800ms)` hard limit, ensuring zero disruption or latency lag to core ledger transactions if the ML service is unreachable.
- **Explainability**: Every flagged anomaly exports top feature z-scores against training distributions (e.g., `events_last_hour_lot (z = 43.14)`).
- **Empirical Result**: On subtle evasion patterns ($v_2$), rule-only recall drops to 43.9% (0% on burst attacks). The Hybrid OR detector achieves **61.4% recall and 0.737 F1-score**, successfully capturing 66.7% of distributed burst attacks (`docs/results/ml_metrics.json`).

### 1.4 Seasonal-Naive Forecasting & Arrhenius Degradation (Phase 4)
- **Demand Forecasting**: Evaluated across 180 out-of-sample windows over 5 ammunition calibers (`docs/results/forecast_eval.csv`). The 12-month **Seasonal-Naive** forecaster achieves **20.93% MAPE**, outperforming OLS linear regression (35.48% MAPE) by **14.55 percentage points**.
- **Degradation Optimization**: Systematic threshold sweep on 80 lots subjected to 10,000 synthetic IoT environmental telemetry readings. Threshold $\tau = 65$ achieves the optimal trade-off with **87.5% recall and 0.757 F1-score** (`docs/results/degradation_eval.csv`).

---

## 2. System Architecture & Diagrams

```
                    +------------------------------------+
                    |        React / Vite Dashboard      |
                    |  - In-Browser Web Crypto Merkle    |
                    |  - IndexedDB DDIL Offline Queue    |
                    +-----------------+------------------+
                                      |
                      REST / JSON     | Batched HMAC Sync
                                      v
                    +------------------------------------+
                    |       Node.js / Express API        |
                    |  - JWT & Role Middleware (ABAC)    |
                    |  - Smart Contracts (State Machine) |
                    |  - Merkle Checkpoint Service       |
                    |  - Sync Engine (Conflict Handling) |
                    +---------+----------------+---------+
                              |                |
             AbortSignal      |                | Mongoose
             Timeout (800ms)  v                v
        +-------------------------+   +--------------------+
        |  Python FastAPI Service |   |  MongoDB Database  |
        |  - Isolation Forest ML  |   |  - Blocks (Ledger) |
        |  - Feature Z-Scores     |   |  - Lots (State)    |
        |  - Explainability Engine|   |  - DeviceState     |
        +-------------------------+   |  - AnomalyFlags    |
                                      +--------------------+
```

Detailed Mermaid architectural diagrams are available in `docs/diagrams/`:
- `docs/diagrams/merkle_proof.mmd`: RFC 6962 tree structure, odd node promotion, and proof paths.
- `docs/diagrams/ddil_sync_flow.mmd`: Tactical offline capture and server-side reconciliation sequence.
- `docs/diagrams/ml_anomaly_architecture.mmd`: Dual-layer rule + ML scoring flow with 800ms abort fallback.
- `docs/diagrams/system_architecture.mmd`: Full component topology and data interactions.

---

## 3. Quick Start & Setup

### Prerequisites
- **Node.js**: v18+ (tested on v25.2.1)
- **MongoDB**: Local Community Server (`mongodb://127.0.0.1:27017/ammo_chain`) or MongoDB Atlas
- **Python**: 3.10+ (for ML microservice)

### 3.1 Automated Full-Stack Verification (One-Command Test)
To verify all unit tests, formal property proofs, outage simulations, and ML evaluations across all phases:
```bash
./scripts/verifyAll.sh
```
This executes all test suites and validates that all 14 benchmark artifacts in `docs/results/` are present and mathematically consistent.

### 3.2 Backend Setup
```bash
cd backend
cp .env.example .env
npm install

# Run database seed (creates demo users, 12 lots, and 12-month consumption history)
npm run seed

# Run test suites
npm run test:logic     # Pure-logic smoke tests (no DB required)
npm run test:merkle    # Merkle tree pure unit & MongoDB direct tamper tests
npm run test:offline   # Formal DDIL queue property verification tests
npm run test:ml        # ML microservice & fallback verification tests
npm test               # Runs all test suites sequentially

# Start backend server
npm run dev            # Starts Express API on http://localhost:5000
```

### 3.3 Python ML Microservice Setup
```bash
# In repository root:
pip3 install -r ml/requirements.txt

# Start the FastAPI microservice
uvicorn ml.service.app:app --host 0.0.0.0 --port 8000

# Verify health endpoint:
curl http://localhost:8000/health
# {"status":"ok","service":"ordnance-ml-anomaly","modelLoaded":true,"nFeatures":16}
```
*(Docker containerization also available via `docker build -t ordnance-ml -f ml/Dockerfile .`)*

### 3.4 Frontend Setup
```bash
cd frontend
cp .env.example .env
npm install
npm run build          # Builds production Vite bundle cleanly
npm run dev            # Starts development server on http://localhost:5173
```

---

## 4. Demo Accounts & Walkthrough

All accounts share the password **`Password123!`**:

| Username | Role / Org | Primary Capabilities |
|:---|:---|:---|
| `factory_officer` | OrdnanceFactory | Register new ammunition lots, initial dispatch |
| `depot1_officer` | Depot (`DEPOT-01`) | Issue to field units, lateral transfer, manage requisitions |
| `depot2_officer` | Depot (`DEPOT-02`) | Lateral transfer recipient, depot inspection logging |
| `unit_alpha` | FieldUnit (`UNIT-ALPHA`) | Consume ammunition, log telemetry, trigger auto-replenishment |
| `unit_bravo` | FieldUnit (`UNIT-BRAVO`) | Capture offline tactical events, sync IndexedDB queue |
| `commander` | Commander | Cross-org global oversight, ledger integrity auditor |

---

## 5. Benchmarking & Empirical Data

All benchmark results and paper snippets are stored in `docs/`:
- `docs/results/merkle_benchmark.csv`: Speedup data ($N = 10$ to $100,000$).
- `docs/results/offline_verification.csv`: 5 formal DDIL safety property results.
- `docs/results/offline_scenarios.csv`: Outage duration and merge recovery rates.
- `docs/results/ml_metrics.json`: Precision, Recall, and F1 across 4 detectors on $v_1$ and $v_2$.
- `docs/results/forecast_eval.csv`: 12-month rolling-origin forecast comparison.
- `docs/results/degradation_eval.csv`: Arrhenius threshold sensitivity sweep ($\tau \in [30, 90]$).
- `docs/REPORT_SNIPPETS.md`: Formatted, publication-ready text and tables for academic reporting.

To reproduce all benchmarks:
```bash
cd backend
npm run bench:merkle       # Generates Merkle charts and CSV
npm run test:outage        # Generates DDIL outage simulation metrics and chart
npm run eval:forecast      # Evaluates rolling-origin forecasting MAPE
npm run eval:degradation   # Re-runs Arrhenius threshold sensitivity sweep
```

---

## 6. Honest Technical Limitations & Scope

In accordance with rigorous academic standards, the following architectural boundaries are explicitly documented:
1. **Centralized Ledger Primitive**: The ledger is append-only and cryptographically hash-chained via SHA-256 with Merkle checkpoints, but runs on MongoDB rather than a Byzantine Fault Tolerant (BFT) decentralized consensus network (e.g., Raft or PBFT in Hyperledger Fabric). Collision resolution relies on atomic document operations.
2. **Whole-Lot Custody**: A lot moves in its entirety; partial-lot custody splits across multiple depots simultaneously are not supported in the current state machine.
3. **Hardware Simulation**: Sensor telemetry and QR/barcode scanning are simulated in software rather than interfacing with physical LoRaWAN/RFID hardware.
4. **Advisory ML Scoring**: The Isolation Forest scoring is strictly non-blocking and advisory. High anomaly scores surface visual indicators on commander consoles but never unilaterally abort field ammunition dispatches.

---

## 7. License & Credits

Developed as part of the Advanced Ammunition Management & Logistics Ledger Project.
All cryptographic and algorithmic implementations strictly adhere to RFC 6962 and academic standards.
