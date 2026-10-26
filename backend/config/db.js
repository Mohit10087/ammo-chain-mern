const mongoose = require('mongoose');

async function connectDB() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI is not set - copy .env.example to .env and configure it');

  mongoose.set('strictQuery', true);
  await mongoose.connect(uri);
  console.log(`[db] connected to ${uri.replace(/\/\/.*@/, '//<credentials>@')}`);
}

module.exports = connectDB;
