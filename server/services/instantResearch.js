'use strict';

const axios = require('axios');
const cheerio = require('cheerio');

const { scrapeUrl } = require('./scraper');
const { rankRelevance, pickBestWindow } = require('./gemini');

const semanticScholar = require('./sources/semanticScholar');
const openAlex = require('./sources/openAlex');
const coreApi = require('./sources/core');
const arxiv = require('./sources/arxiv');
const crossref = require('./sources/crossref');
const gdelt = require('./sources/gdelt');
const domainSearch = require('./sources/domainSearch');
const tavily = require('./sources/tavily');
const exa = require('./sources/exa');
const unpaywall = require('./sources/unpaywall');
const { fetchViaJina } = require('./sources/jina');
const { PRESTIGE_SITES } = require('./sources/domainSearch');
const { reachable } = require('./urlCheck');

const SEARCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
};

function normalizeText(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function tokenizeQuery(query) {
  return [...new Set(
    normalizeText(query)
      .split(/[^a-z0-9]+/i)
      .map(token => token.trim())
      .filter(token => token.length >= 3)
  )];
}

function createKeywordMatcher(query) {
  const tokens = tokenizeQuery(query);
  return value => {
    const haystack = normalizeText(value);
    if (!tokens.length) return Boolean(haystack);
    return tokens.some(token => haystack.includes(token));
  };
}

function scoreTextForQuery(query, value) {
  const haystack = normalizeText(value);
  const tokens = tokenizeQuery(query);
  if (!haystack || !tokens.length) return 0;
  return tokens.reduce((score, token) => {
    if (!haystack.includes(token)) return score;
    const exactMatches = haystack.split(token).length - 1;
    return score + 8 + exactMatches;
  }, 0);
}

function pickBestExcerpt(query, paragraphs) {
  if (!Array.isArray(paragraphs) || !paragraphs.length) return '';
  const ranked = paragraphs
    .filter(p => !p.isFigure && p.text.length >= 120)
    .map(p => ({ text: p.text, score: scoreTextForQuery(query, p.text) }))
    .sort((a, b) => b.score - a.score || b.text.length - a.text.length);
  const best = ranked[0]?.text || paragraphs[0]?.text || '';
  return best.length > 1600 ? `${best.slice(0, 1597).trimEnd()}...` : best;
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function prestigeBonus(url) {
  const host = hostOf(url);
  if (!host) return 0;
  const hit = PRESTIGE_SITES.find(s => host === s || host.endsWith(`.${s}`));
  return hit ? 2 : 0;
}

const SCHOLARLY_HOSTS = [
  'doi.org', 'arxiv.org', 'biorxiv.org', 'medrxiv.org', 'ssrn.com',
  'jstor.org', 'sciencedirect.com', 'springer.com', 'link.springer.com',
  'wiley.com', 'onlinelibrary.wiley.com', 'nature.com', 'science.org',
  'tandfonline.com', 'cambridge.org', 'oup.com', 'academic.oup.com',
  'pubmed.ncbi.nlm.nih.gov', 'ncbi.nlm.nih.gov', 'pmc.ncbi.nlm.nih.gov',
  'plos.org', 'journals.plos.org', 'frontiersin.org', 'mdpi.com',
  'sagepub.com', 'journals.sagepub.com', 'semanticscholar.org',
  'openalex.org', 'researchgate.net', 'core.ac.uk', 'hal.science',
  'scholar.archive.org', 'hathitrust.org', 'elifesciences.org',
  'apa.org', 'ieee.org', 'acm.org', 'rand.org', 'brookings.edu',
  'nber.org', 'cfr.org', 'csis.org', 'iiss.org', 'chathamhouse.org',
];

const BLOG_HOSTS = [
  'medium.com', 'substack.com', 'wordpress.com', 'blogspot.com',
  'tumblr.com', 'blogger.com', 'wix.com', 'squarespace.com',
  'reddit.com', 'quora.com', 'linkedin.com', 'twitter.com', 'x.com',
  'facebook.com', 'youtube.com', 'tiktok.com',
];

function scholarlyBonus(url) {
  const host = hostOf(url);
  if (!host) return 0;
  if (SCHOLARLY_HOSTS.some(s => host === s || host.endsWith(`.${s}`))) return 6;
  if (host.endsWith('.edu') || host.endsWith('.ac.uk') || host.endsWith('.gov')) return 5;
  if (BLOG_HOSTS.some(s => host === s || host.endsWith(`.${s}`))) return -4;
  if (/\/(blog|opinion|thoughts|musings)\//i.test(url)) return -2;
  return 0;
}

const SCHOLARLY_ADAPTERS = new Set(['Semantic Scholar', 'OpenAlex', 'Crossref', 'Unpaywall', 'arXiv', 'CORE']);

function dedupeByUrl(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (!item?.url) continue;
    const key = String(item.url).split('#')[0].replace(/\/$/, '');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} timeout ${ms}ms`)), ms)),
  ]);
}

async function fanoutResearch(query, perAdapter = 4, onPhase = null) {
  const defs = [
    ['Tavily',           () => tavily.search(query, perAdapter * 2)],
    ['Exa',              () => exa.search(query, perAdapter * 2)],
    ['Unpaywall',        () => unpaywall.search(query, perAdapter)],
    ['Semantic Scholar', () => semanticScholar.search(query, perAdapter)],
    ['OpenAlex',         () => openAlex.search(query, perAdapter)],
    ['Crossref',         () => crossref.search(query, perAdapter)],
    ['GDELT news',       () => gdelt.search(query, perAdapter)],
  ];
  if (onPhase) onPhase({ type: 'search_start', sources: defs.map(d => d[0]) });
  const wrapped = defs.map(([label, fn]) => {
    if (onPhase) onPhase({ type: 'search_adapter_start', source: label });
    return withTimeout(fn(), 10000, label).then(v => {
      if (onPhase) onPhase({ type: 'search_adapter_done', source: label, count: (v || []).length });
      return (v || []).map(item => ({ ...item, __adapter: label }));
    }).catch(err => {
      const msg = String(err?.message || err?.code || err || 'unknown').slice(0, 140);
      if (onPhase) onPhase({ type: 'search_adapter_error', source: label, error: msg });
      return [];
    });
  });
  const results = await Promise.allSettled(wrapped);
  const flat = results.flatMap(r => (r.status === 'fulfilled' ? r.value : []));
  // Dedupe but keep scholarly version if duplicate URL comes from multiple adapters
  const byKey = new Map();
  for (const item of flat) {
    if (!item?.url) continue;
    const key = String(item.url).split('#')[0].replace(/\/$/, '');
    const existing = byKey.get(key);
    if (!existing || (SCHOLARLY_ADAPTERS.has(item.__adapter) && !SCHOLARLY_ADAPTERS.has(existing.__adapter))) {
      byKey.set(key, item);
    }
  }
  return [...byKey.values()];
}

async function scrapeWithConcurrency(candidates, limit = 5, onPhase = null) {
  const out = [];
  let cursor = 0;
  async function worker() {
    while (cursor < candidates.length) {
      const idx = cursor++;
      const c = candidates[idx];
      if (onPhase) onPhase({ type: 'scrape_start', url: c.url, title: c.title || '' });
      try {
        const article = await withTimeout(scrapeUrl(c.url), 12000, 'scrape');
        // Reject abstract-only landing pages: require enough body text that it's
        // clearly not just an abstract. Real articles run 3000+ chars.
        const bt = article.bodyText || '';
        const looksAbstractOnly = bt.length < 1800 || /^\s*abstract[:\s]/i.test(bt.slice(0, 200));
        if (bt && !looksAbstractOnly && !bt.startsWith('[SCRAPE LIMITED]')) {
          const enriched = {
            ...article,
            author: article.author || c.author || '',
            date: article.date || c.date || '',
            doi: article.doi || c.doi || '',
            source: article.source || c.source || '',
            title: article.title || c.title || '',
          };
          if (onPhase) onPhase({ type: 'scrape_done', url: c.url, chars: article.bodyText.length });
          out.push({ candidate: c, article: enriched });
          continue;
        }
      } catch (err) {
        const reason = String(err?.message || err?.code || err || 'unknown').slice(0, 140);
        if (onPhase) onPhase({ type: 'scrape_retry', url: c.url, reason });
      }
      const mirror = await withTimeout(fetchViaJina(c.url), 10000, 'jina').catch(() => null);
      if (mirror?.bodyText && mirror.bodyText.length >= 500) {
        if (onPhase) onPhase({ type: 'scrape_done', url: c.url, chars: mirror.bodyText.length, via: 'jina' });
        out.push({
          candidate: c,
          article: {
            title: c.title || mirror.title || c.url,
            author: c.author || '',
            date: c.date || '',
            doi: c.doi || '',
            source: c.source || hostOf(c.url),
            url: c.url,
            bodyText: mirror.bodyText,
            paragraphs: mirror.bodyText.split(/\n\s*\n+/).map((t, i) => ({ text: t.trim(), anchor: `jina-${i}` })).filter(p => p.text),
            isPdf: false,
          },
        });
      }
    }
  }
  const workers = Array.from({ length: Math.min(limit, candidates.length) }, worker);
  await Promise.all(workers);
  return out;
}

async function findBestResearchSource({ query, url = '', onPhase = null }) {
  if (url.trim()) {
    if (onPhase) onPhase({ type: 'mode', mode: 'url', url: url.trim() });
    const reach = await reachable(url.trim()).catch(() => ({ ok: false, url: url.trim() }));
    const finalUrl = reach.ok ? reach.url : url.trim();
    if (!reach.ok) throw new Error(`URL unreachable and no archive snapshot: ${url.trim()}`);
    if (onPhase) onPhase({ type: 'scrape_start', url: finalUrl });
    const article = await withTimeout(scrapeUrl(finalUrl), 12000, 'scrape-url');
    const doiMatch = finalUrl.match(/doi\.org\/(10\.\d+\/[^\s?#]+)/i);
    if (doiMatch && !article.doi) article.doi = doiMatch[1].toLowerCase();
    if (onPhase) onPhase({ type: 'scrape_done', url: article.url || url.trim(), chars: (article.bodyText || '').length });
    const pick = await withTimeout(
      pickBestWindow({ intent: query, paragraphs: article.paragraphs || [] }),
      12000,
      'pick'
    ).catch(() => ({ window: null, reason: 'pick-timeout', windows: [] }));
    return {
      mode: 'url',
      article,
      excerpt: pick.window?.text || pickBestExcerpt(query, article.paragraphs || []),
      candidates: [{ url: article.url, title: article.title || article.source || article.url }],
      window: pick.window,
      windowReason: pick.reason,
    };
  }

  if (onPhase) onPhase({ type: 'mode', mode: 'search', query });
  const candidates = await fanoutResearch(query, 4, onPhase);
  if (!candidates.length) {
    throw new Error('No research articles found across academic + news sources.');
  }

  // Pre-rank: scholarly adapters + scholarly hosts first, blogs last
  const preRanked = [...candidates].sort((a, b) => {
    const sa = (SCHOLARLY_ADAPTERS.has(a.__adapter) ? 5 : 0) + scholarlyBonus(a.url);
    const sb = (SCHOLARLY_ADAPTERS.has(b.__adapter) ? 5 : 0) + scholarlyBonus(b.url);
    return sb - sa;
  });
  const capped = preRanked.slice(0, 10);

  // URL reachability filter — swap 404s for archive.org snapshots, drop dead.
  const reach = await Promise.all(capped.map(c =>
    withTimeout(reachable(c.url), 6000, 'reachable').catch(() => ({ ok: false, url: c.url }))
  ));
  const reachable_capped = capped
    .map((c, i) => reach[i].ok ? { ...c, url: reach[i].url, archived: reach[i].archived || false } : null)
    .filter(Boolean)
    .slice(0, 6);
  if (!reachable_capped.length) {
    throw new Error('All candidate URLs returned 404/dead with no archive snapshot.');
  }

  if (onPhase) onPhase({ type: 'scrape_phase_start', count: reachable_capped.length });
  const scraped = await scrapeWithConcurrency(reachable_capped, 4, onPhase);
  if (!scraped.length) {
    throw new Error('Search results returned but none scraped cleanly enough to cut.');
  }

  const rankingInput = scraped.map(s => ({
    title: s.article.title || s.candidate.title,
    source: s.article.source || s.candidate.source,
    date: s.article.date || s.candidate.date,
    url: s.article.url,
    bodyText: s.article.bodyText,
  }));

  if (onPhase) onPhase({ type: 'rank_start', candidates: rankingInput.length });
  let ranked = [];
  try {
    ranked = await withTimeout(
      rankRelevance({ query, intent: query, candidates: rankingInput }),
      15000,
      'rank'
    );
  } catch {
    ranked = [];
  }
  if (onPhase) onPhase({ type: 'rank_done' });

  const withBonus = scraped.map((s, idx) => {
    const r = ranked.find(x => x.idx === idx);
    const aiScore = r?.score || 0;
    const keywordScore = Math.min(6, scoreTextForQuery(query, `${s.article.title} ${s.article.bodyText.slice(0, 500)}`) / 8);
    const bonus = prestigeBonus(s.article.url);
    const scholar = scholarlyBonus(s.article.url);
    const adapterBonus = SCHOLARLY_ADAPTERS.has(s.candidate?.__adapter) ? 4 : 0;
    return {
      ...s,
      aiScore,
      keywordScore,
      bonus,
      scholar,
      adapterBonus,
      total: aiScore + bonus + scholar + adapterBonus + (aiScore === 0 ? keywordScore : 0),
      reason: r?.reason || '',
    };
  });

  withBonus.sort((a, b) => b.total - a.total);
  const winner = withBonus.find(s => s.total >= 6) || withBonus[0];

  if (onPhase) onPhase({ type: 'pick_start', url: winner.article.url, title: winner.article.title, source: winner.article.source });
  const pick = await withTimeout(
    pickBestWindow({ intent: query, paragraphs: winner.article.paragraphs || [] }),
    12000,
    'pick'
  ).catch(() => ({ window: null, reason: 'pick-timeout', windows: [] }));
  if (onPhase) onPhase({ type: 'pick_done' });

  return {
    mode: 'search',
    article: winner.article,
    excerpt: pick.window?.text || pickBestExcerpt(query, winner.article.paragraphs || []),
    candidates: capped,
    window: pick.window,
    windowReason: pick.reason,
    ranking: {
      top: withBonus.slice(0, 5).map(s => ({
        url: s.article.url,
        title: s.article.title,
        source: s.article.source,
        score: s.total,
        ai: s.aiScore,
        bonus: s.bonus,
        reason: s.reason,
      })),
    },
    lowConfidence: winner.total < 6,
  };
}

function buildInstantLibraryBullets(query, cards) {
  const cleanQuery = String(query || '').trim();
  if (!cards.length) {
    return [
      'No indexed cards matched that query.',
      'Try a narrower keyword string or a shorter phrase.',
    ];
  }
  return [
    'Instant mode: local retrieval only.',
    ...cards.slice(0, 5).map(card => {
      const meta = [card.shortCite || card.cite, card.topicLabel, card.typeLabel].filter(Boolean).join(' | ');
      return `${card.tag || 'Untitled card'}${meta ? ` (${meta})` : ''}`;
    }),
    cleanQuery ? `Query: ${cleanQuery}` : 'Query: all cards',
  ];
}

// Legacy shim kept for callers that still need raw search
async function searchArticles(query, limit = 8) {
  const res = await fanoutResearch(query, Math.ceil(limit / 2));
  return res.slice(0, limit).map(c => ({ url: c.url, title: c.title }));
}

module.exports = {
  createKeywordMatcher,
  scoreTextForQuery,
  pickBestExcerpt,
  searchArticles,
  findBestResearchSource,
  buildInstantLibraryBullets,
};
