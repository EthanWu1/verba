'use strict';
const { getDb } = require('./db');

function todayUtc() { return new Date().toISOString().slice(0, 10); }

function getCount(userId, kind, day = todayUtc()) {
  const row = getDb().prepare('SELECT count FROM usage_counters WHERE userId = ? AND kind = ? AND day = ?').get(userId, kind, day);
  return row ? row.count : 0;
}

function hit(userId, kind, day = todayUtc()) {
  const db = getDb();
  const existing = db.prepare('SELECT count FROM usage_counters WHERE userId = ? AND kind = ? AND day = ?').get(userId, kind, day);
  if (existing) {
    db.prepare('UPDATE usage_counters SET count = count + 1 WHERE userId = ? AND kind = ? AND day = ?').run(userId, kind, day);
    return existing.count + 1;
  }
  db.prepare('INSERT INTO usage_counters (userId, kind, day, count) VALUES (?, ?, ?, 1)').run(userId, kind, day);
  return 1;
}

function checkAndBudget(userId, kind, limit, user = null) {
  if (user && user.tier && user.tier !== 'free') return { allowed: true, remaining: Infinity, limit };
  const used = getCount(userId, kind);
  const remaining = Math.max(0, limit - used);
  return { allowed: used < limit, remaining, used, limit };
}

module.exports = { getCount, hit, checkAndBudget };
