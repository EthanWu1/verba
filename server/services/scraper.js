/**
 * services/scraper.js
 * Fetches a URL and extracts clean paragraph-preserving text for card cutting.
 *
 * Contract:
 *  - paragraphs: ordered list of {text, anchor} for every real block element.
 *  - bodyText: paragraphs joined by "\n\n". Never split mid-paragraph upstream.
 *  - Figures/charts/tables collapse to the literal token "[FIGURE OMITTED]".
 *  - Metadata (author/date) prefers JSON-LD; no invented values.
 */

'use strict';

const axios   = require('axios');
const cheerio = require('cheerio');

const NOISE_SELECTORS = [
  'nav', 'header', 'footer', 'aside',
  '.nav', '.navbar', '.header', '.footer', '.sidebar', '.menu',
  '.advertisement', '.ads', '.ad', '.cookie', '.popup', '.modal',
  '.related', '.recommended', '.social', '.share', '.newsletter',
  'script', 'style', 'noscript', 'iframe',
  '#nav', '#header', '#footer', '#sidebar',
  '[role="navigation"]', '[role="banner"]', '[role="complementary"]',
  '.paywall', '.subscription-prompt',
].join(', ');

const CONTENT_SELECTORS = [
  'article',
  '[role="main"]',
  'main',
  '.article-body',
  '.article-content',
  '.entry-content',
  '.post-content',
  '.content-body',
  '.full-text',
  '#abstract',
  '.abstract',
  '#content',
  '.content',
  'body',
];

const BLOCK_SELECTOR = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, pre';
const FIGURE_SELECTOR = 'figure, figcaption, img, svg, picture, table, .figure, [role="figure"]';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
  'Accept':     'text/html,application/xhtml+xml,application/pdf,*/*',
  'Accept-Language': 'en-US,en;q=0.9',
};

async function scrapeUrl(url) {
  if (url.toLowerCase().endsWith('.pdf') || url.includes('/pdf/')) {
    return scrapePdf(url);
  }

  let html;
  try {
    const resp = await axios.get(url, {
      headers: HEADERS,
      timeout: 8000,
      maxRedirects: 5,
      responseType: 'text',
      maxContentLength: 4 * 1024 * 1024,
      maxBodyLength: 4 * 1024 * 1024,
    });
    html = resp.data;
  } catch (err) {
    if (err.response?.status === 403 || err.response?.status === 401) {
      throw new Error(`Access denied (${err.response.status}). Try pasting the article text directly.`);
    }
    throw new Error(`Could not fetch URL: ${err.message}`);
  }

  if (html.length > 2_000_000) html = html.slice(0, 2_000_000);

  const $ = cheerio.load(html);
  const jsonLd = extractJsonLd($);

  $(NOISE_SELECTORS).remove();

  const title  = extractTitle($, jsonLd);
  const author = extractAuthor($, jsonLd);
  const date   = extractDate($, jsonLd);
  const source = extractSource($, url);

  let bodyEl = null;
  for (const sel of CONTENT_SELECTORS) {
    const el = $(sel).first();
    if (el.length && el.text().trim().length > 300) {
      bodyEl = el;
      break;
    }
  }

  const paragraphs = extractStructuredBody($, bodyEl || $('body'));
  let bodyText = paragraphs.map(p => p.text).join('\n\n');

  if (bodyText.length < 200) {
    bodyText = '[SCRAPE LIMITED] This site may be paywalled. Paste the article text directly.';
  }

  return {
    title,
    author,
    date,
    source,
    url,
    bodyText,
    paragraphs,
    isPdf: false,
  };
}

async function scrapePdf(url) {
  let pdfParse;
  try { pdfParse = require('pdf-parse'); } catch {
    throw new Error('pdf-parse not installed. Run: npm install pdf-parse');
  }

  const resp = await axios.get(url, {
    headers: HEADERS,
    responseType: 'arraybuffer',
    timeout: 30000,
  });

  const data = await pdfParse(resp.data);
  const rawLines = data.text.split(/\r?\n/);
  const paraBlocks = rawLines
    .join('\n')
    .split(/\n\s*\n+/)
    .map(block => block.split(/\n/).map(l => l.trim()).filter(Boolean).join(' '))
    .filter(block => block.length >= 2);

  const paragraphs = paraBlocks.map((text, i) => ({
    text,
    anchor: makeAnchor(text, i),
  }));

  const title    = rawLines.find(l => l.trim())?.trim() || 'Unknown Title';
  const author   = rawLines.slice(1, 6).find(l => /by |author/i.test(l))?.replace(/by |author:/gi, '').trim() || '';
  const date     = rawLines.slice(0, 20).find(l => /\b(20\d\d|19\d\d)\b/.test(l))?.match(/\b(20\d\d|19\d\d)\b/)?.[0] || '';

  return {
    title,
    author,
    date,
    source: 'PDF Document',
    url,
    bodyText: paragraphs.map(p => p.text).join('\n\n'),
    paragraphs,
    isPdf: true,
  };
}

function extractStructuredBody($, scope) {
  const seen = new Set();
  const paragraphs = [];

  scope.find(`${BLOCK_SELECTOR}, ${FIGURE_SELECTOR}`).each((_, el) => {
    if (seen.has(el)) return;
    seen.add(el);
    const $el = $(el);

    // Skip if an ancestor block already consumed this node
    let parent = el.parent;
    while (parent) {
      if (seen.has(parent)) return;
      parent = parent.parent;
    }

    if ($el.is(FIGURE_SELECTOR)) {
      const last = paragraphs[paragraphs.length - 1];
      if (!last || last.text !== '[FIGURE OMITTED]') {
        paragraphs.push({
          text: '[FIGURE OMITTED]',
          anchor: `figure-${paragraphs.length}`,
          isFigure: true,
        });
      }
      $el.find('*').each((__, d) => seen.add(d));
      return;
    }

    // Capture inner text while preserving spacing; do NOT drop words.
    // Only collapse runs of whitespace within a block — never drop tokens.
    const raw = $el.text().replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, ' ').trim();
    if (!raw) return;

    const anchor = $el.attr('id')
      || $el.closest('[id]').attr('id')
      || makeAnchor(raw, paragraphs.length);

    paragraphs.push({
      text: raw,
      anchor,
      tag: el.tagName || el.name || '',
    });

    $el.find(BLOCK_SELECTOR).each((__, d) => seen.add(d));
  });

  return paragraphs;
}

function makeAnchor(text, index) {
  const slug = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 6)
    .join('-');
  return slug ? `p-${index}-${slug}` : `p-${index}`;
}

function extractJsonLd($) {
  const blobs = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const parsed = JSON.parse($(el).contents().text());
      if (Array.isArray(parsed)) blobs.push(...parsed);
      else if (parsed['@graph']) blobs.push(...parsed['@graph']);
      else blobs.push(parsed);
    } catch {}
  });
  return blobs.filter(b => b && typeof b === 'object');
}

function findLdArticle(ld) {
  return ld.find(b => {
    const t = b['@type'];
    if (!t) return false;
    if (Array.isArray(t)) return t.some(x => /Article|NewsArticle|BlogPosting|ScholarlyArticle|Report/.test(String(x)));
    return /Article|NewsArticle|BlogPosting|ScholarlyArticle|Report/.test(String(t));
  });
}

function extractTitle($, ld) {
  const article = findLdArticle(ld);
  if (article?.headline) return String(article.headline).trim();
  const v = (
    $('meta[property="og:title"]').attr('content') ||
    $('meta[name="title"]').attr('content') ||
    $('h1').first().text() ||
    $('title').text()
  );
  return String(v || '').trim().replace(/\s+/g, ' ');
}

function extractAuthor($, ld) {
  const article = findLdArticle(ld);
  if (article?.author) {
    const a = article.author;
    const pick = v => {
      if (!v) return '';
      if (typeof v === 'string') return v;
      if (Array.isArray(v)) return v.map(pick).filter(Boolean).join(', ');
      return v.name || v['@id'] || '';
    };
    const v = pick(a).trim();
    if (v && !/^(staff|editor|team|admin)$/i.test(v)) return v;
  }

  const candidates = [
    $('meta[name="author"]').attr('content'),
    $('meta[property="article:author"]').attr('content'),
    $('[rel="author"]').first().text(),
    $('[itemprop="author"]').first().text(),
    $('[class*="byline"]').first().text(),
    $('[class*="author"]').first().text(),
  ];
  for (const c of candidates) {
    const t = String(c || '').trim().replace(/\s+/g, ' ').replace(/^by\s+/i, '');
    if (t && t.length < 120 && !/^(staff|editor|editorial team)$/i.test(t)) return t;
  }
  return '';
}

function extractDate($, ld) {
  const article = findLdArticle(ld);
  if (article?.datePublished) return String(article.datePublished).split('T')[0];
  if (article?.dateCreated) return String(article.dateCreated).split('T')[0];

  const candidates = [
    $('meta[property="article:published_time"]').attr('content'),
    $('meta[name="date"]').attr('content'),
    $('meta[itemprop="datePublished"]').attr('content'),
    $('time[datetime]').attr('datetime'),
    $('time').first().text(),
  ];
  for (const c of candidates) {
    const t = String(c || '').trim();
    if (!t) continue;
    const iso = t.split('T')[0];
    if (/\d{4}-\d{2}-\d{2}/.test(iso)) return iso;
    if (/\b(20\d\d|19\d\d)\b/.test(t)) return t.slice(0, 40);
  }
  return '';
}

function extractSource($, url) {
  const og = $('meta[property="og:site_name"]').attr('content');
  if (og) return String(og).trim();
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

module.exports = { scrapeUrl };
