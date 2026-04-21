'use strict';
// In-memory cache for uploaded file text. 10-minute TTL.
const crypto = require('crypto');

const CACHE = new Map();
const TTL_MS = 10 * 60 * 1000;

function put(entry) {
  const token = crypto.randomBytes(12).toString('hex');
  CACHE.set(token, { ...entry, expiresAt: Date.now() + TTL_MS });
  return token;
}

function get(token) {
  const row = CACHE.get(token);
  if (!row) return null;
  if (Date.now() > row.expiresAt) { CACHE.delete(token); return null; }
  return row;
}

function drop(token) { CACHE.delete(token); }

// Periodic cleanup
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of CACHE) if (now > v.expiresAt) CACHE.delete(k);
}, 60 * 1000).unref();

module.exports = { put, get, drop };
