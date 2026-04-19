'use strict';

const crypto = require('crypto');
const { loadMeta } = require('./libraryStore');
const db = require('./db');
const { semanticSearch, isConfigured } = require('./vectorSearch');
const { deriveResolutionLabel } = require('./labelDerivation');

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
      const ranked  = await semanticSearch(filters.q, 500);
      const idOrder = new Map(ranked.map((r, i) => [String(r.id), i]));
      const ids     = ranked.map(r => String(r.id));
      const nonQ    = { ...filters, q: undefined };
      const rows    = db.queryCardsByIds(ids, nonQ);
      rows.sort((a, b) => (idOrder.get(String(a.id)) ?? 9999) - (idOrder.get(String(b.id)) ?? 9999));
      total = rows.length;
      const start = (page - 1) * limit;
      items = rows.slice(start, start + limit).map(hydrateRow);
    } catch (err) {
      console.warn('[VECTOR] semanticSearch failed, falling back to keyword:', err.message);
      const out = db.queryCards({ filters, sort: filters.sort || 'relevance', page, limit });
      total = out.total;
      items = out.rows.map(hydrateRow);
    }
  } else {
    const out = db.queryCards({ filters, sort: filters.sort || 'relevance', page, limit });
    total = out.total;
    items = out.rows.map(hydrateRow);
  }

  return {
    total,
    page,
    limit,
    items,
    filters: db.facetCounts(null, 20),
    meta: loadMeta(),
  };
}

function getLibraryAnalytics() {
  const database = db.getDb();
  const totals = database.prepare(`
    SELECT
      COUNT(*) AS cards,
      SUM(CASE WHEN isCanonical = 1 THEN 1 ELSE 0 END) AS canonical,
      COUNT(DISTINCT school) AS schools,
      COUNT(DISTINCT resolutionLabel) AS resolutions
    FROM cards
  `).get();

  function top(col, limit) {
    return database.prepare(`
      SELECT ${col} AS label, COUNT(*) AS count FROM cards
      WHERE ${col} IS NOT NULL AND ${col} != ''
      GROUP BY ${col} ORDER BY count DESC, label ASC LIMIT ?
    `).all(limit);
  }

  return {
    totals: {
      cards:       totals.cards || 0,
      canonical:   totals.canonical || 0,
      schools:     totals.schools || 0,
      resolutions: totals.resolutions || 0,
    },
    topResolutions: top('resolutionLabel', 6),
    topTypes:       top('typeLabel', 6),
    topTopics:      top('topicLabel', 6),
  };
}

async function buildChatContext(query, filters = {}, limit = 8) {
  let items;
  if (query && isConfigured()) {
    try {
      const ranked  = await semanticSearch(query, 50);
      const idOrder = new Map(ranked.map((r, i) => [String(r.id), i]));
      const ids     = ranked.map(r => String(r.id));
      const rows    = db.queryCardsByIds(ids, filters);
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

module.exports = {
  getLibraryCards,
  getLibraryAnalytics,
  buildChatContext,
  inferResolution,
  getRelevantAnalytics,
};
