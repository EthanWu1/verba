/**
 * services/webfetch.js
 * Lightweight HTML fetch backend, powered by Jina Reader (https://r.jina.ai).
 *
 * Why Jina:
 *  - Zero local infrastructure (no docker, no playwright, no extra RAM).
 *  - Public endpoint, free tier works without an API key.
 *  - Returns cleaned HTML so existing cheerio extractors in scraper.js keep
 *    working unchanged. Verbatim fidelity preserved.
 *
 * Set USE_WEBFETCH=true in .env to route scrapes through this client.
 * JINA_API_KEY is optional but raises rate limits.
 */

'use strict';

const JINA_BASE = 'https://r.jina.ai';
const JINA_API_KEY = process.env.JINA_API_KEY || '';

/**
 * Fetch a URL via Jina Reader and return cleaned HTML.
 * @param {string} url
 * @param {object} [opts]
 * @param {number} [opts.timeout]   request timeout (ms)
 * @param {object} [opts.headers]   extra headers (e.g. Cookie passed through)
 * @returns {Promise<{html: string, metadata: object, statusCode: number}>}
 */
async function fetchHtml(url, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeout || 25000);

  const headers = {
    'X-Return-Format': 'html',
    'Accept': 'text/html',
  };
  if (JINA_API_KEY) headers['Authorization'] = `Bearer ${JINA_API_KEY}`;
  if (opts.headers?.Cookie) headers['X-Set-Cookie'] = opts.headers.Cookie;

  try {
    const resp = await fetch(`${JINA_BASE}/${url}`, { headers, signal: ctrl.signal });
    if (!resp.ok) {
      throw new Error(`jina ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
    }
    const html = await resp.text();
    if (!html || html.length < 50) throw new Error('jina returned empty html');
    return { html, metadata: {}, statusCode: resp.status };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Health-check ping.
 */
async function isAvailable() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2000);
    const resp = await fetch(`${JINA_BASE}/https://example.com`, { signal: ctrl.signal });
    clearTimeout(t);
    return resp.ok;
  } catch {
    return false;
  }
}

module.exports = { fetchHtml, isAvailable };
