import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from 'recharts';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import StatusBadge from '../components/StatusBadge';
import LedgerStrip from '../components/LedgerStrip';
import { verifyProofInBrowser } from '../utils/webCryptoMerkle';

export default function LotDetail() {
  const { lotID } = useParams();
  const { actor } = useAuth();

  const [lot, setLot] = useState(null);
  const [history, setHistory] = useState([]);
  const [qrCode, setQrCode] = useState(null);
  const [readings, setReadings] = useState([]);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  // Merkle Audit Layer state
  const [merkleData, setMerkleData] = useState(null);
  const [selectedBlock, setSelectedBlock] = useState(null);
  const [proofResult, setProofResult] = useState(null);
  const [verifyingProof, setVerifyingProof] = useState(false);
  const [proofError, setProofError] = useState(null);

  const isHolder = lot && lot.currentHolderOrg === actor.org && (actor.org === 'OrdnanceFactory' || lot.currentHolderId === actor.depotId);

  const load = useCallback(async () => {
    try {
      const [lotRes, historyRes, qrRes, readingsRes, merkleRes] = await Promise.all([
        api.get(`/lots/${lotID}`),
        api.get(`/lots/${lotID}/history`),
        api.get(`/lots/${lotID}/qrcode`),
        api.get(`/degradation/readings/${lotID}`),
        api.get(`/lots/${lotID}/merkle-root`).catch(() => null)
      ]);
      setLot(lotRes.lot);
      setHistory(historyRes.history);
      setQrCode(qrRes.qrCode);
      setMerkleData(merkleRes);
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

  async function verifyBlock(block) {
    setSelectedBlock(block);
    setVerifyingProof(true);
    setProofError(null);
    setProofResult(null);
    try {
      const proofRes = await api.get(`/lots/${lotID}/proof/${block.index}`);
      const root = proofRes.root;
      const browserResult = await verifyProofInBrowser(block.hash, proofRes.proof, root);
      setProofResult({
        ...proofRes,
        browserVerification: browserResult
      });
    } catch (err) {
      setProofError(err.message);
    } finally {
      setVerifyingProof(false);
    }
  }

  async function handleCreateCheckpoint() {
    try {
      await api.post(`/lots/${lotID}/checkpoint`);
      afterAction('Merkle checkpoint successfully anchored on-chain.');
    } catch (err) {
      setError(err.message);
    }
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <div className="panel-title" style={{ margin: 0 }}>Ledger History & Merkle Audit Layer</div>
            <p className="muted" style={{ fontSize: 12, margin: '2px 0 0 0' }}>
              Select any block below to generate an O(log n) cryptographic inclusion proof and verify it in your browser.
            </p>
          </div>
          {['OrdnanceFactory', 'Depot', 'Commander'].includes(actor.org) && (
            <button className="btn btn-secondary btn-sm" onClick={handleCreateCheckpoint}>
              Anchor Merkle Checkpoint
            </button>
          )}
        </div>

        <LedgerStrip
          blocks={history}
          selectedIndex={selectedBlock?.index}
          onSelectBlock={verifyBlock}
        />

        {verifyingProof && (
          <div style={{ padding: '12px', background: 'var(--panel-raised)', marginTop: 12, borderRadius: 4 }}>
            <span className="mono" style={{ fontSize: 12 }}>Generating proof and computing Web Crypto SHA-256 hashes&hellip;</span>
          </div>
        )}

        {proofError && (
          <div className="error-banner" style={{ marginTop: 12 }}>
            {proofError}
          </div>
        )}

        {proofResult && (
          <div style={{ marginTop: 14, padding: 14, background: 'var(--panel-raised)', border: '1px solid var(--border-strong)', borderRadius: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="mono" style={{ fontWeight: 600 }}>Block #{proofResult.blockIndex} Inclusion Proof</span>
                <span
                  style={{
                    padding: '3px 8px',
                    borderRadius: 3,
                    fontSize: 11,
                    fontWeight: 600,
                    background: proofResult.browserVerification?.valid ? 'rgba(76, 175, 80, 0.2)' : 'rgba(244, 67, 54, 0.2)',
                    color: proofResult.browserVerification?.valid ? '#4caf50' : '#f44336',
                    border: `1px solid ${proofResult.browserVerification?.valid ? '#4caf50' : '#f44336'}`
                  }}
                >
                  {proofResult.browserVerification?.valid ? '\u2713 VERIFIED IN-BROWSER (Web Crypto API)' : '\u2717 TAMPER DETECTED / INVALID'}
                </span>
              </div>
              <span className="muted mono" style={{ fontSize: 11 }}>
                Proof Size: {proofResult.proofSizeBytes} bytes ({proofResult.proof?.length} sibling hashes) &middot; Verified in {proofResult.browserVerification?.durationMs} ms
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 8, fontSize: 12, marginBottom: 8 }}>
              <span className="muted">Block Hash:</span>
              <span className="mono" style={{ wordBreak: 'break-all' }}>{proofResult.blockHash}</span>

              {selectedBlock?.capturedAt && (
                <>
                  <span className="muted">Tactical Origin:</span>
                  <span className="mono" style={{ color: 'var(--accent-amber)' }}>
                    ⚡ Captured offline at {new Date(selectedBlock.capturedAt).toLocaleString()} &middot; Device: {selectedBlock.deviceId || 'Tactical Node'}
                  </span>
                </>
              )}

              <span className="muted">Leaf Hash (0x00):</span>
              <span className="mono" style={{ wordBreak: 'break-all' }}>{proofResult.leafHash}</span>

              <span className="muted">Merkle Root:</span>
              <span className="mono" style={{ wordBreak: 'break-all', color: 'var(--accent-olive, #4caf50)' }}>{proofResult.root}</span>
            </div>

            {proofResult.proof?.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div className="muted" style={{ fontSize: 11, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Cryptographic Proof Path (Siblings Leaf &rarr; Root):
                </div>
                <div style={{ maxHeight: 130, overflowY: 'auto', background: 'var(--panel)', padding: 8, border: '1px solid var(--border)', borderRadius: 3 }}>
                  {proofResult.proof.map((p, idx) => (
                    <div key={idx} style={{ display: 'flex', gap: 10, fontSize: 11, padding: '2px 0', borderBottom: '1px solid #222' }}>
                      <span className="mono muted">L{idx + 1} ({p.position})</span>
                      <span className="mono" style={{ wordBreak: 'break-all' }}>{p.hash}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
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
  const [returnDepotId, setReturnDepotId] = useState('DEPOT-01');
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
  const canReturnToDepot = actor.org === 'FieldUnit' && isHolder && lot.currentHolderOrg === 'FieldUnit';
  const canConsume = actor.org === 'FieldUnit' && isHolder;
  const canDispose = ['Depot', 'FieldUnit'].includes(actor.org) && isHolder;
  const canLogCondition = ['Depot', 'FieldUnit'].includes(actor.org) && isHolder;

  if (!canIssueToDepot && !canIssueToUnit && !canTransfer && !canReturnToDepot && !canConsume && !canDispose && !canLogCondition) {
    return (
      <div className="panel">
        <div className="panel-title">Actions</div>
        <p className="muted">This lot is not currently held by your organization, so there is nothing to do here.</p>
      </div>
    );
  }

  const defaultPeerId =
    actor.org === 'Depot'
      ? actor.depotId === 'DEPOT-01'
        ? 'DEPOT-02'
        : 'DEPOT-01'
      : actor.depotId === 'UNIT-ALPHA'
      ? 'UNIT-BRAVO'
      : 'UNIT-ALPHA';

  const effectivePeerId = toId || defaultPeerId;

  return (
    <div className="panel">
      <div className="panel-title">Actions</div>

      {(canIssueToDepot || canIssueToUnit) && (
        <div className="form-row" style={{ alignItems: 'end', marginBottom: 14 }}>
          <div className="field">
            <label>{canIssueToDepot ? 'Issue to Destination Depot' : 'Issue to Field Unit'}</label>
            {canIssueToDepot ? (
              <select
                value={toId || 'DEPOT-01'}
                onChange={(e) => setToId(e.target.value)}
                style={{ width: '100%', background: 'var(--panel-raised)', border: '1px solid var(--border-strong)', color: 'var(--text)', padding: '8px 10px' }}
              >
                <option value="DEPOT-01">DEPOT-01 (Northern Command)</option>
                <option value="DEPOT-02">DEPOT-02 (Eastern Command)</option>
              </select>
            ) : (
              <select
                value={toId || 'UNIT-ALPHA'}
                onChange={(e) => setToId(e.target.value)}
                style={{ width: '100%', background: 'var(--panel-raised)', border: '1px solid var(--border-strong)', color: 'var(--text)', padding: '8px 10px' }}
              >
                <option value="UNIT-ALPHA">UNIT-ALPHA (1st Forward Battalion)</option>
                <option value="UNIT-BRAVO">UNIT-BRAVO (2nd Forward Battalion)</option>
              </select>
            )}
          </div>
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const target = toId || (canIssueToDepot ? 'DEPOT-01' : 'UNIT-ALPHA');
                await api.post('/lots/issue', { lotID: lot.lotID, toOrg: canIssueToDepot ? 'Depot' : 'FieldUnit', toId: target });
                setToId('');
                onDone(`Lot issued to ${target}.`);
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
            <label>Transfer laterally to peer {actor.org === 'Depot' ? 'Depot' : 'Field Unit'}</label>
            <select
              value={effectivePeerId}
              onChange={(e) => setToId(e.target.value)}
              style={{ width: '100%', background: 'var(--panel-raised)', border: '1px solid var(--border-strong)', color: 'var(--text)', padding: '8px 10px' }}
            >
              {actor.org === 'Depot'
                ? ['DEPOT-01', 'DEPOT-02']
                    .filter((id) => id !== actor.depotId)
                    .map((id) => <option key={id} value={id}>{id} (Peer Command Depot)</option>)
                : ['UNIT-ALPHA', 'UNIT-BRAVO']
                    .filter((id) => id !== actor.depotId)
                    .map((id) => <option key={id} value={id}>{id} (Peer Field Battalion)</option>)}
            </select>
          </div>
          <button
            className="btn"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await api.post('/lots/transfer', { lotID: lot.lotID, toId: effectivePeerId });
                setToId('');
                onDone(`Lot laterally transferred to ${effectivePeerId}.`);
              })
            }
          >
            Transfer Laterally
          </button>
        </div>
      )}

      {canReturnToDepot && (
        <div className="form-row" style={{ alignItems: 'end', marginBottom: 14 }}>
          <div className="field">
            <label>Return Ammunition to Rear Depot (Surplus / Back-loading)</label>
            <select
              value={returnDepotId}
              onChange={(e) => setReturnDepotId(e.target.value)}
              style={{ width: '100%', background: 'var(--panel-raised)', border: '1px solid var(--border-strong)', color: 'var(--text)', padding: '8px 10px' }}
            >
              <option value="DEPOT-01">DEPOT-01 (Northern Command Depot)</option>
              <option value="DEPOT-02">DEPOT-02 (Eastern Command Depot)</option>
            </select>
          </div>
          <button
            className="btn"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await api.post('/lots/return', { lotID: lot.lotID, toDepotId: returnDepotId });
                onDone(`Lot returned to Depot ${returnDepotId} and restored to active storage.`);
              })
            }
          >
            Return to Depot
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
