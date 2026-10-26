/**
 * smartContracts.js
 * -----------------
 * This module is the direct MERN-stack port of what the original design
 * called "chaincode": registerLot, issueLot, transferLot, recordConsumption,
 * disposeLot, checkStockLevel, updateStorageCondition, flagForInspection.
 *
 * Every exported function here:
 *   1. Validates the business rule (not just the caller's role - that is
 *      enforced earlier by middleware/auth.js, mirroring Fabric's ABAC on
 *      chaincode functions).
 *   2. Writes the authoritative record to the hash-chained ledger
 *      (blockchain/Ledger.js).
 *   3. Projects the resulting state into the read-optimized collections
 *      (Lot, Requisition, InspectionAlert, ...) - the MERN analogue of
 *      Fabric's CouchDB world state.
 *
 * Routes (see routes/*.js) are thin: they authenticate, authorize, and
 * delegate to these functions. Nothing here should ever be called directly
 * from a route without going through the auth middleware first.
 */

const Lot = require('../models/Lot');
const Requisition = require('../models/Requisition');
const InspectionAlert = require('../models/InspectionAlert');
const SensorReading = require('../models/SensorReading');
const Ledger = require('./Ledger');
const degradationService = require('../services/degradationService');
const anomalyService = require('../services/anomalyService');
const merkleService = require('../services/merkleService');

class ContractError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

const REPLENISH_THRESHOLD = Number(process.env.DEFAULT_REPLENISH_THRESHOLD || 500);

/**
 * Depot and FieldUnit orgs both have multiple independent instances
 * (DEPOT-01 vs DEPOT-02, UNIT-ALPHA vs UNIT-BRAVO, ...). Checking
 * `currentHolderOrg === actor.org` alone would let, say, DEPOT-02's officer
 * act on a lot actually held by DEPOT-01. This helper enforces the specific
 * holder identity (actor.depotId doubles as "unit id" for FieldUnit users -
 * see models/User.js), which is the real-world equivalent of Fabric ABAC
 * keying on a caller's specific org+affiliate attribute, not just org.
 * OrdnanceFactory is a singleton org in this design, so it is exempt.
 */
function assertHolder(lot, actor) {
  if (actor.org === 'System') return; // background sensor simulator
  if (actor.org === 'OrdnanceFactory') {
    if (lot.currentHolderOrg !== 'OrdnanceFactory') {
      throw new ContractError(`Lot ${lot.lotID} is not currently held by OrdnanceFactory`, 409);
    }
    return;
  }
  if (lot.currentHolderOrg !== actor.org) {
    throw new ContractError(`Lot ${lot.lotID} is not currently held by ${actor.org}`, 409);
  }
  if (lot.currentHolderId !== actor.depotId) {
    throw new ContractError(`Lot ${lot.lotID} is held by a different ${actor.org} (${lot.currentHolderId}), not yours`, 403);
  }
}

/* ------------------------------------------------------------------ *
 * 1. registerLot - Ordnance Factory only
 * ------------------------------------------------------------------ */
async function registerLot(actor, { lotID, ammoType, caliber, quantity, manufactureDate }) {
  if (!lotID || !ammoType || !caliber || !quantity || !manufactureDate) {
    throw new ContractError('lotID, ammoType, caliber, quantity and manufactureDate are all required');
  }
  const existing = await Lot.findOne({ lotID });
  if (existing) throw new ContractError(`Lot ${lotID} is already registered`, 409);

  const lot = await Lot.create({
    lotID,
    ammoType,
    caliber,
    quantity,
    manufactureDate,
    currentHolderOrg: 'OrdnanceFactory',
    currentHolderId: actor.org === 'OrdnanceFactory' ? 'ORDNANCE-FACTORY' : actor.org,
    status: 'REGISTERED'
  });

  const block = await Ledger.addBlock({
    txType: 'REGISTER_LOT',
    lotID,
    payload: { ammoType, caliber, quantity, manufactureDate },
    submittedByOrg: actor.org,
    submittedByUser: actor.username
  });

  lot.lastBlockHash = block.hash;
  await lot.save();
  await merkleService.maybeAutoCheckpoint(actor, lot.lotID);
  return lot;
}

/* ------------------------------------------------------------------ *
 * 2. issueLot - OrdnanceFactory -> Depot, or Depot -> FieldUnit
 * ------------------------------------------------------------------ */
async function issueLot(actor, { lotID, toOrg, toId }) {
  const lot = await Lot.findOne({ lotID });
  if (!lot) throw new ContractError(`Lot ${lotID} not found`, 404);

  const validMoves = {
    OrdnanceFactory: 'Depot',
    Depot: 'FieldUnit'
  };
  const expectedTarget = validMoves[actor.org];
  if (!expectedTarget) throw new ContractError(`${actor.org} is not permitted to issue lots`, 403);
  assertHolder(lot, actor);
  if (toOrg !== expectedTarget) {
    throw new ContractError(`${actor.org} may only issue lots to ${expectedTarget}`, 400);
  }
  if (!toId) throw new ContractError('toId (destination depot/unit id) is required');

  const fromOrg = lot.currentHolderOrg;
  const fromId = lot.currentHolderId;

  lot.currentHolderOrg = toOrg;
  lot.currentHolderId = toId;
  lot.status = toOrg === 'FieldUnit' ? 'ISSUED' : 'IN_STORAGE';
  if (toOrg === 'Depot') lot.sourceDepotId = toId;
  await lot.save();

  const block = await Ledger.addBlock({
    txType: 'ISSUE_LOT',
    lotID,
    payload: { fromOrg, fromId, toOrg, toId, quantity: lot.quantity },
    submittedByOrg: actor.org,
    submittedByUser: actor.username
  });
  lot.lastBlockHash = block.hash;
  await lot.save();
  await merkleService.maybeAutoCheckpoint(actor, lot.lotID);

  await anomalyService.checkIssueAnomalies({ lot, fromOrg, fromId, toOrg, toId });

  return lot;
}

/* ------------------------------------------------------------------ *
 * 3. transferLot - lateral transfer (Depot<->Depot or FieldUnit<->FieldUnit)
 * ------------------------------------------------------------------ */
async function transferLot(actor, { lotID, toId }) {
  const lot = await Lot.findOne({ lotID });
  if (!lot) throw new ContractError(`Lot ${lotID} not found`, 404);

  if (!['Depot', 'FieldUnit'].includes(actor.org)) {
    throw new ContractError(`${actor.org} is not permitted to transfer lots`, 403);
  }
  assertHolder(lot, actor);
  if (!toId) throw new ContractError('toId is required');

  const trimmedToId = toId.trim();
  const fromId = lot.currentHolderId;

  if (trimmedToId === fromId) {
    throw new ContractError(`Cannot transfer lot to the same entity (${trimmedToId})`, 400);
  }

  if (actor.org === 'Depot') {
    if (trimmedToId.startsWith('UNIT-')) {
      throw new ContractError('To dispatch ammunition to a field unit, use Issue Lot.', 400);
    }
    lot.currentHolderOrg = 'Depot';
    lot.currentHolderId = trimmedToId;
    lot.sourceDepotId = trimmedToId;
  } else if (actor.org === 'FieldUnit') {
    if (trimmedToId.startsWith('DEPOT-')) {
      throw new ContractError('Lateral transfer is only permitted to peer Field Units (e.g. UNIT-BRAVO). To return ammunition to a rear depot, use Return to Depot.', 400);
    }
    lot.currentHolderOrg = 'FieldUnit';
    lot.currentHolderId = trimmedToId;
  }

  await lot.save();

  const block = await Ledger.addBlock({
    txType: 'TRANSFER_LOT',
    lotID,
    payload: { org: actor.org, fromId, toId: trimmedToId, quantity: lot.quantity - lot.quantityConsumed },
    submittedByOrg: actor.org,
    submittedByUser: actor.username
  });
  lot.lastBlockHash = block.hash;
  await lot.save();
  await merkleService.maybeAutoCheckpoint(actor, lot.lotID);

  await anomalyService.checkIssueAnomalies({ lot, fromOrg: actor.org, fromId, toOrg: actor.org, toId: trimmedToId });

  return lot;
}

/* ------------------------------------------------------------------ *
 * 3b. returnToDepot - FieldUnit -> Depot (Back-loading / Surplus return)
 * ------------------------------------------------------------------ */
async function returnToDepot(actor, { lotID, toDepotId, reason = 'Surplus / Return to Rear Depot' }) {
  const lot = await Lot.findOne({ lotID });
  if (!lot) throw new ContractError(`Lot ${lotID} not found`, 404);

  if (actor.org !== 'FieldUnit') {
    throw new ContractError(`Only FieldUnit may return ammunition lots to a Depot`, 403);
  }
  assertHolder(lot, actor);

  if (!toDepotId) throw new ContractError('toDepotId (destination depot ID) is required', 400);
  const trimmedDepotId = toDepotId.trim();
  const validDepots = ['DEPOT-01', 'DEPOT-02'];
  if (!validDepots.includes(trimmedDepotId)) {
    throw new ContractError(`Invalid target depot '${trimmedDepotId}'. Must be one of: ${validDepots.join(', ')}`, 400);
  }

  const fromOrg = lot.currentHolderOrg;
  const fromId = lot.currentHolderId;

  lot.currentHolderOrg = 'Depot';
  lot.currentHolderId = trimmedDepotId;
  lot.sourceDepotId = trimmedDepotId;
  lot.status = 'IN_STORAGE';
  await lot.save();

  const block = await Ledger.addBlock({
    txType: 'RETURN_TO_DEPOT',
    lotID,
    payload: {
      fromOrg,
      fromId,
      toOrg: 'Depot',
      toId: trimmedDepotId,
      quantity: lot.quantity - lot.quantityConsumed,
      reason
    },
    submittedByOrg: actor.org,
    submittedByUser: actor.username
  });

  lot.lastBlockHash = block.hash;
  await lot.save();
  await merkleService.maybeAutoCheckpoint(actor, lot.lotID);

  return lot;
}


/* ------------------------------------------------------------------ *
 * 4. recordConsumption - Field Unit only
 * ------------------------------------------------------------------ */
async function recordConsumption(actor, { lotID, quantity }) {
  const lot = await Lot.findOne({ lotID });
  if (!lot) throw new ContractError(`Lot ${lotID} not found`, 404);
  if (actor.org !== 'FieldUnit') throw new ContractError('Only FieldUnit may record consumption', 403);
  assertHolder(lot, actor);
  const remaining = lot.quantity - lot.quantityConsumed;
  if (!quantity || quantity <= 0) throw new ContractError('quantity must be a positive number');
  if (quantity > remaining) throw new ContractError(`Only ${remaining} rounds remain in lot ${lotID}`, 409);

  lot.quantityConsumed += quantity;
  if (lot.quantityConsumed >= lot.quantity) lot.status = 'CONSUMED';
  await lot.save();

  const block = await Ledger.addBlock({
    txType: 'RECORD_CONSUMPTION',
    lotID,
    payload: { quantity, remainingAfter: lot.quantity - lot.quantityConsumed, unitId: lot.currentHolderId },
    submittedByOrg: actor.org,
    submittedByUser: actor.username
  });
  lot.lastBlockHash = block.hash;
  await lot.save();
  await merkleService.maybeAutoCheckpoint(actor, lot.lotID);

  // Auto-replenishment check runs against the depot that supplied this lot.
  const depotToCheck = lot.sourceDepotId;
  let requisition = null;
  if (depotToCheck) {
    requisition = await checkStockLevel({ depotId: depotToCheck, ammoType: lot.ammoType, triggeredByLotID: lotID });
  }

  return { lot, requisition };
}

/* ------------------------------------------------------------------ *
 * 5. disposeLot - Depot or FieldUnit
 * ------------------------------------------------------------------ */
async function disposeLot(actor, { lotID, reason }) {
  const lot = await Lot.findOne({ lotID });
  if (!lot) throw new ContractError(`Lot ${lotID} not found`, 404);
  if (!['Depot', 'FieldUnit'].includes(actor.org)) {
    throw new ContractError(`${actor.org} is not permitted to dispose lots`, 403);
  }
  assertHolder(lot, actor);

  lot.status = 'DISPOSED';
  lot.currentHolderOrg = 'Disposed';
  await lot.save();

  const block = await Ledger.addBlock({
    txType: 'DISPOSE_LOT',
    lotID,
    payload: { reason: reason || 'unspecified', quantityAtDisposal: lot.quantity - lot.quantityConsumed },
    submittedByOrg: actor.org,
    submittedByUser: actor.username
  });
  lot.lastBlockHash = block.hash;
  await lot.save();
  await merkleService.maybeAutoCheckpoint(actor, lot.lotID);
  return lot;
}

/* ------------------------------------------------------------------ *
 * 6. checkStockLevel - runs automatically after consumption
 * ------------------------------------------------------------------ */
async function checkStockLevel({ depotId, ammoType, triggeredByLotID }) {
  const depotLots = await Lot.find({
    currentHolderOrg: 'Depot',
    currentHolderId: depotId,
    ammoType,
    status: { $in: ['IN_STORAGE'] }
  });
  const currentStock = depotLots.reduce((sum, l) => sum + (l.quantity - l.quantityConsumed), 0);

  if (currentStock >= REPLENISH_THRESHOLD) return null;

  const alreadyPending = await Requisition.findOne({ depotId, ammoType, status: 'PENDING_APPROVAL' });
  if (alreadyPending) return alreadyPending;

  const requestedQuantity = REPLENISH_THRESHOLD * 2 - currentStock;
  const requisitionID = `REQ-${depotId}-${ammoType.replace(/[^a-zA-Z0-9]/g, '')}-${Date.now()}`;

  const requisition = await Requisition.create({
    requisitionID,
    depotId,
    ammoType,
    currentStock,
    threshold: REPLENISH_THRESHOLD,
    requestedQuantity,
    triggeredByLotID: triggeredByLotID || null
  });

  await Ledger.addBlock({
    txType: 'CREATE_REQUISITION',
    lotID: triggeredByLotID || null,
    payload: { requisitionID, depotId, ammoType, currentStock, threshold: REPLENISH_THRESHOLD, requestedQuantity },
    submittedByOrg: 'System',
    submittedByUser: 'auto-replenishment'
  });

  return requisition;
}

async function approveRequisition(actor, { requisitionID, approve }) {
  if (actor.org !== 'Depot') throw new ContractError('Only Depot Officers may approve requisitions', 403);
  const requisition = await Requisition.findOne({ requisitionID });
  if (!requisition) throw new ContractError(`Requisition ${requisitionID} not found`, 404);
  if (requisition.status !== 'PENDING_APPROVAL') throw new ContractError('Requisition already decided', 409);

  requisition.status = approve ? 'APPROVED' : 'REJECTED';
  requisition.approvedBy = actor.username;
  requisition.approvedAt = new Date();
  await requisition.save();

  await Ledger.addBlock({
    txType: 'APPROVE_REQUISITION',
    lotID: requisition.triggeredByLotID,
    payload: { requisitionID, decision: requisition.status },
    submittedByOrg: actor.org,
    submittedByUser: actor.username
  });

  return requisition;
}

/* ------------------------------------------------------------------ *
 * 7. updateStorageCondition + flagForInspection
 * ------------------------------------------------------------------ */
async function updateStorageCondition(actor, { lotID, temperatureC, humidityPct }) {
  const lot = await Lot.findOne({ lotID });
  if (!lot) throw new ContractError(`Lot ${lotID} not found`, 404);
  if (typeof temperatureC !== 'number' || typeof humidityPct !== 'number') {
    throw new ContractError('temperatureC and humidityPct must be numbers');
  }
  if (['Depot', 'FieldUnit'].includes(actor.org)) assertHolder(lot, actor);

  await SensorReading.create({ lotID, temperatureC, humidityPct });

  const daysInStorage = Math.max(0, Math.round((Date.now() - new Date(lot.manufactureDate).getTime()) / 86400000));
  const { riskScore } = await degradationService.computeRiskScore({ lotID, temperatureC, humidityPct, daysInStorage });

  lot.lastRiskScore = riskScore;
  lot.lastConditionCheck = new Date();
  await lot.save();

  const alertThreshold = Number(process.env.DEGRADATION_RISK_ALERT_THRESHOLD || 70);
  const isHighRisk = riskScore >= alertThreshold;
  const isManualOfficerAction = actor.org !== 'System';

  // Only commit to immutable blockchain ledger if manually logged by an officer or triggering high risk
  if (isManualOfficerAction || isHighRisk) {
    const block = await Ledger.addBlock({
      txType: 'UPDATE_STORAGE_CONDITION',
      lotID,
      payload: { temperatureC, humidityPct, daysInStorage, riskScore },
      submittedByOrg: actor.org,
      submittedByUser: actor.username
    });
    lot.lastBlockHash = block.hash;
    await lot.save();
    await merkleService.maybeAutoCheckpoint(actor, lot.lotID);
  }

  let alert = null;
  if (isHighRisk && lot.status !== 'DISPOSED' && lot.status !== 'CONSUMED') {
    alert = await flagForInspection({
      lotID,
      riskScore,
      temperatureC,
      humidityPct,
      daysInStorage,
      reason: `Risk score ${riskScore} crossed alert threshold ${alertThreshold}`
    });
  }

  return { lot, riskScore, alert };
}

async function flagForInspection({ lotID, riskScore, temperatureC, humidityPct, daysInStorage, reason }) {
  const lot = await Lot.findOne({ lotID });
  if (lot && lot.status !== 'DISPOSED' && lot.status !== 'CONSUMED') {
    lot.status = 'FLAGGED_FOR_INSPECTION';
    await lot.save();
  }

  const alert = await InspectionAlert.create({
    lotID,
    riskScore,
    temperatureC,
    humidityPct,
    daysInStorage,
    reason
  });

  const block = await Ledger.addBlock({
    txType: 'FLAG_FOR_INSPECTION',
    lotID,
    payload: { riskScore, temperatureC, humidityPct, daysInStorage, reason },
    submittedByOrg: 'System',
    submittedByUser: 'degradation-monitor'
  });

  if (lot) {
    lot.lastBlockHash = block.hash;
    await lot.save();
    await merkleService.maybeAutoCheckpoint({ org: 'System', username: 'degradation-monitor' }, lotID);
  }

  return alert;
}

module.exports = {
  ContractError,
  registerLot,
  issueLot,
  transferLot,
  returnToDepot,
  recordConsumption,
  disposeLot,
  checkStockLevel,
  approveRequisition,
  updateStorageCondition,
  flagForInspection,
  checkpointLotMerkle: (actor, lotID) => merkleService.createCheckpoint(actor, lotID)
};
