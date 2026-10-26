/**
 * Quick sanity checks for the parts of the system that don't need MongoDB:
 * the degradation risk formula, the forecasting math, and ledger hash
 * determinism/tamper-detection. Run with: npm run test:logic
 * This is NOT a substitute for integration testing against a real database -
 * see README for the full manual test checklist.
 */
const assert = require('assert');
const degradationService = require('../services/degradationService');
const { movingAverage, linearRegressionForecast } = require('../services/forecastService');
const { computeHash, GENESIS_PREVIOUS_HASH } = require('../blockchain/Ledger');

async function testDegradation() {
  const cool = await degradationService.computeRiskScore({ lotID: 'X', temperatureC: 15, humidityPct: 35, daysInStorage: 30 });
  const hot = await degradationService.computeRiskScore({ lotID: 'X', temperatureC: 45, humidityPct: 80, daysInStorage: 30 });
  assert(hot.riskScore > cool.riskScore, 'hotter/more humid storage must score a higher risk than cool/dry storage');
  assert(cool.riskScore >= 0 && hot.riskScore <= 100, 'risk score must stay within [0,100]');
  console.log('  ok: degradationService - hot/humid > cool/dry, bounded 0-100');
}

function testForecast() {
  const ma = movingAverage([100, 110, 120, 130], 3);
  assert.strictEqual(ma, Math.round(((110 + 120 + 130) / 3) * 100) / 100, 'moving average of last 3 values');

  const flat = linearRegressionForecast([100, 100, 100, 100]);
  assert.strictEqual(flat.slope, 0, 'flat series should have ~zero slope');

  const rising = linearRegressionForecast([100, 110, 120, 130]);
  assert(rising.slope > 0, 'rising series should have a positive slope');
  assert(rising.forecast > 130, 'forecast for a rising trend should extrapolate beyond the last value');
  console.log('  ok: forecastService - moving average + linear regression behave as expected');
}

function testLedgerHashing() {
  const block = {
    index: 0,
    timestamp: new Date('2026-01-01T00:00:00Z'),
    txType: 'REGISTER_LOT',
    lotID: 'LOT-TEST-001',
    payload: { quantity: 100 },
    previousHash: GENESIS_PREVIOUS_HASH,
    submittedByOrg: 'OrdnanceFactory',
    submittedByUser: 'factory_officer'
  };
  const hash1 = computeHash(block);
  const hash2 = computeHash(block);
  assert.strictEqual(hash1, hash2, 'hashing the same block twice must be deterministic');

  const tampered = { ...block, payload: { quantity: 999 } };
  const hash3 = computeHash(tampered);
  assert.notStrictEqual(hash1, hash3, 'changing the payload must change the hash (tamper-evidence)');
  console.log('  ok: Ledger hashing - deterministic and tamper-sensitive');
}

async function main() {
  console.log('Running pure-logic smoke tests (no database required)...');
  await testDegradation();
  testForecast();
  testLedgerHashing();
  console.log('All logic smoke tests passed.');
}

main().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
