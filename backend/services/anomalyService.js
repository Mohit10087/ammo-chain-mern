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
const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8000';

/**
 * Score transaction with Python ML microservice (Isolation Forest).
 * 800ms hard timeout with graceful silent fallback to rule-based engine.
 */
async function scoreWithML(data) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 800);
    const res = await fetch(`${ML_SERVICE_URL}/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.json();
  } catch (_err) {
    // Graceful degradation when ML microservice is offline or delayed
    return null;
  }
}

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
      severity: 'MEDIUM',
      source: 'rules'
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
      severity: 'HIGH',
      source: 'rules'
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
      severity: 'MEDIUM',
      source: 'rules'
    });
  }
  return null;
}

/**
 * Runs rule engine and queries the ML microservice for advisory anomaly scoring.
 * Never blocks ledger transactions; records AnomalyFlag documents with explainability.
 */
async function checkIssueAnomalies({ lot, toOrg, toId, action = 'ISSUE_LOT' }) {
  const flags = [];

  // 1. Run rule-based checks
  const dup = await checkDuplicateIssueWindow(lot.lotID);
  if (dup) flags.push(dup);

  const spike = await checkTransferQuantitySpike(lot.lotID, lot.ammoType, lot.quantity);
  if (spike) flags.push(spike);

  if (toOrg === 'FieldUnit') {
    const pattern = await checkUnitPatternDeviation(toId);
    if (pattern) flags.push(pattern);
  }

  // 2. Query contextual features from ledger for ML service
  try {
    const now = Date.now();
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);
    const oneHourAgo = new Date(now - 60 * 60 * 1000);

    const [lastBlock, eventsLastHour, eventsLastDay, recentTypeBlocks] = await Promise.all([
      Block.findOne({ lotID: lot.lotID }).sort({ timestamp: -1 }).lean(),
      Block.countDocuments({ lotID: lot.lotID, timestamp: { $gte: oneHourAgo } }),
      Block.countDocuments({ lotID: lot.lotID, timestamp: { $gte: oneDayAgo } }),
      Block.find({ txType: { $in: MOVEMENT_TX_TYPES } }).sort({ timestamp: -1 }).limit(10).lean()
    ]);

    let minutesSinceLastLotEvent = 9999.0;
    if (lastBlock && lastBlock.timestamp) {
      minutesSinceLastLotEvent = Math.max(0, (now - new Date(lastBlock.timestamp).getTime()) / (60 * 1000));
    }

    const recentIssuesSameType = recentTypeBlocks
      .map((b) => b.payload && typeof b.payload.quantity === 'number' ? b.payload.quantity : null)
      .filter((q) => q !== null);

    const mlPayload = {
      lotID: lot.lotID,
      ammoType: lot.ammoType,
      action,
      quantity: lot.quantity,
      timestamp: new Date().toISOString(),
      recentIssuesSameType,
      minutesSinceLastLotEvent,
      eventsLastHour,
      eventsLastDay
    };

    const mlResult = await scoreWithML(mlPayload);

    if (mlResult) {
      const reasonStr = mlResult.topFeatures && mlResult.topFeatures.length
        ? mlResult.topFeatures.map((f) => `${f.feature} (z=${f.zScore})`).join(', ')
        : 'Isolation Forest statistical anomaly';

      if (flags.length > 0) {
        // Rules fired: enrich flags with ML confirmation if available
        for (const f of flags) {
          f.source = mlResult.isAnomaly ? 'both' : 'rules';
          f.mlScore = mlResult.anomalyScore;
          f.topFeatures = mlResult.topFeatures;
          f.reason = reasonStr;
          await f.save();
        }
      } else if (mlResult.isAnomaly) {
        // Rules did NOT fire, but ML detected subtle anomaly (e.g. burst / off-hours)
        const mlFlag = await AnomalyFlag.create({
          rule: 'ML_ISOLATION_FOREST',
          lotID: lot.lotID,
          unitId: toOrg === 'FieldUnit' ? toId : null,
          details: {
            ammoType: lot.ammoType,
            quantity: lot.quantity,
            rawScore: mlResult.rawScore,
            contamination: mlResult.contamination,
            topFeatures: mlResult.topFeatures
          },
          severity: mlResult.anomalyScore >= 0.75 ? 'HIGH' : 'MEDIUM',
          source: 'ml',
          mlScore: mlResult.anomalyScore,
          topFeatures: mlResult.topFeatures,
          reason: `ML Isolation Forest advisory: ${reasonStr}`
        });
        flags.push(mlFlag);
      }
    }
  } catch (_e) {
    // Ledger transaction must never fail on ML scoring errors
  }

  return flags;
}

module.exports = {
  checkIssueAnomalies,
  checkDuplicateIssueWindow,
  checkTransferQuantitySpike,
  checkUnitPatternDeviation,
  scoreWithML
};
