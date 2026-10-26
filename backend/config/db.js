const mongoose = require('mongoose');

async function connectDB() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI is not set - copy .env.example to .env and configure it');

  mongoose.set('strictQuery', true);
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
    console.log(`[db] connected to ${uri.replace(/\/\/.*@/, '//<credentials>@')}`);
  } catch (err) {
    console.error(`[db] Connection failed: ${err.message}`);
    if (err.message && (err.message.includes('whitelisted') || err.message.includes('Could not connect'))) {
      console.error('[db] ACTION REQUIRED: Add 0.0.0.0/0 (Allow Access from Anywhere) in MongoDB Atlas -> Security -> Network Access');
    }
    throw err;
  }
}

module.exports = connectDB;
