const express = require('express');
const AnomalyFlag = require('../models/AnomalyFlag');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

// GET /api/anomalies/evaluation
router.get('/evaluation', async (req, res, next) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const metricsPath = path.resolve(__dirname, '../../docs/results/ml_metrics.json');
    if (fs.existsSync(metricsPath)) {
      const data = JSON.parse(fs.readFileSync(metricsPath, 'utf8'));
      return res.json(data);
    }
    return res.status(404).json({ error: 'Evaluation metrics not found' });
  } catch (err) {
    next(err);
  }
});

// GET /api/anomalies
router.get('/', async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.source) filter.source = req.query.source;
    const flags = await AnomalyFlag.find(filter).sort({ createdAt: -1 }).limit(200);
    res.json({ flags });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/anomalies/:id
router.patch('/:id', async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!['REVIEWED', 'DISMISSED'].includes(status)) {
      return res.status(400).json({ error: 'status must be REVIEWED or DISMISSED' });
    }
    const flag = await AnomalyFlag.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!flag) return res.status(404).json({ error: 'Flag not found' });
    res.json({ flag });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
