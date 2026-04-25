'use strict';

const express = require('express');
const router = express.Router();

const { getLibraryDashboard, searchLibrary } = require('../services/docxImport');
const { getLibraryCards, getLibraryAnalytics, getCardDetail } = require('../services/libraryQuery');

router.get('/dashboard', (req, res) => {
  const limit = Math.max(1, Math.min(50, Number(req.query.limit) || 12));
  res.set('Cache-Control', 'private, max-age=60, stale-while-revalidate=300');
  return res.json(getLibraryDashboard(limit));
});

router.get('/search', async (req, res) => {
  try {
    const q = String(req.query.q || '');
    const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));
    res.set('Cache-Control', 'private, max-age=30');
    const data = await searchLibrary(q, limit);
    // Normalize: getLibraryCards returns {items,total}; older callers want
    // results array at top level.
    const results = Array.isArray(data) ? data : (data.items || data.results || []);
    return res.json({ results });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/cards', async (req, res) => {
  try {
    res.set('Cache-Control', 'private, max-age=60, stale-while-revalidate=300');
    return res.json(await getLibraryCards({
      q: String(req.query.q || ''),
      limit: req.query.limit,
      page: req.query.page,
      sort: String(req.query.sort || 'relevance'),
      randomSeed: Number(req.query.seed) || 0,
      resolution: String(req.query.resolution || ''),
      type: String(req.query.type || ''),
      topic: String(req.query.topic || ''),
      source: String(req.query.source || ''),
      scope: String(req.query.scope || ''),
      canonical: req.query.canonical != null ? String(req.query.canonical) : '',
      minHighlight: req.query.minHighlight != null ? Number(req.query.minHighlight) : 0,
    }));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/cards/:id', (req, res) => {
  try {
    const card = getCardDetail(req.params.id);
    if (!card) return res.status(404).json({ error: 'not_found' });
    res.set('Cache-Control', 'private, max-age=300');
    return res.json({ card });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/analytics', (req, res) => {
  res.set('Cache-Control', 'private, max-age=600, stale-while-revalidate=1800');
  return res.json(getLibraryAnalytics());
});

const _qCache = new Map();
const Q_CACHE_MAX = 4096;
function _cacheGet(k) {
  const v = _qCache.get(k);
  if (!v) return null;
  _qCache.delete(k); _qCache.set(k, v); // LRU bump
  return v;
}
function _cachePut(k, v) {
  _qCache.set(k, v);
  if (_qCache.size > Q_CACHE_MAX) _qCache.delete(_qCache.keys().next().value);
}

// Hybrid search: FTS5 first (fast keyword recall), then semantic to fill the
// rest with synonym/concept matches. FTS handles short queries that semantic
// can't ('nuclear' alone), semantic handles paraphrases that FTS misses.
const HL_RE = /==([^=]+)==/g;
const stripFmt = (s) => s
  .replace(/<\/?[a-zA-Z][^>]*>/g, '')
  .replace(/\*+/g, '')
  .replace(/_+/g, '')
  .replace(/\s+/g, ' ')
  .trim();
function hasRealHighlights(md) {
  if (!md) return false;
  let total = 0, longest = 0, m;
  HL_RE.lastIndex = 0;
  while ((m = HL_RE.exec(md)) !== null) {
    const t = stripFmt(m[1]);
    total += t.length;
    if (t.length > longest) longest = t.length;
  }
  return total >= 50 && longest >= 15;
}
function sanitizeFtsQuery(q) {
  // strip FTS5 special chars + tokenize, AND across tokens
  const tokens = String(q).replace(/["'\\\-:()*]/g, ' ').split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;
  return tokens.map(t => `"${t}"`).join(' AND ');
}

router.get('/semantic-search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  const k = Math.min(100, Number(req.query.k) || 25);
  const diag = req.query.diag === '1';

  if (diag) {
    const { extensionStatus } = require('../services/semanticIndex');
    return res.json({ ok: true, extension: extensionStatus(), cacheSize: _qCache.size });
  }

  if (q.length < 3) return res.json({ results: [] });

  try {
    const { getDb } = require('../services/db');
    const db = getDb();

    // ── Stage 1: FTS5 keyword search ──────────────────────────
    const results = [];
    const seenIds = new Set();
    const ftsQuery = sanitizeFtsQuery(q);
    if (ftsQuery) {
      let ftsRows = [];
      try {
        ftsRows = db.prepare(`
          SELECT c.rowid, c.id, c.tag, c.cite, c.shortCite, c.body_plain, c.body_markdown,
                 bm25(cards_fts) AS rank
          FROM cards_fts JOIN cards c ON c.rowid = cards_fts.rowid
          WHERE cards_fts MATCH ?
            AND c.isCanonical = 1
            AND c.body_markdown LIKE '%==%'
            AND c.tag IS NOT NULL AND TRIM(c.tag) != ''
          ORDER BY rank ASC
          LIMIT ?
        `).all(ftsQuery, k * 4);
      } catch (e) {
        // Bad FTS query syntax; just fall through to semantic
      }
      for (const r of ftsRows) {
        if (results.length >= k) break;
        if (seenIds.has(r.id)) continue;
        if (!hasRealHighlights(r.body_markdown)) continue;
        const { body_markdown, rank, ...rest } = r;
        // Higher rank = better in our scale; bm25 is lower-is-better, invert.
        results.push({ ...rest, score: 1 / (1 + Math.abs(rank)), _src: 'fts' });
        seenIds.add(r.id);
      }
    }

    // ── Stage 2: semantic fill (only if FTS short of k) ───────
    if (results.length < k) {
      const { embedOne } = require('../services/embedder');
      const { knn } = require('../services/semanticIndex');

      let vec = _cacheGet(q);
      if (!vec) {
        vec = await embedOne(q);
        if (vec) _cachePut(q, vec);
      }
      if (vec) {
        const hits = knn(vec, k * 4);
        if (hits.length) {
          const placeholders = hits.map(() => '?').join(',');
          const rows = db.prepare(`
            SELECT rowid, id, tag, cite, shortCite, body_plain, body_markdown
            FROM cards
            WHERE rowid IN (${placeholders})
              AND isCanonical = 1
              AND body_markdown LIKE '%==%'
              AND tag IS NOT NULL AND TRIM(tag) != ''
          `).all(...hits.map(h => h.card_id));
          const byRowid = new Map(rows.map(r => [r.rowid, r]));
          const MIN_SCORE = 0.05;
          for (const h of hits) {
            if (results.length >= k) break;
            const r = byRowid.get(h.card_id);
            if (!r || seenIds.has(r.id)) continue;
            const score = 1 - h.distance;
            if (score < MIN_SCORE) continue;
            if (!hasRealHighlights(r.body_markdown)) continue;
            const { body_markdown, ...rest } = r;
            results.push({ ...rest, score, _src: 'semantic' });
            seenIds.add(r.id);
          }
        }
      }
    }

    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
