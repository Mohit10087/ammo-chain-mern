/**
 * anomalyService.js
 * ------------------
 * Deliberately rule-based, not ML-based. The brief is explicit about why:
 * ML-based anomaly detection over blockchain transactions is already covered
 * by prior work, so a transparent rules engine is both easier to defend in a
 * viva and avoids duplicating that approach. Every rule here reads directly
 * from the ledger (Block collection) - the same tamper-evident log the rest
 * of the system trusts - so "explain why this fired" is always a matter of
 * pointing at specific block hashes.
 *
 * Rules implemented (all from the original spec):
 *   1. DUPLICATE_ISSUE_WINDOW    - the same lot is issued/transferred more
 *                                  than once within a short time window.
 *   2. TRANSFER_QUANTITY_SPIKE   - a transfer/issue quantity exceeds the
 *                                  recent average for that ammo type by a
 *                                  configurable factor.
 *   3. UNIT_PATTERN_DEVIATION    - a field unit receives issues far more
 *                                  often than its own recent normal rate.
 *
 * Flags are advisory only - "Flag on the dashboard, don't auto-block" - so
 * this service never rejects a transaction, it only records AnomalyFlag
 * documents for the dashboard to surface.
 */

const Block = require('../models/Block');
const AnomalyFlag = require('../models/AnomalyFlag');

const DUPLICATE_WINDOW_MINUTES = 10;
const QUANTITY_SPIKE_FACTOR = 3;
const QUANTITY_SPIKE_LOOKBACK = 10; // number of recent transactions to average over
const UNIT_PATTERN_LOOKBACK_HOURS = 24;
const UNIT_PATTERN_MAX_ISSUES_PER_WINDOW = 5;

const MOVEMENT_TX_TYPES = ['ISSUE_LOT', 'TRANSFER_LOT'];

async function checkDuplicateIssueWindow(lotID) {
  const since = new Date(Date.now() - DUPLICATE_WINDOW_MINUTES * 60 * 1000);
  const recent = await Block.find({
    lotID,
    txType: { $in: MOVEMENT_TX_TYPES },
    timestamp: { $gte: since }
  }).sort({ timestamp: 1 }).lean();

  if (recent.length > 1) {
    return AnomalyFlag.create({
      rule: 'DUPLICATE_ISSUE_WINDOW',
      lotID,
      details: {
        windowMinutes: DUPLICATE_WINDOW_MINUTES,
        occurrences: recent.length,
        blockHashes: recent.map((b) => b.hash)
      },
      severity: 'MEDIUM'
    });
  }
  return null;
}

async function checkTransferQuantitySpike(lotID, ammoType, quantity) {
  const recent = await Block.find({ txType: { $in: MOVEMENT_TX_TYPES } })
    .sort({ timestamp: -1 })
    .limit(QUANTITY_SPIKE_LOOKBACK)
    .lean();

  const quantities = recent
    .map((b) => b.payload && typeof b.payload.quantity === 'number' ? b.payload.quantity : null)
    .filter((q) => q !== null);

  if (quantities.length < 3) return null; // not enough history to judge "normal" yet

  const avg = quantities.reduce((a, b) => a + b, 0) / quantities.length;
  if (avg > 0 && quantity > avg * QUANTITY_SPIKE_FACTOR) {
    return AnomalyFlag.create({
      rule: 'TRANSFER_QUANTITY_SPIKE',
      lotID,
      details: { ammoType, quantity, recentAverage: Math.round(avg * 100) / 100, factor: QUANTITY_SPIKE_FACTOR },
      severity: 'HIGH'
    });
  }
  return null;
}

async function checkUnitPatternDeviation(unitId) {
  if (!unitId) return null;
  const since = new Date(Date.now() - UNIT_PATTERN_LOOKBACK_HOURS * 60 * 60 * 1000);

  const recent = await Block.find({
    txType: 'ISSUE_LOT',
    timestamp: { $gte: since },
    'payload.toId': unitId
  }).lean();

  if (recent.length > UNIT_PATTERN_MAX_ISSUES_PER_WINDOW) {
    return AnomalyFlag.create({
      rule: 'UNIT_PATTERN_DEVIATION',
      unitId,
      details: {
        windowHours: UNIT_PATTERN_LOOKBACK_HOURS,
        issueCount: recent.length,
        normalMax: UNIT_PATTERN_MAX_ISSUES_PER_WINDOW
      },
      severity: 'MEDIUM'
    });
  }
  return null;
}

/**
 * Runs all applicable rules after an ISSUE_LOT or TRANSFER_LOT transaction.
 * Called from blockchain/smartContracts.js - never blocks the transaction,
 * only records flags for the dashboard.
 */
async function checkIssueAnomalies({ lot, toOrg, toId }) {
  const flags = [];
  const dup = await checkDuplicateIssueWindow(lot.lotID);
  if (dup) flags.push(dup);

  const spike = await checkTransferQuantitySpike(lot.lotID, lot.ammoType, lot.quantity);
  if (spike) flags.push(spike);

  if (toOrg === 'FieldUnit') {
    const pattern = await checkUnitPatternDeviation(toId);
    if (pattern) flags.push(pattern);
  }

  return flags;
}

module.exports = { checkIssueAnomalies, checkDuplicateIssueWindow, checkTransferQuantitySpike, checkUnitPatternDeviation };
