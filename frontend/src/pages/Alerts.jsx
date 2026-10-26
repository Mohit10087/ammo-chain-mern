import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';
import StatusBadge from '../components/StatusBadge';

export default function Alerts() {
  const [alerts, setAlerts] = useState([]);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('OPEN');
  const [busyId, setBusyId] = useState(null);

  async function load() {
    try {
      const { alerts } = await api.get(`/degradation/alerts${filter ? `?status=${filter}` : ''}`);
      setAlerts(alerts);
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
      await api.patch(`/degradation/alerts/${id}`, { status });
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
          <h1>Degradation Alerts</h1>
          <p>Auto-flagged when a lot's Arrhenius-style risk score crosses the configured threshold.</p>
        </div>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ background: 'var(--panel-raised)', border: '1px solid var(--border-strong)', color: 'var(--text)', padding: '6px 10px' }}>
          <option value="OPEN">Open</option>
          <option value="ACKNOWLEDGED">Acknowledged</option>
          <option value="RESOLVED">Resolved</option>
          <option value="">All</option>
        </select>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Lot</th>
              <th>Risk Score</th>
              <th>Temp / Humidity</th>
              <th>Days in Storage</th>
              <th>Reason</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {alerts.map((a) => (
              <tr key={a._id}>
                <td>
                  <Link to={`/lots/${a.lotID}`} className="mono">
                    {a.lotID}
                  </Link>
                </td>
                <td className="mono">{a.riskScore}</td>
                <td className="mono">
                  {a.temperatureC}&deg;C / {a.humidityPct}%
                </td>
                <td>{a.daysInStorage}</td>
                <td className="muted">{a.reason}</td>
                <td>
                  <StatusBadge value={a.status} />
                </td>
                <td>
                  {a.status !== 'RESOLVED' && (
                    <div style={{ display: 'flex', gap: 6 }}>
                      {a.status === 'OPEN' && (
                        <button className="btn btn-sm" disabled={busyId === a._id} onClick={() => updateStatus(a._id, 'ACKNOWLEDGED')}>
                          Acknowledge
                        </button>
                      )}
                      <button className="btn btn-sm btn-primary" disabled={busyId === a._id} onClick={() => updateStatus(a._id, 'RESOLVED')}>
                        Resolve
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {alerts.length === 0 && <div className="table-empty">No alerts in this view.</div>}
      </div>
    </div>
  );
}
