'use strict';

const express = require('express');
const router = express.Router();

const { previewZipImport } = require('../services/zipImporter');
const { importZipToLibrary, importDocxBuffer } = require('../services/docxImport');
const db = require('../services/db');

router.post('/zip-preview', async (req, res) => {
  const { zipPath = '', sampleSize = 25 } = req.body || {};

  try {
    const preview = await previewZipImport(zipPath, Math.max(1, Math.min(100, Number(sampleSize) || 25)));
    return res.json(preview);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.post('/zip-ingest', async (req, res) => {
  const { zipPath = '', maxDocs } = req.body || {};

  try {
    const result = await importZipToLibrary(zipPath, {
      maxDocs: Number.isFinite(Number(maxDocs)) ? Number(maxDocs) : Infinity,
    });
    return res.json(result);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.post('/docx-upload', express.raw({ type: '*/*', limit: '20mb' }), async (req, res) => {
  const label = String(req.query.label || 'manual-upload').replace(/[^a-zA-Z0-9._\- [\]]/g, '');
  try {
    const result = await importDocxBuffer(req.body, label);
    return res.json(result);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.get('/analytics', (req, res) => {
  const { q = '', limit = 50 } = req.query;
  try {
    const results = db.searchAnalytics(String(q), Math.max(1, Math.min(500, Number(limit) || 50)));
    return res.json(results);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
