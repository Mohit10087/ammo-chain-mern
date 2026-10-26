const mongoose = require('mongoose');

const requisitionSchema = new mongoose.Schema(
  {
    requisitionID: { type: String, required: true, unique: true },
    depotId: { type: String, required: true },
    ammoType: { type: String, required: true },
    currentStock: { type: Number, required: true },
    threshold: { type: Number, required: true },
    requestedQuantity: { type: Number, required: true },
    status: {
      type: String,
      enum: ['PENDING_APPROVAL', 'APPROVED', 'REJECTED'],
      default: 'PENDING_APPROVAL'
    },
    triggeredByLotID: { type: String, default: null },
    approvedBy: { type: String, default: null },
    approvedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Requisition', requisitionSchema);
