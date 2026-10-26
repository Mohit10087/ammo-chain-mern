/**
 * forecastService.js
 * -------------------
 * Two simple, fully explainable forecasting methods over monthly
 * consumption history (ConsumptionHistory collection), exactly as scoped:
 * "simple linear regression or moving-average... keep the model simple and
 * explainable for a viva, not a black box."
 *
 * Both are computed and returned so the dashboard/viva can show the work:
 *   - movingAverage: mean of the last N periods (default N=3)
 *   - linearRegression: ordinary least squares fit of quantityConsumed
 *     against a period index (0, 1, 2, ...), projected one period forward
 */

const ConsumptionHistory = require('../models/ConsumptionHistory');

function movingAverage(values, windowSize = 3) {
  const window = values.slice(-windowSize);
  if (window.length === 0) return 0;
  const sum = window.reduce((a, b) => a + b, 0);
  return Math.round((sum / window.length) * 100) / 100;
}

/** Ordinary least squares: y = slope * x + intercept, x = 0..n-1 */
function linearRegressionForecast(values) {
  const n = values.length;
  if (n === 0) return { forecast: 0, slope: 0, intercept: 0 };
  if (n === 1) return { forecast: values[0], slope: 0, intercept: values[0] };

  const xs = values.map((_, i) => i);
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = values.reduce((a, b) => a + b, 0) / n;

  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i++) {
    numerator += (xs[i] - meanX) * (values[i] - meanY);
    denominator += (xs[i] - meanX) ** 2;
  }
  const slope = denominator === 0 ? 0 : numerator / denominator;
  const intercept = meanY - slope * meanX;

  const nextX = n; // one period beyond the last observed period
  const forecast = Math.max(0, Math.round((slope * nextX + intercept) * 100) / 100);

  return { forecast, slope: Math.round(slope * 100) / 100, intercept: Math.round(intercept * 100) / 100 };
}

async function forecastNextPeriod(ammoType) {
  const history = await ConsumptionHistory.find({ ammoType }).sort({ period: 1 }).lean();
  if (history.length === 0) {
    return { ammoType, history: [], movingAverageForecast: 0, linearRegressionForecast: 0, slope: 0, intercept: 0 };
  }

  const consumedSeries = history.map((h) => h.quantityConsumed);
  const ma = movingAverage(consumedSeries, 3);
  const lr = linearRegressionForecast(consumedSeries);

  return {
    ammoType,
    history,
    movingAverageForecast: ma,
    linearRegressionForecast: lr.forecast,
    slope: lr.slope,
    intercept: lr.intercept
  };
}

async function forecastAll() {
  const ammoTypes = await ConsumptionHistory.distinct('ammoType');
  const results = [];
  for (const ammoType of ammoTypes) {
    results.push(await forecastNextPeriod(ammoType));
  }
  return results;
}

module.exports = { forecastNextPeriod, forecastAll, movingAverage, linearRegressionForecast };
