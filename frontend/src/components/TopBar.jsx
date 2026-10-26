import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { getQueueCount, syncOfflineQueue, getDeviceId } from '../utils/offlineQueue';

export default function TopBar() {
  const { actor, logout } = useAuth();
  const navigate = useNavigate();
  const [summary, setSummary] = useState(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [simulatedOffline, setSimulatedOffline] = useState(false);
  const [queueCount, setQueueCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState(null);

  const refreshQueueCount = useCallback(async () => {
    try {
      const count = await getQueueCount();
      setQueueCount(count);
    } catch {
      // ignore
    }
  }, []);

  const triggerSync = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await syncOfflineQueue(api);
      setSyncMsg(`Synced ${res.resolved}/${res.submitted} actions`);
      await refreshQueueCount();
      setTimeout(() => setSyncMsg(null), 4000);
    } catch (err) {
      setSyncMsg(`Sync error: ${err.message}`);
    } finally {
      setSyncing(false);
    }
  }, [syncing, refreshQueueCount]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await api.get('/dashboard/summary');
        if (!cancelled) setSummary(data);
      } catch {
        // silent
      }
    }
    load();
    refreshQueueCount();
    const id = setInterval(load, 20000);

    const handleOnline = () => {
      setIsOnline(true);
      // Auto-sync on network restoration
      triggerSync();
    };
    const handleOffline = () => setIsOnline(false);
    const handleQueueChange = () => refreshQueueCount();

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('ordnance_offline_queue_changed', handleQueueChange);

    return () => {
      cancelled = true;
      clearInterval(id);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('ordnance_offline_queue_changed', handleQueueChange);
    };
  }, [refreshQueueCount, triggerSync]);

  function handleLogout() {
    logout();
    navigate('/login');
  }

  const effectiveOnline = isOnline && !simulatedOffline;
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
            className="kpi-value"
            style={{ color: summary ? (chainOk ? 'var(--accent-olive, #4caf50)' : 'var(--accent-rust, #f44336)') : undefined }}
          >
            {summary ? (chainOk ? 'VERIFIED' : 'TAMPERED') : '—'}
          </span>
          <span className="kpi-label">Ledger Integrity</span>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {/* Tactical DDIL Status Pill */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: effectiveOnline ? 'rgba(76, 175, 80, 0.15)' : 'rgba(255, 152, 0, 0.2)',
            border: `1px solid ${effectiveOnline ? 'rgba(76, 175, 80, 0.4)' : 'rgba(255, 152, 0, 0.5)'}`,
            padding: '4px 10px',
            borderRadius: 4,
            fontSize: 11
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: effectiveOnline ? '#4caf50' : '#ff9800',
              display: 'inline-block'
            }}
          />
          <span className="mono" style={{ color: effectiveOnline ? '#81c784' : '#ffb74d', fontWeight: 600 }}>
            {effectiveOnline ? 'CONNECTED' : 'TACTICAL DDIL'}
          </span>
          {queueCount > 0 && (
            <span
              style={{
                background: '#ff9800',
                color: '#111',
                padding: '1px 5px',
                borderRadius: 3,
                fontWeight: 700,
                fontSize: 10
              }}
            >
              {queueCount} QUEUED
            </span>
          )}
        </div>

        {/* Sync Offline Queue Button */}
        {queueCount > 0 && (
          <button
            className="btn btn-primary btn-sm"
            onClick={triggerSync}
            disabled={syncing}
            style={{ fontSize: 11, padding: '4px 8px' }}
          >
            {syncing ? 'Syncing\u2026' : `Sync Queue (${queueCount})`}
          </button>
        )}

        {/* Tactical Disconnect Toggle for Demo / Viva */}
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => {
            const next = !simulatedOffline;
            setSimulatedOffline(next);
            localStorage.setItem('ordnance_simulated_ddil', next ? 'true' : 'false');
            window.dispatchEvent(new CustomEvent('ordnance_ddil_mode_changed', { detail: { offline: next } }));
          }}
          style={{ fontSize: 10, padding: '3px 7px' }}
          title="Simulate frontline tactical network severance"
        >
          {simulatedOffline ? 'Restore Tactical Link' : 'Simulate DDIL Cut'}
        </button>

        {syncMsg && (
          <span className="mono" style={{ fontSize: 10, color: 'var(--accent-amber, #ffb74d)' }}>
            {syncMsg}
          </span>
        )}

        <div className="topbar-actor">
          <span className="mono" style={{ fontSize: 11 }}>{actor?.username}</span>
          <button onClick={handleLogout} style={{ fontSize: 11 }}>Sign out</button>
        </div>
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
