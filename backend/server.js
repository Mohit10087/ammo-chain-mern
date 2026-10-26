require('dotenv').config();
const express = require('express');
const cors = require('cors');

const connectDB = require('./config/db');
const errorHandler = require('./middleware/errorHandler');
const sensorSimulator = require('./services/sensorSimulator');

const authRoutes = require('./routes/authRoutes');
const lotRoutes = require('./routes/lotRoutes');
const requisitionRoutes = require('./routes/requisitionRoutes');
const degradationRoutes = require('./routes/degradationRoutes');
const forecastRoutes = require('./routes/forecastRoutes');
const anomalyRoutes = require('./routes/anomalyRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const syncRoutes = require('./routes/syncRoutes');

const app = express();

app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'ammo-chain-backend' }));

app.use('/api/auth', authRoutes);
app.use('/api/lots', lotRoutes);
app.use('/api/requisitions', requisitionRoutes);
app.use('/api/degradation', degradationRoutes);
app.use('/api/forecast', forecastRoutes);
app.use('/api/anomalies', anomalyRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/sync', syncRoutes);

const { authenticate } = require('./middleware/auth');
const merkle = require('./blockchain/merkle');

// POST /api/verify-proof - stateless Merkle proof verification
app.post('/api/verify-proof', authenticate, (req, res) => {
  const { leafHash, blockHash, proof, root } = req.body;
  if (!root || !Array.isArray(proof) || (!leafHash && !blockHash)) {
    return res.status(400).json({ error: 'leafHash (or blockHash), proof array, and root are required' });
  }

  const targetLeaf = leafHash || merkle.hashLeaf(blockHash);
  const startTime = process.hrtime.bigint();
  const valid = merkle.verifyProof(targetLeaf, proof, root);
  const elapsedNanos = Number(process.hrtime.bigint() - startTime);

  return res.json({
    valid,
    leafHash: targetLeaf,
    root,
    proofLength: proof.length,
    verificationTimeNanos: elapsedNanos,
    verificationTimeMicros: Math.round(elapsedNanos / 1000)
  });
});

app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

async function start() {
  await connectDB();
  app.listen(PORT, () => {
    console.log(`[server] ammo-chain backend listening on port ${PORT}`);
    sensorSimulator.start();
  });
}

start().catch((err) => {
  console.error('[server] failed to start:', err);
  process.exit(1);
});

module.exports = app;
