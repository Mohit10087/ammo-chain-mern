import { useEffect, useState } from 'react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import StatusBadge from '../components/StatusBadge';

export default function Requisitions() {
  const { actor } = useAuth();
  const [requisitions, setRequisitions] = useState([]);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  async function load() {
    try {
      const { requisitions } = await api.get('/requisitions');
      setRequisitions(requisitions);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function decide(requisitionID, approve) {
    setBusyId(requisitionID);
    setError(null);
    try {
      await api.post(`/requisitions/${requisitionID}/decision`, { approve });
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
          <h1>Requisitions</h1>
          <p>Auto-generated whenever a depot's stock for an ammo type falls below its replenishment threshold.</p>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Requisition</th>
              <th>Depot</th>
              <th>Ammo Type</th>
              <th>Stock / Threshold</th>
              <th>Requested Qty</th>
              <th>Status</th>
              {actor.org === 'Depot' && <th></th>}
            </tr>
          </thead>
          <tbody>
            {requisitions.map((r) => (
              <tr key={r._id}>
                <td className="mono">{r.requisitionID}</td>
                <td className="mono">{r.depotId}</td>
                <td>{r.ammoType}</td>
                <td className="mono">
                  {r.currentStock} / {r.threshold}
                </td>
                <td className="mono">+{r.requestedQuantity}</td>
                <td>
                  <StatusBadge value={r.status} />
                </td>
                {actor.org === 'Depot' && (
                  <td>
                    {r.status === 'PENDING_APPROVAL' && r.depotId === actor.depotId ? (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="btn btn-sm btn-primary" disabled={busyId === r.requisitionID} onClick={() => decide(r.requisitionID, true)}>
                          Approve
                        </button>
                        <button className="btn btn-sm btn-danger" disabled={busyId === r.requisitionID} onClick={() => decide(r.requisitionID, false)}>
                          Reject
                        </button>
                      </div>
                    ) : (
                      <span className="muted">&mdash;</span>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {requisitions.length === 0 && <div className="table-empty">No requisitions yet.</div>}
      </div>
    </div>
  );
}
