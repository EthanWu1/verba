'use strict';

const axios = require('axios');

const EXA_URL = 'https://api.exa.ai/search';

async function search(query, limit = 8) {
  const key = process.env.EXA_API_KEY;
  if (!key) return [];
  try {
    const resp = await axios.post(EXA_URL, {
      query,
      type: 'auto',
      num_results: limit,
      contents: {
        text: { max_characters: 2000 },
      },
    }, {
      headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
      timeout: 20000,
    });
    const results = resp.data?.results || [];
    return results.map(r => ({
      url: r.url,
      title: r.title || '',
      source: (() => { try { return new URL(r.url).hostname.replace(/^www\./, ''); } catch { return ''; } })(),
      author: r.author || '',
      date: r.publishedDate || r.published_date || '',
      excerpt: (r.text || r.summary || '').slice(0, 1600),
      score: r.score || 0,
    })).filter(r => r.url);
  } catch {
    return [];
  }
}

module.exports = { search };
