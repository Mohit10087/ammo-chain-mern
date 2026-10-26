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
              <th>#</th>
              <th>Timestamp</th>
              <th>Tx Type</th>
              <th>Lot</th>
              <th>Submitted By</th>
              <th>Hash</th>
            </tr>
          </thead>
          <tbody>
            {blocks.map((b) => (
              <tr key={b.hash}>
                <td className="mono">{b.index}</td>
                <td className="mono" style={{ fontSize: 11 }}>
                  {new Date(b.timestamp).toLocaleString()}
                </td>
                <td>{b.txType}</td>
                <td className="mono">{b.lotID ? <Link to={`/lots/${b.lotID}`}>{b.lotID}</Link> : '—'}</td>
                <td className="muted" style={{ fontSize: 12 }}>
                  {b.submittedByOrg}/{b.submittedByUser}
                </td>
                <td className="mono" style={{ fontSize: 11 }} title={b.hash}>
                  {b.hash.slice(0, 14)}&hellip;
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
