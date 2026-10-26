/**
 * testMerkle.js
 * -------------
 * Comprehensive test suite for Phase 1: Per-Lot Merkle Tree Audit Layer.
 * Tests:
 * 1. Unit tests: single leaf, even leaf counts, odd leaf counts, promotion logic.
 * 2. Proof verification: correct proofs verify, tampered leaf fails, tampered proof step fails.
 * 3. Database integration & tamper test:
 *    - Validates linear chain and Merkle root against a live MongoDB test lot.
 *    - Injects a direct database tamper (modifying block payload in MongoDB).
 *    - Proves that (a) full chain verification fails, and (b) Merkle proof verification fails.
 */

require('dotenv').config();
const crypto = require('crypto');
const mongoose = require('mongoose');
const merkle = require('../blockchain/merkle');
const Ledger = require('../blockchain/Ledger');
const Block = require('../models/Block');
const Lot = require('../models/Lot');
const merkleService = require('../services/merkleService');
const connectDB = require('../config/db');

function assert(condition, message) {
  if (!condition) {
    console.error(`  FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`  ✓ ${message}`);
}

async function runUnitTests() {
  console.log('\n--- 1. PURE MERKLE TREE UNIT TESTS ---');

  // Test 1: Empty tree
  const emptyTree = merkle.buildTree([]);
  assert(emptyTree.getRoot() === null, 'Empty tree returns null root');

  // Test 2: Single leaf
  const singleHash = crypto.createHash('sha256').update('block-0').digest('hex');
  const tree1 = merkle.buildTree([singleHash]);
  const leaf1 = merkle.hashLeaf(singleHash);
  assert(tree1.getRoot() === leaf1, 'Single-leaf tree root equals hashLeaf(blockHash)');
  assert(tree1.getProof(0).length === 0, 'Single-leaf tree proof has 0 steps');
  assert(merkle.verifyBlockProof(singleHash, [], tree1.getRoot()) === true, 'Single-leaf proof verifies cleanly');

  // Test 3: Even leaf count (4 leaves)
  const hashes4 = [0, 1, 2, 3].map((i) => crypto.createHash('sha256').update(`block-${i}`).digest('hex'));
  const tree4 = merkle.buildTree(hashes4);
  assert(tree4.getDepth() === 3, '4-leaf tree has depth 3 (leaves, pairs, root)');
  for (let i = 0; i < 4; i++) {
    const proof = tree4.getProof(i);
    assert(proof.length === 2, `Leaf ${i} has proof length 2`);
    assert(merkle.verifyBlockProof(hashes4[i], proof, tree4.getRoot()) === true, `Leaf ${i} proof verifies`);
    // Tamper test: flipped leaf
    const tamperedHash = crypto.createHash('sha256').update(`tampered-${i}`).digest('hex');
    assert(merkle.verifyBlockProof(tamperedHash, proof, tree4.getRoot()) === false, `Tampered leaf ${i} fails verification`);
  }

  // Test 4: Odd leaf count (3 leaves - odd promotion test)
  const hashes3 = [0, 1, 2].map((i) => crypto.createHash('sha256').update(`block-${i}`).digest('hex'));
  const tree3 = merkle.buildTree(hashes3);
  // Layer 0: [L0, L1, L2]
  // Layer 1: [Parent(L0, L1), L2 (promoted)]
  // Layer 2: Parent(P(L0, L1), L2) -> Root
  assert(tree3.getDepth() === 3, '3-leaf tree has depth 3 with odd-node promotion');
  for (let i = 0; i < 3; i++) {
    const proof = tree3.getProof(i);
    assert(merkle.verifyBlockProof(hashes3[i], proof, tree3.getRoot()) === true, `Odd-tree leaf ${i} proof verifies`);
  }

  // Test 5: Odd leaf count (5 leaves)
  const hashes5 = [0, 1, 2, 3, 4].map((i) => crypto.createHash('sha256').update(`block-${i}`).digest('hex'));
  const tree5 = merkle.buildTree(hashes5);
  for (let i = 0; i < 5; i++) {
    const proof = tree5.getProof(i);
    assert(merkle.verifyBlockProof(hashes5[i], proof, tree5.getRoot()) === true, `5-leaf tree leaf ${i} proof verifies`);
  }

  // Test 6: Tampering with a sibling in proof path
  const proof0 = tree4.getProof(0);
  const corruptedProof = proof0.map((step, idx) => (idx === 0 ? { ...step, hash: 'a'.repeat(64) } : step));
  assert(merkle.verifyBlockProof(hashes4[0], corruptedProof, tree4.getRoot()) === false, 'Corrupted proof step fails verification');
}

async function runTamperTest() {
  console.log('\n--- 2. MONGODB INTEGRATION & DIRECT TAMPER TEST ---');
  await connectDB();

  const testLotID = `TEST-LOT-TAMPER-${Date.now()}`;
  console.log(`Setting up test lot: ${testLotID}...`);

  // Create lot
  const lot = await Lot.create({
    lotID: testLotID,
    ammoType: '7.62x51mm',
    caliber: '7.62mm NATO',
    quantity: 1000,
    manufactureDate: new Date(),
    currentHolderOrg: 'OrdnanceFactory',
    currentHolderId: 'ORDNANCE-FACTORY',
    status: 'REGISTERED'
  });

  // Append 4 blocks
  const blocks = [];
  blocks.push(
    await Ledger.addBlock({
      txType: 'REGISTER_LOT',
      lotID: testLotID,
      payload: { quantity: 1000 },
      submittedByOrg: 'OrdnanceFactory',
      submittedByUser: 'factory_officer'
    })
  );

  blocks.push(
    await Ledger.addBlock({
      txType: 'ISSUE_LOT',
      lotID: testLotID,
      payload: { toOrg: 'Depot', toId: 'DEPOT-01', quantity: 1000 },
      submittedByOrg: 'OrdnanceFactory',
      submittedByUser: 'factory_officer'
    })
  );

  blocks.push(
    await Ledger.addBlock({
      txType: 'UPDATE_STORAGE_CONDITION',
      lotID: testLotID,
      payload: { temperatureC: 22.5, humidityPct: 45.0, riskScore: 12 },
      submittedByOrg: 'Depot',
      submittedByUser: 'depot1_officer'
    })
  );

  blocks.push(
    await Ledger.addBlock({
      txType: 'TRANSFER_LOT',
      lotID: testLotID,
      payload: { toId: 'DEPOT-02', quantity: 1000 },
      submittedByOrg: 'Depot',
      submittedByUser: 'depot1_officer'
    })
  );

  // Checkpoint Merkle Root
  const checkpoint = await merkleService.createCheckpoint({ org: 'Depot', username: 'depot1_officer' }, testLotID);
  console.log(`Anchored Merkle Root: ${checkpoint.root}`);

  // 1. Verify before tamper
  const initialChainVerify = await Ledger.verifyChain();
  assert(initialChainVerify.valid === true, 'Baseline linear blockchain verifies clean');

  const blockDoc = blocks[1];
  const blockToTamper = blockDoc.toObject ? blockDoc.toObject() : blockDoc;
  const proofBefore = await merkleService.getProofForBlock(testLotID, blockToTamper.index);
  const verifiedBefore = merkle.verifyProof(proofBefore.leafHash, proofBefore.proof, checkpoint.root);
  assert(verifiedBefore === true, `Pre-tamper Merkle proof for Block #${blockToTamper.index} verifies valid`);

  // 2. Perform direct MongoDB tamper (bypass Ledger API)
  console.log(`\nInjecting direct MongoDB tamper on Block #${blockToTamper.index}...`);
  const tamperedPayload = { ...blockToTamper.payload, quantity: 999999, toId: 'ROGUE_ACTOR' };
  const tamperedBlockHash = Ledger.computeHash({
    index: blockToTamper.index,
    timestamp: blockToTamper.timestamp,
    txType: blockToTamper.txType,
    lotID: blockToTamper.lotID,
    payload: tamperedPayload,
    previousHash: blockToTamper.previousHash,
    submittedByOrg: blockToTamper.submittedByOrg,
    submittedByUser: blockToTamper.submittedByUser
  });

  // Attacker alters payload and attempts to fix the block's hash in DB
  await Block.updateOne(
    { _id: blockToTamper._id },
    { $set: { payload: tamperedPayload, hash: tamperedBlockHash } }
  );

  try {
    // 3. Test (a): Full chain verification MUST fail (previousHash mismatch on subsequent block)
    const chainVerifyAfter = await Ledger.verifyChain();
    assert(chainVerifyAfter.valid === false, 'Tamper detected: Full linear chain verification FAILED as expected');
    assert(
      chainVerifyAfter.brokenAtIndex === blockToTamper.index + 1 || chainVerifyAfter.brokenAtIndex === blockToTamper.index,
      `Tamper detected at broken chain link: #${chainVerifyAfter.brokenAtIndex}`
    );

    // 4. Test (b): Merkle proof verification for the tampered block MUST fail against anchored root
    const tamperedDoc = await Block.findById(blockToTamper._id).lean();
    const tamperedLeaf = merkle.hashLeaf(tamperedDoc.hash);
    const tamperedProofVerify = merkle.verifyProof(tamperedLeaf, proofBefore.proof, checkpoint.root);
    assert(tamperedProofVerify === false, 'Tamper detected: Merkle proof verification FAILED against anchored root');
  } finally {
    // 5. Cleanup test data
    console.log('\nCleaning up test artifacts in MongoDB...');
    await Block.deleteMany({ lotID: testLotID });
    await Lot.deleteOne({ lotID: testLotID });

    // Re-verify chain is restored
    const finalChainVerify = await Ledger.verifyChain();
    assert(finalChainVerify.valid === true, 'Ledger chain integrity cleanly restored after test cleanup');
  }

  console.log('\nAll Merkle unit and tamper tests passed successfully!\n');
  await mongoose.disconnect();
}

async function main() {
  try {
    await runUnitTests();
    await runTamperTest();
  } catch (err) {
    console.error('Fatal error during testMerkle:', err);
    process.exit(1);
  }
}

main();
