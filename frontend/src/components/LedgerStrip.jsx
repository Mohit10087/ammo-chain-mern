export default function LedgerStrip({ blocks, selectedIndex, onSelectBlock }) {
  if (!blocks || blocks.length === 0) {
    return <div className="table-empty">No ledger entries yet.</div>;
  }
  return (
    <div className="ledger-strip" style={{ overflowX: 'auto', paddingBottom: 8 }}>
      {blocks.map((block, i) => {
        const isSelected = selectedIndex === block.index;
        return (
          <div key={block.hash || i} style={{ display: 'flex', alignItems: 'center' }}>
            <div
              className={`ledger-block${isSelected ? ' active' : ''}`}
              title={block.hash}
              onClick={() => onSelectBlock && onSelectBlock(block)}
              style={{
                cursor: onSelectBlock ? 'pointer' : 'default',
                borderColor: isSelected ? 'var(--accent-olive, #4caf50)' : undefined,
                boxShadow: isSelected ? '0 0 0 2px rgba(76, 175, 80, 0.4)' : undefined
              }}
            >
              <span className="idx">#{block.index}</span>
              <span className="tx">{block.txType}</span>
              <span className="hash">{block.hash ? `${block.hash.slice(0, 10)}\u2026` : 'pending'}</span>
              {onSelectBlock && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  style={{ marginTop: 6, fontSize: 10, padding: '3px 6px', width: '100%' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectBlock(block);
                  }}
                >
                  Verify block
                </button>
              )}
            </div>
            {i < blocks.length - 1 && <div className="ledger-link" />}
          </div>
        );
      })}
    </div>
  );
}
