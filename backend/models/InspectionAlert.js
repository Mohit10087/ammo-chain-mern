const mongoose = require('mongoose');

const inspectionAlertSchema = new mongoose.Schema(
  {
    lotID: { type: String, required: true, index: true },
    riskScore: { type: Number, required: true },
    temperatureC: { type: Number, required: true },
    humidityPct: { type: Number, required: true },
    daysInStorage: { type: Number, required: true },
    reason: { type: String, required: true },
    status: { type: String, enum: ['OPEN', 'ACKNOWLEDGED', 'RESOLVED'], default: 'OPEN' },
    acknowledgedBy: { type: String, default: null }
  },
  { timestamps: true }
);

module.exports = mongoose.model('InspectionAlert', inspectionAlertSchema);
