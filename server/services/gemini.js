'use strict';

const { complete, parseJSON } = require('./llm');

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'google/gemini-2.5-flash-lite';

function firstWords(text, n) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, n)
    .join(' ');
}

async function callGeminiJSON({ system, user, maxTokens = 900 }) {
  const result = await complete({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.1,
    maxTokens,
    forceModel: GEMINI_MODEL,
  });
  return parseJSON(result.content);
}

async function rankRelevance({ query, intent = '', candidates }) {
  if (!candidates.length) return [];

  const payload = candidates.map((c, idx) => ({
    idx,
    title: c.title || '',
    source: c.source || '',
    date: c.date || '',
    url: c.url || '',
    excerpt: firstWords(c.bodyText || c.abstract || c.title, 450),
  }));

  const system = `You rank search results for LD debate card cutting.
The debater needs evidence that supports their stated INTENT, not merely keyword matches.
Score each candidate 0-10 on: relevance to the intent, quality of warrants, source credibility.
Penalize off-topic, tangential, or keyword-only matches.
Return JSON only: {"ranked":[{"idx":N,"score":N,"reason":"one short sentence"}]}.`;

  const user = `QUERY: ${query}
DEBATER INTENT: ${intent || query}

CANDIDATES:
${JSON.stringify(payload, null, 2)}

Score every candidate. Return strict JSON.`;

  try {
    const out = await callGeminiJSON({ system, user, maxTokens: 1200 });
    const list = Array.isArray(out?.ranked) ? out.ranked : [];
    return list
      .map(item => ({
        idx: Number(item.idx),
        score: Number(item.score) || 0,
        reason: String(item.reason || ''),
      }))
      .filter(item => Number.isFinite(item.idx) && item.idx >= 0 && item.idx < candidates.length);
  } catch {
    return [];
  }
}

function splitIntoWindows(paragraphs, targetWords = 400, overlap = 1) {
  if (!Array.isArray(paragraphs) || !paragraphs.length) return [];
  const windows = [];
  let buffer = [];
  let wordCount = 0;

  const flush = () => {
    if (!buffer.length) return;
    const text = buffer.map(p => p.text).join('\n\n');
    windows.push({
      idx: windows.length,
      startParagraph: buffer[0].index,
      endParagraph: buffer[buffer.length - 1].index,
      text,
    });
  };

  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i];
    const words = (p.text || '').split(/\s+/).filter(Boolean).length;
    buffer.push({ index: i, text: p.text, words });
    wordCount += words;
    if (wordCount >= targetWords) {
      flush();
      buffer = buffer.slice(-overlap);
      wordCount = buffer.reduce((sum, b) => sum + b.words, 0);
    }
  }
  flush();
  return windows;
}

const BOILERPLATE_RE = /\b(references|bibliography|acknowledg(e)?ments?|works cited|about the author|author bio|author note|disclosures?|conflicts of interest|funding statement|appendix|citation|doi:|©|copyright)\b/i;

function tokenizeIntent(s) {
  return [...new Set(
    String(s || '').toLowerCase().split(/[^a-z0-9]+/)
      .filter(t => t.length >= 4)
  )];
}

function scoreWindowKeyword(text, tokens) {
  if (!tokens.length) return 0;
  const hay = String(text || '').toLowerCase();
  let score = 0;
  for (const t of tokens) {
    const matches = hay.split(t).length - 1;
    if (matches) score += 3 + Math.min(matches, 4);
  }
  return score;
}

function warrantSignals(text) {
  const s = String(text || '').toLowerCase();
  let n = 0;
  if (/\b(because|therefore|thus|hence|consequently|as a result|leads to|causes?)\b/.test(s)) n += 2;
  if (/\d+(\.\d+)?\s?(%|percent|million|billion|trillion|bps|years?|deaths?)/.test(s)) n += 2;
  if (/\b(study|research|report|analysis|data|findings?|evidence|paper)\b/.test(s)) n += 1;
  if (BOILERPLATE_RE.test(s)) n -= 4;
  return n;
}

async function pickBestWindow({ intent, paragraphs }) {
  const windows = splitIntoWindows(paragraphs, 400, 1);
  if (windows.length <= 1) {
    return {
      window: windows[0] || null,
      reason: windows.length ? 'only-window' : 'no-windows',
      windows,
    };
  }

  const tokens = tokenizeIntent(intent);
  const scored = windows.map(w => ({
    w,
    kw: scoreWindowKeyword(w.text, tokens),
    sig: warrantSignals(w.text),
  })).map(x => ({ ...x, pre: x.kw + x.sig }));

  scored.sort((a, b) => b.pre - a.pre);
  const top = scored.slice(0, Math.min(5, scored.length));

  if (top.length === 1) {
    return { window: top[0].w, reason: 'keyword-only-survivor', windows };
  }

  const payload = top.map(x => ({
    idx: x.w.idx,
    text: firstWords(x.w.text, 450),
  }));

  const system = `You select the single best passage from a long article for a debate card.
Pick the window with the strongest warrants matching the debater INTENT.
Prefer: empirical claims, causal mechanisms, quantified impacts, named experts.
Avoid: intros, bios, throat-clearing, tangents, references lists.
Return JSON only: {"best":N,"reason":"one sentence"}.`;

  const user = `DEBATER INTENT: ${intent}

WINDOWS (already pre-filtered by keyword+warrant signals):
${JSON.stringify(payload, null, 2)}

Return strict JSON.`;

  try {
    const out = await callGeminiJSON({ system, user, maxTokens: 300 });
    const bestIdx = Number(out?.best);
    const picked = windows.find(w => w.idx === bestIdx) || top[0].w;
    return { window: picked, reason: String(out?.reason || ''), windows };
  } catch {
    return { window: top[0].w, reason: 'fallback-keyword-top', windows };
  }
}

module.exports = {
  GEMINI_MODEL,
  rankRelevance,
  pickBestWindow,
  splitIntoWindows,
};
