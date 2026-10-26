const express = require('express');
const forecastService = require('../services/forecastService');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

// GET /api/forecast - forecast for every ammo type with history
router.get('/', async (req, res, next) => {
  try {
    const results = await forecastService.forecastAll();
    res.json({ forecasts: results });
  } catch (err) {
    next(err);
  }
});

// GET /api/forecast/:ammoType
router.get('/:ammoType', async (req, res, next) => {
  try {
    const result = await forecastService.forecastNextPeriod(req.params.ammoType);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
