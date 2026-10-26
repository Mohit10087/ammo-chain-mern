const express = require('express');
const Lot = require('../models/Lot');
const Requisition = require('../models/Requisition');
const InspectionAlert = require('../models/InspectionAlert');
const AnomalyFlag = require('../models/AnomalyFlag');
const Ledger = require('../blockchain/Ledger');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

// GET /api/dashboard/stock - current stock grouped by holder + ammo type
// Commander sees everything; other orgs are scoped to their own holdings.
router.get('/stock', async (req, res, next) => {
  try {
    const match = { status: { $nin: ['DISPOSED', 'CONSUMED'] } };
    if (req.actor.org !== 'Commander') match.currentHolderOrg = req.actor.org;

    const stock = await Lot.aggregate([
      { $match: match },
      {
        $group: {
          _id: { org: '$currentHolderOrg', holderId: '$currentHolderId', ammoType: '$ammoType' },
          totalQuantity: { $sum: { $subtract: ['$quantity', '$quantityConsumed'] } },
          lotCount: { $sum: 1 }
        }
      },
      { $sort: { '_id.org': 1, '_id.holderId': 1, '_id.ammoType': 1 } }
    ]);

    res.json({ stock });
  } catch (err) {
    next(err);
  }
});

// GET /api/dashboard/summary - counters for the top-of-page KPI strip
router.get('/summary', async (req, res, next) => {
  try {
    const lotFilter = req.actor.org !== 'Commander' ? { currentHolderOrg: req.actor.org } : {};

    const [totalLots, pendingRequisitions, openAlerts, openAnomalies, chainHeight, chainStatus] = await Promise.all([
      Lot.countDocuments(lotFilter),
      Requisition.countDocuments({ status: 'PENDING_APPROVAL' }),
      InspectionAlert.countDocuments({ status: 'OPEN' }),
      AnomalyFlag.countDocuments({ status: 'OPEN' }),
      Ledger.getChainHeight(),
      Ledger.verifyChain()
    ]);

    res.json({ totalLots, pendingRequisitions, openAlerts, openAnomalies, chainHeight, chainIntegrity: chainStatus });
  } catch (err) {
    next(err);
  }
});

// GET /api/dashboard/ledger/verify - explicit integrity check, useful as a live demo moment
router.get('/ledger/verify', async (req, res, next) => {
  try {
    const status = await Ledger.verifyChain();
    res.json(status);
  } catch (err) {
    next(err);
  }
});

// GET /api/dashboard/ledger - paginated raw ledger for a "block explorer" view
router.get('/ledger', async (req, res, next) => {
  try {
    const limit = Math.min(200, Number(req.query.limit) || 50);
    const chain = await Ledger.getFullChain();
    const recent = chain.slice(-limit).reverse();
    res.json({ totalBlocks: chain.length, blocks: recent });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
