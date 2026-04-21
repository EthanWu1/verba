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

module.exports = router;
