// server/services/chatRetrieval.js
'use strict';
const { getDb } = require('./db');

const CACHE_MAX = 1000;
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map();

function cacheGet(key) {
  const e = cache.get(key);
  if (!e) return null;
  if (Date.now() - e.at > CACHE_TTL_MS) { cache.delete(key); return null; }
  cache.delete(key); cache.set(key, e);
  return e.val;
}
function cacheSet(key, val) {
  cache.set(key, { val, at: Date.now() });
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

function sanitize(s) {
  return String(s || '').replace(/["'\\-]/g, ' ').replace(/\s+/g, ' ').trim();
}
function safeJson(s) { try { return JSON.parse(s); } catch { return []; } }

async function retrieveCards(query, k = 10) {
  const q = sanitize(query); if (!q) return [];
  const key = 'cards|' + q + '|' + k;
  const cached = cacheGet(key); if (cached) return cached;
  let rows;
  try {
    rows = getDb().prepare(`
      SELECT c.id, c.tag, c.shortCite, substr(c.body_plain, 1, 400) AS body_plain,
             c.argumentTypes, c.argumentTags,
             bm25(cards_fts) AS rank
      FROM cards_fts JOIN cards c ON c.rowid = cards_fts.rowid
      WHERE cards_fts MATCH ? AND c.isCanonical = 1
      ORDER BY rank ASC LIMIT ?
    `).all(q, k);
  } catch {
    rows = getDb().prepare(`
      SELECT id, tag, shortCite, substr(body_plain, 1, 400) AS body_plain, argumentTypes, argumentTags
      FROM cards WHERE isCanonical = 1 AND (tag LIKE ? OR shortCite LIKE ?) LIMIT ?
    `).all('%' + q + '%', '%' + q + '%', k);
  }
  const out = rows.map(r => ({ ...r, argumentTypes: safeJson(r.argumentTypes), argumentTags: safeJson(r.argumentTags) }));
  cacheSet(key, out);
  return out;
}

async function retrieveAnalytics(query, k = 5) {
  const q = sanitize(query); if (!q) return [];
  const key = 'analytics|' + q + '|' + k;
  const cached = cacheGet(key); if (cached) return cached;
  let out = [];
  try {
    out = getDb().prepare(`
      SELECT a.id, a.title, substr(a.content_plain, 1, 500) AS content_plain, bm25(analytics_fts) AS rank
      FROM analytics_fts JOIN analytics a ON a.rowid = analytics_fts.rowid
      WHERE analytics_fts MATCH ? ORDER BY rank ASC LIMIT ?
    `).all(q, k);
  } catch {}
  cacheSet(key, out);
  return out;
}

async function retrieveUserContext(userId, query, k = 5) {
  const q = sanitize(query); if (!q || !userId) return [];
  const key = 'ctx|' + userId + '|' + q + '|' + k;
  const cached = cacheGet(key); if (cached) return cached;
  let out = [];
  try {
    out = getDb().prepare(`
      SELECT c.id, c.name, substr(c.content, 1, 500) AS content_plain, bm25(chat_context_fts) AS rank
      FROM chat_context_fts JOIN chat_context c ON c.rowid = chat_context_fts.rowid
      WHERE chat_context_fts MATCH ? AND c.userId = ?
      ORDER BY rank ASC LIMIT ?
    `).all(q, userId, k);
  } catch {}
  cacheSet(key, out);
  return out;
}

module.exports = { retrieveCards, retrieveAnalytics, retrieveUserContext };
