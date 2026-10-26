const express = require('express');
const Requisition = require('../models/Requisition');
const smartContracts = require('../blockchain/smartContracts');
const { authenticate, requireOrg } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

// GET /api/requisitions
router.get('/', async (req, res, next) => {
  try {
    const filter = {};
    if (req.actor.org === 'Depot' && req.actor.depotId) filter.depotId = req.actor.depotId;
    if (req.query.status) filter.status = req.query.status;
    const requisitions = await Requisition.find(filter).sort({ createdAt: -1 });
    res.json({ requisitions });
  } catch (err) {
    next(err);
  }
});

// POST /api/requisitions/:requisitionID/decision - Depot Officer approves/rejects
router.post('/:requisitionID/decision', requireOrg('Depot'), async (req, res, next) => {
  try {
    const requisition = await smartContracts.approveRequisition(req.actor, {
      requisitionID: req.params.requisitionID,
      approve: !!req.body.approve
    });
    res.json({ requisition });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
