'use strict';

const axios = require('axios');

/**
 * Resolve citation metadata via Wikipedia Citoid.
 * Returns Zotero-formatted fields normalized to { author, date, title, source, url } or null.
 */
async function resolve(url) {
  if (!url) return null;
  try {
    const r = await axios.get(
      `https://en.wikipedia.org/api/rest_v1/data/citation/mediawiki/${encodeURIComponent(url)}`,
      {
        timeout: 12000,
        headers: { 'User-Agent': 'verba/1.0 (https://github.com/)' },
      }
    );
    const first = Array.isArray(r.data) ? r.data[0] : r.data;
    if (!first) return null;
    const authors = first.author || [];
    const authorStr = authors
      .map(a => Array.isArray(a) ? a.filter(Boolean).join(' ') : String(a || ''))
      .filter(Boolean)
      .join(', ');
    const lastName = authors[0] && Array.isArray(authors[0]) ? authors[0][1] || authors[0][0] || '' : '';
    return {
      author: authorStr,
      lastName,
      date: first.date || first.issued || '',
      title: first.title || '',
      source: first.publicationTitle || first.websiteTitle || first.publisher || '',
      url: first.url || url,
    };
  } catch {
    return null;
  }
}

module.exports = { resolve };
