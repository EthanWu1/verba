'use strict';
const express = require('express');
const router = express.Router();
const auth = require('../services/auth');

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: 30 * 24 * 60 * 60 * 1000,
};

function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, tier: u.tier };
}

router.post('/signup', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const name = req.body?.name ? String(req.body.name).trim() : null;
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  if (password.length < 8) return res.status(400).json({ error: 'password must be at least 8 characters' });
  try {
    const user = await auth.createUser({ email, password, name });
    const sid = auth.createSession(user.id);
    res.cookie('verba.sid', sid, COOKIE_OPTS);
    res.status(201).json({ user: publicUser(user) });
  } catch (err) {
    if (String(err.message).includes('already registered')) return res.status(409).json({ error: 'email already registered' });
    res.status(400).json({ error: err.message });
  }
});

router.post('/login', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  const user = auth.findUserByEmail(email);
  const ok = user ? await auth.verifyPassword(user, password) : false;
  if (!ok) return res.status(401).json({ error: 'invalid credentials' });
  const sid = auth.createSession(user.id);
  res.cookie('verba.sid', sid, COOKIE_OPTS);
  res.json({ user: publicUser(user) });
});

module.exports = router;
