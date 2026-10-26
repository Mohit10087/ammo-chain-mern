const express = require('express');
const { authenticate } = require('../middleware/auth');
const syncService = require('../services/syncService');
const DeviceState = require('../models/DeviceState');
const Block = require('../models/Block');

const router = express.Router();
router.use(authenticate);

// POST /api/sync/batch - merge queued offline DDIL transactions
router.post('/batch', async (req, res, next) => {
  try {
    const summary = await syncService.processSyncBatch(req.actor, req.body);
    res.json(summary);
  } catch (err) {
    next(err);
  }
});

// GET /api/sync/devices/:deviceId - retrieve device sync status
router.get('/devices/:deviceId', async (req, res, next) => {
  try {
    const device = await DeviceState.findOne({ deviceId: req.params.deviceId }).lean();
    if (!device) return res.status(404).json({ error: 'Device not found' });
    res.json({ device });
  } catch (err) {
    next(err);
  }
});

// GET /api/sync/conflicts - list all conflict blocks recorded on ledger
router.get('/conflicts', async (req, res, next) => {
  try {
    const conflicts = await Block.find({ txType: 'CONFLICT_DETECTED' })
      .sort({ timestamp: -1 })
      .limit(100)
      .lean();
    res.json({ totalConflicts: conflicts.length, conflicts });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
