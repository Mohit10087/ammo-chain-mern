const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

function signToken(user) {
  return jwt.sign(
    { id: user._id, username: user.username, org: user.org, displayName: user.displayName, depotId: user.depotId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );
}

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'username and password are required' });

    const user = await User.findOne({ username });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    const token = signToken(user);
    res.json({ token, user: user.toSafeJSON() });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/me - returns the current actor, useful for the frontend on refresh
router.get('/me', authenticate, (req, res) => {
  res.json({ actor: req.actor });
});

// POST /api/auth/register - only used by the seed script / an existing Commander,
// exposed here so a demo admin can create additional accounts without touching Mongo directly.
router.post('/register', authenticate, async (req, res, next) => {
  try {
    if (req.actor.org !== 'Commander') {
      return res.status(403).json({ error: 'Only a Commander account may create new users in this demo' });
    }
    const { username, password, org, displayName, depotId } = req.body;
    if (!username || !password || !org || !displayName) {
      return res.status(400).json({ error: 'username, password, org and displayName are required' });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ username, passwordHash, org, displayName, depotId: depotId || null });
    res.status(201).json({ user: user.toSafeJSON() });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Username already exists' });
    next(err);
  }
});

module.exports = router;
