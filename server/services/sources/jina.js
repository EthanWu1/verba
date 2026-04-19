'use strict';

const axios = require('axios');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
};

async function fetchViaJina(url) {
  const mirror = `https://r.jina.ai/${url.replace(/^https?:\/\//i, 'http://')}`;
  try {
    const resp = await axios.get(mirror, {
      headers: HEADERS,
      timeout: 20000,
      maxContentLength: 4 * 1024 * 1024,
      maxBodyLength: 4 * 1024 * 1024,
    });
    const text = String(resp.data || '').replace(/\r/g, '').trim();
    const title = text.split('\n').find(l => l.startsWith('Title:'))?.replace(/^Title:\s*/i, '') || '';
    return { bodyText: text, title };
  } catch {
    return null;
  }
}

module.exports = { fetchViaJina };
