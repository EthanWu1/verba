'use strict';

const axios = require('axios');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
};

/**
 * Check if a URL is reachable (2xx/3xx on HEAD or GET).
 * On 404/410/5xx, try the latest archive.org snapshot.
 * Returns { ok: boolean, url: string (possibly archive), status: number, archived?: boolean }.
 */
async function reachable(url) {
  try {
    const resp = await axios.head(url, {
      headers: HEADERS,
      timeout: 10000,
      maxRedirects: 3,
      validateStatus: () => true,
    });
    if (resp.status >= 200 && resp.status < 400) {
      return { ok: true, url: resp.request?.res?.responseUrl || url, status: resp.status };
    }
  } catch {}

  // Some sites reject HEAD — try GET with tiny range
  try {
    const resp = await axios.get(url, {
      headers: { ...HEADERS, 'Range': 'bytes=0-256' },
      timeout: 10000,
      maxRedirects: 3,
      validateStatus: () => true,
      responseType: 'text',
    });
    if (resp.status >= 200 && resp.status < 400) {
      return { ok: true, url: resp.request?.res?.responseUrl || url, status: resp.status };
    }
  } catch {}

  // Fall back to archive.org latest snapshot
  try {
    const availability = await axios.get('https://archive.org/wayback/available', {
      params: { url },
      timeout: 10000,
    });
    const snap = availability.data?.archived_snapshots?.closest;
    if (snap?.available && snap.url) {
      return { ok: true, url: snap.url, status: snap.status || 200, archived: true };
    }
  } catch {}

  return { ok: false, url, status: 0 };
}

module.exports = { reachable };
