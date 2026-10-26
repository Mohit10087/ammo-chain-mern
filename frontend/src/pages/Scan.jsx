import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';

/**
 * Simulates the physical RFID/QR scan-in/scan-out flow described in the
 * brief: a real deployment would decode a tag/QR code off a camera or
 * handheld reader and feed the lotID straight into these same calls. Manual
 * entry here stands in for that hardware step (see README, "Out of scope").
 */
export default function Scan() {
  const { actor } = useAuth();
  const [lotID, setLotID] = useState('');
  const [action, setAction] = useState(actor.org === 'FieldUnit' ? 'CONSUME' : 'ISSUE_TO_UNIT');
  const [targetId, setTargetId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const actionsForOrg = {
    OrdnanceFactory: [{ value: 'ISSUE_TO_DEPOT', label: 'Issue to Depot' }],
    Depot: [
      { value: 'ISSUE_TO_UNIT', label: 'Issue to Field Unit' },
      { value: 'TRANSFER', label: 'Transfer to another Depot' }
    ],
    FieldUnit: [
      { value: 'CONSUME', label: 'Record Consumption' },
      { value: 'TRANSFER', label: 'Transfer to another Unit' },
      { value: 'DISPOSE', label: 'Dispose Lot' }
    ]
  };
  const options = actionsForOrg[actor.org] || [];

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setBusy(true);
    try {
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
      } else if (action === 'DISPOSE') {
        response = await api.post('/lots/dispose', { lotID, reason: 'disposed via scan' });
        setResult(`Lot ${lotID} marked disposed.`);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const needsTarget = ['ISSUE_TO_DEPOT', 'ISSUE_TO_UNIT', 'TRANSFER'].includes(action);
  const needsQuantity = action === 'CONSUME';

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Scan / Move</h1>
          <p>Simulates a handheld RFID/QR scan: enter (or scan) a lot ID and the movement is written straight to the ledger.</p>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {result && (
        <div className="success-banner">
          {result} <Link to={`/lots/${lotID}`}>View lot &rarr;</Link>
        </div>
      )}

      <div className="panel" style={{ maxWidth: 480 }}>
        <div className="panel-title">Scanner (manual entry simulation)</div>
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

          <button className="btn btn-primary" disabled={busy}>
            {busy ? 'Submitting…' : 'Submit Scan'}
          </button>
        </form>
      </div>
    </div>
  );
}
