/**
 * testCustodyTransfer.js
 * -----------------------
 * Comprehensive automated test for custody transitions, lateral transfers,
 * and rear echelon return (back-loading).
 *
 * Enforces invariants:
 * 1. Lateral transfers are restricted to peer echelons:
 *    - Depot <-> Depot
 *    - FieldUnit <-> FieldUnit
 * 2. Field units cannot laterally transfer to Depots; they must use Return to Depot.
 * 3. Cross-echelon transfers cleanly transition currentHolderOrg and currentHolderId.
 * 4. Returned lots reappear in Depot active inventory without orphaned records.
 * 5. Full cryptographic hash-chain and Merkle root integrity check.
 */

require('dotenv').config();
const assert = require('assert');
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Lot = require('../models/Lot');
const Block = require('../models/Block');
const Ledger = require('../blockchain/Ledger');
const smartContracts = require('../blockchain/smartContracts');
const merkleService = require('../services/merkleService');

const ACTORS = {
  factory: { org: 'OrdnanceFactory', username: 'factory_officer', depotId: null },
  depot1: { org: 'Depot', username: 'depot1_officer', depotId: 'DEPOT-01' },
  depot2: { org: 'Depot', username: 'depot2_officer', depotId: 'DEPOT-02' },
  unitAlpha: { org: 'FieldUnit', username: 'unit_alpha', depotId: 'UNIT-ALPHA' },
  unitBravo: { org: 'FieldUnit', username: 'unit_bravo', depotId: 'UNIT-BRAVO' }
};

const TEST_LOT_ID = 'LOT-CUSTODY-TEST-001';

async function runCustodyTests() {
  console.log('--- Starting Custody Transfer & Return Verification Suite ---');

  // Clean test artifacts if present
  await Lot.deleteOne({ lotID: TEST_LOT_ID });
  await Block.deleteMany({ lotID: TEST_LOT_ID });

  // 1. Factory registers lot
  console.log('[1/10] Factory registering test lot...');
  const lot = await smartContracts.registerLot(ACTORS.factory, {
    lotID: TEST_LOT_ID,
    ammoType: '5.56x45mm',
    caliber: '5.56mm NATO',
    quantity: 10000,
    manufactureDate: '2026-03-01'
  });
  assert.strictEqual(lot.currentHolderOrg, 'OrdnanceFactory');
  console.log('  ok: Registered with OrdnanceFactory custody');

  // 2. Factory issues to DEPOT-01
  console.log('[2/10] Factory issuing lot to DEPOT-01...');
  const issuedToDepot = await smartContracts.issueLot(ACTORS.factory, {
    lotID: TEST_LOT_ID,
    toOrg: 'Depot',
    toId: 'DEPOT-01'
  });
  assert.strictEqual(issuedToDepot.currentHolderOrg, 'Depot');
  assert.strictEqual(issuedToDepot.currentHolderId, 'DEPOT-01');
  console.log('  ok: Custody successfully transferred to DEPOT-01');

  // 3. DEPOT-01 laterally transfers to DEPOT-02
  console.log('[3/10] DEPOT-01 laterally transferring lot to peer DEPOT-02...');
  const transferredDepot = await smartContracts.transferLot(ACTORS.depot1, {
    lotID: TEST_LOT_ID,
    toId: 'DEPOT-02'
  });
  assert.strictEqual(transferredDepot.currentHolderOrg, 'Depot');
  assert.strictEqual(transferredDepot.currentHolderId, 'DEPOT-02');
  assert.strictEqual(transferredDepot.sourceDepotId, 'DEPOT-02');
  console.log('  ok: Lateral transfer Depot -> Depot succeeded with updated holder');

  // 4. DEPOT-02 lateral transfer to UNIT-ALPHA should be REJECTED (must use issueLot)
  console.log('[4/10] DEPOT-02 attempting lateral transfer to UNIT-ALPHA (must fail)...');
  let rejected = false;
  try {
    await smartContracts.transferLot(ACTORS.depot2, {
      lotID: TEST_LOT_ID,
      toId: 'UNIT-ALPHA'
    });
  } catch (err) {
    rejected = true;
    assert(err.message.includes('Issue Lot'), `Expected issue lot guidance, got: ${err.message}`);
  }
  assert(rejected, 'Depot transfer to Unit must be rejected');
  console.log('  ok: Illegal cross-echelon transfer correctly rejected');

  // 5. DEPOT-02 issues lot to UNIT-ALPHA
  console.log('[5/10] DEPOT-02 issuing lot to UNIT-ALPHA...');
  const issuedToUnit = await smartContracts.issueLot(ACTORS.depot2, {
    lotID: TEST_LOT_ID,
    toOrg: 'FieldUnit',
    toId: 'UNIT-ALPHA'
  });
  assert.strictEqual(issuedToUnit.currentHolderOrg, 'FieldUnit');
  assert.strictEqual(issuedToUnit.currentHolderId, 'UNIT-ALPHA');
  assert.strictEqual(issuedToUnit.status, 'ISSUED');
  console.log('  ok: Custody issued to UNIT-ALPHA');

  // 6. UNIT-ALPHA lateral transfer to DEPOT-01 should be REJECTED (must use returnToDepot)
  console.log('[6/10] UNIT-ALPHA attempting lateral transfer to DEPOT-01 (must fail)...');
  rejected = false;
  try {
    await smartContracts.transferLot(ACTORS.unitAlpha, {
      lotID: TEST_LOT_ID,
      toId: 'DEPOT-01'
    });
  } catch (err) {
    rejected = true;
    assert(err.message.includes('Return to Depot'), `Expected returnToDepot guidance, got: ${err.message}`);
  }
  assert(rejected, 'FieldUnit lateral transfer to Depot must be rejected');
  console.log('  ok: Illegal FieldUnit transfer to Depot rejected with clear guidance');

  // 7. UNIT-ALPHA transfer to itself should be REJECTED
  console.log('[7/10] UNIT-ALPHA attempting lateral transfer to itself (must fail)...');
  rejected = false;
  try {
    await smartContracts.transferLot(ACTORS.unitAlpha, {
      lotID: TEST_LOT_ID,
      toId: 'UNIT-ALPHA'
    });
  } catch (err) {
    rejected = true;
  }
  assert(rejected, 'Self-transfer must be rejected');
  console.log('  ok: Self-transfer rejected');

  // 8. UNIT-ALPHA laterally transfers to peer UNIT-BRAVO
  console.log('[8/10] UNIT-ALPHA laterally transferring lot to peer UNIT-BRAVO...');
  const transferredUnit = await smartContracts.transferLot(ACTORS.unitAlpha, {
    lotID: TEST_LOT_ID,
    toId: 'UNIT-BRAVO'
  });
  assert.strictEqual(transferredUnit.currentHolderOrg, 'FieldUnit');
  assert.strictEqual(transferredUnit.currentHolderId, 'UNIT-BRAVO');
  console.log('  ok: Lateral transfer FieldUnit -> FieldUnit succeeded with updated holder');

  // 9. UNIT-BRAVO returns surplus lot to rear depot DEPOT-01
  console.log('[9/10] UNIT-BRAVO executing returnToDepot to DEPOT-01...');
  const returnedLot = await smartContracts.returnToDepot(ACTORS.unitBravo, {
    lotID: TEST_LOT_ID,
    toDepotId: 'DEPOT-01',
    reason: 'Combat Mission Concluded - Surplus Restocking'
  });
  assert.strictEqual(returnedLot.currentHolderOrg, 'Depot');
  assert.strictEqual(returnedLot.currentHolderId, 'DEPOT-01');
  assert.strictEqual(returnedLot.sourceDepotId, 'DEPOT-01');
  assert.strictEqual(returnedLot.status, 'IN_STORAGE');
  console.log('  ok: Return to Depot succeeded: custody now Depot/DEPOT-01, status IN_STORAGE');

  // Query verification from Depot viewpoint
  const depotView = await Lot.findOne({ lotID: TEST_LOT_ID, currentHolderOrg: 'Depot', currentHolderId: 'DEPOT-01' });
  assert(depotView, 'Lot MUST be visible in DEPOT-01 active inventory');
  console.log('  ok: Lot verified present in DEPOT-01 active inventory filter');

  // 10. Ledger chain and Merkle root verification
  console.log('[10/10] Verifying full cryptographic chain and Merkle proof integrity...');
  const chainValid = await Ledger.verifyChain();
  assert(chainValid, 'Ledger hash chain must be cryptographically valid');

  const merkleInfo = await merkleService.getLotMerkleRoot(TEST_LOT_ID);
  assert(merkleInfo.root, 'Lot must have a valid Merkle root');
  console.log(`  ok: Ledger chain valid. Merkle root: ${merkleInfo.root.slice(0, 16)}...`);

  // Cleanup test lot
  await Lot.deleteOne({ lotID: TEST_LOT_ID });
  await Block.deleteMany({ lotID: TEST_LOT_ID });

  console.log('\n--- ALL 10 CUSTODY & TRANSFER TESTS PASSED PERFECTLY! ---\n');
}

async function main() {
  await connectDB();
  try {
    await runCustodyTests();
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error('CUSTODY TEST FAILED:', err);
  process.exit(1);
});
