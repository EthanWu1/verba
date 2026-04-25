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

    // Reciprocal Rank Fusion (RRF): merge FTS and semantic into a single
    // ranked list. Each card's combined score is the sum of 1/(60+rank) over
    // every list it appears in. Cards in BOTH get boosted; cards in one
    // still get a partial score. Standard hybrid-search ranking technique.
    const RRF_K = 60;
    const merged = new Map(); // id -> { row, ftsRank, semRank, ftsScore, semScore }
    const upsert = (id, patch, row) => {
      const cur = merged.get(id) || { row, ftsRank: null, semRank: null, ftsScore: 0, semScore: 0 };
      Object.assign(cur, patch);
      if (row && !cur.row) cur.row = row;
      merged.set(id, cur);
    };

    // ── FTS5 keyword search ──────────────────────────────────
    const ftsQuery = sanitizeFtsQuery(q);
    if (ftsQuery) {
      let ftsRows = [];
      try {
        ftsRows = db.prepare(`
          SELECT c.rowid, c.id, c.tag, c.cite, c.shortCite, c.body_plain, c.body_markdown,
                 bm25(cards_fts) AS bm25_rank
          FROM cards_fts JOIN cards c ON c.rowid = cards_fts.rowid
          WHERE cards_fts MATCH ?
            AND c.isCanonical = 1
            AND c.body_markdown LIKE '%==%'
            AND c.tag IS NOT NULL AND TRIM(c.tag) != ''
          ORDER BY bm25_rank ASC
          LIMIT ?
        `).all(ftsQuery, k * 4);
      } catch (e) { /* bad FTS query — skip stage */ }
      let rank = 0;
      for (const r of ftsRows) {
        if (!hasRealHighlights(r.body_markdown)) continue;
        rank++;
        const { body_markdown, bm25_rank, ...rest } = r;
        upsert(r.id, { ftsRank: rank, ftsScore: 1 / (1 + Math.abs(bm25_rank)) }, rest);
      }
    }

    // ── Semantic KNN ─────────────────────────────────────────
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
        let rank = 0;
        for (const h of hits) {
          const r = byRowid.get(h.card_id);
          if (!r) continue;
          const semScore = 1 - h.distance;
          if (semScore < MIN_SCORE) continue;
          if (!hasRealHighlights(r.body_markdown)) continue;
          rank++;
          const { body_markdown, ...rest } = r;
          upsert(r.id, { semRank: rank, semScore }, rest);
        }
      }
    }

    // Compute RRF combined score, sort, trim
    const results = [...merged.values()]
      .map(x => {
        const fts = x.ftsRank ? 1 / (RRF_K + x.ftsRank) : 0;
        const sem = x.semRank ? 1 / (RRF_K + x.semRank) : 0;
        return {
          ...x.row,
          score: fts + sem,
          _src: x.ftsRank && x.semRank ? 'both' : (x.ftsRank ? 'fts' : 'semantic'),
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, k);

    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
