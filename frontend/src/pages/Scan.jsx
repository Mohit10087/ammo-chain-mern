import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { getQueuedEvents, syncOfflineQueue } from '../utils/offlineQueue';

export default function Scan() {
  const { actor } = useAuth();
  const [lots, setLots] = useState([]);
  const [selectedLotID, setSelectedLotID] = useState('');
  const [manualLotID, setManualLotID] = useState('');
  const [useManualEntry, setUseManualEntry] = useState(false);

  const defaultAction =
    actor.org === 'OrdnanceFactory'
      ? 'ISSUE_TO_DEPOT'
      : actor.org === 'FieldUnit'
      ? 'CONSUME'
      : 'ISSUE_TO_UNIT';

  const [action, setAction] = useState(defaultAction);
  const [targetId, setTargetId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [temperatureC, setTemperatureC] = useState('24.5');
  const [humidityPct, setHumidityPct] = useState('45.0');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  // Load lots held by this actor
  const loadLots = useCallback(async () => {
    try {
      const res = await api.get('/lots');
      const loaded = res.lots || [];
      setLots(loaded);
      if (loaded.length > 0 && !selectedLotID) {
        setSelectedLotID(loaded[0].lotID);
      }
    } catch (err) {
      setError(err.message);
    }
  }, [selectedLotID]);

  useEffect(() => {
    loadLots();
  }, [loadLots]);

  if (actor.org === 'Commander') {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1>Dispatch & Ammunition Movements</h1>
            <p>Role-Gated Chaincode Movement Operations</p>
          </div>
        </div>
        <div className="panel" style={{ borderLeft: '4px solid var(--accent-steel)' }}>
          <div className="panel-title">Read-Only Oversight Mode</div>
          <p>
            The <strong>Commander</strong> account holds cross-organizational read-only audit authority.
            In compliance with strict military chain-of-custody protocols, commanders cannot unilaterally issue, transfer, or consume ammunition lots.
          </p>
          <p className="muted">
            To execute dispatch or consumption transactions, please sign in with an operational role:
          </p>
          <ul style={{ paddingLeft: 20 }}>
            <li><strong>factory_officer</strong> &mdash; Register and issue manufactured lots to depots</li>
            <li><strong>depot1_officer</strong> &mdash; Issue lots to field units or transfer between depots</li>
            <li><strong>unit_alpha</strong> &mdash; Consume rounds in the field or transfer to other units</li>
          </ul>
        </div>
      </div>
    );
  }

  const actionsForOrg = {
    OrdnanceFactory: [{ value: 'ISSUE_TO_DEPOT', label: 'Issue Manufactured Lot to Depot' }],
    Depot: [
      { value: 'ISSUE_TO_UNIT', label: 'Issue Lot to Field Unit' },
      { value: 'TRANSFER_DEPOT', label: 'Transfer Laterally to another Depot' },
      { value: 'LOG_CONDITION', label: 'Log Depot Storage Condition' }
    ],
    FieldUnit: [
      { value: 'CONSUME', label: 'Record Ammunition Consumption' },
      { value: 'TRANSFER_UNIT', label: 'Transfer Laterally to another Field Unit' },
      { value: 'RETURN_DEPOT', label: 'Return Ammunition to Depot (Surplus / Rear Echelon)' },
      { value: 'LOG_CONDITION', label: 'Log Field Storage Condition' },
      { value: 'DISPOSE', label: 'Dispose Expired/Damaged Lot' }
    ]
  };

  const options = actionsForOrg[actor.org] || [];
  const effectiveLotID = useManualEntry ? manualLotID.trim() : selectedLotID;
  const selectedLot = lots.find((l) => l.lotID === effectiveLotID);
  const remainingRounds = selectedLot ? selectedLot.quantity - selectedLot.quantityConsumed : 0;

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setBusy(true);

    try {
      if (!effectiveLotID) throw new Error('Please select or specify a valid Lot ID.');

      // Pre-action barrier: Ensure any prior offline events in IndexedDB are committed FIRST
      const pendingOffline = await getQueuedEvents();
      if (pendingOffline.length > 0) {
        await syncOfflineQueue(api);
      }

      // Compute effective target with fallback defaults
      let effectiveTarget = targetId.trim();
      if (!effectiveTarget) {
        if (action === 'ISSUE_TO_DEPOT') effectiveTarget = 'DEPOT-01';
        else if (action === 'ISSUE_TO_UNIT') effectiveTarget = 'UNIT-ALPHA';
        else if (action === 'TRANSFER_DEPOT') effectiveTarget = actor.depotId === 'DEPOT-01' ? 'DEPOT-02' : 'DEPOT-01';
        else if (action === 'TRANSFER_UNIT') effectiveTarget = actor.depotId === 'UNIT-ALPHA' ? 'UNIT-BRAVO' : 'UNIT-ALPHA';
        else if (action === 'RETURN_DEPOT') effectiveTarget = selectedLot?.sourceDepotId || 'DEPOT-01';
      }

      let response;
      if (action === 'ISSUE_TO_DEPOT') {
        if (!effectiveTarget) throw new Error('Please specify destination Depot ID (e.g. DEPOT-01).');
        response = await api.post('/lots/issue', { lotID: effectiveLotID, toOrg: 'Depot', toId: effectiveTarget });
        setResult(`✅ Lot ${effectiveLotID} issued to Depot ${effectiveTarget}.`);
      } else if (action === 'ISSUE_TO_UNIT') {
        if (!effectiveTarget) throw new Error('Please specify destination Field Unit ID (e.g. UNIT-ALPHA).');
        response = await api.post('/lots/issue', { lotID: effectiveLotID, toOrg: 'FieldUnit', toId: effectiveTarget });
        setResult(`✅ Lot ${effectiveLotID} issued to Field Unit ${effectiveTarget}.`);
      } else if (action === 'TRANSFER_DEPOT' || action === 'TRANSFER_UNIT') {
        if (!effectiveTarget) throw new Error('Please specify destination recipient ID.');
        response = await api.post('/lots/transfer', { lotID: effectiveLotID, toId: effectiveTarget });
        setResult(`✅ Lot ${effectiveLotID} laterally transferred to ${effectiveTarget}.`);
      } else if (action === 'RETURN_DEPOT') {
        if (!effectiveTarget) throw new Error('Please specify destination Depot ID.');
        response = await api.post('/lots/return', { lotID: effectiveLotID, toDepotId: effectiveTarget });
        setResult(`✅ Lot ${effectiveLotID} returned to Depot ${effectiveTarget} and restored to active storage.`);
      } else if (action === 'CONSUME') {
        const q = Number(quantity);
        if (!q || q <= 0) throw new Error('Please enter a positive consumption quantity.');
        response = await api.post('/lots/consume', { lotID: effectiveLotID, quantity: q });
        setResult(
          response.requisition
            ? `✅ Consumption of ${q} rounds recorded. Depot stock fell below threshold: Requisition ${response.requisition.requisitionID} triggered!`
            : `✅ Consumption of ${q} rounds recorded.`
        );
        setQuantity('');
      } else if (action === 'LOG_CONDITION') {
        await api.post('/lots/condition', {
          lotID: effectiveLotID,
          temperatureC: Number(temperatureC),
          humidityPct: Number(humidityPct)
        });
        setResult(`✅ Storage condition logged for Lot ${effectiveLotID}.`);
      } else if (action === 'DISPOSE') {
        response = await api.post('/lots/dispose', { lotID: effectiveLotID, reason: 'Disposed via operational console' });
        setResult(`✅ Lot ${effectiveLotID} marked disposed.`);
      }

      await loadLots();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const needsTarget = ['ISSUE_TO_DEPOT', 'ISSUE_TO_UNIT', 'TRANSFER_DEPOT', 'TRANSFER_UNIT', 'RETURN_DEPOT'].includes(action);
  const needsQuantity = action === 'CONSUME';
  const needsCondition = action === 'LOG_CONDITION';

  return (
    <div>
      <div className="page-header" style={{ marginBottom: 16 }}>
        <div>
          <h1>Dispatch & Inventory Movement</h1>
          <p>
            Role-authorized custody transfers, unit issues, and consumption tracking anchored to the blockchain ledger.
          </p>
        </div>
      </div>

      {/* Innovation notice */}
      <div
        className="panel"
        style={{
          marginBottom: 16,
          background: 'var(--panel-raised)',
          borderLeft: '4px solid var(--accent-olive)',
          padding: '10px 14px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}
      >
        <div>
          <strong style={{ color: 'var(--accent-olive)' }}>⚡ Tactical Store-and-Forward Offline Queue Available</strong>
          <div className="muted" style={{ fontSize: 12 }}>
            Operating during a tactical communications outage or network blackout? Use the dedicated offline console.
          </div>
        </div>
        <Link to="/offline-console" className="btn btn-sm btn-secondary">
          Open Tactical DDIL Console &rarr;
        </Link>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {result && (
        <div className="success-banner">
          {result} {effectiveLotID && <Link to={`/lots/${effectiveLotID}`}>View lot in ledger &rarr;</Link>}
        </div>
      )}

      <div className="grid-2">
        <div className="panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div className="panel-title" style={{ margin: 0 }}>Operational Movement Form</div>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setUseManualEntry(!useManualEntry)}
              style={{ fontSize: 11, padding: '4px 8px' }}
            >
              {useManualEntry ? 'Select from My Lots' : 'Manual Barcode Scan'}
            </button>
          </div>

          <form onSubmit={handleSubmit}>
            {/* Lot selection */}
            <div className="field">
              <label>{useManualEntry ? 'Scanned / Manual Lot ID' : 'Select Ammunition Lot'}</label>
              {useManualEntry ? (
                <input
                  required
                  autoFocus
                  placeholder="e.g. LOT-DEP1-762-01"
                  value={manualLotID}
                  onChange={(e) => setManualLotID(e.target.value)}
                />
              ) : lots.length > 0 ? (
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
                      {l.lotID} &mdash; {l.ammoType} ({l.quantity - l.quantityConsumed} rounds remaining)
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  required
                  placeholder="e.g. LOT-DEP1-762-01"
                  value={selectedLotID}
                  onChange={(e) => setSelectedLotID(e.target.value)}
                />
              )}
            </div>

            {selectedLot && (
              <div
                style={{
                  padding: '8px 12px',
                  background: 'var(--panel-raised)',
                  border: '1px solid var(--border)',
                  borderRadius: 2,
                  marginBottom: 14,
                  fontSize: 12
                }}
              >
                <div><strong>Caliber:</strong> {selectedLot.caliber} &middot; <strong>Ammo Type:</strong> {selectedLot.ammoType}</div>
                <div><strong>Available Rounds:</strong> {remainingRounds.toLocaleString()} &middot; <strong>Current Status:</strong> {selectedLot.status}</div>
              </div>
            )}

            {/* Action Selection */}
            <div className="field">
              <label>Authorized Action for {actor.org}</label>
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
                {options.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {needsTarget && (
              <div className="field">
                <label>
                  {action === 'ISSUE_TO_DEPOT'
                    ? 'Target Destination Depot'
                    : action === 'TRANSFER_DEPOT'
                    ? 'Target Peer Depot (Lateral Transfer)'
                    : action === 'ISSUE_TO_UNIT'
                    ? 'Target Destination Field Unit'
                    : action === 'TRANSFER_UNIT'
                    ? 'Target Peer Field Unit (Lateral Transfer)'
                    : 'Target Destination Depot (Return Surplus)'}
                </label>
                {action === 'ISSUE_TO_DEPOT' ? (
                  <select
                    value={targetId || 'DEPOT-01'}
                    onChange={(e) => setTargetId(e.target.value)}
                    style={{
                      width: '100%',
                      background: 'var(--panel-raised)',
                      border: '1px solid var(--border-strong)',
                      color: 'var(--text)',
                      padding: '8px 10px'
                    }}
                    required
                  >
                    <option value="DEPOT-01">DEPOT-01 (Northern Command Depot)</option>
                    <option value="DEPOT-02">DEPOT-02 (Eastern Command Depot)</option>
                  </select>
                ) : action === 'TRANSFER_DEPOT' ? (
                  <select
                    value={targetId || (actor.depotId === 'DEPOT-01' ? 'DEPOT-02' : 'DEPOT-01')}
                    onChange={(e) => setTargetId(e.target.value)}
                    style={{
                      width: '100%',
                      background: 'var(--panel-raised)',
                      border: '1px solid var(--border-strong)',
                      color: 'var(--text)',
                      padding: '8px 10px'
                    }}
                    required
                  >
                    {['DEPOT-01', 'DEPOT-02']
                      .filter((id) => id !== actor.depotId)
                      .map((id) => (
                        <option key={id} value={id}>
                          {id} (Peer Command Depot)
                        </option>
                      ))}
                  </select>
                ) : action === 'ISSUE_TO_UNIT' ? (
                  <select
                    value={targetId || 'UNIT-ALPHA'}
                    onChange={(e) => setTargetId(e.target.value)}
                    style={{
                      width: '100%',
                      background: 'var(--panel-raised)',
                      border: '1px solid var(--border-strong)',
                      color: 'var(--text)',
                      padding: '8px 10px'
                    }}
                    required
                  >
                    <option value="UNIT-ALPHA">UNIT-ALPHA (1st Forward Battalion)</option>
                    <option value="UNIT-BRAVO">UNIT-BRAVO (2nd Forward Battalion)</option>
                  </select>
                ) : action === 'TRANSFER_UNIT' ? (
                  <select
                    value={targetId || (actor.depotId === 'UNIT-ALPHA' ? 'UNIT-BRAVO' : 'UNIT-ALPHA')}
                    onChange={(e) => setTargetId(e.target.value)}
                    style={{
                      width: '100%',
                      background: 'var(--panel-raised)',
                      border: '1px solid var(--border-strong)',
                      color: 'var(--text)',
                      padding: '8px 10px'
                    }}
                    required
                  >
                    {['UNIT-ALPHA', 'UNIT-BRAVO']
                      .filter((id) => id !== actor.depotId)
                      .map((id) => (
                        <option key={id} value={id}>
                          {id} (Peer Field Battalion)
                        </option>
                      ))}
                  </select>
                ) : action === 'RETURN_DEPOT' ? (
                  <select
                    value={targetId || (selectedLot?.sourceDepotId || 'DEPOT-01')}
                    onChange={(e) => setTargetId(e.target.value)}
                    style={{
                      width: '100%',
                      background: 'var(--panel-raised)',
                      border: '1px solid var(--border-strong)',
                      color: 'var(--text)',
                      padding: '8px 10px'
                    }}
                    required
                  >
                    <option value="DEPOT-01">DEPOT-01 (Northern Command Depot)</option>
                    <option value="DEPOT-02">DEPOT-02 (Eastern Command Depot)</option>
                  </select>
                ) : (
                  <input
                    required
                    placeholder="Recipient ID"
                    value={targetId}
                    onChange={(e) => setTargetId(e.target.value)}
                  />
                )}
              </div>
            )}

            {needsQuantity && (
              <div className="field">
                <label>Quantity Consumed (rounds)</label>
                <input
                  required
                  type="number"
                  min="1"
                  max={remainingRounds > 0 ? remainingRounds : 100000}
                  placeholder={`e.g. 500 (max ${remainingRounds})`}
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
              </div>
            )}

            {needsCondition && (
              <div className="form-row">
                <div className="field">
                  <label>Temperature (&deg;C)</label>
                  <input
                    required
                    type="number"
                    step="0.1"
                    value={temperatureC}
                    onChange={(e) => setTemperatureC(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label>Humidity (%)</label>
                  <input
                    required
                    type="number"
                    step="0.1"
                    value={humidityPct}
                    onChange={(e) => setHumidityPct(e.target.value)}
                  />
                </div>
              </div>
            )}

            <button className="btn btn-primary" disabled={busy} style={{ width: '100%', marginTop: 10 }}>
              {busy ? 'Executing Smart Contract…' : 'Execute & Record to Blockchain'}
            </button>
          </form>
        </div>

        {/* Informational Guidance Panel */}
        <div className="panel">
          <div className="panel-title">Chaincode Role Capabilities</div>
          <div style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ padding: 10, background: 'var(--panel-raised)', border: '1px solid var(--border)' }}>
              <div style={{ fontWeight: 700, color: 'var(--accent-steel)' }}>Ordnance Factory</div>
              <p className="muted" style={{ margin: '4px 0 0 0', fontSize: 12 }}>
                Registers new manufacturing lots on the blockchain and dispatches initial bulk consignments to designated military depots.
              </p>
            </div>

            <div style={{ padding: 10, background: 'var(--panel-raised)', border: '1px solid var(--border)' }}>
              <div style={{ fontWeight: 700, color: 'var(--accent-amber)' }}>Ammunition Depot</div>
              <p className="muted" style={{ margin: '4px 0 0 0', fontSize: 12 }}>
                Holds reserve inventory, approves auto-replenishment requisitions, performs lateral depot transfers, and issues lots to frontline field units.
              </p>
            </div>

            <div style={{ padding: 10, background: 'var(--panel-raised)', border: '1px solid var(--border)' }}>
              <div style={{ fontWeight: 700, color: 'var(--accent-olive)' }}>Field Unit</div>
              <p className="muted" style={{ margin: '4px 0 0 0', fontSize: 12 }}>
                Records combat / training consumption (which triggers automated replenishment if depot stock falls below threshold), lateral unit re-allocations, and DDIL store-and-forward events.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
