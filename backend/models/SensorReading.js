const mongoose = require('mongoose');

const sensorReadingSchema = new mongoose.Schema({
  lotID: { type: String, required: true, index: true },
  temperatureC: { type: Number, required: true },
  humidityPct: { type: Number, required: true },
  recordedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('SensorReading', sensorReadingSchema);
