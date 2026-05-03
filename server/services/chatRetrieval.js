// server/services/chatRetrieval.js
'use strict';
const { getDb } = require('./db');
const { semanticSearch, isConfigured: vecConfigured } = require('./vectorSearch');

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

// Return columns include body_markdown (full <u>/=*=*= formatting intact)
// so /block can paste cards verbatim. body_plain stays for non-block paths
// that need a short text excerpt.
const CARD_COLUMNS = `
  c.id, c.tag, c.shortCite,
  c.body_plain,
  c.body_markdown,
  c.argumentTypes, c.argumentTags
`;

// Hybrid card retrieval. Semantic search (Pinecone via vectorSearch) is
// preferred when configured — finds cards whose tags/bodies are semantically
// near the query even without keyword overlap. Falls back to FTS5 BM25 when
// vector search fails or is unconfigured. Mirrors libraryQuery.buildChatContext.
async function retrieveCards(query, k = 10) {
  const q = sanitize(query); if (!q) return [];
  const key = 'cards|' + q + '|' + k;
  const cached = cacheGet(key); if (cached) return cached;

  const db = getDb();
  let rows = [];

  // 1. Semantic-first
  if (vecConfigured()) {
    try {
      const ranked = await semanticSearch(q, Math.max(k * 4, 40));
      const ids = ranked.map(r => String(r.id)).filter(Boolean);
      if (ids.length) {
        const placeholders = ids.map(() => '?').join(',');
        const fetched = db.prepare(`
          SELECT ${CARD_COLUMNS}
          FROM cards c
          WHERE c.id IN (${placeholders}) AND c.isCanonical = 1
        `).all(...ids);
        const order = new Map(ids.map((id, i) => [id, i]));
        fetched.sort((a, b) => (order.get(String(a.id)) ?? 9999) - (order.get(String(b.id)) ?? 9999));
        rows = fetched.slice(0, k);
      }
    } catch (err) {
      console.warn('[chatRetrieval] semantic failed, falling back to FTS:', err.message);
    }
  }

  // 2. FTS fallback
  if (rows.length === 0) {
    try {
      rows = db.prepare(`
        SELECT ${CARD_COLUMNS}, bm25(cards_fts) AS rank
        FROM cards_fts JOIN cards c ON c.rowid = cards_fts.rowid
        WHERE cards_fts MATCH ? AND c.isCanonical = 1
        ORDER BY rank ASC LIMIT ?
      `).all(q, k);
    } catch {
      rows = db.prepare(`
        SELECT ${CARD_COLUMNS}
        FROM cards c
        WHERE c.isCanonical = 1 AND (c.tag LIKE ? OR c.shortCite LIKE ?) LIMIT ?
      `).all('%' + q + '%', '%' + q + '%', k);
    }
  }

  const out = rows.map(r => ({
    ...r,
    argumentTypes: safeJson(r.argumentTypes),
    argumentTags:  safeJson(r.argumentTags),
  }));
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
