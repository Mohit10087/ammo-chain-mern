/**
 * benchMerkle.js
 * --------------
 * Rigorous benchmark evaluating linear full-chain verification O(n)
 * versus Merkle inclusion proof verification O(log n).
 *
 * Measures:
 * - History sizes: N in [10, 100, 1,000, 10,000, 100,000]
 * - Median of N runs (using process.hrtime.bigint())
 * - Proof size in bytes
 * - Real speedup factor
 * - Outputs docs/results/merkle_benchmark.csv and two PNG charts via Python matplotlib
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const merkle = require('../blockchain/merkle');

const SIZES = [10, 100, 1000, 10000, 100000];
const NUM_RUNS = 25;

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function median(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function generateChain(n) {
  const blocks = new Array(n);
  let prevHash = '0'.repeat(64);

  for (let i = 0; i < n; i++) {
    const payload = `tx-payload-${i}`;
    const hash = sha256(`${i}:${prevHash}:${payload}`);
    blocks[i] = { index: i, prevHash, hash, payload };
    prevHash = hash;
  }

  return blocks;
}

function verifyLinearChain(blocks, targetIndex) {
  // Verifying linear link integrity up to the target block
  let expectedPrev = '0'.repeat(64);
  for (let i = 0; i <= targetIndex; i++) {
    const b = blocks[i];
    if (b.prevHash !== expectedPrev) return false;
    const computed = sha256(`${b.index}:${b.prevHash}:${b.payload}`);
    if (computed !== b.hash) return false;
    expectedPrev = b.hash;
  }
  return true;
}

async function runBenchmark() {
  console.log('Starting Merkle vs Linear Chain Verification Benchmark...\n');
  const results = [];

  for (const n of SIZES) {
    process.stdout.write(`Benchmarking N = ${n.toLocaleString()} blocks... `);
    const blocks = generateChain(n);
    const hashes = blocks.map((b) => b.hash);

    // Build Merkle Tree
    const tree = merkle.buildTree(hashes);
    const root = tree.getRoot();

    // Target block is the last or midpoint block (typical viva audit scenario)
    const targetIndex = n - 1;
    const proof = tree.getProof(targetIndex);
    const targetLeaf = merkle.hashLeaf(blocks[targetIndex].hash);
    const proofSizeBytes = proof.length * 32;
    const theoreticalMaxBytes = 32 * Math.ceil(Math.log2(n));

    // Linear Verification Timing (median of runs)
    const runsForThisSize = n >= 100000 ? 7 : NUM_RUNS;
    const linearTimesMicros = [];
    for (let r = 0; r < runsForThisSize; r++) {
      const t0 = process.hrtime.bigint();
      const validLinear = verifyLinearChain(blocks, targetIndex);
      const elapsedNanos = Number(process.hrtime.bigint() - t0);
      if (!validLinear) throw new Error('Linear chain failed verification');
      linearTimesMicros.push(elapsedNanos / 1000);
    }

    // Merkle Verification Timing (median of runs)
    const merkleTimesMicros = [];
    for (let r = 0; r < runsForThisSize; r++) {
      const t0 = process.hrtime.bigint();
      const validMerkle = merkle.verifyProof(targetLeaf, proof, root);
      const elapsedNanos = Number(process.hrtime.bigint() - t0);
      if (!validMerkle) throw new Error('Merkle proof failed verification');
      merkleTimesMicros.push(elapsedNanos / 1000);
    }

    const medLinear = Math.round(median(linearTimesMicros) * 100) / 100;
    const medMerkle = Math.round(median(merkleTimesMicros) * 100) / 100;
    const speedup = Math.round((medLinear / Math.max(0.001, medMerkle)) * 10) / 10;

    results.push({
      history_size_n: n,
      linear_time_us: medLinear,
      merkle_time_us: medMerkle,
      speedup_factor: speedup,
      proof_size_bytes: proofSizeBytes,
      theoretical_max_bytes: theoreticalMaxBytes,
      proof_steps: proof.length
    });

    console.log(
      `Done. Linear: ${medLinear} µs | Merkle: ${medMerkle} µs | Speedup: ${speedup}x | Proof: ${proofSizeBytes} B`
    );
  }

  // Ensure output directory exists
  const resultsDir = path.resolve(__dirname, '../../docs/results');
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }

  // Write CSV
  const csvPath = path.join(resultsDir, 'merkle_benchmark.csv');
  const csvHeader = 'history_size_n,linear_time_us,merkle_time_us,speedup_factor,proof_size_bytes,theoretical_max_bytes,proof_steps\n';
  const csvRows = results
    .map(
      (r) =>
        `${r.history_size_n},${r.linear_time_us},${r.merkle_time_us},${r.speedup_factor},${r.proof_size_bytes},${r.theoretical_max_bytes},${r.proof_steps}`
    )
    .join('\n');
  fs.writeFileSync(csvPath, csvHeader + csvRows + '\n');
  console.log(`\nSaved benchmark data to ${csvPath}`);

  // Generate Charts using Python Matplotlib
  generateCharts(resultsDir, csvPath);
}

function generateCharts(resultsDir, csvPath) {
  console.log('\nGenerating high-resolution benchmark plots (200 DPI)...');

  const pythonScript = `
import pandas as pd
import matplotlib.pyplot as plt
import numpy as np

df = pd.read_csv('${csvPath}')

plt.style.use('seaborn-v0_8-whitegrid' if 'seaborn-v0_8-whitegrid' in plt.style.available else 'default')

# 1. Verification Time vs History Size (Log-Log)
plt.figure(figsize=(8, 5), dpi=200)
plt.loglog(df['history_size_n'], df['linear_time_us'], marker='o', linewidth=2.2, color='#c14a3a', label='Linear Full-Chain O(n)')
plt.loglog(df['history_size_n'], df['merkle_time_us'], marker='s', linewidth=2.2, color='#2e7d32', label='Merkle Proof O(log n)')

for i, row in df.iterrows():
    plt.annotate(f"{row['speedup_factor']:.0f}x", 
                 (row['history_size_n'], row['merkle_time_us']),
                 textcoords="offset points", xytext=(0,-15), ha='center', fontsize=9, fontweight='bold', color='#1b5e20')

plt.title('Verification Time vs. Lot History Size (Linear vs. Merkle)', fontsize=13, fontweight='bold', pad=12)
plt.xlabel('Lot History Size (Blocks, N)', fontsize=11, labelpad=8)
plt.ylabel('Verification Latency (µs, log scale)', fontsize=11, labelpad=8)
plt.grid(True, which="both", ls="--", alpha=0.5)
plt.legend(frameon=True, fontsize=10, loc='upper left')
plt.tight_layout()
chart1_path = '${path.join(resultsDir, 'fig_merkle_verification_time.png')}'
plt.savefig(chart1_path)
plt.close()

# 2. Proof Payload Size vs History Size
plt.figure(figsize=(8, 5), dpi=200)
plt.plot(df['history_size_n'], df['proof_size_bytes'], marker='^', linewidth=2.2, color='#1976d2', label='Measured Proof Size')
plt.plot(df['history_size_n'], df['theoretical_max_bytes'], linestyle='--', linewidth=1.8, color='#888', label='Theoretical Upper Bound (32*ceil(log2 N))')

plt.xscale('log')
for i, row in df.iterrows():
    plt.annotate(f"{int(row['proof_size_bytes'])} B", 
                 (row['history_size_n'], row['proof_size_bytes']),
                 textcoords="offset points", xytext=(0,8), ha='center', fontsize=9, fontweight='bold', color='#0d47a1')

plt.title('Merkle Inclusion Proof Size vs. History Size', fontsize=13, fontweight='bold', pad=12)
plt.xlabel('Lot History Size (Blocks, N)', fontsize=11, labelpad=8)
plt.ylabel('Proof Payload Size (Bytes)', fontsize=11, labelpad=8)
plt.grid(True, which="both", ls="--", alpha=0.5)
plt.legend(frameon=True, fontsize=10, loc='upper left')
plt.tight_layout()
chart2_path = '${path.join(resultsDir, 'fig_merkle_proof_size.png')}'
plt.savefig(chart2_path)
plt.close()

print('Charts rendered successfully:')
print('  -', chart1_path)
print('  -', chart2_path)
`;

  const pyRes = spawnSync('python3', ['-c', pythonScript], { encoding: 'utf8' });
  if (pyRes.error || pyRes.status !== 0) {
    console.error('Failed to run chart plotting script:', pyRes.stderr || pyRes.error);
  } else {
    console.log(pyRes.stdout);
  }
}

runBenchmark().catch((err) => {
  console.error('Fatal benchmark error:', err);
  process.exit(1);
});
