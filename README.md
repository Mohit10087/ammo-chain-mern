# Ordnance-Chain

**Blockchain-Enabled Smart-Contract-Based Ammunition Management System — MERN edition**

A permissioned, tamper-evident ledger that tracks ammunition through its full
lifecycle (procurement → issue → transfer → consumption → disposal), with
smart-contract-style business logic automating replenishment, degradation
alerts, and anomaly flagging, behind a role-based React dashboard.

This is a **from-scratch MERN-stack rebuild** of a capstone spec originally
written against Hyperledger Fabric. Every functional requirement from that
spec is implemented; the underlying platform is different, and that
trade-off is explained below so you can defend it in a viva.

---

## 1. Why MERN instead of Hyperledger Fabric

The original design targeted Hyperledger Fabric — a real permissioned
blockchain platform. Standing up a Fabric network (orderers, peers,
certificate authorities, channels, chaincode containers) is a large amount
of infrastructure for a one-semester, three-person build, and most of it is
invisible to anyone evaluating the *system's behaviour* rather than its
deployment topology.

What actually matters for the brief — an **append-only, tamper-evident
transaction log**, **role-gated write functions**, and a **queryable current
state** — can be built directly on MongoDB with about 150 lines of hashing
logic. This project does that, and documents the substitution honestly
instead of pretending it's Fabric under the hood.

| Original Fabric concept | This project's MERN equivalent | Where |
|---|---|---|
| Ordered transaction log / ledger blocks | Hash-chained `Block` collection (SHA-256, each block embeds the previous block's hash) | `backend/blockchain/Ledger.js` |
| Chaincode functions | Plain Node functions with the same names and signatures | `backend/blockchain/smartContracts.js` |
| ABAC on chaincode (org/role gating) | JWT carries `org` + `depotId`/unit id; middleware + per-function holder checks | `backend/middleware/auth.js`, `assertHolder()` in `smartContracts.js` |
| CouchDB world state | `Lot`, `Requisition`, `InspectionAlert`, `AnomalyFlag` collections, always derived from the ledger | `backend/models/` |
| `GetHistoryForKey(lotID)` | `Ledger.getHistory(lotID)` | `backend/blockchain/Ledger.js` |
| Peer endorsement / multi-node consensus | **Not reproduced.** Single writer, single MongoDB instance. | Documented simplification — see §7 |
| RFID/QR hardware | QR codes generated server-side (`qrcode` npm package); scan-in/scan-out simulated via a manual-entry "Scan" page | `backend/services/qrService.js`, `frontend/src/pages/Scan.jsx` |
| Real IoT sensors | Background job generates plausible temperature/humidity readings on an interval | `backend/services/sensorSimulator.js` |
| Python forecasting/degradation scripts | Plain JavaScript, same formulas, no ML | `backend/services/degradationService.js`, `forecastService.js` |

If your evaluators specifically require Fabric, this codebase is not a
drop-in replacement for that — but every *feature* in the original spec
(roles, lifecycle chaincode, QR simulation, auto-replenishment, degradation
scoring, forecasting, anomaly rules, role-based dashboard) is present and
working here, in a stack that runs with `npm install && npm start`.

---

## 2. Tech stack

- **MongoDB** — ledger storage (`Block` collection) + world-state collections
- **Express + Node.js** — REST API, JWT auth, the "chaincode" business-logic layer
- **React (Vite)** — role-based dashboard
- **No Python, no Hyperledger Fabric, no separate ML service** — everything
  runs in one JS runtime on each side, which is what makes `npm run seed`
  followed by two `npm run dev`s enough to get a full demo running.

---

## 3. Project layout

```
ammo-chain-mern/
├── backend/
│   ├── blockchain/
│   │   ├── Ledger.js            # hash-chained ledger primitive
│   │   └── smartContracts.js    # chaincode-equivalent business logic
│   ├── models/                  # Mongoose schemas (Block, Lot, User, ...)
│   ├── middleware/               # JWT auth + ABAC-style org/holder checks
│   ├── routes/                   # thin HTTP layer over smartContracts.js
│   ├── services/                 # degradation, forecasting, anomaly rules,
│   │                              # QR generation, sensor simulator
│   ├── utils/seedData.js         # synthetic demo data generator
│   ├── scripts/seed.js           # `npm run seed`
│   ├── scripts/testLogic.js      # `npm run test:logic` (no DB required)
│   └── server.js
└── frontend/
    └── src/
        ├── pages/                 # one file per dashboard view
        ├── components/            # Sidebar, TopBar, LedgerStrip, ...
        ├── context/AuthContext.jsx
        └── api/client.js
```

---

## 4. Setup

### Prerequisites
- Node.js 18+
- A MongoDB instance — either:
  - **Local**: install MongoDB Community Server and run `mongod` (default
    port 27017), or
  - **Atlas**: create a free cluster at mongodb.com and copy its connection
    string.

### 4.1 Backend

```bash
cd backend
cp .env.example .env
# edit .env if your MongoDB URI, JWT secret, or thresholds differ from the defaults
npm install
npm run test:logic     # optional: pure-logic smoke tests, no DB needed
npm run seed            # creates demo users, ~12 lots run through real
                         # smart-contract calls, and 12 months of synthetic
                         # consumption history per ammo type
npm run dev              # starts the API on http://localhost:5000
                         #   (npm start for a non-watching run)
```

`npm run seed` prints the demo usernames; all of them share the password
`Password123!`:

| Username | Org | ID |
|---|---|---|
| `commander` | Commander | — (read-only, cross-org) |
| `factory_officer` | OrdnanceFactory | — |
| `depot1_officer` | Depot | DEPOT-01 |
| `depot2_officer` | Depot | DEPOT-02 |
| `unit_alpha` | FieldUnit | UNIT-ALPHA |
| `unit_bravo` | FieldUnit | UNIT-BRAVO |

### 4.2 Frontend

```bash
cd frontend
cp .env.example .env    # defaults to http://localhost:5000/api, edit if needed
npm install
npm run dev              # opens on http://localhost:5173
```

Log in as any of the seeded users above. Try `depot1_officer` first — Depot
accounts can see the most actions (issue to field units, transfer, approve
requisitions, log conditions, dispose).

---

## 5. A five-minute viva walkthrough

1. **Login as `factory_officer`.** Go to *Lot Registry* → register a new
   lot. Note the lot appears instantly with status `REGISTERED`.
2. **Open the lot's detail page.** The *Ledger History* strip shows one
   block (`REGISTER_LOT`) with its hash. This is the append-only log — point
   at *Ledger Explorer* → *Verify Chain Integrity* to show the whole chain
   hash-checks clean.
3. **Issue it to a depot** from the lot detail page's Actions panel.
   A second block (`ISSUE_LOT`) appears in the history strip, and the lot's
   holder updates.
4. **Log in as `depot1_officer`.** Issue the same lot on to `UNIT-ALPHA`.
5. **Log in as `unit_alpha`.** On the lot detail page, record a consumption
   of most of the lot's quantity. Point out the success message: if that
   pushes the *depot's* total stock for that ammo type below the
   replenishment threshold (500 rounds by default, see `.env`), a
   `Requisition` is auto-created — visible immediately on the *Requisitions*
   page, and as a `CREATE_REQUISITION` block in the ledger.
6. **Log storage conditions** (same lot, Actions panel) with a high
   temperature (e.g. 45°C) and humidity (e.g. 80%). The risk score jumps;
   if it crosses the alert threshold (70 by default) the lot is
   auto-flagged and appears on the *Degradation Alerts* page with the
   Arrhenius-style breakdown available in the block payload (Ledger
   Explorer).
7. **Visit *Demand Forecast*.** Shows 12 months of synthetic consumption per
   ammo type with both a moving-average and a linear-regression next-period
   forecast, worked out with the visible slope/intercept — nothing here is
   a black box.
8. **Visit *Anomaly Flags*.** If you repeat an issue/transfer on the same
   lot within 10 minutes, or issue an unusually large quantity, a rule
   fires here automatically — again, purely from re-reading the ledger, no
   ML.
9. **Log in as `commander`.** Everything above rolls up read-only across
   every org — the *Overview* page's stock table spans all depots and
   units at once.

---

## 6. API reference (summary)

All routes except `/api/auth/login` and `/api/health` require
`Authorization: Bearer <token>`.

| Method & path | Who | Purpose |
|---|---|---|
| `POST /api/auth/login` | anyone | returns `{ token, user }` |
| `GET /api/lots` | any | list lots (scoped to own org unless Commander) |
| `POST /api/lots/register` | OrdnanceFactory | chaincode `registerLot` |
| `POST /api/lots/issue` | OrdnanceFactory, Depot | chaincode `issueLot` |
| `POST /api/lots/transfer` | Depot, FieldUnit | chaincode `transferLot` |
| `POST /api/lots/consume` | FieldUnit | chaincode `recordConsumption` (auto-runs `checkStockLevel`) |
| `POST /api/lots/dispose` | Depot, FieldUnit | chaincode `disposeLot` |
| `POST /api/lots/condition` | Depot, FieldUnit | chaincode `updateStorageCondition` (may auto-`flagForInspection`) |
| `GET /api/lots/:lotID/history` | any | full ledger history for one lot |
| `GET /api/lots/:lotID/qrcode` | any | QR code (data URL) encoding the lot ID |
| `GET/POST /api/requisitions...` | any / Depot | replenishment queue + approvals |
| `GET/PATCH /api/degradation/alerts...` | any | inspection alerts |
| `GET /api/forecast` | any | moving-average + linear-regression forecasts |
| `GET/PATCH /api/anomalies...` | any | rule-based anomaly flags |
| `GET /api/dashboard/summary` \| `/stock` \| `/ledger` \| `/ledger/verify` | any | dashboard rollups + integrity check |

---

## 7. Design decisions & explicit scope simplifications

Stated up front so nothing here looks accidental in a review:

- **Single writer, no consensus.** The ledger is append-only and
  hash-chained, but it runs on one MongoDB instance rather than a
  multi-peer network. Write ordering is serialized with a short
  retry-on-collision loop (`Ledger.addBlock`), not distributed consensus.
  This is the single biggest simplification versus real Fabric/blockchain
  deployments and is the first thing to call out if asked "is this really a
  blockchain?" — it is a tamper-evident log with the same hash-chain
  integrity property, not a decentralized one.
- **Whole-lot movement.** `issueLot`/`transferLot` move a lot's entire
  remaining quantity to a new holder; splitting a lot into two custodians
  isn't supported. Register lots at whatever granularity your demo needs
  instead.
- **RFID/QR, IoT sensors** are simulated (manual entry / a background
  timer), not read from real hardware — this matches the original brief's
  explicit scope.
- **Forecasting and degradation scoring are deliberately non-ML** — a
  3-month moving average, an OLS linear regression, and a plain
  Arrhenius-style formula, all picked so their output can be explained on a
  whiteboard.
- **Anomaly detection is rule-based, not ML-based** — by design, so it
  doesn't duplicate the ML-over-blockchain-transactions approach already
  covered by prior work.

## 8. Explicitly out of scope (unchanged from the original brief)

Zero-knowledge proofs, real GPS/live shipment tracking, computer vision,
real IoT hardware, multi-chain/cross-chain bridges, "digital twin" framing.

---

## 9. Suggested three-way ownership split

- **Student A** — `backend/blockchain/` (Ledger + smartContracts), `models/`,
  `middleware/` — the ledger and chaincode-equivalent core.
- **Student B** — `backend/services/` (degradation, forecasting, anomaly
  rules, sensor simulator, QR) + `backend/routes/` — the analytics and API
  surface.
- **Student C** — `frontend/` — the React dashboard.

## 10. Testing notes

- `backend/scripts/testLogic.js` (`npm run test:logic`) exercises the
  degradation formula, forecasting math, and ledger hashing/tamper-detection
  **without needing a database** — useful for a quick CI-style check.
- Full integration testing (registering/issuing/consuming lots through the
  live API) requires a running MongoDB instance; point `MONGO_URI` at one
  and run through the walkthrough in §5.
- `npm run build` in `frontend/` produces a clean production bundle with no
  compile errors.
