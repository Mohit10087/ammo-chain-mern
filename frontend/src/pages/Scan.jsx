import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { enqueueOfflineEvent, getQueuedEvents, syncOfflineQueue } from '../utils/offlineQueue';

export default function Scan() {
  const { actor } = useAuth();
  const [lotID, setLotID] = useState('');
  const [action, setAction] = useState(actor.org === 'FieldUnit' ? 'CONSUME' : 'ISSUE_TO_UNIT');
  const [targetId, setTargetId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [temperatureC, setTemperatureC] = useState('24.5');
  const [humidityPct, setHumidityPct] = useState('45.0');
  const [forceOffline, setForceOffline] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [queuedEvents, setQueuedEvents] = useState([]);
  const [syncResults, setSyncResults] = useState(null);
  const [syncing, setSyncing] = useState(false);

  const loadQueue = useCallback(async () => {
    try {
      const events = await getQueuedEvents();
      setQueuedEvents(events);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadQueue();
    const handleQueueChange = () => loadQueue();
    window.addEventListener('ordnance_offline_queue_changed', handleQueueChange);
    return () => window.removeEventListener('ordnance_offline_queue_changed', handleQueueChange);
  }, [loadQueue]);

  const actionsForOrg = {
    OrdnanceFactory: [{ value: 'ISSUE_TO_DEPOT', label: 'Issue to Depot' }],
    Depot: [
      { value: 'ISSUE_TO_UNIT', label: 'Issue to Field Unit' },
      { value: 'TRANSFER', label: 'Transfer to another Depot' },
      { value: 'LOG_CONDITION', label: 'Log Storage Condition' }
    ],
    FieldUnit: [
      { value: 'CONSUME', label: 'Record Consumption' },
      { value: 'TRANSFER', label: 'Transfer to another Unit' },
      { value: 'LOG_CONDITION', label: 'Log Field Storage Condition' },
      { value: 'DISPOSE', label: 'Dispose Lot' }
    ]
  };
  const options = actionsForOrg[actor.org] || [];

  const isDdilCut = localStorage.getItem('ordnance_simulated_ddil') === 'true';
  const shouldQueueOffline = forceOffline || isDdilCut || !navigator.onLine;

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setBusy(true);

    try {
      if (shouldQueueOffline) {
        // TACTICAL DDIL OFFLINE CAPTURE (Algorithm A.5)
        let offlineAction = action;
        let offlinePayload = { lotID };

        if (action === 'CONSUME') {
          offlineAction = 'RECORD_CONSUMPTION';
          offlinePayload = { lotID, quantity: Number(quantity) };
        } else if (action === 'TRANSFER') {
          offlineAction = 'TRANSFER_LOT';
          offlinePayload = { lotID, toId: targetId };
        } else if (action === 'ISSUE_TO_DEPOT') {
          offlineAction = 'ISSUE_LOT';
          offlinePayload = { lotID, toOrg: 'Depot', toId: targetId };
        } else if (action === 'ISSUE_TO_UNIT') {
          offlineAction = 'ISSUE_LOT';
          offlinePayload = { lotID, toOrg: 'FieldUnit', toId: targetId };
        } else if (action === 'LOG_CONDITION') {
          offlineAction = 'UPDATE_STORAGE_CONDITION';
          offlinePayload = { lotID, temperatureC: Number(temperatureC), humidityPct: Number(humidityPct) };
        }

        const queued = await enqueueOfflineEvent({
          action: offlineAction,
          payload: offlinePayload,
          actor
        });

        setResult(
          `⚡ Captured in Tactical Offline Queue! Seq #${queued.sequenceNumber} HMAC-SHA256 signed. Stored in IndexedDB.`
        );
        await loadQueue();
      } else {
        // STANDARD ONLINE SUBMISSION
        let response;
        if (action === 'ISSUE_TO_DEPOT') {
          response = await api.post('/lots/issue', { lotID, toOrg: 'Depot', toId: targetId });
          setResult(`Lot ${lotID} issued to Depot ${targetId}.`);
        } else if (action === 'ISSUE_TO_UNIT') {
          response = await api.post('/lots/issue', { lotID, toOrg: 'FieldUnit', toId: targetId });
          setResult(`Lot ${lotID} issued to Field Unit ${targetId}.`);
        } else if (action === 'TRANSFER') {
          response = await api.post('/lots/transfer', { lotID, toId: targetId });
          setResult(`Lot ${lotID} transferred to ${targetId}.`);
        } else if (action === 'CONSUME') {
          response = await api.post('/lots/consume', { lotID, quantity: Number(quantity) });
          setResult(
            response.requisition
              ? `Consumption recorded. Depot stock fell below threshold - requisition ${response.requisition.requisitionID} created.`
              : 'Consumption recorded.'
          );
        } else if (action === 'LOG_CONDITION') {
          await api.post('/lots/condition', {
            lotID,
            temperatureC: Number(temperatureC),
            humidityPct: Number(humidityPct)
          });
          setResult(`Storage condition logged for Lot ${lotID}.`);
        } else if (action === 'DISPOSE') {
          response = await api.post('/lots/dispose', { lotID, reason: 'disposed via scan' });
          setResult(`Lot ${lotID} marked disposed.`);
        }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSync() {
    setSyncing(true);
    setSyncResults(null);
    setError(null);
    try {
      const summary = await syncOfflineQueue(api);
      setSyncResults(summary);
      await loadQueue();
    } catch (err) {
      setError(err.message);
    } finally {
      setSyncing(false);
    }
  }

  const needsTarget = ['ISSUE_TO_DEPOT', 'ISSUE_TO_UNIT', 'TRANSFER'].includes(action);
  const needsQuantity = action === 'CONSUME';
  const needsCondition = action === 'LOG_CONDITION';

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Scan / Move & Tactical DDIL Queue</h1>
          <p>
            Capture physical RFID/QR actions online or store-and-forward cryptographically while disconnected in DDIL conditions.
          </p>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {result && (
        <div className="success-banner">
          {result} {lotID && !shouldQueueOffline && <Link to={`/lots/${lotID}`}>View lot &rarr;</Link>}
        </div>
      )}

      <div className="grid-2">
        {/* Scanner Form */}
        <div className="panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div className="panel-title" style={{ margin: 0 }}>Action Entry Form</div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={forceOffline}
                onChange={(e) => setForceOffline(e.target.checked)}
              />
              Force Tactical Offline Mode
            </label>
          </div>

          {shouldQueueOffline && (
            <div style={{ background: 'rgba(255, 152, 0, 0.15)', border: '1px solid #ff9800', padding: '8px 12px', borderRadius: 4, marginBottom: 14, fontSize: 12, color: '#ffb74d' }}>
              ⚡ <strong>DDIL Offline Mode Active:</strong> Action will be signed with Web Crypto HMAC-SHA256 and queued locally in IndexedDB until sync.
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="field">
              <label>Lot ID</label>
              <input required autoFocus placeholder="LOT-556-101" value={lotID} onChange={(e) => setLotID(e.target.value)} />
            </div>

            <div className="field">
              <label>Action</label>
              <select value={action} onChange={(e) => setAction(e.target.value)}>
                {options.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {needsTarget && (
              <div className="field">
                <label>Destination ID</label>
                <input required placeholder="DEPOT-01 / UNIT-ALPHA" value={targetId} onChange={(e) => setTargetId(e.target.value)} />
              </div>
            )}

            {needsQuantity && (
              <div className="field">
                <label>Quantity (rounds)</label>
                <input required type="number" min="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
              </div>
            )}

            {needsCondition && (
              <div className="grid-2" style={{ gap: 10 }}>
                <div className="field">
                  <label>Temperature (&deg;C)</label>
                  <input required type="number" step="0.1" value={temperatureC} onChange={(e) => setTemperatureC(e.target.value)} />
                </div>
                <div className="field">
                  <label>Humidity (%)</label>
                  <input required type="number" step="0.1" value={humidityPct} onChange={(e) => setHumidityPct(e.target.value)} />
                </div>
              </div>
            )}

            <button className={`btn ${shouldQueueOffline ? 'btn-secondary' : 'btn-primary'}`} disabled={busy}>
              {busy ? 'Processing\u2026' : shouldQueueOffline ? 'Queue Offline Action' : 'Submit Live Scan'}
            </button>
          </form>
        </div>

        {/* Offline Queue Inspector */}
        <div className="panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div className="panel-title" style={{ margin: 0 }}>
              Tactical Queue ({queuedEvents.length} Pending)
            </div>
            <button
              className="btn btn-primary btn-sm"
              onClick={handleSync}
              disabled={syncing || queuedEvents.length === 0}
            >
              {syncing ? 'Syncing\u2026' : 'Sync Offline Queue'}
            </button>
          </div>

          {queuedEvents.length === 0 ? (
            <p className="muted" style={{ fontSize: 13, padding: '20px 0', textAlign: 'center' }}>
              No offline events pending. Edge queue in IndexedDB is synchronized with the server.
            </p>
          ) : (
            <div style={{ maxHeight: 280, overflowY: 'auto' }}>
              {queuedEvents.map((ev) => (
                <div
                  key={ev.eventId}
                  style={{
                    padding: '8px 10px',
                    background: 'var(--panel-raised)',
                    border: '1px solid var(--border)',
                    borderRadius: 4,
                    marginBottom: 8,
                    fontSize: 12
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span className="mono" style={{ fontWeight: 600 }}>#{ev.sequenceNumber} &middot; {ev.action}</span>
                    <span className="muted" style={{ fontSize: 10 }}>{new Date(ev.capturedAt).toLocaleTimeString()}</span>
                  </div>
                  <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    Lot: {ev.payload?.lotID} {ev.payload?.quantity ? `\u00B7 ${ev.payload.quantity} rounds` : ''}
                  </div>
                  <div className="mono" style={{ fontSize: 10, color: '#888', wordBreak: 'break-all', marginTop: 4 }}>
                    HMAC: {ev.signature?.slice(0, 16)}&hellip;
                  </div>
                </div>
              ))}
            </div>
          )}

          {syncResults && (
            <div style={{ marginTop: 14, padding: 12, background: 'var(--panel)', border: '1px solid var(--border-strong)', borderRadius: 4 }}>
              <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 6 }}>Batch Sync Resolution Report:</div>
              <div style={{ display: 'flex', gap: 12, fontSize: 11, marginBottom: 8 }}>
                <span style={{ color: '#4caf50' }}>{syncResults.results?.filter((r) => r.status === 'APPLIED').length} Applied</span>
                <span style={{ color: '#f44336' }}>{syncResults.results?.filter((r) => r.status === 'CONFLICT_DETECTED').length} Conflicts</span>
                <span style={{ color: '#ff9800' }}>{syncResults.results?.filter((r) => r.status === 'DUPLICATE_IGNORED').length} Deduplicated</span>
              </div>
              <div style={{ maxHeight: 120, overflowY: 'auto' }}>
                {syncResults.results?.map((res) => (
                  <div key={res.eventId} style={{ fontSize: 11, padding: '3px 0', borderBottom: '1px solid #222' }}>
                    <span className="mono" style={{ fontWeight: 600, color: res.status === 'APPLIED' ? '#4caf50' : '#f44336' }}>
                      [{res.status}]
                    </span>{' '}
                    <span className="mono">{res.action}</span> {res.reason ? `\u2014 ${res.reason}` : ''}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
