/**
 * routes/scrape.js
 * POST /api/scrape  — takes { url }, returns scraped metadata + body text + auto-cite
 */

'use strict';

const express = require('express');
const router  = express.Router();

const { scrapeUrl } = require('../services/scraper');
const { buildCite } = require('../services/autocite');

/* ════════════════════════════════════════
   POST /api/scrape
   Body: { url, inferQuals? }
   Returns: { title, author, date, source, url, bodyText, cite, citeData }
   ════════════════════════════════════════ */
router.post('/', async (req, res) => {
  const { url, inferQuals = true } = req.body;

  if (!url || !url.startsWith('http')) {
    return res.status(400).json({ error: 'A valid http/https URL is required.' });
  }

  let scraped;
  try {
    scraped = await scrapeUrl(url);
  } catch (err) {
    console.error('[scrape] Error:', err.message);
    return res.status(422).json({ error: err.message });
  }

  // Build auto-cite string
  let citeData = null;
  let cite     = '';
  try {
    citeData = await buildCite(scraped, { inferQuals });
    cite     = citeData.citeString;
  } catch (err) {
    console.warn('[scrape] AutoCite failed (non-fatal):', err.message);
    cite = `${scraped.author || 'Unknown'} ${new Date().getFullYear().toString().slice(-2)} (${scraped.title || 'Unknown Title'}, ${scraped.source || url})`;
  }

  return res.json({
    title:    scraped.title,
    author:   scraped.author,
    date:     scraped.date,
    source:   scraped.source,
    url:      scraped.url,
    isPdf:    scraped.isPdf,
    bodyText: scraped.bodyText,
    cite,
    citeData,
  });
});

module.exports = router;
