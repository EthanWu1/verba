'use strict';

const axios = require('axios');

const UA = 'VerbatimAI/3.0 (mailto:ethanzhouwu@gmail.com)';

async function search(query, limit = 5) {
  try {
    const resp = await axios.get('https://api.crossref.org/works', {
      params: {
        query,
        rows: limit,
        select: 'DOI,title,author,issued,container-title,URL,abstract',
      },
      headers: { 'User-Agent': UA },
      timeout: 12000,
    });
    const items = resp.data?.message?.items || [];
    return items
      .map(w => {
        const url = w.URL || (w.DOI ? `https://doi.org/${w.DOI}` : '');
        if (!url) return null;
        const parts = w.issued?.['date-parts']?.[0] || [];
        const date = parts.length ? parts.join('-') : '';
        const title = Array.isArray(w.title) ? w.title[0] : w.title;
        const authors = (w.author || []).map(a => [a.given, a.family].filter(Boolean).join(' ')).join(', ');
        return {
          url,
          title: title || '',
          source: Array.isArray(w['container-title']) ? w['container-title'][0] : w['container-title'] || 'Crossref',
          author: authors,
          date,
          doi: w.DOI || '',
          adapter: 'crossref',
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

module.exports = { search };
