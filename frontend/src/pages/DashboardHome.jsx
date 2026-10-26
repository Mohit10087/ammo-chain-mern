import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import StatusBadge from '../components/StatusBadge';

export default function DashboardHome() {
  const { actor } = useAuth();
  const [stock, setStock] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [anomalies, setAnomalies] = useState([]);
  const [requisitions, setRequisitions] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function load() {
      try {
        const [stockRes, alertsRes, anomaliesRes, reqRes] = await Promise.all([
          api.get('/dashboard/stock'),
          api.get('/degradation/alerts?status=OPEN'),
          api.get('/anomalies?status=OPEN'),
          api.get('/requisitions?status=PENDING_APPROVAL')
        ]);
        setStock(stockRes.stock);
        setAlerts(alertsRes.alerts.slice(0, 5));
        setAnomalies(anomaliesRes.flags.slice(0, 5));
        setRequisitions(reqRes.requisitions.slice(0, 5));
      } catch (err) {
        setError(err.message);
      }
    }
    load();
  }, []);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Command Overview</h1>
          <p>
            {actor?.org === 'Commander'
              ? 'Cross-organization rollup of all ammunition holdings and open flags.'
              : `Current holdings and pending actions for ${actor?.org}${actor?.depotId ? ` (${actor.depotId})` : ''}.`}
          </p>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="panel">
        <div className="panel-title">
          <span>Current Stock</span>
          <Link to="/lots">View lot registry &rarr;</Link>
        </div>
        <table>
          <thead>
            <tr>
              <th>Holder Org</th>
              <th>Holder ID</th>
              <th>Ammo Type</th>
              <th>Lots</th>
              <th>Total Rounds</th>
            </tr>
          </thead>
          <tbody>
            {stock.map((row) => (
              <tr key={`${row._id.org}-${row._id.holderId}-${row._id.ammoType}`}>
                <td>{row._id.org}</td>
                <td className="mono">{row._id.holderId}</td>
                <td>{row._id.ammoType}</td>
                <td>{row.lotCount}</td>
                <td className="mono">{row.totalQuantity.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {stock.length === 0 && <div className="table-empty">No active stock found.</div>}
      </div>

      <div className="grid-3">
        <MiniPanel title="Open Degradation Alerts" viewAllHref="/alerts">
          {alerts.map((a) => (
            <div key={a._id} style={{ marginBottom: 8 }}>
              <span className="mono">{a.lotID}</span> &middot; risk {a.riskScore}
            </div>
          ))}
          {alerts.length === 0 && <div className="muted">None open.</div>}
        </MiniPanel>

        <MiniPanel title="Open Anomaly Flags" viewAllHref="/anomalies">
          {anomalies.map((f) => (
            <div key={f._id} style={{ marginBottom: 8 }}>
              <StatusBadge value={f.severity} /> {f.rule.replaceAll('_', ' ')}
            </div>
          ))}
          {anomalies.length === 0 && <div className="muted">None open.</div>}
        </MiniPanel>

        <MiniPanel title="Pending Requisitions" viewAllHref="/requisitions">
          {requisitions.map((r) => (
            <div key={r._id} style={{ marginBottom: 8 }}>
              <span className="mono">{r.depotId}</span> &middot; {r.ammoType} &middot; +{r.requestedQuantity}
            </div>
          ))}
          {requisitions.length === 0 && <div className="muted">None pending.</div>}
        </MiniPanel>
      </div>
    </div>
  );
}

function MiniPanel({ title, viewAllHref, children }) {
  return (
    <div className="panel">
      <div className="panel-title">
        <span>{title}</span>
        <Link to={viewAllHref}>View all &rarr;</Link>
      </div>
      <div style={{ fontSize: 13 }}>{children}</div>
    </div>
  );
}
