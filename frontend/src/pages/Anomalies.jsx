import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';
import StatusBadge from '../components/StatusBadge';

const RULE_LABELS = {
  DUPLICATE_ISSUE_WINDOW: 'Duplicate issue within window',
  TRANSFER_QUANTITY_SPIKE: 'Transfer quantity spike',
  UNIT_PATTERN_DEVIATION: 'Unit pattern deviation'
};

export default function Anomalies() {
  const [flags, setFlags] = useState([]);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('OPEN');
  const [busyId, setBusyId] = useState(null);

  async function load() {
    try {
      const { flags } = await api.get(`/anomalies${filter ? `?status=${filter}` : ''}`);
      setFlags(flags);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  async function updateStatus(id, status) {
    setBusyId(id);
    try {
      await api.patch(`/anomalies/${id}`, { status });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Anomaly Flags</h1>
          <p>Rule-based checks over the ledger - advisory only, nothing here ever blocks a transaction.</p>
        </div>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ background: 'var(--panel-raised)', border: '1px solid var(--border-strong)', color: 'var(--text)', padding: '6px 10px' }}>
          <option value="OPEN">Open</option>
          <option value="REVIEWED">Reviewed</option>
          <option value="DISMISSED">Dismissed</option>
          <option value="">All</option>
        </select>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Rule</th>
              <th>Severity</th>
              <th>Lot / Unit</th>
              <th>Details</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {flags.map((f) => (
              <tr key={f._id}>
                <td>{RULE_LABELS[f.rule] || f.rule}</td>
                <td>
                  <StatusBadge value={f.severity} />
                </td>
                <td className="mono">
                  {f.lotID ? <Link to={`/lots/${f.lotID}`}>{f.lotID}</Link> : f.unitId || '—'}
                </td>
                <td className="muted mono" style={{ fontSize: 11 }}>
                  {JSON.stringify(f.details)}
                </td>
                <td>
                  <StatusBadge value={f.status} />
                </td>
                <td>
                  {f.status === 'OPEN' && (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-sm" disabled={busyId === f._id} onClick={() => updateStatus(f._id, 'REVIEWED')}>
                        Mark Reviewed
                      </button>
                      <button className="btn btn-sm btn-danger" disabled={busyId === f._id} onClick={() => updateStatus(f._id, 'DISMISSED')}>
                        Dismiss
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {flags.length === 0 && <div className="table-empty">No anomaly flags in this view.</div>}
      </div>
    </div>
  );
}
