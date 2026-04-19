'use strict';

const axios = require('axios');

const TAVILY_URL = 'https://api.tavily.com/search';

async function search(query, limit = 8) {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return [];
  try {
    const resp = await axios.post(TAVILY_URL, {
      api_key: key,
      query,
      search_depth: 'advanced',
      max_results: limit,
      include_raw_content: false,
      include_answer: false,
    }, { timeout: 15000 });
    const results = resp.data?.results || [];
    return results.map(r => ({
      url: r.url,
      title: r.title || '',
      source: (() => { try { return new URL(r.url).hostname.replace(/^www\./, ''); } catch { return ''; } })(),
      author: '',
      date: r.published_date || '',
      excerpt: r.content || '',
      score: r.score || 0,
    })).filter(r => r.url);
  } catch {
    return [];
  }
}

module.exports = { search };
