export default function LedgerStrip({ blocks }) {
  if (!blocks || blocks.length === 0) {
    return <div className="table-empty">No ledger entries yet.</div>;
  }
  return (
    <div className="ledger-strip">
      {blocks.map((block, i) => (
        <div key={block.hash} style={{ display: 'flex', alignItems: 'center' }}>
          <div className="ledger-block" title={block.hash}>
            <span className="idx">#{block.index}</span>
            <span className="tx">{block.txType}</span>
            <span className="hash">{block.hash.slice(0, 10)}&hellip;</span>
          </div>
          {i < blocks.length - 1 && <div className="ledger-link" />}
        </div>
      ))}
    </div>
  );
}
