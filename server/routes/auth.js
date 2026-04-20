'use strict';
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const auth = require('../services/auth');
const requireUser = require('../middleware/requireUser');
const { OAuth2Client } = require('google-auth-library');
const { sendPasswordReset } = require('../services/emailSender');
const { getDb } = require('../services/db');

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: 30 * 24 * 60 * 60 * 1000,
};

function sessionMeta(req) {
  return {
    userAgent: String(req.headers['user-agent'] || '').slice(0, 300),
    ip: (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim() || null,
  };
}

function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, tier: u.tier, nameUpdatedAt: u.nameUpdatedAt };
}

router.post('/signup', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const name = req.body?.name ? String(req.body.name).trim() : null;
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  if (password.length < 8) return res.status(400).json({ error: 'password must be at least 8 characters' });
  try {
    const user = await auth.createUser({ email, password, name });
    const sid = auth.createSession(user.id, sessionMeta(req));
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
  const sid = auth.createSession(user.id, sessionMeta(req));
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
    const sid = auth.createSession(user.id, sessionMeta(req));
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

router.post('/forgot', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ error: 'email required' });
  const user = auth.findUserByEmail(email);
  if (user) {
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    getDb().prepare('INSERT INTO password_resets (tokenHash, userId, expiresAt) VALUES (?, ?, ?)').run(tokenHash, user.id, expiresAt);
    const base = process.env.PUBLIC_BASE_URL || 'http://localhost:3000';
    const url = `${base}/reset?token=${encodeURIComponent(token)}`;
    try { await sendPasswordReset(email, url); } catch (e) { console.error('[email] send failed', e.message); }
  }
  res.json({ ok: true });
});

router.post('/reset', async (req, res) => {
  const token = String(req.body?.token || '');
  const password = String(req.body?.password || '');
  if (!token || password.length < 8) return res.status(400).json({ error: 'token and 8+ char password required' });
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const db = getDb();
  const row = db.prepare('SELECT * FROM password_resets WHERE tokenHash = ?').get(tokenHash);
  if (!row) return res.status(400).json({ error: 'invalid token' });
  if (row.usedAt) return res.status(400).json({ error: 'token already used' });
  if (new Date(row.expiresAt).getTime() < Date.now()) return res.status(400).json({ error: 'token expired' });
  await auth.updatePassword(row.userId, password);
  db.prepare('UPDATE password_resets SET usedAt = ? WHERE tokenHash = ?').run(new Date().toISOString(), tokenHash);
  db.prepare('DELETE FROM sessions WHERE userId = ?').run(row.userId);
  res.json({ ok: true });
});

router.patch('/profile', requireUser, (req, res) => {
  const patch = req.body || {};
  try {
    if (typeof patch.name === 'string') {
      const updated = auth.updateUserName(req.user.id, patch.name);
      return res.json({ user: publicUser(updated) });
    }
    res.status(400).json({ error: 'no valid fields' });
  } catch (err) {
    if (err.code === 'NAME_COOLDOWN') {
      return res.status(429).json({ error: err.message, nextAllowedAt: err.nextAllowedAt });
    }
    res.status(400).json({ error: err.message });
  }
});

router.get('/sessions', requireUser, (req, res) => {
  const rows = auth.listSessions(req.user.id).map(s => ({
    id: s.id,
    current: s.id === req.sessionId,
    createdAt: s.createdAt,
    lastSeenAt: s.lastSeenAt,
    userAgent: s.userAgent,
    ip: s.ip,
  }));
  res.json({ sessions: rows });
});

router.delete('/sessions/:id', requireUser, (req, res) => {
  const targetId = String(req.params.id || '');
  const mine = auth.listSessions(req.user.id).some(s => s.id === targetId);
  if (!mine) return res.status(404).json({ error: 'not found' });
  auth.deleteSession(targetId);
  if (targetId === req.sessionId) res.clearCookie('verba.sid', { path: '/' });
  res.json({ ok: true });
});

router.delete('/sessions', requireUser, (req, res) => {
  auth.deleteAllSessionsForUser(req.user.id);
  res.clearCookie('verba.sid', { path: '/' });
  res.json({ ok: true });
});

module.exports = router;
