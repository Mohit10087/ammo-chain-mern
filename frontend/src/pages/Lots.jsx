import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import StatusBadge from '../components/StatusBadge';

const EMPTY_FORM = { lotID: '', ammoType: '', caliber: '', quantity: '', manufactureDate: '' };

export default function Lots() {
  const { actor } = useAuth();
  const [lots, setLots] = useState([]);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  async function loadLots() {
    try {
      const { lots } = await api.get('/lots');
      setLots(lots);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    loadLots();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleRegister(e) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      const payload = { ...form, quantity: Number(form.quantity) };
      const { lot } = await api.post('/lots/register', payload);
      setSuccess(`Lot ${lot.lotID} registered and written to the ledger.`);
      setForm(EMPTY_FORM);
      loadLots();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Lot Registry</h1>
          <p>Every ammunition lot and its current custody, sourced from the ledger's world-state projection.</p>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {success && <div className="success-banner">{success}</div>}

      {actor?.org === 'OrdnanceFactory' && (
        <div className="panel">
          <div className="panel-title">Register New Lot</div>
          <form onSubmit={handleRegister}>
            <div className="form-row">
              <div className="field">
                <label>Lot ID</label>
                <input
                  required
                  placeholder="LOT-556-101"
                  value={form.lotID}
                  onChange={(e) => setForm({ ...form, lotID: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Ammo Type</label>
                <input
                  required
                  placeholder="5.56x45mm"
                  value={form.ammoType}
                  onChange={(e) => setForm({ ...form, ammoType: e.target.value })}
                />
              </div>
            </div>
            <div className="form-row">
              <div className="field">
                <label>Caliber</label>
                <input
                  required
                  placeholder="5.56mm NATO"
                  value={form.caliber}
                  onChange={(e) => setForm({ ...form, caliber: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Quantity (rounds)</label>
                <input
                  required
                  type="number"
                  min="1"
                  value={form.quantity}
                  onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                />
              </div>
            </div>
            <div className="field" style={{ maxWidth: 240 }}>
              <label>Manufacture Date</label>
              <input
                required
                type="date"
                value={form.manufactureDate}
                onChange={(e) => setForm({ ...form, manufactureDate: e.target.value })}
              />
            </div>
            <button className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Registering…' : 'Register Lot'}
            </button>
          </form>
        </div>
      )}

      <div className="panel">
        <div className="panel-title">
          <span>Lots {actor?.org !== 'Commander' ? `held by ${actor?.org}` : '(all organizations)'}</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Lot ID</th>
              <th>Ammo Type</th>
              <th>Holder</th>
              <th>Qty Remaining</th>
              <th>Status</th>
              <th>Risk</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {lots.map((lot) => (
              <tr key={lot.lotID}>
                <td className="mono">{lot.lotID}</td>
                <td>{lot.ammoType}</td>
                <td>
                  {lot.currentHolderOrg} <span className="muted mono">{lot.currentHolderId}</span>
                </td>
                <td className="mono">{(lot.quantity - lot.quantityConsumed).toLocaleString()}</td>
                <td>
                  <StatusBadge value={lot.status} />
                </td>
                <td className="mono">{lot.lastRiskScore ?? 0}</td>
                <td>
                  <Link to={`/lots/${lot.lotID}`}>Open &rarr;</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {lots.length === 0 && <div className="table-empty">No lots found. Run the seed script for demo data.</div>}
      </div>
    </div>
  );
}
