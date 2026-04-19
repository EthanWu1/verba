'use strict';

const axios = require('axios');

async function search(query, limit = 5) {
  try {
    const resp = await axios.get('http://export.arxiv.org/api/query', {
      params: {
        search_query: `all:${query}`,
        start: 0,
        max_results: limit,
        sortBy: 'relevance',
      },
      timeout: 12000,
    });
    const xml = String(resp.data || '');
    const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(m => m[1]);
    return entries
      .map(entry => {
        const title = (entry.match(/<title>([\s\S]*?)<\/title>/)?.[1] || '').replace(/\s+/g, ' ').trim();
        const link = entry.match(/<link[^>]*rel="alternate"[^>]*href="([^"]+)"/)?.[1]
          || entry.match(/<id>([\s\S]*?)<\/id>/)?.[1] || '';
        const published = entry.match(/<published>([\s\S]*?)<\/published>/)?.[1] || '';
        const authors = [...entry.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>/g)]
          .map(m => m[1].trim()).join(', ');
        if (!link || !title) return null;
        return {
          url: link.replace(/^http:/, 'https:'),
          title,
          source: 'arXiv',
          author: authors,
          date: published.split('T')[0] || '',
          adapter: 'arxiv',
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

module.exports = { search };
