const mongoose = require('mongoose');

// This collection is the "current state" read model - the MERN analogue of
// Hyperledger Fabric's CouchDB world state. The authoritative, tamper-evident
// record of every change is the hash-chained Block ledger (see models/Block.js
// and blockchain/Ledger.js); this document is always derived from it.
const lotSchema = new mongoose.Schema(
  {
    lotID: { type: String, required: true, unique: true, index: true },
    ammoType: { type: String, required: true }, // e.g. "5.56x45mm"
    caliber: { type: String, required: true },
    quantity: { type: Number, required: true, min: 0 },
    manufactureDate: { type: Date, required: true },

    // Chain of custody
    currentHolderOrg: {
      type: String,
      enum: ['OrdnanceFactory', 'Depot', 'FieldUnit', 'Disposed'],
      required: true
    },
    currentHolderId: { type: String, required: true }, // depotId or unitId

    // The last Depot this lot passed through - lets recordConsumption route
    // the auto-replenishment check (checkStockLevel) back to the correct depot.
    sourceDepotId: { type: String, default: null },

    status: {
      type: String,
      enum: ['REGISTERED', 'IN_TRANSIT', 'IN_STORAGE', 'ISSUED', 'CONSUMED', 'DISPOSED', 'FLAGGED_FOR_INSPECTION'],
      default: 'REGISTERED'
    },

    // Running total already consumed out of this lot (partial consumption allowed)
    quantityConsumed: { type: Number, default: 0 },

    // Latest degradation snapshot (full sensor history lives in SensorReading)
    lastRiskScore: { type: Number, default: 0 },
    lastConditionCheck: { type: Date, default: null },

    // Pointer to the most recent block hash affecting this lot, so the UI can
    // jump straight into the ledger history for verification.
    lastBlockHash: { type: String, default: null }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Lot', lotSchema);
