import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';

export default function TopBar() {
  const { actor, logout } = useAuth();
  const navigate = useNavigate();
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await api.get('/dashboard/summary');
        if (!cancelled) setSummary(data);
      } catch {
        // silent - the KPI strip just stays blank if the API is unreachable
      }
    }
    load();
    const id = setInterval(load, 20000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  function handleLogout() {
    logout();
    navigate('/login');
  }

  const chainOk = summary?.chainIntegrity?.valid;

  return (
    <header className="topbar">
      <div className="topbar-kpis">
        <Kpi label="Lots" value={summary?.totalLots ?? '—'} />
        <Kpi label="Pending Req." value={summary?.pendingRequisitions ?? '—'} />
        <Kpi label="Open Alerts" value={summary?.openAlerts ?? '—'} />
        <Kpi label="Anomalies" value={summary?.openAnomalies ?? '—'} />
        <Kpi label="Chain Height" value={summary?.chainHeight ?? '—'} />
        <div className="kpi">
          <span
            className={`kpi-value`}
            style={{ color: summary ? (chainOk ? 'var(--accent-olive)' : 'var(--accent-rust)') : undefined }}
          >
            {summary ? (chainOk ? 'VERIFIED' : 'TAMPERED') : '—'}
          </span>
          <span className="kpi-label">Ledger Integrity</span>
        </div>
      </div>

      <div className="topbar-actor">
        <span>{actor?.username}</span>
        <button onClick={handleLogout}>Sign out</button>
      </div>
    </header>
  );
}

function Kpi({ label, value }) {
  return (
    <div className="kpi">
      <span className="kpi-value">{value}</span>
      <span className="kpi-label">{label}</span>
    </div>
  );
}
