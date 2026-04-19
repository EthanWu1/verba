'use strict';

const axios = require('axios');

const UA = 'VerbatimAI/3.0 (mailto:ethanzhouwu@gmail.com)';

async function search(query, limit = 5) {
  try {
    const resp = await axios.get('https://api.openalex.org/works', {
      params: {
        search: query,
        per_page: limit,
        select: 'title,doi,publication_date,authorships,primary_location,open_access,id',
      },
      headers: { 'User-Agent': UA },
      timeout: 12000,
    });
    const items = resp.data?.results || [];
    return items
      .map(w => {
        const landing = w.primary_location?.landing_page_url;
        const pdf = w.open_access?.oa_url;
        const url = pdf || landing;
        if (!url) return null;
        return {
          url,
          title: w.title || '',
          source: w.primary_location?.source?.display_name || 'OpenAlex',
          author: (w.authorships || []).map(a => a.author?.display_name).filter(Boolean).join(', '),
          date: w.publication_date || '',
          doi: String(w.doi || '').replace(/^https?:\/\/doi\.org\//i, '').toLowerCase(),
          adapter: 'openAlex',
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

module.exports = { search };
