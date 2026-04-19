'use strict';

const axios = require('axios');

const BASE = 'https://api.unpaywall.org/v2';
const EMAIL = process.env.UNPAYWALL_EMAIL || 'verba@example.com';

function pickBestOaUrl(r) {
  const best = r?.best_oa_location;
  if (best?.url_for_pdf) return best.url_for_pdf;
  if (best?.url) return best.url;
  const any = (r?.oa_locations || []).find(l => l.url_for_pdf || l.url);
  return any?.url_for_pdf || any?.url || r?.doi_url || '';
}

async function search(query, limit = 8) {
  try {
    const resp = await axios.get(`${BASE}/search`, {
      params: { query, is_oa: true, email: EMAIL },
      timeout: 12000,
    });
    const results = resp.data?.results || [];
    return results.slice(0, limit).map(item => {
      const r = item.response || item;
      const url = pickBestOaUrl(r);
      if (!url) return null;
      const authors = Array.isArray(r.z_authors)
        ? r.z_authors.map(a => [a.given, a.family].filter(Boolean).join(' ')).filter(Boolean).join(', ')
        : '';
      return {
        url,
        title: r.title || '',
        source: r.journal_name || r.publisher || 'Unpaywall',
        author: authors,
        date: r.published_date || (r.year ? String(r.year) : ''),
        excerpt: '',
        doi: r.doi || '',
      };
    }).filter(Boolean);
  } catch {
    return [];
  }
}

async function resolveDoi(doi) {
  if (!doi) return null;
  try {
    const resp = await axios.get(`${BASE}/${encodeURIComponent(doi)}`, {
      params: { email: EMAIL },
      timeout: 8000,
    });
    const url = pickBestOaUrl(resp.data);
    return url || null;
  } catch {
    return null;
  }
}

module.exports = { search, resolveDoi };
