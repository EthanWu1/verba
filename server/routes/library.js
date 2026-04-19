'use strict';

const express = require('express');
const router = express.Router();

const { getLibraryDashboard, searchLibrary } = require('../services/docxImport');
const { getLibraryCards, getLibraryAnalytics } = require('../services/libraryQuery');

router.get('/dashboard', (req, res) => {
  const limit = Math.max(1, Math.min(50, Number(req.query.limit) || 12));
  return res.json(getLibraryDashboard(limit));
});

router.get('/search', (req, res) => {
  const q = String(req.query.q || '');
  const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));
  return res.json({ results: searchLibrary(q, limit) });
});

router.get('/cards', async (req, res) => {
  try {
    return res.json(await getLibraryCards({
      q: String(req.query.q || ''),
      limit: req.query.limit,
      page: req.query.page,
      sort: String(req.query.sort || 'relevance'),
      resolution: String(req.query.resolution || ''),
      type: String(req.query.type || ''),
      topic: String(req.query.topic || ''),
      source: String(req.query.source || ''),
      scope: String(req.query.scope || ''),
      canonical: req.query.canonical != null ? String(req.query.canonical) : '',
    }));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/analytics', (req, res) => {
  return res.json(getLibraryAnalytics());
});

module.exports = router;
