'use strict';
const { getDb } = require('./db');

function periodUtc() { return new Date().toISOString().slice(0, 7); }

function nextResetAt() {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, 1, 0, 0, 0)).toISOString();
}

function getCount(userId, kind, period = periodUtc()) {
  const row = getDb().prepare('SELECT count FROM usage_counters WHERE userId = ? AND kind = ? AND day = ?').get(userId, kind, period);
  return row ? row.count : 0;
}

function hit(userId, kind, period = periodUtc()) {
  const db = getDb();
  const existing = db.prepare('SELECT count FROM usage_counters WHERE userId = ? AND kind = ? AND day = ?').get(userId, kind, period);
  if (existing) {
    db.prepare('UPDATE usage_counters SET count = count + 1 WHERE userId = ? AND kind = ? AND day = ?').run(userId, kind, period);
    return existing.count + 1;
  }
  db.prepare('INSERT INTO usage_counters (userId, kind, day, count) VALUES (?, ?, ?, 1)').run(userId, kind, period);
  return 1;
}

// Hardcoded unlimited-tier allowlist. Bypasses every kind of rate limit
// (cutCard, chat, etc.) regardless of the user's stored `tier` column.
// Comma-separated emails in UNLIMITED_EMAILS env override / supplement this.
const HARDCODED_UNLIMITED_EMAILS = new Set([
  'ethanzhouwu@gmail.com',
]);
function isUnlimitedEmail(email) {
  if (!email) return false;
  const e = String(email).toLowerCase().trim();
  if (HARDCODED_UNLIMITED_EMAILS.has(e)) return true;
  const fromEnv = String(process.env.UNLIMITED_EMAILS || '')
    .split(',').map(s => s.toLowerCase().trim()).filter(Boolean);
  return fromEnv.includes(e);
}

function checkAndBudget(userId, kind, limit, user = null) {
  if (user && user.tier && user.tier !== 'free') return { allowed: true, remaining: Infinity, limit };
  if (user && isUnlimitedEmail(user.email)) return { allowed: true, remaining: Infinity, limit };
  const used = getCount(userId, kind);
  const remaining = Math.max(0, limit - used);
  return { allowed: used < limit, remaining, used, limit };
}

module.exports = { getCount, hit, checkAndBudget, nextResetAt };
