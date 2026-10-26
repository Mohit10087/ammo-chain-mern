# Ordnance-Chain: Empirical Benchmark Snippets for Academic Report / Paper

This document contains publication-ready text, mathematical formulations, and empirical tables generated directly from code executions on the synthetic ammunition dataset (`data/`). Every metric below is backed by reproducible artifacts in `docs/results/`.

---

## 1. Section 4.9: Per-Lot Merkle Tree Audit Layer (Design & Algorithm)

### 1.1 Architectural Rationale
While a linear hash chain provides tamper-evidence for the overall ledger, auditing the provenance of a specific ammunition lot containing $k$ events out of a global history of $N$ blocks requires $O(N)$ sequential hash evaluations. In large-scale defense supply chains where $N \ge 10^5$, linear verification imposes unacceptable latency on low-power forward devices.

We introduce a per-lot hierarchical Merkle tree structure anchored periodically into the ledger via `MERKLE_CHECKPOINT` blocks. Each lot maintains an authenticated cryptographic root $R = \text{MerkleRoot}(\mathcal{L}_{\text{lot}})$.

### 1.2 Mathematical Formulation & RFC 6962 Domain Separation
To prevent second-preimage attacks (such as the vulnerability identified in Bitcoin's original Merkle tree implementation, CVE-2012-2459), we enforce RFC 6962 domain separation using distinct 1-byte prefixes for leaves and internal nodes:

$$\text{LeafHash}(B_i) = \text{SHA-256}(0\text{x}00 \parallel B_i.\text{hash})$$

$$\text{InternalHash}(L, R) = \text{SHA-256}(0\text{x}01 \parallel L \parallel R)$$

For odd leaf counts at any tree level, the unpaired rightmost node is promoted directly to the parent layer without duplicate hashing:

$$\text{Node}(k) = \begin{cases} 
\text{InternalHash}(\text{Node}_{2k}, \text{Node}_{2k+1}) & \text{if } 2k+1 < M \\ 
\text{Node}_{2k} & \text{if } 2k+1 = M \text{ (odd promotion)} 
\end{cases}$$

An audit proof $\mathcal{P}_i$ for block $B_i$ comprises $\lceil \log_2 k \rceil$ sibling hashes and orientation indicators. Verification in the forward browser requires only $\lceil \log_2 k \rceil$ hash computations using native Web Crypto APIs.

---

## 2. Section 4.10: Offline Store-and-Forward Queue for DDIL Tactical Resilience

### 2.1 Threat Model & Tactical Realities
Forward military units operate in Disconnected, Intermittent, and Limited-Bandwidth (DDIL) environments where continuous cloud or server connectivity is unavailable. Rejecting field transactions during outages paralyzes operations, whereas unauthenticated offline queues risk replay, forgery, and state divergency.

### 2.2 Protocol Specification
1. **Client Event Store (IndexedDB)**: Forward browsers maintain a non-volatile IndexedDB queue recording offline events with client-generated UUIDs ($e_{\text{id}}$), device identifiers ($d_{\text{id}}$), and strictly monotonic sequence numbers $s \in \mathbb{N}^+$.
2. **Cryptographic Authentication**: Every offline batch is signed via Web Crypto HMAC-SHA256 using a device-specific pre-shared secret:
   $$\sigma = \text{HMAC-SHA-256}(K_{d}, d_{\text{id}} \parallel s_{\text{start}} \parallel s_{\text{end}} \parallel \text{BatchPayload})$$
3. **Server-Side Conflict Resolution**: Upon reconnection, the server authenticates $\sigma$, asserts monotonic sequence continuity ($s = s_{\text{last}} + 1$), checks for duplicate batch UUIDs (idempotency), and evaluates world-state pre-conditions. If an invariant is violated (e.g., lot consumed elsewhere during outage), the system **never silently drops the transaction**. Instead, it commits an immutable `CONFLICT_DETECTED` block to the ledger, preserving full accountability for military post-incident investigations.

---

## 3. Section 7.2.2: Empirical Merkle Tree Benchmarking Results

Empirical verification benchmarks were executed across lot histories ranging from $N = 10$ to $N = 100,000$ blocks on an Apple Silicon M-series testbed. Table 1 summarizes the performance scaling.

### Table 1: Linear vs. Merkle Verification Benchmarks (`docs/results/merkle_benchmark.csv`)

| Block History ($N$) | Linear Time (ms) | Merkle Time (ms) | Speedup ($\times$) | Proof Steps ($\lceil \log_2 N \rceil$) | Proof Size (Bytes) |
|:-------------------:|:----------------:|:----------------:|:------------------:|:-------------------------------------:|:------------------:|
| 10                  | 0.043            | 0.020            | **2.1$\times$**    | 4                                     | 128                |
| 100                 | 0.362            | 0.028            | **12.9$\times$**   | 7                                     | 224                |
| 1,000               | 4.672            | 0.038            | **122.9$\times$**  | 10                                    | 320                |
| 10,000              | 40.231           | 0.047            | **855.9$\times$**  | 14                                    | 448                |
| 100,000             | 478.012          | 0.050            | **9,560.2$\times$**| 17                                    | 544                |

**Key Finding**: As ledger size scales to $10^5$ events, linear verification time degrades linearly ($O(N)$), reaching nearly half a second per check. In contrast, Merkle audit proof verification remains virtually instantaneous ($0.05$ ms), achieving a **9,560.2$\times$ acceleration** with a proof size of just 544 bytes.

---

## 4. Section 7.2.3: Tactical DDIL Outage Simulation & Formal Verification

### 4.1 Formal Property Verification (`docs/results/offline_verification.csv`)
Formal automated testing verified five essential safety and liveness properties:
- **Property 1 (Tampered HMAC Rejection)**: 100% rejection of modified offline batch payloads (`REJECTED_BAD_SIGNATURE`).
- **Property 2 (Idempotent Resubmission)**: Duplicate submissions return cached ACK without duplicate ledger appending (`DUPLICATE_IGNORED`).
- **Property 3 (Audited Conflict Resolution)**: Invariant collisions commit `CONFLICT_DETECTED` blocks without data loss.
- **Property 4 (Chain Continuity)**: Full 26,514+ block ledger retains cryptographic hash validity after batch merges.
- **Property 5 (Sequence Monotonicity)**: Out-of-order batches are sorted and applied according to device sequence numbers.

### Table 2: Simulated Tactical Outage Scenarios (`docs/results/offline_scenarios.csv`)

| Scenario | Offline Events | Applied | Conflicts | Duplicates | Merge Success Rate | Sync Latency (ms) |
|:---------|:--------------:|:-------:|:---------:|:----------:|:------------------:|:-----------------:|
| 1. Short Outage (Comm Loss) | 10 | 10 | 0 | 0 | **100.0%** | 38.45 ms |
| 2. Medium Outage (Jamming) | 25 | 25 | 0 | 0 | **100.0%** | 80.53 ms |
| 3. Long Outage (Extended DDIL)| 60 | 60 | 0 | 0 | **100.0%** | 146.49 ms |
| 4. Dual-Device Collision | 2 | 1 | 1 | 0 | **50.0%** (1 Conflict Audited) | 18.20 ms |
| 5. Clock Skew / Out-of-Order | 10 | 8 | 0 | 2 | **80.0%** (2 Dup Ignored) | 19.49 ms |

---

## 5. Section 7.2.4: Dual-Layer ML Anomaly Detection Evaluation

To evaluate anomaly detection beyond simplistic thresholds, we tested 4 detection paradigms across both the baseline dataset ($v_1$, containing obvious $>3\times$ volume spikes and duplicates) and a subtle evasion dataset ($v_2$, containing off-hours transfers, burst extractions, and moderate 1.85--2.75$\times$ spikes).

### Table 3: Anomaly Detection Performance Comparison (`docs/results/ml_metrics.json`)

| Evaluation Benchmark | Detector Paradigm | Precision | Recall | F1-Score | ROC-AUC | PR-AUC |
|:---------------------|:------------------|:---------:|:------:|:--------:|:-------:|:------:|
| **Base Dataset ($v_1$)** | Deterministic Rules | 1.000 | 1.000 | **1.000** | 1.000 | 1.000 |
| (Obvious 3x Spikes) | Unsupervised Isolation Forest | 0.920 | 0.920 | **0.920** | 0.002 | 0.028 |
| | **Hybrid OR (Rules $\lor$ ML)** | **0.926** | **1.000** | **0.962** | 0.797 | 0.216 |
| | Score Fusion (Linear Combination)| 0.112 | 1.000 | 0.201 | 0.989 | 0.930 |
| **Subtle Dataset ($v_2$)** | Deterministic Rules | 0.962 | 0.439 | **0.602** | 0.718 | 0.485 |
| (Burst & Off-Hours) | Unsupervised Isolation Forest | 0.943 | 0.579 | **0.717** | 0.137 | 0.064 |
| | **Hybrid OR (Rules $\lor$ ML)** | **0.921** | **0.614** | **0.737** | 0.484 | 0.156 |
| | Score Fusion (Linear Combination)| 0.120 | 0.491 | 0.193 | 0.568 | 0.429 |

### 5.1 Sub-Category Breakdown on Subtle Attacks ($v_2$)
- **Burst Pattern Attacks** (3 rapid small issues within 45 min):
  - Rule-Based Recall: **0.0% (0 / 15)** --- completely blind to distributed volume splitting.
  - Isolation Forest Recall: **66.7% (10 / 15)**.
  - Hybrid OR Recall: **66.7% (10 / 15)**.
- **Explainability Contribution**:
  Every flagged event provides human-interpretable feature z-scores, pinpointing anomalous behavioral dimensions:
  e.g., `events_last_hour_lot (z = 43.14)`, `z_score_recent (z = 39.81)`, `minutes_since_last_lot_event (z = 12.4)`.

---

## 6. Section 7.2.5: Demand Forecasting & Ammunition Degradation Evaluations

### Table 4: Consumption Forecasting Model Error (`docs/results/forecast_eval.csv`)

| Forecasting Method | Formulation | Out-of-Sample MAPE (%) | Median APE (%) |
|:-------------------|:------------|:----------------------:|:--------------:|
| **Seasonal-Naive (Lag 12)** | $\hat{y}_{t} = y_{t-12}$ | **20.93%** | **14.86%** |
| Naive (Last Month) | $\hat{y}_{t} = y_{t-1}$ | 23.24% | 16.11% |
| Moving Average (3 Months) | $\hat{y}_{t} = \frac{1}{3}\sum_{i=1}^3 y_{t-i}$ | 25.84% | 21.55% |
| OLS Linear Regression | $\hat{y}_{t} = \alpha + \beta t$ | 35.48% | 31.13% |

**Insight**: Military consumption exhibits pronounced annual training cycle seasonality. The 12-month Seasonal-Naive model yields the lowest out-of-sample prediction error, outperforming standard linear extrapolation by **14.55 percentage points**.

### Table 5: Arrhenius Degradation Threshold Sweep (`docs/results/degradation_eval.csv`)

| Threshold ($\tau$) | Flagged Lots | True Positives (TP) | False Positives (FP) | False Negatives (FN) | Precision | Recall | F1-Score |
|:------------------:|:------------:|:-------------------:|:--------------------:|:--------------------:|:---------:|:------:|:--------:|
| 30 to 60           | 23           | 14                  | 9                    | 2                    | 0.609     | 0.875  | 0.718    |
| **65 (Optimal)**   | **21**       | **14**              | **7**                | **2**                | **0.667** | **0.875** | **0.757** |
| 70 to 90           | 17           | 11                  | 6                    | 5                    | 0.647     | 0.688  | 0.667    |

**Optimal Operating Point**: At threshold $\tau = 65$, the system achieves optimal performance with **87.5% recall** and **0.757 F1-score**, successfully identifying hazardous ammunition lots while minimizing unnecessary depot disposal inspections.
