import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';

export default function LedgerExplorer() {
  const [blocks, setBlocks] = useState([]);
  const [totalBlocks, setTotalBlocks] = useState(0);
  const [verification, setVerification] = useState(null);
  const [error, setError] = useState(null);
  const [verifying, setVerifying] = useState(false);

  async function load() {
    try {
      const { blocks, totalBlocks } = await api.get('/dashboard/ledger?limit=100');
      setBlocks(blocks);
      setTotalBlocks(totalBlocks);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function verify() {
    setVerifying(true);
    try {
      const result = await api.get('/dashboard/ledger/verify');
      setVerification(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Ledger Explorer</h1>
          <p>Every write in the system, oldest first, hash-linked to the block before it. {totalBlocks} blocks total.</p>
        </div>
        <button className="btn btn-primary" onClick={verify} disabled={verifying}>
          {verifying ? 'Verifying…' : 'Verify Chain Integrity'}
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {verification && (
        <div className={verification.valid ? 'success-banner' : 'error-banner'}>
          {verification.valid
            ? `Chain verified: all ${verification.totalBlocks} blocks hash-check clean.`
            : `Tamper detected at block #${verification.brokenAtIndex}: ${verification.reason}`}
        </div>
      )}

      <div className="panel">
        <table>
          <thead>
            <tr>
              <th style={{ width: 45 }}>#</th>
              <th>Timestamps</th>
              <th>Tx Type</th>
              <th>Lot ID</th>
              <th>Provenance / Device</th>
              <th>Payload Details</th>
              <th>Block Hash</th>
            </tr>
          </thead>
          <tbody>
            {blocks.map((b) => (
              <tr key={b.hash}>
                <td className="mono" style={{ fontWeight: 700 }}>#{b.index}</td>
                <td className="mono" style={{ fontSize: 11 }}>
                  <div>{new Date(b.timestamp).toLocaleString()}</div>
                  {b.capturedAt && (
                    <div style={{ marginTop: 2 }}>
                      <span
                        style={{
                          background: 'rgba(255, 152, 0, 0.2)',
                          color: '#ffb74d',
                          border: '1px solid rgba(255, 152, 0, 0.4)',
                          padding: '1px 5px',
                          borderRadius: 2,
                          fontSize: 10,
                          fontWeight: 700
                        }}
                      >
                        ⚡ Captured: {new Date(b.capturedAt).toLocaleTimeString()}
                      </span>
                    </div>
                  )}
                </td>
                <td style={{ fontWeight: 600 }}>
                  <span
                    style={{
                      display: 'inline-block',
                      padding: '2px 6px',
                      borderRadius: 2,
                      fontSize: 11,
                      fontFamily: 'var(--font-mono)',
                      background:
                        b.txType === 'CONFLICT_DETECTED'
                          ? 'rgba(193, 74, 58, 0.2)'
                          : b.txType === 'MERKLE_CHECKPOINT'
                          ? 'rgba(91, 139, 168, 0.2)'
                          : 'var(--panel-raised)',
                      border: '1px solid var(--border)'
                    }}
                  >
                    {b.txType}
                  </span>
                </td>
                <td className="mono">{b.lotID ? <Link to={`/lots/${b.lotID}`}>{b.lotID}</Link> : '—'}</td>
                <td className="muted" style={{ fontSize: 12 }}>
                  <div>{b.submittedByOrg}/{b.submittedByUser}</div>
                  {b.deviceId && (
                    <div className="mono" style={{ fontSize: 10, color: 'var(--accent-steel)' }}>
                      Dev: {b.deviceId}
                    </div>
                  )}
                </td>
                <td className="mono muted" style={{ fontSize: 10, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {JSON.stringify(b.payload)}
                </td>
                <td className="mono" style={{ fontSize: 11 }} title={b.hash}>
                  {b.hash.slice(0, 12)}&hellip;
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {blocks.length === 0 && <div className="table-empty">Ledger is empty.</div>}
      </div>
    </div>
  );
}
