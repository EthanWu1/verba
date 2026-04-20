'use strict';
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { getDb } = require('./db');

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function _newId(prefix) {
  return prefix + '_' + crypto.randomBytes(12).toString('hex');
}

function _insertUserSync({ email, passwordHash = null, googleSub = null, name = null }) {
  const db = getDb();
  const id = _newId('u');
  const createdAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO users (id, email, passwordHash, googleSub, name, tier, createdAt)
    VALUES (?, ?, ?, ?, ?, 'free', ?)
  `).run(id, email.toLowerCase(), passwordHash, googleSub, name, createdAt);
  return { id, email: email.toLowerCase(), passwordHash, googleSub, name, tier: 'free', createdAt };
}

async function createUser({ email, password, name = null }) {
  if (!email || !password) throw new Error('email and password required');
  if (password.length < 8) throw new Error('password must be >= 8 chars');
  const passwordHash = await bcrypt.hash(password, 10);
  try {
    return _insertUserSync({ email, passwordHash, name });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) throw new Error('email already registered');
    throw err;
  }
}

function findUserByEmail(email) {
  return getDb().prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').toLowerCase()) || null;
}

function findUserById(id) {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id) || null;
}

function findUserByGoogleSub(sub) {
  return getDb().prepare('SELECT * FROM users WHERE googleSub = ?').get(sub) || null;
}

function linkGoogleSub(userId, sub) {
  getDb().prepare('UPDATE users SET googleSub = ? WHERE id = ?').run(sub, userId);
}

async function verifyPassword(user, password) {
  if (!user || !user.passwordHash) return false;
  return bcrypt.compare(password, user.passwordHash);
}

function createSession(userId, meta = {}) {
  const id = crypto.randomBytes(32).toString('hex');
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  getDb().prepare(
    'INSERT INTO sessions (id, userId, createdAt, expiresAt, lastSeenAt, userAgent, ip) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, userId, now, expiresAt, now, meta.userAgent || null, meta.ip || null);
  return id;
}

function validateSession(sessionId) {
  if (!sessionId) return null;
  const db = getDb();
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  if (!row) return null;
  if (new Date(row.expiresAt).getTime() < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    return null;
  }
  const user = findUserById(row.userId);
  if (!user) return null;
  return { session: row, user };
}

function deleteSession(sessionId) {
  if (!sessionId) return;
  getDb().prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

function touchSession(sessionId) {
  if (!sessionId) return;
  try {
    getDb().prepare('UPDATE sessions SET lastSeenAt = ? WHERE id = ?')
      .run(new Date().toISOString(), sessionId);
  } catch {}
}

function listSessions(userId) {
  return getDb().prepare(
    'SELECT id, createdAt, lastSeenAt, userAgent, ip FROM sessions WHERE userId = ? ORDER BY lastSeenAt DESC, createdAt DESC'
  ).all(userId);
}

function deleteAllSessionsForUser(userId) {
  getDb().prepare('DELETE FROM sessions WHERE userId = ?').run(userId);
}

function updateUserName(userId, name) {
  const cleaned = String(name || '').trim();
  if (!cleaned) throw new Error('name required');
  if (cleaned.length > 60) throw new Error('name too long');
  const u = findUserById(userId);
  if (!u) throw new Error('user not found');
  const last = u.nameUpdatedAt ? new Date(u.nameUpdatedAt).getTime() : 0;
  const waitMs = 24 * 60 * 60 * 1000;
  if (last && Date.now() - last < waitMs) {
    const err = new Error('name was changed recently');
    err.code = 'NAME_COOLDOWN';
    err.nextAllowedAt = new Date(last + waitMs).toISOString();
    throw err;
  }
  const now = new Date().toISOString();
  getDb().prepare('UPDATE users SET name = ?, nameUpdatedAt = ? WHERE id = ?')
    .run(cleaned, now, userId);
  return findUserById(userId);
}

async function updatePassword(userId, newPassword) {
  if (!newPassword || newPassword.length < 8) throw new Error('password must be >= 8 chars');
  const hash = await bcrypt.hash(newPassword, 10);
  getDb().prepare('UPDATE users SET passwordHash = ? WHERE id = ?').run(hash, userId);
}

module.exports = {
  createUser, findUserByEmail, findUserById, findUserByGoogleSub, linkGoogleSub,
  verifyPassword, createSession, validateSession, deleteSession, updatePassword,
  touchSession, listSessions, deleteAllSessionsForUser, updateUserName,
  _insertUserSync,
};
