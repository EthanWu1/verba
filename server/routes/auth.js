'use strict';
const express = require('express');
const router = express.Router();
const auth = require('../services/auth');
const requireUser = require('../middleware/requireUser');
const { OAuth2Client } = require('google-auth-library');

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

router.get('/me', requireUser, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

router.post('/logout', (req, res) => {
  const sid = req.cookies && req.cookies['verba.sid'];
  if (sid) auth.deleteSession(sid);
  res.clearCookie('verba.sid', { path: '/' });
  res.json({ ok: true });
});

router.post('/google', async (req, res) => {
  const idToken = String(req.body?.idToken || '');
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!idToken) return res.status(400).json({ error: 'idToken required' });
  if (!clientId) return res.status(500).json({ error: 'GOOGLE_CLIENT_ID not configured' });
  try {
    const client = new OAuth2Client(clientId);
    const ticket = await client.verifyIdToken({ idToken, audience: clientId });
    const payload = ticket.getPayload();
    const sub = payload.sub;
    const email = String(payload.email || '').toLowerCase();
    const name = payload.name || null;
    if (!email) return res.status(400).json({ error: 'google token missing email' });

    let user = auth.findUserByGoogleSub(sub);
    if (!user) {
      const byEmail = auth.findUserByEmail(email);
      if (byEmail) { auth.linkGoogleSub(byEmail.id, sub); user = auth.findUserById(byEmail.id); }
      else         { user = auth._insertUserSync({ email, googleSub: sub, name }); }
    }
    const sid = auth.createSession(user.id);
    res.cookie('verba.sid', sid, COOKIE_OPTS);
    res.json({ user: publicUser(user) });
  } catch (err) {
    res.status(401).json({ error: 'google verification failed' });
  }
});

router.get('/config', (_req, res) => {
  res.json({ googleClientId: process.env.GOOGLE_CLIENT_ID || null });
});

const limitsSvc = require('../services/limits');
router.get('/usage', requireUser, (req, res) => {
  const chat = limitsSvc.getCount(req.user.id, 'chat');
  const cutCard = limitsSvc.getCount(req.user.id, 'cutCard');
  res.json({
    tier: req.user.tier,
    chat:   { used: chat,    limit: Number(process.env.FREE_CHAT_DAILY || 20) },
    cutCard:{ used: cutCard, limit: Number(process.env.FREE_CUTCARD_DAILY || 10) },
  });
});

module.exports = router;
