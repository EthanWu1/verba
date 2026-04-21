/**
 * routes/scrape.js
 * POST /api/scrape  — takes { url }, returns scraped metadata + body text + auto-cite
 */

'use strict';

const express = require('express');
const multer  = require('multer');
const path    = require('path');
const pdfParse = require('pdf-parse');
const router  = express.Router();

const { scrapeUrl } = require('../services/scraper');
const { buildCite } = require('../services/autocite');
const fileCache    = require('../services/fileCache');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
});

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

/* ════════════════════════════════════════
   POST /api/scrape/file  — multipart upload
   Field: file (PDF or TXT). Returns { token, filename, title, cite, chars, preview }.
   Token usable for 10 min via ?fileToken= on research-source-stream.
   ════════════════════════════════════════ */
router.post('/file', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  const { originalname, mimetype, buffer } = req.file;
  const ext = (path.extname(originalname) || '').toLowerCase();

  let bodyText = '';
  try {
    if (ext === '.pdf' || mimetype === 'application/pdf') {
      const parsed = await pdfParse(buffer);
      bodyText = String(parsed.text || '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    } else if (ext === '.txt' || mimetype === 'text/plain') {
      bodyText = buffer.toString('utf8').trim();
    } else {
      return res.status(415).json({ error: 'Only PDF or TXT are supported right now.' });
    }
  } catch (err) {
    console.error('[scrape/file] parse error:', err.message);
    return res.status(422).json({ error: 'Could not read that file.' });
  }

  if (!bodyText || bodyText.length < 50) {
    return res.status(422).json({ error: 'No readable text found in file.' });
  }

  const title = path.basename(originalname, ext);
  const year2 = new Date().getFullYear().toString().slice(-2);
  const cite = `[Uploaded file] ${title} ${year2}`;

  const token = fileCache.put({
    filename: originalname,
    title,
    cite,
    bodyText,
  });

  return res.json({
    token,
    filename: originalname,
    title,
    cite,
    chars: bodyText.length,
    preview: bodyText.slice(0, 300),
  });
});

module.exports = router;
