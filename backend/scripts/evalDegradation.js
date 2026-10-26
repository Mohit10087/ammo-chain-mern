/**
 * evalDegradation.js
 * ------------------
 * Empirical evaluation of the Arrhenius-like ammunition degradation risk model
 * across thresholds \tau \in [30, 90] evaluated against truly unsafe lots
 * in data/sensor_readings.csv and data/lots_ground_truth.csv.
 */

const fs = require('fs');
const path = require('path');

const SENSOR_CSV = path.resolve(__dirname, '../../data/sensor_readings.csv');
const TRUTH_CSV = path.resolve(__dirname, '../../data/lots_ground_truth.csv');
const OUT_FILE = path.resolve(__dirname, '../../docs/results/degradation_eval.csv');

function parseCSV(content) {
  const lines = content.trim().split('\n');
  const headers = lines[0].split(',').map((h) => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',').map((p) => p.trim());
    if (parts.length === headers.length) {
      const obj = {};
      headers.forEach((h, idx) => {
        obj[h] = parts[idx];
      });
      rows.push(obj);
    }
  }
  return rows;
}

function runDegradationEval() {
  console.log('=== AMMUNITION DEGRADATION THRESHOLD SWEEP ===\n');

  const sensorRows = parseCSV(fs.readFileSync(SENSOR_CSV, 'utf8'));
  const truthRows = parseCSV(fs.readFileSync(TRUTH_CSV, 'utf8'));

  const groundTruth = new Map();
  for (const r of truthRows) {
    groundTruth.set(r.lot_id, parseInt(r.truly_unsafe, 10));
  }

  // Calculate raw risk per lot: sum of 2^((temp - 25)/10) * (1 + 0.015 * max(0, humidity - 50))
  const lotRaw = new Map();
  for (const r of sensorRows) {
    const lid = r.lot_id;
    const temp = parseFloat(r.temperature_c);
    const rh = parseFloat(r.humidity_pct);

    const term = Math.pow(2, (temp - 25.0) / 10.0) * (1 + 0.015 * Math.max(0, rh - 50.0));
    lotRaw.set(lid, (lotRaw.get(lid) || 0) + term);
  }

  // Min-max normalize 0..100
  const rawValues = Array.from(lotRaw.values());
  const minRaw = Math.min(...rawValues);
  const maxRaw = Math.max(...rawValues);

  const lotScores = new Map();
  for (const [lid, raw] of lotRaw.entries()) {
    const norm = ((raw - minRaw) / (maxRaw - minRaw)) * 100;
    lotScores.set(lid, norm);
  }

  const results = [];
  for (let th = 30; th <= 90; th += 5) {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    let flagged = 0;

    for (const [lid, score] of lotScores.entries()) {
      const isUnsafe = groundTruth.get(lid) || 0;
      const pred = score >= th ? 1 : 0;

      if (pred === 1) flagged++;
      if (pred === 1 && isUnsafe === 1) tp++;
      if (pred === 1 && isUnsafe === 0) fp++;
      if (pred === 0 && isUnsafe === 1) fn++;
    }

    const pr = tp + fp > 0 ? tp / (tp + fp) : 0;
    const rc = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1 = pr + rc > 0 ? (2 * pr * rc) / (pr + rc) : 0;

    results.push({
      threshold: th,
      flagged,
      TP: tp,
      FP: fp,
      FN: fn,
      precision: parseFloat(pr.toFixed(3)),
      recall: parseFloat(rc.toFixed(3)),
      F1: parseFloat(f1.toFixed(3))
    });
  }

  console.table(results);

  const csvRows = ['threshold,flagged,TP,FP,FN,precision,recall,F1', ...results.map((r) => `${r.threshold},${r.flagged},${r.TP},${r.FP},${r.FN},${r.precision},${r.recall},${r.F1}`)];
  fs.writeFileSync(OUT_FILE, csvRows.join('\n'));
  console.log(`\nSaved threshold sweep results to ${OUT_FILE}`);
}

runDegradationEval();
