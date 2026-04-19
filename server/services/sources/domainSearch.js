'use strict';

const axios = require('axios');
const cheerio = require('cheerio');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
};

const PRESTIGE_SITES = [
  'brookings.edu', 'rand.org', 'cfr.org', 'un.org', 'worldbank.org',
  'nature.com', 'science.org', 'nytimes.com', 'foreignaffairs.com',
  'wsj.com', 'theguardian.com', 'economist.com', 'reuters.com',
  'bbc.com', 'ft.com', 'nber.org', 'jstor.org', 'pewresearch.org',
  'carnegieendowment.org', 'chathamhouse.org', 'iiss.org',
];

function buildSiteFilter() {
  return PRESTIGE_SITES.map(s => `site:${s}`).join(' OR ');
}

function unwrapDuckDuckGoUrl(value) {
  const href = String(value || '').trim();
  if (!href) return '';
  if (/^https?:\/\//i.test(href)) return href;
  try {
    const parsed = new URL(href, 'https://duckduckgo.com');
    const redirect = parsed.searchParams.get('uddg');
    return redirect ? decodeURIComponent(redirect) : href;
  } catch {
    return href;
  }
}

function matchSource(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    const hit = PRESTIGE_SITES.find(s => host === s || host.endsWith(`.${s}`));
    return hit || host;
  } catch {
    return '';
  }
}

async function search(query, limit = 8) {
  const q = `${query} (${buildSiteFilter()})`;
  const results = [];

  for (const url of [
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`,
    `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}`,
  ]) {
    if (results.length >= limit) break;
    try {
      const resp = await axios.get(url, { headers: HEADERS, timeout: 15000 });
      const $ = cheerio.load(resp.data);
      $('a[href]').each((_, node) => {
        if (results.length >= limit) return false;
        const href = unwrapDuckDuckGoUrl($(node).attr('href'));
        const title = $(node).text().replace(/\s+/g, ' ').trim();
        if (!href || !title || !/^https?:\/\//i.test(href)) return;
        if (href.includes('duckduckgo.com')) return;
        if (!PRESTIGE_SITES.some(s => href.includes(s))) return;
        if (results.some(r => r.url === href)) return;
        results.push({
          url: href,
          title,
          source: matchSource(href),
          author: '',
          date: '',
          adapter: 'domainSearch',
        });
      });
    } catch {}
  }

  return results.slice(0, limit);
}

module.exports = { search, PRESTIGE_SITES };
