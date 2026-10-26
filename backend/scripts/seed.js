require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const { seedAll, DEMO_PASSWORD } = require('../utils/seedData');

async function main() {
  await connectDB();
  console.log('[seed] generating demo users, lots, ledger history and 12 months of consumption data...');
  const result = await seedAll();
  console.log('[seed] done. Demo accounts (all share one password):');
  console.log(`[seed]   password: ${DEMO_PASSWORD}`);
  for (const username of result.users) console.log(`[seed]   username: ${username}`);
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('[seed] failed:', err);
  process.exit(1);
});
