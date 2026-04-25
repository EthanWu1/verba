'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { loadMeta } = require('./libraryStore');
const db = require('./db');
const { semanticSearch, isConfigured } = require('./vectorSearch');
const { deriveResolutionLabel } = require('./labelDerivation');

const ANALYTICS_CACHE_FILE = path.resolve(__dirname, '..', 'data', '.cache', 'analytics.json');

function cardId(card) {
  if (card && card.id) return String(card.id);
  return crypto.createHash('md5').update(`${(card && card.tag) || ''}|${(card && card.cite) || ''}`).digest('hex').slice(0, 10);
}

function hydrateRow(row) {
  if (!row) return row;
  return {
    ...row,
    id: cardId(row),
    resolution: row.resolutionLabel || deriveResolutionLabel(row),
  };
}

async function getLibraryCards(filters = {}) {
  const page  = Math.max(1, Number(filters.page)  || 1);
  const limit = Math.max(1, Math.min(5000, Number(filters.limit) || 40));

  let items;
  let total;

  const wantSemantic = filters.q && filters.sort === 'semantic' && isConfigured();
  if (wantSemantic) {
    try {
      const ranked  = await semanticSearch(filters.q, 200);
      const idOrder = new Map(ranked.map((r, i) => [String(r.id), i]));
      const ids     = ranked.map(r => String(r.id));
      const nonQ    = { ...filters, q: undefined };
      const rows    = db.queryCardsByIds(ids, nonQ, { lite: true, maxIds: 200 });
      rows.sort((a, b) => (idOrder.get(String(a.id)) ?? 9999) - (idOrder.get(String(b.id)) ?? 9999));
      total = rows.length;
      const start = (page - 1) * limit;
      items = rows.slice(start, start + limit).map(hydrateRow);
    } catch (err) {
      console.warn('[VECTOR] semanticSearch failed, falling back to keyword:', err.message);
      const out = db.queryCards({ filters, sort: filters.sort || 'relevance', page, limit, lite: true });
      total = out.total;
      items = out.rows.map(hydrateRow);
    }
  } else {
    const out = db.queryCards({ filters, sort: filters.sort || 'relevance', page, limit, lite: true });
    total = out.total;
    items = out.rows.map(hydrateRow);
  }

  return {
    total,
    page,
    limit,
    items,
    filters: getCachedFacets(),
    meta: loadMeta(),
  };
}

const ANALYTICS_TTL_MS = 10 * 60 * 1000;
const FACETS_TTL_MS = 10 * 60 * 1000;
let _analyticsCache = { at: 0, data: null };
let _facetsCache = { at: 0, data: null };

// Hydrate the analytics cache from disk on first import so a pm2 restart
// doesn't trigger another 41-second warmup. Falls through to recompute if
// the file is missing/stale beyond the TTL.
try {
  if (fs.existsSync(ANALYTICS_CACHE_FILE)) {
    const raw = JSON.parse(fs.readFileSync(ANALYTICS_CACHE_FILE, 'utf8'));
    if (raw && raw.at && raw.data) _analyticsCache = raw;
  }
} catch { /* corrupted cache file — recompute */ }

function invalidateLibraryCaches() {
  _analyticsCache = { at: 0, data: null };
  _facetsCache = { at: 0, data: null };
  try { fs.unlinkSync(ANALYTICS_CACHE_FILE); } catch {}
}

function getCachedFacets() {
  const now = Date.now();
  if (_facetsCache.data && now - _facetsCache.at < FACETS_TTL_MS) return _facetsCache.data;
  const data = db.facetCounts(null, 20);
  _facetsCache = { at: now, data };
  return data;
}

function getLibraryAnalytics() {
  const now = Date.now();
  if (_analyticsCache.data && now - _analyticsCache.at < ANALYTICS_TTL_MS) return _analyticsCache.data;

  const database = db.getDb();
  // Single query for totals + 3 top-N lists. The top-* lists filter on
  // hasHighlight=1 so SQLite can use the partial indexes idx_cards_hl_*
  // (48k rows instead of 832k), which is the dominant cost.
  // Returns rows tagged by `kind`; we partition in JS.
  const rows = database.prepare(`
    WITH t AS (
      SELECT
        COUNT(*) AS cards,
        SUM(CASE WHEN isCanonical = 1 THEN 1 ELSE 0 END) AS canonical,
        COUNT(DISTINCT school) AS schools,
        COUNT(DISTINCT resolutionLabel) AS resolutions
      FROM cards
    )
    SELECT 'totals' AS kind, NULL AS label,
           cards, canonical, schools, resolutions
    FROM t
    UNION ALL
    SELECT * FROM (
      SELECT 'res' AS kind, resolutionLabel AS label,
             COUNT(*) AS cards, NULL, NULL, NULL
      FROM cards WHERE hasHighlight = 1 AND resolutionLabel IS NOT NULL AND resolutionLabel != ''
      GROUP BY resolutionLabel ORDER BY COUNT(*) DESC, resolutionLabel ASC LIMIT 6
    )
    UNION ALL
    SELECT * FROM (
      SELECT 'type' AS kind, typeLabel AS label,
             COUNT(*), NULL, NULL, NULL
      FROM cards WHERE hasHighlight = 1 AND typeLabel IS NOT NULL AND typeLabel != ''
      GROUP BY typeLabel ORDER BY COUNT(*) DESC, typeLabel ASC LIMIT 6
    )
    UNION ALL
    SELECT * FROM (
      SELECT 'topic' AS kind, topicLabel AS label,
             COUNT(*), NULL, NULL, NULL
      FROM cards WHERE hasHighlight = 1 AND topicLabel IS NOT NULL AND topicLabel != ''
      GROUP BY topicLabel ORDER BY COUNT(*) DESC, topicLabel ASC LIMIT 6
    )
  `).all();

  let totals = { cards: 0, canonical: 0, schools: 0, resolutions: 0 };
  const topResolutions = [], topTypes = [], topTopics = [];
  for (const r of rows) {
    if (r.kind === 'totals') {
      totals = { cards: r.cards || 0, canonical: r.canonical || 0, schools: r.schools || 0, resolutions: r.resolutions || 0 };
    } else if (r.kind === 'res')   topResolutions.push({ label: r.label, count: r.cards });
    else if (r.kind === 'type')    topTypes.push({ label: r.label, count: r.cards });
    else if (r.kind === 'topic')   topTopics.push({ label: r.label, count: r.cards });
  }

  const data = { totals, topResolutions, topTypes, topTopics };
  _analyticsCache = { at: now, data };
  // Persist so the next pm2 restart doesn't re-warm.
  try {
    fs.mkdirSync(path.dirname(ANALYTICS_CACHE_FILE), { recursive: true });
    fs.writeFileSync(ANALYTICS_CACHE_FILE, JSON.stringify(_analyticsCache));
  } catch { /* best-effort; missing disk space etc. shouldn't fail the response */ }
  return data;
}

async function buildChatContext(query, filters = {}, limit = 8) {
  let items;
  if (query && isConfigured()) {
    try {
      const ranked  = await semanticSearch(query, 50);
      const idOrder = new Map(ranked.map((r, i) => [String(r.id), i]));
      const ids     = ranked.map(r => String(r.id));
      const rows    = db.queryCardsByIds(ids, filters, { maxIds: 50 });
      rows.sort((a, b) => (idOrder.get(String(a.id)) ?? 9999) - (idOrder.get(String(b.id)) ?? 9999));
      items = rows.slice(0, limit).map(hydrateRow);
    } catch {
      items = db.queryCards({ filters: { ...filters, q: query }, sort: 'relevance', page: 1, limit }).rows.map(hydrateRow);
    }
  } else {
    items = db.queryCards({ filters: { ...filters, q: query }, sort: 'relevance', page: 1, limit }).rows.map(hydrateRow);
  }

  return {
    cards: items,
    analytics: getLibraryAnalytics(),
    meta: loadMeta(),
  };
}

function getRelevantAnalytics(query, limit = 2) {
  try {
    const tokens = String(query || '').toLowerCase().split(/\s+/).filter(t => t.length >= 4);
    if (!tokens.length) return [];
    for (const token of tokens) {
      const results = db.searchAnalytics(token, limit);
      if (results && results.length) return results;
    }
    return [];
  } catch {
    return [];
  }
}

function inferResolution(card) {
  return deriveResolutionLabel(card);
}

function getCardDetail(id) {
  const row = db.getCardById(id);
  return row ? hydrateRow(row) : null;
}

module.exports = {
  getLibraryCards,
  getLibraryAnalytics,
  buildChatContext,
  inferResolution,
  getRelevantAnalytics,
  invalidateLibraryCaches,
  getCardDetail,
};
