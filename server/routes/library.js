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
    const { embedOne } = require('../services/embedder');
    const { knn } = require('../services/semanticIndex');
    const { getDb } = require('../services/db');

    let vec = _cacheGet(q);
    if (!vec) {
      vec = await embedOne(q);
      if (vec) _cachePut(q, vec);
    }
    if (!vec) return res.json({ results: [] });

    const hits = knn(vec, k);
    if (!hits.length) return res.json({ results: [] });

    const db = getDb();
    const placeholders = hits.map(() => '?').join(',');
    // Defensive filter: vec0 contains stale embeddings for cards that have
    // since been demoted (isCanonical=0) or had highlights stripped. Also
    // mirror the embed-time rule (extractHighlights joined length >= 20)
    // so cards with stray `==` but no real highlight content are dropped.
    const rows = db.prepare(`
      SELECT rowid, id, tag, cite, shortCite, body_plain, body_markdown
      FROM cards
      WHERE rowid IN (${placeholders})
        AND isCanonical = 1
        AND body_markdown LIKE '%==%'
    `).all(...hits.map(h => h.card_id));
    const HL_RE = /==([^=]+)==/g;
    // Strip markdown emphasis + html tags so we measure REAL highlighted
    // text content, not formatting noise. Cards like
    //   ==**<u>N</u>**==  ==**<u> is </u>**==
    // would otherwise pass a length check despite carrying ~2 chars of text.
    const stripFmt = (s) => s
      .replace(/<\/?[a-zA-Z][^>]*>/g, '')   // <u>, </u>, <em>, etc.
      .replace(/\*+/g, '')                  // ** bold, * italic
      .replace(/_+/g, '')                   // _emphasis_
      .replace(/\s+/g, ' ')
      .trim();
    const hasRealHighlights = (md) => {
      if (!md) return false;
      let total = 0, longest = 0;
      let m;
      HL_RE.lastIndex = 0;
      while ((m = HL_RE.exec(md)) !== null) {
        const t = stripFmt(m[1]);
        total += t.length;
        if (t.length > longest) longest = t.length;
      }
      return total >= 50 && longest >= 15;
    };
    const byRowid = new Map();
    for (const r of rows) {
      if (!hasRealHighlights(r.body_markdown)) continue;
      // Don't ship raw body_markdown to the client (already had body_plain).
      const { body_markdown, ...rest } = r;
      byRowid.set(r.rowid, rest);
    }
    const results = hits.map(h => {
      const r = byRowid.get(h.card_id);
      return r ? { ...r, score: 1 - h.distance } : null;
    }).filter(Boolean);
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
