import { useState, useEffect, useCallback } from 'react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import {
  enqueueOfflineEvent,
  getQueuedEvents,
  syncOfflineQueue,
  clearQueue,
  removeEvent,
  getDeviceId
} from '../utils/offlineQueue';

export default function OfflineConsole() {
  const { actor } = useAuth();
  const [lots, setLots] = useState([]);
  const [selectedLotID, setSelectedLotID] = useState('');
  const [action, setAction] = useState('RECORD_CONSUMPTION');
  const [targetId, setTargetId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [temperatureC, setTemperatureC] = useState('28.5');
  const [humidityPct, setHumidityPct] = useState('55.0');

  const [isOutage, setIsOutage] = useState(
    () => localStorage.getItem('ordnance_simulated_ddil') === 'true'
  );
  const [queuedEvents, setQueuedEvents] = useState([]);
  const [syncReceipt, setSyncReceipt] = useState(null);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [busy, setBusy] = useState(false);

  const deviceId = getDeviceId();

  // Load lots held by this actor
  const loadLots = useCallback(async () => {
    try {
      const res = await api.get('/lots');
      setLots(res.lots || []);
      if (res.lots && res.lots.length > 0 && !selectedLotID) {
        setSelectedLotID(res.lots[0].lotID);
      }
    } catch {
      // If offline, lots may fail to load from server; keep existing
    }
  }, [selectedLotID]);

  // Load queued events from IndexedDB
  const loadQueue = useCallback(async () => {
    try {
      const events = await getQueuedEvents();
      setQueuedEvents(events);
    } catch (e) {
      console.error('Failed to load IndexedDB queue:', e);
    }
  }, []);

  useEffect(() => {
    loadLots();
    loadQueue();

    const handleQueueChange = () => loadQueue();
    window.addEventListener('ordnance_offline_queue_changed', handleQueueChange);
    return () => window.removeEventListener('ordnance_offline_queue_changed', handleQueueChange);
  }, [loadLots, loadQueue]);

  const toggleOutage = () => {
    const next = !isOutage;
    setIsOutage(next);
    localStorage.setItem('ordnance_simulated_ddil', String(next));
    window.dispatchEvent(new Event('ordnance_ddil_state_changed'));
    setSuccess(
      next
        ? '⚠️ Tactical blackout simulation activated: Central connection cut. All actions will queue into IndexedDB.'
        : '🟢 Central connection restored. You may now synchronize queued events with the server.'
    );
  };

  const selectedLot = lots.find((l) => l.lotID === selectedLotID);
  const remainingRounds = selectedLot ? selectedLot.quantity - selectedLot.quantityConsumed : 0;

  async function handleQueueAction(e) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setBusy(true);

    try {
      if (!selectedLotID) {
        throw new Error('Please select an ammunition lot.');
      }

      let payload = { lotID: selectedLotID };
      if (action === 'RECORD_CONSUMPTION') {
        const q = Number(quantity);
        if (!q || q <= 0) throw new Error('Please enter a valid positive consumption quantity.');
        if (remainingRounds > 0 && q > remainingRounds) {
          throw new Error(`Cannot consume ${q} rounds: only ${remainingRounds} available in lot.`);
        }
        payload.quantity = q;
      } else if (action === 'TRANSFER_LOT') {
        if (!targetId.trim()) throw new Error('Please specify destination recipient ID.');
        payload.toId = targetId.trim();
        payload.quantity = remainingRounds;
      } else if (action === 'UPDATE_STORAGE_CONDITION') {
        payload.temperatureC = Number(temperatureC);
        payload.humidityPct = Number(humidityPct);
      }

      // Enqueue into IndexedDB with monotonic sequence and Web Crypto HMAC-SHA256 signature
      const event = await enqueueOfflineEvent({
        action,
        payload,
        actor
      });

      setSuccess(
        `⚡ Action queued offline! Seq #${event.sequenceNumber} signed via HMAC-SHA256 and sealed in IndexedDB.`
      );
      setQuantity('');
      await loadQueue();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSyncNow() {
    setSyncing(true);
    setSyncReceipt(null);
    setError(null);
    setSuccess(null);

    try {
      const summary = await syncOfflineQueue(api);
      setSyncReceipt(summary);
      await loadQueue();
      await loadLots();
      setSuccess(`✅ Successfully synchronized batch with central node!`);
    } catch (err) {
      setError(`Sync failed: ${err.message}`);
    } finally {
      setSyncing(false);
    }
  }

  async function handleClearQueue() {
    if (!window.confirm('Are you sure you want to discard all queued offline events?')) return;
    await clearQueue();
    await loadQueue();
    setSuccess('Local IndexedDB queue cleared.');
  }

  return (
    <div>
      <div className="page-header" style={{ marginBottom: 16 }}>
        <div>
          <h1>Tactical DDIL Console</h1>
          <p>
            Disconnected, Intermittent & Limited-Bandwidth (DDIL) tactical store-and-forward queue with client IndexedDB,
            monotonic sequences, and Web Crypto HMAC-SHA256 request authentication.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            className={`btn ${isOutage ? 'btn-danger' : 'btn-secondary'}`}
            onClick={toggleOutage}
            style={{ fontWeight: 700 }}
          >
            {isOutage ? '🔴 Disconnected (DDIL Outage Active)' : '🟢 Link Online (Central Connected)'}
          </button>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {success && <div className="success-banner">{success}</div>}

      {/* Outage status banner */}
      <div
        className="panel"
        style={{
          marginBottom: 20,
          background: isOutage ? 'rgba(193, 74, 58, 0.12)' : 'rgba(111, 156, 127, 0.12)',
          borderLeft: `4px solid ${isOutage ? 'var(--accent-rust)' : 'var(--accent-olive)'}`,
          padding: '12px 16px'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: isOutage ? 'var(--accent-rust)' : 'var(--accent-olive)' }}>
              {isOutage
                ? 'TACTICAL DDIL MODE: Central Network Disconnected'
                : 'NORMAL MODE: Central Ledger Network Reached'}
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
              {isOutage
                ? `Operations are authenticated with Device ID (${deviceId}) via Web Crypto HMAC-SHA256, given monotonic sequence numbers, and held in non-volatile IndexedDB until comms return.`
                : 'Central node reachable. Any events queued in IndexedDB can now be reconciled and merged into the blockchain ledger.'}
            </div>
          </div>
          <button className="btn btn-sm" onClick={toggleOutage}>
            {isOutage ? 'Simulate Reconnection' : 'Simulate Comms Cut'}
          </button>
        </div>
      </div>

      <div className="grid-2">
        {/* Tactical Event Dispatcher */}
        <div className="panel">
          <div className="panel-title">1. Record Tactical Field Action</div>
          <form onSubmit={handleQueueAction}>
            <div className="field">
              <label>Select Lot Held by Your Unit</label>
              {lots.length > 0 ? (
                <select
                  value={selectedLotID}
                  onChange={(e) => setSelectedLotID(e.target.value)}
                  style={{
                    width: '100%',
                    background: 'var(--panel-raised)',
                    border: '1px solid var(--border-strong)',
                    color: 'var(--text)',
                    padding: '8px 10px',
                    fontFamily: 'var(--font-mono)'
                  }}
                >
                  {lots.map((l) => (
                    <option key={l.lotID} value={l.lotID}>
                      {l.lotID} — {l.ammoType} ({l.quantity - l.quantityConsumed} rounds remaining)
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  placeholder="e.g. LOT-ALPHA-556-01"
                  value={selectedLotID}
                  onChange={(e) => setSelectedLotID(e.target.value)}
                  required
                />
              )}
              {selectedLot && (
                <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                  Current holder: {selectedLot.currentHolderOrg} ({selectedLot.currentHolderId || '—'}) &middot;{' '}
                  Status: <strong>{selectedLot.status}</strong>
                </div>
              )}
            </div>

            <div className="field">
              <label>Action to Execute</label>
              <select
                value={action}
                onChange={(e) => setAction(e.target.value)}
                style={{
                  width: '100%',
                  background: 'var(--panel-raised)',
                  border: '1px solid var(--border-strong)',
                  color: 'var(--text)',
                  padding: '8px 10px'
                }}
              >
                <option value="RECORD_CONSUMPTION">Record Ammunition Consumption</option>
                <option value="TRANSFER_LOT">Lateral Field Transfer to Another Unit/Depot</option>
                <option value="UPDATE_STORAGE_CONDITION">Log Field Environmental Condition</option>
              </select>
            </div>

            {action === 'RECORD_CONSUMPTION' && (
              <div className="field">
                <label>Rounds Consumed</label>
                <input
                  type="number"
                  min="1"
                  max={remainingRounds > 0 ? remainingRounds : 10000}
                  placeholder={`e.g. 250 (max ${remainingRounds})`}
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  required
                />
              </div>
            )}

            {action === 'TRANSFER_LOT' && (
              <div className="field">
                <label>Transfer Destination Unit ID</label>
                <input
                  placeholder="e.g. UNIT-BRAVO or DEPOT-02"
                  value={targetId}
                  onChange={(e) => setTargetId(e.target.value)}
                  required
                />
              </div>
            )}

            {action === 'UPDATE_STORAGE_CONDITION' && (
              <div className="form-row">
                <div className="field">
                  <label>Temperature (&deg;C)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={temperatureC}
                    onChange={(e) => setTemperatureC(e.target.value)}
                    required
                  />
                </div>
                <div className="field">
                  <label>Humidity (%)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={humidityPct}
                    onChange={(e) => setHumidityPct(e.target.value)}
                    required
                  />
                </div>
              </div>
            )}

            <button className="btn btn-primary" disabled={busy} style={{ width: '100%', marginTop: 8 }}>
              {busy ? 'Signing & Storing…' : '⚡ Queue Action into IndexedDB'}
            </button>
          </form>
        </div>

        {/* Sync & Device Diagnostics Panel */}
        <div className="panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div className="panel-title" style={{ margin: 0 }}>2. Server Reconciliation Engine</div>
            <span
              className="mono"
              style={{
                fontSize: 11,
                padding: '2px 8px',
                background: 'var(--panel-raised)',
                border: '1px solid var(--border)',
                borderRadius: 2
              }}
            >
              Device: {deviceId}
            </span>
          </div>

          <p className="muted" style={{ fontSize: 12 }}>
            Upon re-establishing communication, the client submits the batch of signed events. The server verifies
            HMAC signatures, strictly validates monotonic sequence continuity, and executes state updates onto the blockchain ledger.
          </p>

          <div style={{ padding: 12, background: 'var(--panel-raised)', border: '1px solid var(--border)', marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span className="muted" style={{ fontSize: 12 }}>Events Currently in Queue:</span>
              <strong style={{ color: queuedEvents.length > 0 ? 'var(--accent-amber)' : 'var(--accent-olive)' }}>
                {queuedEvents.length} events
              </strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="muted" style={{ fontSize: 12 }}>Next Monotonic Sequence:</span>
              <span className="mono" style={{ fontSize: 12 }}>
                #{queuedEvents.length > 0 ? queuedEvents[queuedEvents.length - 1].sequenceNumber + 1 : 1}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button
              className="btn btn-primary"
              disabled={syncing || queuedEvents.length === 0}
              onClick={handleSyncNow}
              style={{ flex: 1 }}
            >
              {syncing ? 'Verifying & Merging…' : `🚀 Synchronize ${queuedEvents.length} Events to Central Ledger`}
            </button>

            {queuedEvents.length > 0 && (
              <button className="btn btn-danger btn-sm" onClick={handleClearQueue}>
                Discard
              </button>
            )}
          </div>

          {/* Sync Receipt */}
          {syncReceipt && (
            <div
              style={{
                marginTop: 14,
                padding: 12,
                background: 'rgba(111, 156, 127, 0.1)',
                border: '1px solid var(--accent-olive)',
                borderRadius: 2
              }}
            >
              <div style={{ fontWeight: 700, color: 'var(--accent-olive)', marginBottom: 6, fontSize: 13 }}>
                Reconciliation Receipt (Batch {syncReceipt.syncBatchId?.slice(0, 8)}…)
              </div>
              <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)' }}>
                <div>&bull; Applied to Ledger: {syncReceipt.appliedCount} block(s)</div>
                <div>&bull; Conflicts Audited: {syncReceipt.conflictCount}</div>
                <div>&bull; Duplicate Submissions: {syncReceipt.duplicateCount}</div>
                <div>&bull; Rejections: {syncReceipt.rejectedCount}</div>
                <div>&bull; Elapsed Sync Time: {syncReceipt.elapsedMs} ms</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Live IndexedDB Queue Inspector Table */}
      <div className="panel" style={{ marginTop: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div className="panel-title" style={{ margin: 0 }}>
            Live IndexedDB Event Store ({queuedEvents.length} Queued)
          </div>
          <span className="muted" style={{ fontSize: 11, fontFamily: 'var(--font-mono)' }}>
            Store: ordnance_tactical_ddil_db / offline_events
          </span>
        </div>

        <table>
          <thead>
            <tr>
              <th style={{ width: 60 }}>Seq #</th>
              <th>Action</th>
              <th>Lot ID</th>
              <th>Payload Details</th>
              <th>HMAC-SHA256 Signature</th>
              <th>Captured Timestamp</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {queuedEvents.map((ev) => (
              <tr key={ev.eventId}>
                <td className="mono" style={{ fontWeight: 700, color: 'var(--accent-amber)' }}>
                  #{ev.sequenceNumber}
                </td>
                <td style={{ fontWeight: 600 }}>{ev.action}</td>
                <td className="mono">{ev.payload?.lotID || '—'}</td>
                <td className="mono muted" style={{ fontSize: 11 }}>
                  {JSON.stringify(ev.payload)}
                </td>
                <td className="mono" style={{ fontSize: 10, color: 'var(--accent-steel)' }}>
                  {ev.signature ? `${ev.signature.slice(0, 16)}…` : 'none'}
                </td>
                <td className="muted" style={{ fontSize: 11 }}>
                  {new Date(ev.capturedAt).toLocaleTimeString()}
                </td>
                <td>
                  <button
                    className="btn btn-sm btn-danger"
                    onClick={async () => {
                      await removeEvent(ev.eventId);
                      await loadQueue();
                    }}
                    style={{ padding: '2px 6px', fontSize: 10 }}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {queuedEvents.length === 0 && (
          <div className="table-empty">
            No events in offline queue. Toggle "Simulate Comms Cut" and queue an action above to see it held in IndexedDB.
          </div>
        )}
      </div>
    </div>
  );
}
