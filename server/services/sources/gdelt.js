'use strict';

const axios = require('axios');

async function search(query, limit = 5) {
  try {
    const resp = await axios.get('https://api.gdeltproject.org/api/v2/doc/doc', {
      params: {
        query,
        mode: 'ArtList',
        format: 'json',
        maxrecords: limit,
        sort: 'hybridrel',
      },
      timeout: 12000,
    });
    const items = resp.data?.articles || [];
    return items
      .map(a => {
        if (!a.url) return null;
        return {
          url: a.url,
          title: a.title || '',
          source: a.domain || a.sourcecountry || 'News',
          author: '',
          date: (a.seendate || '').replace(/^(\d{4})(\d{2})(\d{2}).*/, '$1-$2-$3'),
          adapter: 'gdelt',
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

module.exports = { search };
