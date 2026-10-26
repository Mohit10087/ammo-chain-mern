const mongoose = require('mongoose');

const deviceStateSchema = new mongoose.Schema(
  {
    deviceId: { type: String, required: true, unique: true, index: true },
    secret: { type: String, required: true },
    lastSequenceNumber: { type: Number, default: 0 },
    lastSyncAt: { type: Date, default: Date.now },
    totalApplied: { type: Number, default: 0 },
    totalConflicts: { type: Number, default: 0 },
    totalRejections: { type: Number, default: 0 }
  },
  { timestamps: true }
);

module.exports = mongoose.model('DeviceState', deviceStateSchema);
