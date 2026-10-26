import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const NAV_CONFIG = {
  Commander: [
    { to: '/', label: 'Global Overview', end: true },
    { to: '/lots', label: 'All Lots Registry' },
    { to: '/anomalies', label: 'Anomaly Console (ML)' },
    { to: '/alerts', label: 'Degradation Alerts' },
    { to: '/forecast', label: 'Demand Forecast' },
    { to: '/requisitions', label: 'Requisitions Overview' },
    { to: '/ledger', label: 'Ledger Explorer' }
  ],
  OrdnanceFactory: [
    { to: '/', label: 'Factory Overview', end: true },
    { to: '/lots', label: 'Lot Production Registry' },
    { to: '/scan', label: 'Dispatch to Depot' },
    { to: '/ledger', label: 'Ledger Explorer' }
  ],
  Depot: [
    { to: '/', label: 'Depot Overview', end: true },
    { to: '/lots', label: 'Depot Inventory' },
    { to: '/scan', label: 'Issue & Transfer' },
    { to: '/offline-console', label: 'Tactical DDIL Queue' },
    { to: '/requisitions', label: 'Requisitions' },
    { to: '/alerts', label: 'Degradation Alerts' },
    { to: '/forecast', label: 'Demand Forecast' },
    { to: '/ledger', label: 'Ledger Explorer' }
  ],
  FieldUnit: [
    { to: '/', label: 'Unit Overview', end: true },
    { to: '/lots', label: 'Unit Ammunition' },
    { to: '/offline-console', label: '⚡ Tactical DDIL Console' },
    { to: '/scan', label: 'Consume & Transfer' },
    { to: '/requisitions', label: 'Requisitions Status' },
    { to: '/alerts', label: 'Degradation Alerts' },
    { to: '/ledger', label: 'Ledger Explorer' }
  ]
};

export default function Sidebar() {
  const { actor } = useAuth();
  const navItems = (actor?.org && NAV_CONFIG[actor.org]) || [
    { to: '/', label: 'Overview', end: true },
    { to: '/lots', label: 'Lot Registry' },
    { to: '/ledger', label: 'Ledger Explorer' }
  ];

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">ORDNANCE-CHAIN</div>
        <div className="brand-sub">Ammunition Ledger System</div>
      </div>

      <div className="nav-section-label">
        {actor?.org ? `${actor.org} Workspace` : 'Navigate'}
      </div>
      {navItems.map((item) => (
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
