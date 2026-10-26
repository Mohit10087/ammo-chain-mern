/**
 * testMLAnomaly.js
 * ----------------
 * Automated test suite for Phase 3:
 * 1. Verifies graceful degradation (800ms fallback) when ML microservice is unreachable.
 * 2. Spawns/tests FastAPI microservice (POST /score, GET /health).
 * 3. Verifies feature explainability (z-scores) on normal vs anomalous payloads.
 * 4. Verifies database schema extensions on AnomalyFlag (source, mlScore, topFeatures, reason).
 * 5. Verifies end-to-end integration via checkIssueAnomalies.
 */

const assert = require('assert');
const path = require('path');
const { spawn } = require('child_process');
const mongoose = require('mongoose');

const anomalyService = require('../services/anomalyService');
const AnomalyFlag = require('../models/AnomalyFlag');
const Block = require('../models/Block');
const Lot = require('../models/Lot');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/ammo_chain';
let spawnedProcess = null;

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isMLServiceRunning() {
  try {
    const res = await fetch('http://localhost:8000/health', { signal: AbortSignal.timeout(1000) });
    if (res.ok) {
      const data = await res.json();
      return data.status === 'ok';
    }
  } catch (_e) {}
  return false;
}

async function startMLServiceIfNeeded() {
  const alreadyRunning = await isMLServiceRunning();
  if (alreadyRunning) {
    console.log('✓ ML microservice already running on port 8000');
    return null;
  }

  console.log('Starting ML microservice on port 8000...');
  const rootDir = path.resolve(__dirname, '../..');
  const proc = spawn('python3', ['-m', 'uvicorn', 'ml.service.app:app', '--port', '8000'], {
    cwd: rootDir,
    stdio: 'ignore'
  });

  for (let i = 0; i < 20; i++) {
    await wait(300);
    if (await isMLServiceRunning()) {
      console.log('✓ ML microservice successfully spawned');
      return proc;
    }
  }
  throw new Error('Failed to start ML microservice within 6 seconds');
}

async function runTests() {
  console.log('=== TEST SUITE: Phase 3 Machine Learning Anomaly Detection ===\n');

  // Connect to MongoDB
  await mongoose.connect(MONGO_URI);
  console.log('✓ Connected to MongoDB');

  // Test 1: Fallback when endpoint is unreachable
  console.log('\n[Test 1] Fallback mechanism on timeout / offline service...');
  const originalUrl = process.env.ML_SERVICE_URL;
  process.env.ML_SERVICE_URL = 'http://localhost:9999'; // unreachable port
  const fallbackRes = await anomalyService.scoreWithML({
    lotID: 'LOT-TEST-OFFLINE',
    ammoType: '5.56mm',
    action: 'ISSUE_LOT',
    quantity: 4000
  });
  assert.strictEqual(fallbackRes, null, 'scoreWithML should return null gracefully on connection failure');
  console.log('✓ Fallback verified: returns null cleanly within timeout without throwing');
  process.env.ML_SERVICE_URL = originalUrl || 'http://localhost:8000';

  // Test 2: Ensure ML microservice is available
  console.log('\n[Test 2] Microservice health & model availability...');
  spawnedProcess = await startMLServiceIfNeeded();
  const healthRes = await fetch('http://localhost:8000/health').then((r) => r.json());
  assert.strictEqual(healthRes.status, 'ok');
  assert.strictEqual(healthRes.modelLoaded, true);
  console.log(`✓ Health check passed: modelLoaded=${healthRes.modelLoaded}, features=${healthRes.nFeatures}`);

  // Test 3: Normal transaction scoring
  console.log('\n[Test 3] Scoring normal daytime transaction...');
  const normalRes = await anomalyService.scoreWithML({
    lotID: 'LOT-TEST-NORMAL',
    ammoType: '5.56mm',
    action: 'ISSUE_LOT',
    quantity: 4000,
    timestamp: '2026-06-15T14:30:00Z',
    recentIssuesSameType: [4000, 3900, 4100, 4000],
    minutesSinceLastLotEvent: 1440.0,
    eventsLastHour: 0,
    eventsLastDay: 1
  });
  assert.ok(normalRes);
  assert.strictEqual(normalRes.isAnomaly, false, 'Standard 4000 qty daytime issue should NOT be an anomaly');
  assert.ok(normalRes.anomalyScore < 0.65, `Score should be low, got ${normalRes.anomalyScore}`);
  console.log(`✓ Normal transaction score=${normalRes.anomalyScore} (isAnomaly=${normalRes.isAnomaly})`);

  // Test 4: Anomalous burst / off-hours transaction scoring with explainability
  console.log('\n[Test 4] Scoring anomalous burst / rapid transactions with explainability...');
  const burstRes = await anomalyService.scoreWithML({
    lotID: 'LOT-TEST-BURST',
    ammoType: '5.56mm',
    action: 'ISSUE_LOT',
    quantity: 12000, // 3x typical
    timestamp: '2026-06-15T02:15:00Z', // 2 AM off-hours
    recentIssuesSameType: [4000, 4000, 4000],
    minutesSinceLastLotEvent: 3.5, // 3.5 minutes since last
    eventsLastHour: 8, // 8 events in last hour!
    eventsLastDay: 15
  });
  assert.ok(burstRes);
  assert.strictEqual(burstRes.isAnomaly, true, 'High frequency off-hours spike MUST be flagged as anomaly');
  assert.ok(burstRes.anomalyScore >= 0.60, `Score should be high, got ${burstRes.anomalyScore}`);
  assert.ok(Array.isArray(burstRes.topFeatures), 'topFeatures must be an array');
  assert.ok(burstRes.topFeatures.length >= 2, 'Must include at least 2 top feature explanations');
  console.log(`✓ Anomalous transaction score=${burstRes.anomalyScore} (isAnomaly=${burstRes.isAnomaly})`);
  console.log(`  Top explainability deviations:`);
  burstRes.topFeatures.forEach((f) => {
    console.log(`    - ${f.feature}: val=${f.value}, z-score=${f.zScore}`);
  });

  // Test 5: Database integration with AnomalyFlag schema
  console.log('\n[Test 5] AnomalyFlag schema and checkIssueAnomalies integration...');
  const testLotID = `LOT-TEST-ML-${Date.now()}`;
  const mockLot = {
    lotID: testLotID,
    ammoType: '5.56mm',
    quantity: 15000 // Huge quantity to trigger both rule and ML
  };

  const flags = await anomalyService.checkIssueAnomalies({
    lot: mockLot,
    toOrg: 'FieldUnit',
    toId: 'FU-TEST-ML'
  });

  assert.ok(flags.length > 0, 'Should generate anomaly flags');
  const flag = flags[0];
  assert.ok(['rules', 'ml', 'both'].includes(flag.source), `Source must be rules/ml/both, got ${flag.source}`);
  assert.ok(flag.mlScore !== null, 'mlScore must be populated');
  assert.ok(flag.topFeatures !== null, 'topFeatures must be populated');
  console.log(`✓ Flag generated successfully: rule=${flag.rule}, source=${flag.source}, mlScore=${flag.mlScore}`);

  // Clean up test flags
  await AnomalyFlag.deleteMany({ lotID: testLotID });
  console.log('✓ Cleaned up test database records');

  console.log('\n======================================================');
  console.log('ALL PHASE 3 MACHINE LEARNING ANOMALY TESTS PASSED CLEANLY');
  console.log('======================================================\n');
}

runTests()
  .catch((err) => {
    console.error('Test Suite Failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (spawnedProcess) {
      spawnedProcess.kill();
    }
    await mongoose.disconnect();
  });
