const mongoose = require('mongoose');

const anomalyFlagSchema = new mongoose.Schema(
  {
    rule: {
      type: String,
      required: true,
      enum: ['DUPLICATE_ISSUE_WINDOW', 'TRANSFER_QUANTITY_SPIKE', 'UNIT_PATTERN_DEVIATION']
    },
    lotID: { type: String, default: null },
    unitId: { type: String, default: null },
    details: { type: mongoose.Schema.Types.Mixed, required: true },
    severity: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH'], default: 'MEDIUM' },
    status: { type: String, enum: ['OPEN', 'REVIEWED', 'DISMISSED'], default: 'OPEN' }
  },
  { timestamps: true }
);

module.exports = mongoose.model('AnomalyFlag', anomalyFlagSchema);
