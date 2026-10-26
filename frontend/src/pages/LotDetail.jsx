import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from 'recharts';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import StatusBadge from '../components/StatusBadge';
import LedgerStrip from '../components/LedgerStrip';

export default function LotDetail() {
  const { lotID } = useParams();
  const { actor } = useAuth();

  const [lot, setLot] = useState(null);
  const [history, setHistory] = useState([]);
  const [qrCode, setQrCode] = useState(null);
  const [readings, setReadings] = useState([]);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const isHolder = lot && lot.currentHolderOrg === actor.org && (actor.org === 'OrdnanceFactory' || lot.currentHolderId === actor.depotId);

  const load = useCallback(async () => {
    try {
      const [lotRes, historyRes, qrRes, readingsRes] = await Promise.all([
        api.get(`/lots/${lotID}`),
        api.get(`/lots/${lotID}/history`),
        api.get(`/lots/${lotID}/qrcode`),
        api.get(`/degradation/readings/${lotID}`)
      ]);
      setLot(lotRes.lot);
      setHistory(historyRes.history);
      setQrCode(qrRes.qrCode);
      setReadings(
        readingsRes.readings.map((r) => ({ ...r, t: new Date(r.recordedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }))
      );
    } catch (err) {
      setError(err.message);
    }
  }, [lotID]);

  useEffect(() => {
    load();
  }, [load]);

  function afterAction(message) {
    setSuccess(message);
    setError(null);
    load();
  }

  if (!lot) {
    return (
      <div>
        {error && <div className="error-banner">{error}</div>}
        {!error && <p className="muted">Loading lot {lotID}&hellip;</p>}
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="mono">{lot.lotID}</h1>
          <p>
            {lot.ammoType} &middot; {lot.caliber} &middot; manufactured{' '}
            {new Date(lot.manufactureDate).toLocaleDateString()}
          </p>
        </div>
        <Link to="/lots">&larr; Back to registry</Link>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {success && <div className="success-banner">{success}</div>}

      <div className="grid-2">
        <div className="panel">
          <div className="panel-title">Current State</div>
          <KV label="Status"><StatusBadge value={lot.status} /></KV>
          <KV label="Holder">{lot.currentHolderOrg} <span className="mono muted">{lot.currentHolderId}</span></KV>
          <KV label="Quantity">{lot.quantity.toLocaleString()} rounds</KV>
          <KV label="Consumed">{lot.quantityConsumed.toLocaleString()} rounds</KV>
          <KV label="Remaining">{(lot.quantity - lot.quantityConsumed).toLocaleString()} rounds</KV>
          <KV label="Last Risk Score">
            <RiskBar score={lot.lastRiskScore || 0} />
          </KV>
        </div>

        <div className="panel">
          <div className="panel-title">Scan Code</div>
          {qrCode ? (
            <div style={{ textAlign: 'center' }}>
              <div className="qr-box">
                <img src={qrCode} alt={`QR code for ${lot.lotID}`} width={160} height={160} />
              </div>
              <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                Scan on the Scan / Move page to simulate a physical scan-in/scan-out.
              </p>
            </div>
          ) : (
            <p className="muted">Generating&hellip;</p>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel-title">Ledger History (hash-chained, tamper-evident)</div>
        <LedgerStrip blocks={history} />
      </div>

      {readings.length > 0 && (
        <div className="panel">
          <div className="panel-title">Storage Conditions Over Time</div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={readings}>
              <CartesianGrid stroke="#2c343d" strokeDasharray="3 3" />
              <XAxis dataKey="t" stroke="#8B939C" fontSize={11} />
              <YAxis stroke="#8B939C" fontSize={11} />
              <Tooltip contentStyle={{ background: '#1a2027', border: '1px solid #2c343d' }} />
              <Line type="monotone" dataKey="temperatureC" name="Temp (C)" stroke="#c14a3a" dot={false} />
              <Line type="monotone" dataKey="humidityPct" name="Humidity (%)" stroke="#5b8ba8" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {actor.org !== 'Commander' && (
        <ActionsPanel lot={lot} actor={actor} isHolder={isHolder} onDone={afterAction} onError={setError} />
      )}
    </div>
  );
}

function KV({ label, children }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
      <span className="muted">{label}</span>
      <span>{children}</span>
    </div>
  );
}

function RiskBar({ score }) {
  const color = score >= 70 ? 'var(--accent-rust)' : score >= 40 ? 'var(--accent-amber)' : 'var(--accent-olive)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: 140 }}>
      <div className="risk-bar-track">
        <div className="risk-bar-fill" style={{ width: `${Math.min(100, score)}%`, background: color }} />
      </div>
      <span className="mono" style={{ fontSize: 12 }}>{score}</span>
    </div>
  );
}

function ActionsPanel({ lot, actor, isHolder, onDone, onError }) {
  const [toId, setToId] = useState('');
  const [consumeQty, setConsumeQty] = useState('');
  const [disposeReason, setDisposeReason] = useState('');
  const [temperatureC, setTemperatureC] = useState('');
  const [humidityPct, setHumidityPct] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(fn) {
    setBusy(true);
    onError(null);
    try {
      await fn();
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const canIssueToDepot = actor.org === 'OrdnanceFactory' && lot.currentHolderOrg === 'OrdnanceFactory';
  const canIssueToUnit = actor.org === 'Depot' && isHolder && lot.currentHolderOrg === 'Depot';
  const canTransfer = ['Depot', 'FieldUnit'].includes(actor.org) && isHolder;
  const canConsume = actor.org === 'FieldUnit' && isHolder;
  const canDispose = ['Depot', 'FieldUnit'].includes(actor.org) && isHolder;
  const canLogCondition = ['Depot', 'FieldUnit'].includes(actor.org) && isHolder;

  if (!canIssueToDepot && !canIssueToUnit && !canTransfer && !canConsume && !canDispose && !canLogCondition) {
    return (
      <div className="panel">
        <div className="panel-title">Actions</div>
        <p className="muted">This lot is not currently held by your organization, so there is nothing to do here.</p>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="panel-title">Actions</div>

      {(canIssueToDepot || canIssueToUnit) && (
        <div className="form-row" style={{ alignItems: 'end', marginBottom: 14 }}>
          <div className="field">
            <label>{canIssueToDepot ? 'Issue to Depot ID' : 'Issue to Field Unit ID'}</label>
            <input placeholder={canIssueToDepot ? 'DEPOT-01' : 'UNIT-ALPHA'} value={toId} onChange={(e) => setToId(e.target.value)} />
          </div>
          <button
            className="btn btn-primary"
            disabled={busy || !toId}
            onClick={() =>
              run(async () => {
                await api.post('/lots/issue', { lotID: lot.lotID, toOrg: canIssueToDepot ? 'Depot' : 'FieldUnit', toId });
                setToId('');
                onDone(`Lot issued to ${toId}.`);
              })
            }
          >
            Issue Lot
          </button>
        </div>
      )}

      {canTransfer && (
        <div className="form-row" style={{ alignItems: 'end', marginBottom: 14 }}>
          <div className="field">
            <label>Transfer laterally to ID</label>
            <input placeholder="DEPOT-02 / UNIT-BRAVO" value={toId} onChange={(e) => setToId(e.target.value)} />
          </div>
          <button
            className="btn"
            disabled={busy || !toId}
            onClick={() =>
              run(async () => {
                await api.post('/lots/transfer', { lotID: lot.lotID, toId });
                setToId('');
                onDone(`Lot transferred to ${toId}.`);
              })
            }
          >
            Transfer
          </button>
        </div>
      )}

      {canConsume && (
        <div className="form-row" style={{ alignItems: 'end', marginBottom: 14 }}>
          <div className="field">
            <label>Record consumption (rounds)</label>
            <input type="number" min="1" value={consumeQty} onChange={(e) => setConsumeQty(e.target.value)} />
          </div>
          <button
            className="btn btn-primary"
            disabled={busy || !consumeQty}
            onClick={() =>
              run(async () => {
                await api.post('/lots/consume', { lotID: lot.lotID, quantity: Number(consumeQty) });
                setConsumeQty('');
                onDone('Consumption recorded and stock levels re-checked.');
              })
            }
          >
            Record Consumption
          </button>
        </div>
      )}

      {canLogCondition && (
        <div className="form-row" style={{ alignItems: 'end', marginBottom: 14 }}>
          <div className="field">
            <label>Manual reading: Temp (C)</label>
            <input type="number" value={temperatureC} onChange={(e) => setTemperatureC(e.target.value)} />
          </div>
          <div className="field">
            <label>Manual reading: Humidity (%)</label>
            <input type="number" value={humidityPct} onChange={(e) => setHumidityPct(e.target.value)} />
          </div>
          <button
            className="btn"
            disabled={busy || temperatureC === '' || humidityPct === ''}
            onClick={() =>
              run(async () => {
                const res = await api.post('/lots/condition', {
                  lotID: lot.lotID,
                  temperatureC: Number(temperatureC),
                  humidityPct: Number(humidityPct)
                });
                setTemperatureC('');
                setHumidityPct('');
                onDone(
                  res.alert
                    ? `Reading logged. Risk score ${res.riskScore} crossed the alert threshold - flagged for inspection.`
                    : `Reading logged. Risk score ${res.riskScore}.`
                );
              })
            }
          >
            Log Reading
          </button>
        </div>
      )}

      {canDispose && (
        <div className="form-row" style={{ alignItems: 'end' }}>
          <div className="field">
            <label>Dispose reason</label>
            <input placeholder="expired / damaged / expended" value={disposeReason} onChange={(e) => setDisposeReason(e.target.value)} />
          </div>
          <button
            className="btn btn-danger"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await api.post('/lots/dispose', { lotID: lot.lotID, reason: disposeReason || 'unspecified' });
                setDisposeReason('');
                onDone('Lot marked disposed.');
              })
            }
          >
            Dispose Lot
          </button>
        </div>
      )}
    </div>
  );
}
