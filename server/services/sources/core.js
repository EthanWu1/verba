'use strict';

const axios = require('axios');

async function search(query, limit = 5) {
  const key = process.env.CORE_API_KEY;
  if (!key) return [];
  try {
    const resp = await axios.get('https://api.core.ac.uk/v3/search/works', {
      params: { q: query, limit },
      headers: { Authorization: `Bearer ${key}` },
      timeout: 12000,
    });
    const items = resp.data?.results || [];
    return items
      .map(r => {
        const url = r.downloadUrl || r.sourceFulltextUrls?.[0] || r.links?.find(l => l.type === 'download')?.url;
        if (!url) return null;
        return {
          url,
          title: r.title || '',
          source: r.publisher || r.sourceFulltextUrls ? 'CORE' : 'CORE',
          author: (r.authors || []).map(a => a.name).filter(Boolean).join(', '),
          date: r.publishedDate || r.yearPublished || '',
          adapter: 'core',
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

module.exports = { search };
