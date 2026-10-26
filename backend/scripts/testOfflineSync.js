/**
 * testOfflineSync.js
 * -------------------
 * Formal verification test suite for Phase 2: Offline Store-and-Forward Queue (DDIL Resilience).
 *
 * Verifies 5 formal properties:
 * 1. Tampered HMAC is rejected (REJECTED_BAD_SIGNATURE)
 * 2. Replaying the same batch is idempotent (DUPLICATE_IGNORED)
 * 3. A conflict produces a CONFLICT_DETECTED block (no silent drop)
 * 4. Ledger chain integrity verifies clean after any merge
 * 5. Events arriving out of order are applied in sequence
 *
 * Output: docs/results/offline_verification.csv (test_name, expected, observed, pass_fail)
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Lot = require('../models/Lot');
const Block = require('../models/Block');
const Ledger = require('../blockchain/Ledger');
const DeviceState = require('../models/DeviceState');
const syncService = require('../services/syncService');

const RESULTS_DIR = path.resolve(__dirname, '../../docs/results');

function signEvent(secret, event) {
  const canonicalData = {
    eventId: event.eventId,
    deviceId: event.deviceId,
    sequenceNumber: event.sequenceNumber,
    capturedAt: event.capturedAt,
    action: event.action,
    payload: event.payload
  };
  const msg = JSON.stringify(canonicalData);
  return crypto.createHmac('sha256', secret).update(msg).digest('hex');
}

async function runFormalVerification() {
  await connectDB();
  console.log('\n--- PHASE 2: FORMAL DDIL OFFLINE QUEUE VERIFICATION ---');

  const testPrefix = `FORMAL-DDIL-${Date.now().toString().slice(-6)}`;
  const testLotID = `${testPrefix}-LOT-VERIFY`;
  const deviceId = `DEV-${testPrefix}`;
  const deviceSecret = crypto.randomBytes(32).toString('hex');

  // Seed test lot
  const lot = await Lot.create({
    lotID: testLotID,
    ammoType: '5.56x45mm',
    caliber: '5.56mm NATO',
    quantity: 1000,
    manufactureDate: new Date(),
    currentHolderOrg: 'FieldUnit',
    currentHolderId: 'UNIT-ALPHA',
    status: 'ISSUED'
  });

  await Ledger.addBlock({
    txType: 'REGISTER_LOT',
    lotID: testLotID,
    payload: { ammoType: lot.ammoType, quantity: 1000 },
    submittedByOrg: 'OrdnanceFactory',
    submittedByUser: 'factory_officer'
  });

  const testRecords = [];

  try {
    // ---------------- TEST 1: TAMPERED HMAC IS REJECTED ----------------
    console.log('Testing Property 1: Tampered HMAC rejection...');
    const ev1 = {
      eventId: `EV-TAMPER-${crypto.randomUUID()}`,
      deviceId,
      sequenceNumber: 1,
      capturedAt: new Date().toISOString(),
      action: 'RECORD_CONSUMPTION',
      payload: { lotID: testLotID, quantity: 50 }
    };
    // Sign legitimately, then tamper with payload
    ev1.signature = signEvent(deviceSecret, ev1);
    ev1.payload.quantity = 99999; // Attacker altered quantity without updating HMAC!

    const res1 = await syncService.processSyncBatch(
      { org: 'FieldUnit', username: 'qm_tester' },
      { deviceId, deviceSecret, events: [ev1] }
    );

    const observed1 = res1.results[0]?.status;
    const pass1 = observed1 === 'REJECTED_BAD_SIGNATURE';
    console.log(`  Expected: REJECTED_BAD_SIGNATURE | Observed: ${observed1} | Result: ${pass1 ? 'PASS' : 'FAIL'}`);
    testRecords.push({
      test_name: 'Tampered HMAC signature is rejected',
      expected: 'REJECTED_BAD_SIGNATURE',
      observed: observed1,
      pass_fail: pass1 ? 'PASS' : 'FAIL'
    });

    // ---------------- TEST 2: REPLAYING SAME BATCH IS IDEMPOTENT ----------------
    console.log('\nTesting Property 2: Idempotent duplicate batch suppression...');
    const ev2 = {
      eventId: `EV-IDEMPOTENT-${crypto.randomUUID()}`,
      deviceId,
      sequenceNumber: 2,
      capturedAt: new Date().toISOString(),
      action: 'RECORD_CONSUMPTION',
      payload: { lotID: testLotID, quantity: 100 }
    };
    ev2.signature = signEvent(deviceSecret, ev2);

    // First submission
    const res2_first = await syncService.processSyncBatch(
      { org: 'FieldUnit', username: 'qm_tester' },
      { deviceId, deviceSecret, events: [ev2] }
    );
    // Duplicate submission (replay attack or network retry)
    const res2_second = await syncService.processSyncBatch(
      { org: 'FieldUnit', username: 'qm_tester' },
      { deviceId, deviceSecret, events: [ev2] }
    );

    const observed2 = res2_second.results[0]?.status;
    const pass2 = res2_first.results[0]?.status === 'APPLIED' && observed2 === 'DUPLICATE_IGNORED';
    console.log(`  Expected: DUPLICATE_IGNORED | Observed: ${observed2} | Result: ${pass2 ? 'PASS' : 'FAIL'}`);
    testRecords.push({
      test_name: 'Replaying the same event batch is idempotent',
      expected: 'DUPLICATE_IGNORED',
      observed: observed2,
      pass_fail: pass2 ? 'PASS' : 'FAIL'
    });

    // ---------------- TEST 3: CONFLICT PRODUCES CONFLICT_DETECTED BLOCK ----------------
    console.log('\nTesting Property 3: Conflict block creation (no silent drops)...');
    // Request more rounds than currently remaining
    const ev3 = {
      eventId: `EV-CONFLICT-${crypto.randomUUID()}`,
      deviceId,
      sequenceNumber: 3,
      capturedAt: new Date().toISOString(),
      action: 'RECORD_CONSUMPTION',
      payload: { lotID: testLotID, quantity: 50000 } // Exceeds 900 remaining rounds!
    };
    ev3.signature = signEvent(deviceSecret, ev3);

    const res3 = await syncService.processSyncBatch(
      { org: 'FieldUnit', username: 'qm_tester' },
      { deviceId, deviceSecret, events: [ev3] }
    );

    const conflictBlockInLedger = await Block.findOne({ eventId: ev3.eventId, txType: 'CONFLICT_DETECTED' });
    const observed3 = res3.results[0]?.status;
    const pass3 = observed3 === 'CONFLICT_DETECTED' && conflictBlockInLedger !== null;
    console.log(`  Expected: CONFLICT_DETECTED in Ledger | Observed: ${observed3} (Block #${conflictBlockInLedger?.index}) | Result: ${pass3 ? 'PASS' : 'FAIL'}`);
    testRecords.push({
      test_name: 'Merge conflict produces immutable CONFLICT_DETECTED block',
      expected: 'CONFLICT_DETECTED block on ledger',
      observed: `Block #${conflictBlockInLedger?.index} (${observed3})`,
      pass_fail: pass3 ? 'PASS' : 'FAIL'
    });

    // ---------------- TEST 4: LEDGER CHAIN INTEGRITY POST-MERGE ----------------
    console.log('\nTesting Property 4: End-to-end ledger chain integrity verification...');
    const chainVerify = await Ledger.verifyChain();
    const observed4 = chainVerify.valid ? 'VALID_HASH_CHAIN' : 'BROKEN_CHAIN';
    const pass4 = chainVerify.valid === true;
    console.log(`  Expected: VALID_HASH_CHAIN | Observed: ${observed4} (${chainVerify.totalBlocks} blocks) | Result: ${pass4 ? 'PASS' : 'FAIL'}`);
    testRecords.push({
      test_name: 'Ledger integrity verifies clean after conflict and sync merges',
      expected: 'VALID_HASH_CHAIN',
      observed: observed4,
      pass_fail: pass4 ? 'PASS' : 'FAIL'
    });

    // ---------------- TEST 5: OUT-OF-ORDER EVENTS APPLIED IN SEQUENCE ----------------
    console.log('\nTesting Property 5: Out-of-order events applied in logical sequence...');
    const evSeqA = {
      eventId: `EV-SEQ-1-${crypto.randomUUID()}`,
      deviceId,
      sequenceNumber: 4,
      capturedAt: new Date(Date.now() - 20000).toISOString(),
      action: 'RECORD_CONSUMPTION',
      payload: { lotID: testLotID, quantity: 20 }
    };
    evSeqA.signature = signEvent(deviceSecret, evSeqA);

    const evSeqB = {
      eventId: `EV-SEQ-2-${crypto.randomUUID()}`,
      deviceId,
      sequenceNumber: 5,
      capturedAt: new Date(Date.now() - 10000).toISOString(),
      action: 'RECORD_CONSUMPTION',
      payload: { lotID: testLotID, quantity: 30 }
    };
    evSeqB.signature = signEvent(deviceSecret, evSeqB);

    // Transmit in reverse order [Seq 5, Seq 4]
    const res5 = await syncService.processSyncBatch(
      { org: 'FieldUnit', username: 'qm_tester' },
      { deviceId, deviceSecret, events: [evSeqB, evSeqA] }
    );

    const appliedSeqOrder = res5.results.filter((r) => r.status === 'APPLIED').map((r) => r.sequenceNumber);
    const pass5 = appliedSeqOrder[0] === 4 && appliedSeqOrder[1] === 5;
    const observed5 = `Order: [${appliedSeqOrder.join(', ')}]`;
    console.log(`  Expected: Order: [4, 5] | Observed: ${observed5} | Result: ${pass5 ? 'PASS' : 'FAIL'}`);
    testRecords.push({
      test_name: 'Out-of-order received events are sorted and committed in sequence',
      expected: 'Order: [4, 5]',
      observed: observed5,
      pass_fail: pass5 ? 'PASS' : 'FAIL'
    });
  } finally {
    // Cleanup test artifacts
    console.log('\nCleaning up verification records in MongoDB...');
    await Block.deleteMany({ lotID: { $regex: `^${testPrefix}` } });
    await Lot.deleteMany({ lotID: { $regex: `^${testPrefix}` } });
    await DeviceState.deleteOne({ deviceId });
  }

  // Write results CSV
  if (!fs.existsSync(RESULTS_DIR)) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
  }
  const csvPath = path.join(RESULTS_DIR, 'offline_verification.csv');
  const header = 'test_name,expected,observed,pass_fail\n';
  const rows = testRecords
    .map((r) => `"${r.test_name}","${r.expected}","${r.observed}","${r.pass_fail}"`)
    .join('\n');
  fs.writeFileSync(csvPath, header + rows + '\n');
  console.log(`\nSaved verification results to ${csvPath}\n`);

  const allPassed = testRecords.every((r) => r.pass_fail === 'PASS');
  if (!allPassed) {
    console.error('One or more formal verification tests failed!');
    process.exit(1);
  }
  console.log('All 5 formal DDIL offline queue verification tests PASSED!\n');
  await mongoose.disconnect();
}

runFormalVerification().catch((err) => {
  console.error('Fatal formal verification error:', err);
  process.exit(1);
});
