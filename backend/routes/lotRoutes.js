const express = require('express');
const Lot = require('../models/Lot');
const Ledger = require('../blockchain/Ledger');
const smartContracts = require('../blockchain/smartContracts');
const qrService = require('../services/qrService');
const { authenticate, requireOrg } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

// GET /api/lots - list, with optional filters (any authenticated role can read)
router.get('/', async (req, res, next) => {
  try {
    const { org, holderId, status, ammoType } = req.query;
    const filter = {};
    if (org) filter.currentHolderOrg = org;
    if (holderId) filter.currentHolderId = holderId;
    if (status) filter.status = status;
    if (ammoType) filter.ammoType = ammoType;

    // Non-Commander users only see lots relevant to their own org by default,
    // unless they explicitly query another org's public stock view.
    if (req.actor.org !== 'Commander' && !org) {
      filter.currentHolderOrg = req.actor.org;
    }

    const lots = await Lot.find(filter).sort({ updatedAt: -1 }).limit(500);
    res.json({ lots });
  } catch (err) {
    next(err);
  }
});

// GET /api/lots/:lotID
router.get('/:lotID', async (req, res, next) => {
  try {
    const lot = await Lot.findOne({ lotID: req.params.lotID });
    if (!lot) return res.status(404).json({ error: 'Lot not found' });
    res.json({ lot });
  } catch (err) {
    next(err);
  }
});

// GET /api/lots/:lotID/history - full ledger history for one lot
router.get('/:lotID/history', async (req, res, next) => {
  try {
    const history = await Ledger.getHistory(req.params.lotID);
    res.json({ lotID: req.params.lotID, history });
  } catch (err) {
    next(err);
  }
});

// GET /api/lots/:lotID/qrcode
router.get('/:lotID/qrcode', async (req, res, next) => {
  try {
    const dataUrl = await qrService.generateLotQRCode(req.params.lotID);
    res.json({ lotID: req.params.lotID, qrCode: dataUrl });
  } catch (err) {
    next(err);
  }
});

// POST /api/lots/register - Ordnance Factory only
router.post('/register', requireOrg('OrdnanceFactory'), async (req, res, next) => {
  try {
    const lot = await smartContracts.registerLot(req.actor, req.body);
    res.status(201).json({ lot });
  } catch (err) {
    next(err);
  }
});

// POST /api/lots/issue - OrdnanceFactory->Depot or Depot->FieldUnit
router.post('/issue', requireOrg('OrdnanceFactory', 'Depot'), async (req, res, next) => {
  try {
    const lot = await smartContracts.issueLot(req.actor, req.body);
    res.json({ lot });
  } catch (err) {
    next(err);
  }
});

// POST /api/lots/transfer - lateral transfer within Depot or FieldUnit org
router.post('/transfer', requireOrg('Depot', 'FieldUnit'), async (req, res, next) => {
  try {
    const lot = await smartContracts.transferLot(req.actor, req.body);
    res.json({ lot });
  } catch (err) {
    next(err);
  }
});

// POST /api/lots/consume - Field Unit only, this is what the "scan-out" page calls
router.post('/consume', requireOrg('FieldUnit'), async (req, res, next) => {
  try {
    const result = await smartContracts.recordConsumption(req.actor, req.body);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/lots/dispose
router.post('/dispose', requireOrg('Depot', 'FieldUnit'), async (req, res, next) => {
  try {
    const lot = await smartContracts.disposeLot(req.actor, req.body);
    res.json({ lot });
  } catch (err) {
    next(err);
  }
});

// POST /api/lots/condition - manual sensor entry (in addition to the background simulator)
router.post('/condition', requireOrg('Depot', 'FieldUnit'), async (req, res, next) => {
  try {
    const result = await smartContracts.updateStorageCondition(req.actor, req.body);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
