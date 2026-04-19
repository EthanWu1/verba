'use strict';

const axios = require('axios');

const UA_EMAIL = process.env.CROSSREF_UA_EMAIL || 'verba@example.com';

/**
 * Resolve citation metadata via CrossRef.
 * Accepts either a DOI (preferred) or a title string.
 * Returns { author, date, title, source, url, doi } or null.
 */
async function resolve({ doi = '', title = '' } = {}) {
  try {
    if (doi) {
      const r = await axios.get(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, {
        timeout: 10000,
        headers: { 'User-Agent': `verba/1.0 (mailto:${UA_EMAIL})` },
      });
      return normalize(r.data?.message);
    }
    if (title) {
      const r = await axios.get('https://api.crossref.org/works', {
        params: { 'query.bibliographic': title, rows: 3 },
        timeout: 10000,
        headers: { 'User-Agent': `verba/1.0 (mailto:${UA_EMAIL})` },
      });
      const items = r.data?.message?.items || [];
      const match = items.find(it => jaccard(title, (it.title?.[0] || '')) >= 0.55);
      if (match) return normalize(match);
    }
  } catch {}
  return null;
}

function normalize(item) {
  if (!item) return null;
  const first = (item.author || [])[0] || {};
  const authorStr = item.author
    ? item.author.map(a => [a.given, a.family].filter(Boolean).join(' ')).filter(Boolean).join(', ')
    : '';
  const parts = item['published-print']?.['date-parts']?.[0]
    || item['published-online']?.['date-parts']?.[0]
    || item.created?.['date-parts']?.[0];
  const date = parts ? parts.map((n, i) => (i === 0 ? String(n) : String(n).padStart(2, '0'))).join('-') : '';
  return {
    author: authorStr,
    lastName: first.family || '',
    date,
    title: item.title?.[0] || '',
    source: item['container-title']?.[0] || item.publisher || '',
    url: item.URL || (item.DOI ? `https://doi.org/${item.DOI}` : ''),
    doi: item.DOI || '',
  };
}

function jaccard(a, b) {
  const tok = s => new Set(String(s).toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 3));
  const A = tok(a); const B = tok(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  A.forEach(w => { if (B.has(w)) inter++; });
  return inter / (A.size + B.size - inter);
}

module.exports = { resolve };
