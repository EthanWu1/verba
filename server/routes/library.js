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
// Normalize so "Nuclear", "nuclear ", "NUCLEAR" share one cache slot.
function _normKey(q) { return String(q || '').toLowerCase().replace(/\s+/g, ' ').trim(); }
function _cacheGet(k) {
  const nk = _normKey(k);
  const v = _qCache.get(nk);
  if (!v) return null;
  _qCache.delete(nk); _qCache.set(nk, v); // LRU bump
  return v;
}
function _cachePut(k, v) {
  const nk = _normKey(k);
  _qCache.set(nk, v);
  if (_qCache.size > Q_CACHE_MAX) _qCache.delete(_qCache.keys().next().value);
}

// Hybrid search: FTS5 first (fast keyword recall), then semantic to fill the
// rest with synonym/concept matches. FTS handles short queries that semantic
// can't ('nuclear' alone), semantic handles paraphrases that FTS misses.
//
// Highlight filter: trust the DB-maintained hasHighlight + highlightWordCount
// columns (set during ingestion + backfill from any of ==…==, <u>…</u>, **…**).
// Don't re-parse body_markdown here — it diverged from ingestion in the past
// and silently dropped underline-highlighted cards. See server/services/db.js
// (_countHighlightWords + insert hasHighlight regex).
const MIN_HL_WORDS = 6;       // ~1 short sentence's worth of highlighted text
const SEM_MIN_SCORE = 0.05;   // cosine floor — below this is essentially noise

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

  if (q.length < 1) return res.json({ results: [] });
  // Short queries (1-2 chars like "K", "AI", "CP") skip semantic — embedding
  // a 1-token vector is meaningless. FTS still serves keyword matches.
  const allowSemantic = q.length >= 3;

  try {
    const { getDb } = require('../services/db');
    const db = getDb();

    // Reciprocal Rank Fusion (RRF) merges FTS + semantic positionally; we then
    // ADD normalized match strength so a barely-above-threshold semantic hit
    // can't outrank a strong textual match purely because it's earlier in
    // its list. Strength is normalized per-list to [0,1] so neither signal
    // can dominate by absolute scale (bm25 magnitudes vary widely).
    const RRF_K = 60;
    const STRENGTH_WEIGHT = 0.04; // bump up to ~the magnitude of an RRF top hit
    const merged = new Map(); // id -> { row, ftsRank, semRank, ftsRaw, semRaw }
    const upsert = (id, patch, row) => {
      const cur = merged.get(id) || { row, ftsRank: null, semRank: null, ftsRaw: 0, semRaw: 0 };
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
          SELECT c.rowid, c.id, c.tag, c.cite, c.shortCite, c.body_plain,
                 bm25(cards_fts) AS bm25_rank
          FROM cards_fts JOIN cards c ON c.rowid = cards_fts.rowid
          WHERE cards_fts MATCH ?
            AND c.isCanonical = 1
            AND c.hasHighlight = 1
            AND c.highlightWordCount >= ?
            AND c.tag IS NOT NULL AND TRIM(c.tag) != ''
          ORDER BY bm25_rank ASC
          LIMIT ?
        `).all(ftsQuery, MIN_HL_WORDS, k * 4);
      } catch (e) { /* bad FTS query — skip stage */ }
      let rank = 0;
      for (const r of ftsRows) {
        rank++;
        const { bm25_rank, ...rest } = r;
        // bm25 is lower=better, magnitudes vary; transform to a [0,1]-ish
        // raw strength via 1/(1+|bm25|). Per-list min-max comes after merge.
        upsert(r.id, { ftsRank: rank, ftsRaw: 1 / (1 + Math.abs(bm25_rank)) }, rest);
      }
    }

    // ── Semantic KNN (skipped for very short queries) ────────
    if (allowSemantic) {
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
            SELECT rowid, id, tag, cite, shortCite, body_plain
            FROM cards
            WHERE rowid IN (${placeholders})
              AND isCanonical = 1
              AND hasHighlight = 1
              AND highlightWordCount >= ?
              AND tag IS NOT NULL AND TRIM(tag) != ''
          `).all(...hits.map(h => h.card_id), MIN_HL_WORDS);
          const byRowid = new Map(rows.map(r => [r.rowid, r]));
          let rank = 0;
          for (const h of hits) {
            const r = byRowid.get(h.card_id);
            if (!r) continue;
            const semScore = 1 - h.distance;
            if (semScore < SEM_MIN_SCORE) continue;
            rank++;
            upsert(r.id, { semRank: rank, semRaw: semScore }, r);
          }
        }
      }
    }

    // Per-list min-max normalize raw strengths so neither signal dominates
    // by absolute scale, then combine RRF position + normalized strength.
    const ftsRaws = [...merged.values()].map(x => x.ftsRaw).filter(v => v > 0);
    const semRaws = [...merged.values()].map(x => x.semRaw).filter(v => v > 0);
    const ftsMin = ftsRaws.length ? Math.min(...ftsRaws) : 0;
    const ftsMax = ftsRaws.length ? Math.max(...ftsRaws) : 1;
    const semMin = semRaws.length ? Math.min(...semRaws) : 0;
    const semMax = semRaws.length ? Math.max(...semRaws) : 1;
    const norm = (v, lo, hi) => (v <= 0 || hi <= lo) ? 0 : (v - lo) / (hi - lo);

    const results = [...merged.values()]
      .map(x => {
        const rrfFts = x.ftsRank ? 1 / (RRF_K + x.ftsRank) : 0;
        const rrfSem = x.semRank ? 1 / (RRF_K + x.semRank) : 0;
        const normFts = norm(x.ftsRaw, ftsMin, ftsMax);
        const normSem = norm(x.semRaw, semMin, semMax);
        const strength = Math.max(normFts, normSem);
        return {
          ...x.row,
          score: rrfFts + rrfSem + STRENGTH_WEIGHT * strength,
          _src: x.ftsRank && x.semRank ? 'both' : (x.ftsRank ? 'fts' : 'semantic'),
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, k);

    res.set('Cache-Control', 'private, max-age=60');
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
