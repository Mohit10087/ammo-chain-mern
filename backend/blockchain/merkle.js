/**
 * merkle.js
 * ---------
 * Pure, self-contained binary Merkle Tree implementation with domain separation
 * for per-lot block auditability (Innovation A).
 *
 * CRYPTOGRAPHIC SPECIFICATION & DOMAIN SEPARATION:
 * 1. Domain Separation (RFC 6962 standard):
 *    - Leaf Hash:          H(0x00 || blockHash)
 *    - Internal Node Hash: H(0x01 || leftChildHash || rightChildHash)
 *    Prevents second-preimage attacks where an internal node could be substituted
 *    for a leaf or vice versa.
 *
 * 2. Odd Node Promotion:
 *    When a level contains an odd number of nodes, the lone rightmost node is
 *    promoted directly to the next level without hashing. This avoids the duplicate-leaf
 *    vulnerability present in naive implementations (e.g., CVE-2012-2459 in Bitcoin).
 *
 * 3. Pure Functions:
 *    Contains no direct database access. Functions take hash arrays or proof structures
 *    and operate deterministically.
 */

const crypto = require('crypto');

const PREFIX_LEAF = Buffer.from([0x00]);
const PREFIX_INTERNAL = Buffer.from([0x01]);

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest();
}

function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Computes a leaf hash from a block hash with 0x00 domain separation prefix.
 * @param {string|Buffer} blockHash - 64-char hex string or Buffer
 * @returns {string} 64-char hex leaf hash
 */
function hashLeaf(blockHash) {
  let hashBuf;
  if (Buffer.isBuffer(blockHash)) {
    hashBuf = blockHash;
  } else if (typeof blockHash === 'string' && /^[0-9a-fA-F]{64}$/.test(blockHash)) {
    hashBuf = Buffer.from(blockHash, 'hex');
  } else {
    hashBuf = Buffer.from(String(blockHash), 'utf8');
  }
  return sha256Hex(Buffer.concat([PREFIX_LEAF, hashBuf]));
}

/**
 * Computes an internal node hash from left and right child hashes with 0x01 prefix.
 * @param {string} leftHex - 64-char hex
 * @param {string} rightHex - 64-char hex
 * @returns {string} 64-char hex parent hash
 */
function hashInternal(leftHex, rightHex) {
  const leftBuf = Buffer.from(leftHex, 'hex');
  const rightBuf = Buffer.from(rightHex, 'hex');
  return sha256Hex(Buffer.concat([PREFIX_INTERNAL, leftBuf, rightBuf]));
}

class MerkleTree {
  /**
   * @param {string[]} blockHashes - Array of block hashes in chronological order
   */
  constructor(blockHashes = []) {
    this.rawHashes = [...blockHashes];
    this.layers = [];
    this.root = null;
    if (this.rawHashes.length > 0) {
      this._buildTree();
    }
  }

  _buildTree() {
    if (this.rawHashes.length === 0) {
      this.layers = [];
      this.root = null;
      return;
    }

    // Layer 0: Leaf hashes with 0x00 domain separation prefix
    const leaves = this.rawHashes.map((h) => hashLeaf(h));
    this.layers = [leaves];

    let currentLayer = leaves;

    while (currentLayer.length > 1) {
      const nextLayer = [];
      for (let i = 0; i < currentLayer.length; i += 2) {
        if (i + 1 < currentLayer.length) {
          // Standard pair: hashInternal(0x01 || left || right)
          nextLayer.push(hashInternal(currentLayer[i], currentLayer[i + 1]));
        } else {
          // Odd node count: promote unpaired node directly to next layer
          // Documented choice: RFC 6962 / Ethereum style odd-node promotion
          nextLayer.push(currentLayer[i]);
        }
      }
      this.layers.push(nextLayer);
      currentLayer = nextLayer;
    }

    this.root = currentLayer[0];
  }

  /**
   * Returns the Merkle root hash (64-char hex).
   */
  getRoot() {
    return this.root;
  }

  /**
   * Returns leaf count of the tree.
   */
  getLeafCount() {
    return this.rawHashes.length;
  }

  /**
   * Returns depth/height of the tree (number of layers).
   */
  getDepth() {
    return this.layers.length;
  }

  /**
   * Generates an audit inclusion proof for the leaf at index.
   * @param {number} index - 0-based leaf index
   * @returns {Array<{ hash: string, position: 'left'|'right' }>}
   */
  getProof(index) {
    if (index < 0 || index >= this.rawHashes.length) {
      throw new Error(`Leaf index ${index} out of bounds (tree size: ${this.rawHashes.length})`);
    }

    const proof = [];
    let currentIndex = index;

    for (let l = 0; l < this.layers.length - 1; l++) {
      const layer = this.layers[l];
      const isRight = currentIndex % 2 === 1;
      const siblingIndex = isRight ? currentIndex - 1 : currentIndex + 1;

      if (siblingIndex < layer.length) {
        // Sibling exists
        proof.push({
          hash: layer[siblingIndex],
          position: isRight ? 'left' : 'right'
        });
      } else {
        // Unpaired node was promoted; no sibling at this level
      }

      currentIndex = Math.floor(currentIndex / 2);
    }

    return proof;
  }
}

/**
 * Builds a Merkle tree from an array of block hashes.
 * @param {string[]} blockHashes
 * @returns {MerkleTree}
 */
function buildTree(blockHashes) {
  return new MerkleTree(blockHashes);
}

/**
 * Pure verification function: evaluates whether leafHash + proof leads to root.
 * No database access.
 *
 * @param {string} leafHash - Hash of leaf (already with 0x00 prefix or computed via hashLeaf)
 * @param {Array<{ hash: string, position: 'left'|'right' }>} proof
 * @param {string} root - Expected 64-char hex Merkle root
 * @returns {boolean}
 */
function verifyProof(leafHash, proof, root) {
  if (!leafHash || !root || !Array.isArray(proof)) return false;

  let current = leafHash;
  for (const step of proof) {
    if (step.position === 'left') {
      current = hashInternal(step.hash, current);
    } else if (step.position === 'right') {
      current = hashInternal(current, step.hash);
    } else {
      return false;
    }
  }

  return current.toLowerCase() === root.toLowerCase();
}

/**
 * Helper to verify directly from original blockHash.
 */
function verifyBlockProof(blockHash, proof, root) {
  const leaf = hashLeaf(blockHash);
  return verifyProof(leaf, proof, root);
}

module.exports = {
  MerkleTree,
  buildTree,
  hashLeaf,
  hashInternal,
  verifyProof,
  verifyBlockProof
};
