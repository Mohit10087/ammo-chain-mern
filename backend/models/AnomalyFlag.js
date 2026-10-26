const mongoose = require('mongoose');

const anomalyFlagSchema = new mongoose.Schema(
  {
    rule: {
      type: String,
      required: true
    },
    lotID: { type: String, default: null },
    unitId: { type: String, default: null },
    details: { type: mongoose.Schema.Types.Mixed, required: true },
    severity: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH'], default: 'MEDIUM' },
    status: { type: String, enum: ['OPEN', 'REVIEWED', 'DISMISSED'], default: 'OPEN' },

    // Machine Learning Anomaly Detection Extensions (Phase 3)
    source: {
      type: String,
      enum: ['rules', 'ml', 'both'],
      default: 'rules'
    },
    mlScore: { type: Number, default: null },
    topFeatures: { type: mongoose.Schema.Types.Mixed, default: null },
    reason: { type: String, default: null }
  },
  { timestamps: true }
);

module.exports = mongoose.model('AnomalyFlag', anomalyFlagSchema);
