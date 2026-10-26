/**
 * sensorSimulator.js
 * -------------------
 * Stands in for real RFID/IoT temperature & humidity sensors (explicitly out
 * of scope per the brief: "Real IoT hardware integration - simulate sensor
 * data instead"). On an interval, it generates a plausible reading for a
 * handful of in-storage/issued lots and pushes it through the same
 * updateStorageCondition smart contract a real sensor gateway would call, so
 * degradation risk scoring and auto-inspection-flagging run exactly as they
 * would in production.
 *
 * A small fraction of readings are deliberately biased hot/humid so the
 * degradation alert pipeline has something to show in a live demo without
 * waiting for genuinely bad storage conditions to occur.
 */

const Lot = require('../models/Lot');
const smartContracts = require('../blockchain/smartContracts');

const SYSTEM_ACTOR = { org: 'System', username: 'sensor-simulator' };

function randomBetween(min, max) {
  return Math.round((Math.random() * (max - min) + min) * 10) / 10;
}

async function tick() {
  const activeLots = await Lot.find({ status: { $in: ['IN_STORAGE', 'ISSUED'] } }).limit(25).lean();
  if (activeLots.length === 0) return;

  // Simulate a handful of lots per tick rather than all of them, closer to a
  // real sensor network where only some units report each cycle.
  const sampleSize = Math.min(activeLots.length, Math.max(1, Math.ceil(activeLots.length * 0.3)));
  const sample = [...activeLots].sort(() => Math.random() - 0.5).slice(0, sampleSize);

  for (const lot of sample) {
    const isHotSpot = Math.random() < 0.08; // ~8% chance of a "problem" reading for demo purposes
    const temperatureC = isHotSpot ? randomBetween(38, 48) : randomBetween(18, 30);
    const humidityPct = isHotSpot ? randomBetween(70, 90) : randomBetween(30, 55);

    try {
      await smartContracts.updateStorageCondition(SYSTEM_ACTOR, { lotID: lot.lotID, temperatureC, humidityPct });
    } catch (err) {
      // A single lot failing (e.g. raced with a dispose) should not stop the
      // rest of the batch or crash the interval timer.
      console.error(`[sensorSimulator] failed to update ${lot.lotID}:`, err.message);
    }
  }
}

let timer = null;

function start() {
  if (process.env.SENSOR_SIM_ENABLED === 'false') {
    console.log('[sensorSimulator] disabled via SENSOR_SIM_ENABLED=false');
    return;
  }
  const intervalMs = Number(process.env.SENSOR_SIM_INTERVAL_MS || 15000);
  timer = setInterval(() => {
    tick().catch((err) => console.error('[sensorSimulator] tick error:', err.message));
  }, intervalMs);
  console.log(`[sensorSimulator] running every ${intervalMs}ms`);
}

function stop() {
  if (timer) clearInterval(timer);
}

module.exports = { start, stop, tick };
