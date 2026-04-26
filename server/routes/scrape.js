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

const { scrapeUrl }    = require('../services/scraper');
const { buildCite }    = require('../services/autocite');
const fileCache        = require('../services/fileCache');
const { fetchViaJina } = require('../services/sources/jina');

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
  let viaJina = false;
  try {
    scraped = await scrapeUrl(url);
  } catch (err) {
    console.warn('[scrape] direct fetch failed:', err.message);
    // Cloudflare / 403 / paywall? Retry via Jina Reader, which proxies through
    // their headless infra and bypasses bot challenges.
    const jina = await fetchViaJina(url);
    if (!jina || !jina.bodyText || jina.bodyText.length < 80) {
      return res.status(422).json({ error: err.message });
    }
    // Jina returns text with a metadata header followed by "Markdown Content:".
    // Pull the title/source/published-time out and use the remainder as bodyText.
    const full = jina.bodyText;
    const headerEnd = full.indexOf('Markdown Content:');
    const header    = headerEnd >= 0 ? full.slice(0, headerEnd) : '';
    const body      = headerEnd >= 0 ? full.slice(headerEnd + 'Markdown Content:'.length) : full;
    const grab = (re) => { const m = header.match(re); return m ? m[1].trim() : ''; };
    const title  = jina.title || grab(/Title:\s*(.+)/i);
    const date   = grab(/Published Time:\s*(.+)/i);
    const author = grab(/(?:Author|Byline):\s*(.+)/i);
    let source;
    try { source = new URL(url).host.replace(/^www\./, ''); } catch { source = ''; }
    scraped = {
      title:    title || '',
      author:   author || '',
      date:     date || '',
      source,
      url,
      isPdf:    false,
      bodyText: body.trim(),
    };
    viaJina = true;
    console.log(`[scrape] recovered via Jina (${scraped.bodyText.length} chars)`);
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
