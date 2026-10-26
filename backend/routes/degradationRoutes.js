const express = require('express');
const InspectionAlert = require('../models/InspectionAlert');
const SensorReading = require('../models/SensorReading');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

// GET /api/degradation/alerts
router.get('/alerts', async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    const alerts = await InspectionAlert.find(filter).sort({ createdAt: -1 }).limit(200);
    res.json({ alerts });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/degradation/alerts/:id - acknowledge/resolve
router.patch('/alerts/:id', async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!['ACKNOWLEDGED', 'RESOLVED'].includes(status)) {
      return res.status(400).json({ error: 'status must be ACKNOWLEDGED or RESOLVED' });
    }
    const alert = await InspectionAlert.findByIdAndUpdate(
      req.params.id,
      { status, acknowledgedBy: req.actor.username },
      { new: true }
    );
    if (!alert) return res.status(404).json({ error: 'Alert not found' });
    res.json({ alert });
  } catch (err) {
    next(err);
  }
});

// GET /api/degradation/readings/:lotID - sensor history for a chart
router.get('/readings/:lotID', async (req, res, next) => {
  try {
    const readings = await SensorReading.find({ lotID: req.params.lotID }).sort({ recordedAt: 1 });
    res.json({ lotID: req.params.lotID, readings });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
