/**
 * merkleService.js
 * ----------------
 * Service bridging the pure cryptographic Merkle tree (blockchain/merkle.js)
 * to the MongoDB Ledger and Lot models.
 *
 * Responsibilities:
 * 1. Fetching lot history and constructing the Merkle tree.
 * 2. Anchoring MERKLE_CHECKPOINT blocks on the ledger periodically (every N events)
 *    and on demand.
 * 3. Extracting O(log n) inclusion proofs for specific blocks.
 */

const Block = require('../models/Block');
const Lot = require('../models/Lot');
const Ledger = require('../blockchain/Ledger');
const merkle = require('../blockchain/merkle');

const DEFAULT_CHECKPOINT_INTERVAL = Number(process.env.MERKLE_CHECKPOINT_INTERVAL || 5);

/**
 * Returns all state-transition blocks for a lot in chronological order,
 * excluding checkpoint blocks to avoid self-referential cycles.
 */
async function getLotDataBlocks(lotID) {
  return Block.find({
    lotID,
    txType: { $ne: 'MERKLE_CHECKPOINT' }
  }).sort({ index: 1 }).lean();
}

/**
 * Builds the MerkleTree instance for the given lot.
 */
async function getTreeForLot(lotID) {
  const blocks = await getLotDataBlocks(lotID);
  const hashes = blocks.map((b) => b.hash);
  const tree = merkle.buildTree(hashes);
  return { tree, blocks };
}

/**
 * Creates and appends an on-chain MERKLE_CHECKPOINT block anchoring the Merkle root.
 */
async function createCheckpoint(actor, lotID) {
  const { tree, blocks } = await getTreeForLot(lotID);
  if (blocks.length === 0) {
    throw new Error(`Cannot checkpoint lot ${lotID}: no transactions exist`);
  }

  const root = tree.getRoot();
  const leafCount = tree.getLeafCount();
  const startIndex = blocks[0].index;
  const endIndex = blocks[blocks.length - 1].index;

  const checkpointBlock = await Ledger.addBlock({
    txType: 'MERKLE_CHECKPOINT',
    lotID,
    payload: {
      root,
      leafCount,
      range: { startIndex, endIndex },
      anchoredAt: new Date().toISOString()
    },
    submittedByOrg: actor?.org || 'System',
    submittedByUser: actor?.username || 'merkle-anchorer'
  });

  // Update world-state document
  await Lot.updateOne(
    { lotID },
    {
      merkleRoot: root,
      merkleTreeSize: leafCount,
      merkleUpdatedAt: new Date()
    }
  );

  return { checkpointBlock, root, leafCount, range: { startIndex, endIndex } };
}

/**
 * Automatically creates a checkpoint if the number of events reaches the interval.
 */
async function maybeAutoCheckpoint(actor, lotID) {
  const { tree, blocks } = await getTreeForLot(lotID);
  const leafCount = tree.getLeafCount();
  const root = tree.getRoot();

  // Always update the world-state cached root
  await Lot.updateOne(
    { lotID },
    {
      merkleRoot: root,
      merkleTreeSize: leafCount,
      merkleUpdatedAt: new Date()
    }
  );

  if (DEFAULT_CHECKPOINT_INTERVAL > 0 && leafCount > 0 && leafCount % DEFAULT_CHECKPOINT_INTERVAL === 0) {
    return createCheckpoint(actor, lotID);
  }

  return null;
}

/**
 * Returns the current Merkle root and tree metadata for a lot.
 */
async function getLotMerkleRoot(lotID) {
  const lot = await Lot.findOne({ lotID }).lean();
  if (!lot) {
    throw new Error(`Lot ${lotID} not found`);
  }

  const { tree, blocks } = await getTreeForLot(lotID);
  const root = tree.getRoot();
  const lastCheckpoint = await Block.findOne({ lotID, txType: 'MERKLE_CHECKPOINT' })
    .sort({ index: -1 })
    .lean();

  return {
    lotID,
    root,
    persistedRoot: lot.merkleRoot,
    leafCount: tree.getLeafCount(),
    treeDepth: tree.getDepth(),
    isSynced: root === lot.merkleRoot,
    lastCheckpoint: lastCheckpoint
      ? {
          blockIndex: lastCheckpoint.index,
          anchoredRoot: lastCheckpoint.payload.root,
          anchoredAt: lastCheckpoint.timestamp,
          range: lastCheckpoint.payload.range
        }
      : null
  };
}

/**
 * Generates an inclusion proof for a block by its global index or relative index.
 */
async function getProofForBlock(lotID, blockIndex) {
  const { tree, blocks } = await getTreeForLot(lotID);
  if (blocks.length === 0) {
    throw new Error(`Lot ${lotID} has no ledger blocks`);
  }

  const targetIndex = Number(blockIndex);
  let leafIndex = blocks.findIndex((b) => b.index === targetIndex);
  if (leafIndex === -1 && targetIndex >= 0 && targetIndex < blocks.length) {
    leafIndex = targetIndex;
  }

  if (leafIndex === -1) {
    throw new Error(`Block #${blockIndex} not found in lot ${lotID} history`);
  }

  const block = blocks[leafIndex];
  const proof = tree.getProof(leafIndex);
  const root = tree.getRoot();
  const leafHash = merkle.hashLeaf(block.hash);
  const proofSizeBytes = proof.length * 32; // 32 bytes per SHA-256 sibling hash

  return {
    lotID,
    blockIndex: block.index,
    relativeLeafIndex: leafIndex,
    blockHash: block.hash,
    leafHash,
    root,
    proof,
    proofSizeBytes,
    leafCount: blocks.length,
    treeDepth: tree.getDepth()
  };
}

module.exports = {
  DEFAULT_CHECKPOINT_INTERVAL,
  getLotDataBlocks,
  getTreeForLot,
  createCheckpoint,
  maybeAutoCheckpoint,
  getLotMerkleRoot,
  getProofForBlock
};
