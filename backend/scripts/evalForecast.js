/**
 * evalForecast.js
 * ---------------
 * Empirical rolling-origin evaluation of forecasting models across all
 * (unit, ammo_type) time series in data/consumption_history.csv.
 *
 * Compares 4 explainable models:
 *   1. naive: last observed month's consumption
 *   2. ma3: 3-month simple moving average
 *   3. ols12: ordinary least squares linear regression over previous 12 months
 *   4. seasonal_naive: consumption from the exact same month last year (12-month lag)
 *
 * Evaluated on the final 12 months (months 24..35) across 15 distinct series
 * (180 evaluation windows total).
 */

const fs = require('fs');
const path = require('path');
const { movingAverage, linearRegressionForecast, seasonalNaive } = require('../services/forecastService');

const CSV_PATH = path.resolve(__dirname, '../../data/consumption_history.csv');
const OUT_DIR = path.resolve(__dirname, '../../docs/results');

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

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 !== 0 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function mean(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

async function runForecastEval() {
  console.log('=== FORECASTING MODEL EVALUATION ===\n');
  if (!fs.existsSync(CSV_PATH)) {
    throw new Error(`Data file not found at ${CSV_PATH}`);
  }

  const data = parseCSV(fs.readFileSync(CSV_PATH, 'utf8'));
  console.log(`Loaded ${data.length} monthly consumption records.`);

  // Group by (unit, ammo_type)
  const seriesMap = new Map();
  for (const row of data) {
    const key = `${row.unit}__${row.ammo_type}`;
    if (!seriesMap.has(key)) seriesMap.set(key, []);
    seriesMap.get(key).push({
      month: row.month,
      ammo_type: row.ammo_type,
      rounds: parseFloat(row.rounds_consumed)
    });
  }

  const errors = {
    naive: [],
    ma3: [],
    ols12: [],
    seasonal_naive: []
  };

  const perTypeErrors = {};

  for (const [key, records] of seriesMap.entries()) {
    records.sort((a, b) => a.month.localeCompare(b.month));
    const y = records.map((r) => r.rounds);
    const ammoType = records[0].ammo_type;

    // Rolling-origin evaluation on last 12 months (months 24 to 35)
    for (let t = 24; t < records.length; t++) {
      const actual = y[t];
      const history = y.slice(0, t);

      const predNaive = history[history.length - 1];
      const predMa3 = movingAverage(history, 3);
      const predOls = linearRegressionForecast(history.slice(-12)).forecast;
      const predSNaive = seasonalNaive(history, 12);

      const apeNaive = (Math.abs(predNaive - actual) / actual) * 100;
      const apeMa3 = (Math.abs(predMa3 - actual) / actual) * 100;
      const apeOls = (Math.abs(predOls - actual) / actual) * 100;
      const apeSNaive = (Math.abs(predSNaive - actual) / actual) * 100;

      errors.naive.push(apeNaive);
      errors.ma3.push(apeMa3);
      errors.ols12.push(apeOls);
      errors.seasonal_naive.push(apeSNaive);

      if (!perTypeErrors[ammoType]) {
        perTypeErrors[ammoType] = { naive: [], ma3: [], ols12: [], seasonal_naive: [] };
      }
      perTypeErrors[ammoType].naive.push(apeNaive);
      perTypeErrors[ammoType].ma3.push(apeMa3);
      perTypeErrors[ammoType].ols12.push(apeOls);
      perTypeErrors[ammoType].seasonal_naive.push(apeSNaive);
    }
  }

  // Summary results
  const summaryRows = [
    { method: 'naive', 'MAPE_%': mean(errors.naive).toFixed(2), 'median_APE_%': median(errors.naive).toFixed(2) },
    { method: 'ma3', 'MAPE_%': mean(errors.ma3).toFixed(2), 'median_APE_%': median(errors.ma3).toFixed(2) },
    { method: 'ols12', 'MAPE_%': mean(errors.ols12).toFixed(2), 'median_APE_%': median(errors.ols12).toFixed(2) },
    { method: 'seasonal_naive', 'MAPE_%': mean(errors.seasonal_naive).toFixed(2), 'median_APE_%': median(errors.seasonal_naive).toFixed(2) }
  ];

  console.table(summaryRows);

  // Write CSV
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const csvOut = ['method,MAPE_%,median_APE_%', ...summaryRows.map((r) => `${r.method},${r['MAPE_%']},${r['median_APE_%']}`)].join('\n');
  fs.writeFileSync(path.join(OUT_DIR, 'forecast_eval.csv'), csvOut);
  console.log(`Saved evaluation to ${path.join(OUT_DIR, 'forecast_eval.csv')}`);

  // Breakdown by ammo type
  const ammoHeader = 'ammo_type,ma3,naive,ols12,seasonal_naive';
  const ammoRows = Object.keys(perTypeErrors).sort().map((a) => {
    const o = perTypeErrors[a];
    return `${a},${mean(o.ma3).toFixed(2)},${mean(o.naive).toFixed(2)},${mean(o.ols12).toFixed(2)},${mean(o.seasonal_naive).toFixed(2)}`;
  });
  fs.writeFileSync(path.join(OUT_DIR, 'forecast_eval_by_ammo.csv'), [ammoHeader, ...ammoRows].join('\n'));
  console.log(`Saved breakdown to ${path.join(OUT_DIR, 'forecast_eval_by_ammo.csv')}`);
}

runForecastEval().catch(console.error);
