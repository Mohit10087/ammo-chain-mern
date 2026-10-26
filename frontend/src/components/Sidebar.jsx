import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const NAV_ITEMS = [
  { to: '/', label: 'Overview', end: true },
  { to: '/lots', label: 'Lot Registry' },
  { to: '/scan', label: 'Scan / Move' },
  { to: '/requisitions', label: 'Requisitions' },
  { to: '/alerts', label: 'Degradation Alerts' },
  { to: '/anomalies', label: 'Anomaly Flags' },
  { to: '/forecast', label: 'Demand Forecast' },
  { to: '/ledger', label: 'Ledger Explorer' }
];

export default function Sidebar() {
  const { actor } = useAuth();

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">ORDNANCE-CHAIN</div>
        <div className="brand-sub">Ammunition Ledger System</div>
      </div>

      <div className="nav-section-label">Navigate</div>
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
        >
          {item.label}
        </NavLink>
      ))}

      <div className="spacer" />
      <div className="nav-section-label">Signed in as</div>
      <div style={{ padding: '0 20px 12px 20px' }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{actor?.displayName}</div>
        <div className="muted" style={{ fontSize: 11 }}>
          {actor?.org}
          {actor?.depotId ? ` \u00B7 ${actor.depotId}` : ''}
        </div>
      </div>
    </aside>
  );
}
