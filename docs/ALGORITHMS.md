# Formal Algorithms: DDIL Store-and-Forward & Conflict Resolution

This document specifies the exact pseudocode for the edge and server protocols enabling resilient tactical operation under Denied, Disrupted, Intermittent, and Limited-bandwidth (DDIL) battlefield constraints.

---

### Algorithm A.5: Store-and-Forward Queue (Field Unit Edge Client)

```text
Algorithm A.5: Store-and-Forward Queue at Tactical Edge (Field Unit)
Input:
  a: Action type (e.g., RECORD_CONSUMPTION, TRANSFER_LOT, UPDATE_STORAGE_CONDITION)
  P: Action payload dictionary (lotID, quantity, sensor readings, destination)
  u: Authenticated actor credentials (username, org, role)
  K_dev: 256-bit provisioned edge device secret key (persisted in secure client enclave)
Output:
  e: Encrypted/signed event record persisted in local IndexedDB store

State Variables:
  D_id: Unique hardware/client device identifier (e.g., DEV-7F89B2A1)
  seq: Local monotonic integer counter, initialized to 0

1: procedure CAPTURE_OFFLINE_EVENT(a, P, u)
2:   seq <- seq + 1
3:   eventId <- UUID_V4()
4:   t_cap <- CURRENT_ISO_TIMESTAMP()
5:
6:   // Canonical payload serialization (deterministic key ordering)
7:   M <- {
8:     "eventId": eventId,
9:     "deviceId": D_id,
10:    "sequenceNumber": seq,
11:    "capturedAt": t_cap,
12:    "action": a,
13:    "payload": P
14:  }
15:
16:  // Web Crypto HMAC-SHA256 signature generation
17:  sig <- HMAC_SHA256(K_dev, SERIALIZE_CANONICAL(M))
18:
19:  eventRecord <- M || { "signature": sig, "actor": u, "status": "QUEUED" }
20:
21:  // Atomic persistence to IndexedDB
22:  INDEXED_DB.PUT("offline_events", eventRecord)
23:  EMIT_EVENT("ordnance_offline_queue_changed", COUNT(INDEXED_DB))
24:  return eventRecord
25: end procedure

26: procedure FLUSH_OFFLINE_QUEUE(API_CLIENT)
27:  events <- INDEXED_DB.GET_ALL_SORTED("offline_events", by="sequenceNumber")
28:  if IS_EMPTY(events) then
29:    return { "status": "EMPTY" }
30:  end if
31:
32:  payload <- { "deviceId": D_id, "deviceSecret": K_dev, "events": events }
33:
34:  try
35:    response <- API_CLIENT.POST("/api/sync/batch", payload)
36:    for each res in response.results do
37:      if res.status in ["APPLIED", "CONFLICT_DETECTED", "DUPLICATE_IGNORED"] then
38:        INDEXED_DB.DELETE("offline_events", res.eventId)
39:      end if
40:    end for
41:    return response
42:  catch NetworkError as err
43:    SCHEDULE_RETRY(BACKOFF = MIN(BACKOFF * 2, 60_SECONDS))
44:  end try
45: end procedure
```

---

### Algorithm A.6: Server-Side Batch Merge and Conflict Check

```text
Algorithm A.6: Server-Side Batch Merge and Conflict Resolution
Input:
  D_id: Client device identifier
  K_dev: Device secret key (validated against DeviceRegistry)
  E: Array of offline event objects [{eventId, seq, t_cap, a, P, sig}, ...]
  actor: Authenticated sync actor credentials
Output:
  R: Batch synchronization summary and per-event merge decisions

1: procedure MERGE_OFFLINE_BATCH(D_id, K_dev, E, actor)
2:   D_state <- FETCH_OR_REGISTER_DEVICE(D_id, K_dev)
3:   syncBatchId <- "SYNC-" || UNIX_MS() || "-" || RANDOM_HEX(6)
4:   t_sync <- CURRENT_TIMESTAMP()
5:   R_events <- []
6:
7:   // Enforce strict monotonic sequence and timestamp order
8:   SORT(E, by=[sequenceNumber ASC, capturedAt ASC])
9:
10:  for each e in E do
11:    // 1. Constant-Time HMAC Signature Verification
12:    M <- CANONICAL_FIELDS(e)
13:    expected_sig <- HMAC_SHA256(D_state.secret, SERIALIZE_CANONICAL(M))
14:    if not CONSTANT_TIME_EQUAL(expected_sig, e.sig) then
15:      R_events.APPEND({ "eventId": e.eventId, "status": "REJECTED_BAD_SIGNATURE" })
16:      continue
17:    end if
18:
19:    // 2. Idempotency Check (Duplicate Suppression)
20:    if LEDGER_EXISTS(eventId == e.eventId) then
21:      R_events.APPEND({ "eventId": e.eventId, "status": "DUPLICATE_IGNORED" })
22:      continue
23:    end if
24:
25:    // 3. Monotonic Sequence Continuity Check
26:    if e.seq > D_state.lastSeq + 1 then
27:      FLAG_WARNING("Sequence gap detected", expected=D_state.lastSeq + 1, actual=e.seq)
28:    end if
29:
30:    // 4. World State Validation
31:    lot <- WORLD_STATE.FIND_LOT(e.P.lotID)
32:    conflictReason <- NULL
33:
34:    if lot is NULL then
35:      conflictReason <- "Lot not found"
36:    else if lot.status == "DISPOSED" then
37:      conflictReason <- "Lot already disposed"
38:    else if e.a in ["RECORD_CONSUMPTION", "CONSUME"] then
39:      remaining <- lot.quantity - lot.quantityConsumed
40:      if e.P.quantity > remaining then
41:        conflictReason <- "Insufficient rounds remaining (requested " || e.P.quantity || ", available " || remaining || ")"
42:      end if
43:    else if e.a == "TRANSFER_LOT" and lot.status not in ["IN_STORAGE", "ISSUED"] then
44:      conflictReason <- "Lot in invalid state for transfer: " || lot.status
45:    end if
46:
47:    // 5. Append to Ledger and World State
48:    if conflictReason is not NULL then
49:      // Immutable CONFLICT_DETECTED Block (never silently dropped)
50:      b <- LEDGER.ADD_BLOCK({
51:        txType: "CONFLICT_DETECTED",
52:        lotID: e.P.lotID,
53:        payload: { originalAction: e.a, originalPayload: e.P, reason: conflictReason },
54:        capturedAt: e.t_cap,
55:        syncedAt: t_sync,
56:        deviceId: D_id,
57:        syncBatchId: syncBatchId,
58:        eventId: e.eventId
59:      })
60:      ANOMALY_ENGINE.RAISE_FLAG("DDIL_OFFLINE_MERGE_CONFLICT", severity="HIGH", block=b)
61:      R_events.APPEND({ "eventId": e.eventId, "status": "CONFLICT_DETECTED", "reason": conflictReason })
62:    else
63:      // Apply State Mutation & Commit Normal Block
64:      APPLY_STATE_MUTATION(lot, e.a, e.P)
65:      b <- LEDGER.ADD_BLOCK({
66:        txType: e.a,
67:        lotID: e.P.lotID,
68:        payload: e.P || { offlineCaptured: true },
69:        capturedAt: e.t_cap,
70:        syncedAt: t_sync,
71:        deviceId: D_id,
72:        syncBatchId: syncBatchId,
73:        eventId: e.eventId
74:      })
75:      MERKLE_ENGINE.UPDATE_LOT_TREE(lot.lotID)
76:      R_events.APPEND({ "eventId": e.eventId, "status": "APPLIED", "blockIndex": b.index })
77:    end if
78:
79:    D_state.lastSeq <- MAX(D_state.lastSeq, e.seq)
80:  end for
81:
82:  D_state.lastSyncAt <- t_sync
83:  SAVE(D_state)
84:  return { "syncBatchId": syncBatchId, "results": R_events }
85: end procedure
```
