const TONE_MAP = {
  // Lot statuses
  REGISTERED: 'steel',
  IN_TRANSIT: 'amber',
  IN_STORAGE: 'olive',
  ISSUED: 'steel',
  CONSUMED: 'neutral',
  DISPOSED: 'neutral',
  FLAGGED_FOR_INSPECTION: 'rust',
  // Requisition / alert statuses
  PENDING_APPROVAL: 'amber',
  APPROVED: 'olive',
  REJECTED: 'rust',
  OPEN: 'rust',
  ACKNOWLEDGED: 'amber',
  RESOLVED: 'olive',
  REVIEWED: 'amber',
  DISMISSED: 'neutral',
  // Severity
  LOW: 'olive',
  MEDIUM: 'amber',
  HIGH: 'rust'
};

export default function StatusBadge({ value }) {
  const tone = TONE_MAP[value] || 'neutral';
  return <span className={`badge badge-${tone}`}>{value}</span>;
}
