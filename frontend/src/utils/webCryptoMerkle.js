/**
 * webCryptoMerkle.js
 * -------------------
 * Pure in-browser cryptographic Merkle proof verifier using native Web Crypto API.
 * Domain separation:
 *   - Leaf:     SHA-256( 0x00 || blockHash )
 *   - Internal: SHA-256( 0x01 || left || right )
 */

function hexToBytes(hex) {
  const clean = hex.trim();
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    bytes[i / 2] = parseInt(clean.substring(i, i + 2), 16);
  }
  return bytes;
}

function bytesToHex(buffer) {
  const bytes = new Uint8Array(buffer);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Computes leaf hash in browser: SHA-256( 0x00 || blockHash )
 */
export async function computeLeafHashBrowser(blockHash) {
  const hashBytes = hexToBytes(blockHash);
  const data = new Uint8Array(1 + hashBytes.length);
  data[0] = 0x00; // 0x00 domain prefix for leaf
  data.set(hashBytes, 1);

  const digest = await window.crypto.subtle.digest('SHA-256', data);
  return bytesToHex(digest);
}

/**
 * Computes internal node hash: SHA-256( 0x01 || left || right )
 */
export async function computeInternalHashBrowser(leftHex, rightHex) {
  const leftBytes = hexToBytes(leftHex);
  const rightBytes = hexToBytes(rightHex);
  const data = new Uint8Array(1 + leftBytes.length + rightBytes.length);
  data[0] = 0x01; // 0x01 domain prefix for internal node
  data.set(leftBytes, 1);
  data.set(rightBytes, 1 + leftBytes.length);

  const digest = await window.crypto.subtle.digest('SHA-256', data);
  return bytesToHex(digest);
}

/**
 * Verifies a Merkle proof entirely in browser using Web Crypto API in O(log n) time.
 * @param {string} blockHash - The block's SHA-256 hash
 * @param {Array<{ hash: string, position: 'left'|'right' }>} proof - Sibling path
 * @param {string} expectedRoot - Stored lot Merkle root
 * @returns {Promise<{ valid: boolean, computedRoot: string, steps: Array, durationMs: number }>}
 */
export async function verifyProofInBrowser(blockHash, proof, expectedRoot) {
  const t0 = performance.now();
  let current = await computeLeafHashBrowser(blockHash);
  const steps = [{ step: 0, label: 'Leaf Hash', hash: current }];

  for (let i = 0; i < proof.length; i++) {
    const p = proof[i];
    if (p.position === 'left') {
      current = await computeInternalHashBrowser(p.hash, current);
      steps.push({
        step: i + 1,
        label: `Parent ${i + 1} (sibling on left)`,
        sibling: p.hash,
        position: 'left',
        resultHash: current
      });
    } else if (p.position === 'right') {
      current = await computeInternalHashBrowser(current, p.hash);
      steps.push({
        step: i + 1,
        label: `Parent ${i + 1} (sibling on right)`,
        sibling: p.hash,
        position: 'right',
        resultHash: current
      });
    }
  }

  const durationMs = performance.now() - t0;
  const valid = current.toLowerCase() === expectedRoot.toLowerCase();

  return {
    valid,
    computedRoot: current,
    expectedRoot,
    steps,
    durationMs: Math.round(durationMs * 100) / 100
  };
}
