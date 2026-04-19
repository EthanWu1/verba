'use strict';

const axios = require('axios');

const UA = 'VerbatimAI/3.0 (contact: ethanzhouwu@gmail.com)';

async function search(query, limit = 5) {
  const url = 'https://api.semanticscholar.org/graph/v1/paper/search';
  try {
    const resp = await axios.get(url, {
      params: {
        query,
        limit,
        fields: 'title,authors,year,openAccessPdf,externalIds,venue,url,abstract,publicationDate',
      },
      headers: { 'User-Agent': UA },
      timeout: 12000,
    });
    const items = resp.data?.data || [];
    return items
      .map(p => {
        const openUrl = p.openAccessPdf?.url || p.url;
        if (!openUrl) return null;
        return {
          url: openUrl,
          title: p.title || '',
          source: p.venue || 'Semantic Scholar',
          author: (p.authors || []).map(a => a.name).filter(Boolean).join(', '),
          date: p.publicationDate || (p.year ? String(p.year) : ''),
          doi: p.externalIds?.DOI || '',
          abstract: p.abstract || '',
          adapter: 'semanticScholar',
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

module.exports = { search };
