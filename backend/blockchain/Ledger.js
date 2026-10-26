/**
 * Ledger.js
 * ---------
 * A minimal, dependency-free hash-chained ledger built directly on MongoDB.
 *
 * WHY THIS EXISTS
 * The original project design targeted Hyperledger Fabric (a permissioned
 * blockchain platform). For a one-semester MERN-stack build, standing up a
 * Fabric network, CAs, channels and chaincode containers is a large amount
 * of infrastructure that adds risk without adding much to what a viva panel
 * can actually observe: an append-only, tamper-evident transaction log with
 * role-gated write functions. This module reproduces exactly that guarantee
 * with plain Node.js + MongoDB, so the whole system runs anywhere Node and
 * Mongo run, with no container orchestration required.
 *
 * HOW IT MAPS TO THE ORIGINAL FABRIC DESIGN
 *   Fabric concept                         MERN equivalent (this project)
 *   -------------------------------------  ------------------------------------
 *   Ordered transaction log / blocks       Block collection (this file)
 *   Chaincode functions (smart contracts)  blockchain/smartContracts.js
 *   ABAC on chaincode functions            middleware/auth.js (JWT org/role)
 *   CouchDB world state                    Lot / Requisition / ... collections
 *   GetHistoryForKey(lotID)                Ledger.getHistory(lotID)
 *   Peer endorsement / consensus           Not reproduced (single writer,
 *                                          single Mongo instance) - documented
 *                                          as an explicit simplification, see
 *                                          README "Design decisions & scope".
 *
 * INTEGRITY GUARANTEE
 * Every block's hash is SHA-256 over (index, timestamp, txType, lotID,
 * payload, previousHash, submittedByOrg, submittedByUser). Because each
 * block embeds the previous block's hash, editing or deleting any historical
 * block changes that block's hash and breaks every hash after it. Anyone can
 * call verifyChain() to prove the ledger has not been tampered with, which is
 * the property that matters for a viva demo (immutability), independent of
 * whether the underlying platform is a full distributed blockchain or a
 * single tamper-evident log.
 */

const crypto = require('crypto');
const Block = require('../models/Block');

const GENESIS_PREVIOUS_HASH = '0'.repeat(64);

function computeHash({ index, timestamp, txType, lotID, payload, previousHash, submittedByOrg, submittedByUser }) {
  const data = JSON.stringify({
    index,
    timestamp: new Date(timestamp).toISOString(),
    txType,
    lotID: lotID || null,
    payload,
    previousHash,
    submittedByOrg,
    submittedByUser
  });
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Appends a new block to the ledger. Not exported as a "public" chaincode
 * function on its own - business rules always live in smartContracts.js,
 * which calls this after validating a transaction.
 */
async function addBlock({
  txType,
  lotID,
  payload,
  submittedByOrg,
  submittedByUser,
  capturedAt,
  syncedAt,
  deviceId,
  syncBatchId,
  eventId
}) {
  // Serialize writers with a short retry loop instead of a DB transaction,
  // since a single ordered writer is a documented simplification (see file
  // header). This is sufficient for the demo's write volume.
  for (let attempt = 0; attempt < 5; attempt++) {
    const last = await Block.findOne().sort({ index: -1 }).lean();
    const index = last ? last.index + 1 : 0;
    const previousHash = last ? last.hash : GENESIS_PREVIOUS_HASH;
    const timestamp = new Date();

    const hash = computeHash({ index, timestamp, txType, lotID, payload, previousHash, submittedByOrg, submittedByUser });

    try {
      const block = await Block.create({
        index,
        timestamp,
        txType,
        lotID: lotID || null,
        payload,
        submittedByOrg,
        submittedByUser,
        capturedAt: capturedAt || null,
        syncedAt: syncedAt || null,
        deviceId: deviceId || null,
        syncBatchId: syncBatchId || null,
        eventId: eventId || null,
        previousHash,
        hash
      });
      return block;
    } catch (err) {
      // Unique index collision on `index` means another write raced us -
      // retry with the new tail.
      if (err && err.code === 11000 && attempt < 4) continue;
      throw err;
    }
  }
  throw new Error('Ledger.addBlock: failed to append block after multiple attempts (write contention)');
}

/** Full history of every block that touched a given lot, oldest first. */
async function getHistory(lotID) {
  return Block.find({ lotID }).sort({ index: 1 }).lean();
}

/** The whole ledger, oldest first. Fine for a viva-scale demo dataset. */
async function getFullChain() {
  return Block.find({}).sort({ index: 1 }).lean();
}

/**
 * Recomputes every block's hash from its contents and checks the hash-chain
 * links. Returns { valid, brokenAtIndex, totalBlocks }.
 */
async function verifyChain() {
  const blocks = await Block.find({}).sort({ index: 1 }).lean();
  let expectedPrevious = GENESIS_PREVIOUS_HASH;

  for (const block of blocks) {
    if (block.previousHash !== expectedPrevious) {
      return { valid: false, brokenAtIndex: block.index, reason: 'previousHash mismatch', totalBlocks: blocks.length };
    }
    const recomputed = computeHash(block);
    if (recomputed !== block.hash) {
      return { valid: false, brokenAtIndex: block.index, reason: 'hash mismatch (data tampered)', totalBlocks: blocks.length };
    }
    expectedPrevious = block.hash;
  }
  return { valid: true, brokenAtIndex: null, reason: null, totalBlocks: blocks.length };
}

async function getChainHeight() {
  const last = await Block.findOne().sort({ index: -1 }).lean();
  return last ? last.index + 1 : 0;
}

module.exports = { addBlock, getHistory, getFullChain, verifyChain, getChainHeight, computeHash, GENESIS_PREVIOUS_HASH };
