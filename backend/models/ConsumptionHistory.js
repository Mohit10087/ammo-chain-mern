const mongoose = require('mongoose');

// Monthly aggregated issue/consumption figures per ammo type. Populated by
// the synthetic data generator (utils/seedData.js) for the viva demo, but in
// a real deployment this would be aggregated automatically from
// RECORD_CONSUMPTION blocks on a schedule.
const consumptionHistorySchema = new mongoose.Schema({
  ammoType: { type: String, required: true, index: true },
  period: { type: String, required: true }, // "YYYY-MM"
  quantityIssued: { type: Number, required: true },
  quantityConsumed: { type: Number, required: true }
});

consumptionHistorySchema.index({ ammoType: 1, period: 1 }, { unique: true });

module.exports = mongoose.model('ConsumptionHistory', consumptionHistorySchema);
