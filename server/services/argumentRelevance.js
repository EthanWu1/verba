'use strict';

/**
 * argumentRelevance.js — paragraph pre-filter for the card cutter.
 *
 * Given an article body and a debater argument, returns the top-K
 * paragraphs by relevance, plus their immediate neighbours, in
 * original-document order. Cuts ~70% of input tokens before the LLM
 * ever sees the article.
 *
 * Method: BM25 over whitespace+lowercase tokens, with English stopword
 * removal. Pure-deterministic, sub-millisecond, zero LLM cost.
 *
 * If argument is empty/short, falls back to "first K body paragraphs"
 * (matches today's smartTruncate behaviour, just paragraph-aware).
 */

const { stripAbstractPrelude, stripBoilerplateSections } = require('../prompts/cardCutter');

const STOPWORDS = new Set([
  'a','an','the','of','to','in','on','for','at','by','with','from','as','is',
  'are','was','were','be','been','being','it','its','this','that','these','those',
  'and','or','but','if','then','so','than','because','while','about','into','over',
  'under','through','out','up','down','no','not','nor','do','does','did','done',
  'have','has','had','having','will','would','could','should','may','might','must',
  'can','i','you','he','she','they','we','them','their','his','her','our','your',
  'who','whom','which','what','when','where','why','how','also','such','only','own',
  'same','some','any','more','most','few','many','each','all','both','other','another',
]);

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t && t.length >= 2 && !STOPWORDS.has(t));
}

function splitParagraphs(text) {
  return String(text || '')
    .split(/\n\s*\n+/)
    .map(p => p.trim())
    .filter(Boolean);
}

// Split overly-long paragraphs at sentence boundaries so BM25 can rank
// FRAGMENTS of them rather than treating the whole giant block as a single
// candidate. Without this, K-card sources like a Wilderson interview or
// a Meiches paper (one 18,000-char paragraph) cause the model to pick 5
// random sentences out of dozens — different runs, different picks, huge
// run-to-run variance.
//
// Strategy: paragraphs <= MAX_PARAGRAPH_CHARS pass through untouched.
// Larger ones are sliced into sentence groups of ~TARGET_CHUNK_CHARS each.
// Sentence detection is regex-based ([.!?] followed by space/quote/end).
// Single sentences >TARGET_CHUNK_CHARS stay whole — we never split a
// sentence in half.
const MAX_PARAGRAPH_CHARS = 1500;
const TARGET_CHUNK_CHARS  = 600;

function splitGiantParagraphs(paragraphs, maxChars = MAX_PARAGRAPH_CHARS, targetChars = TARGET_CHUNK_CHARS) {
  const out = [];
  for (const p of paragraphs) {
    if (p.length <= maxChars) {
      out.push(p);
      continue;
    }
    // Match sentence-like spans: chars up to and including a [.!?], then
    // optional closing quote/paren and trailing whitespace. Catches "...end."
    // and "...end!" reliably; falls back to whole paragraph if no matches.
    const sentences = p.match(/[^.!?]+[.!?]+(?:["'\)\]]\s*|\s+|$)/g) || [p];
    let current = '';
    for (const s of sentences) {
      if (!current) {
        current = s;
      } else if (current.length + s.length <= targetChars) {
        current += s;
      } else {
        out.push(current.trim());
        current = s;
      }
    }
    const tail = current.trim();
    if (tail) out.push(tail);
  }
  return out;
}

// BM25 with Okapi defaults (k1=1.5, b=0.75).
function bm25Rank({ corpus, query, k1 = 1.5, b = 0.75 }) {
  const N = corpus.length;
  if (!N) return [];
  const docTokens = corpus.map(tokenize);
  const docLengths = docTokens.map(t => t.length);
  const avgdl = docLengths.reduce((a, n) => a + n, 0) / N || 1;

  // Document frequency.
  const df = Object.create(null);
  for (const tokens of docTokens) {
    const seen = new Set();
    for (const t of tokens) {
      if (seen.has(t)) continue;
      seen.add(t);
      df[t] = (df[t] || 0) + 1;
    }
  }

  const queryTokens = tokenize(query);
  if (!queryTokens.length) {
    return corpus.map((_, i) => ({ index: i, score: 0 }));
  }

  // IDF with Robertson-Spärck-Jones smoothing.
  const idf = Object.create(null);
  for (const t of new Set(queryTokens)) {
    const n = df[t] || 0;
    idf[t] = Math.log(1 + (N - n + 0.5) / (n + 0.5));
  }

  const scores = [];
  for (let i = 0; i < N; i++) {
    const tokens = docTokens[i];
    if (!tokens.length) { scores.push({ index: i, score: 0 }); continue; }
    const tf = Object.create(null);
    for (const t of tokens) tf[t] = (tf[t] || 0) + 1;
    const dl = docLengths[i];
    let score = 0;
    for (const t of new Set(queryTokens)) {
      const f = tf[t] || 0;
      if (!f) continue;
      const num = f * (k1 + 1);
      const den = f + k1 * (1 - b + b * (dl / avgdl));
      score += (idf[t] || 0) * (num / den);
    }
    scores.push({ index: i, score });
  }
  return scores;
}

/**
 * selectCandidates — main entry point.
 *
 * @param {object}  args
 * @param {string}  args.bodyText        — full article body (paragraphs separated by blank lines).
 * @param {string}  [args.argument='']   — debater intent / warrant query.
 * @param {number}  [args.k=15]          — target number of relevance-picked paragraphs.
 * @param {number}  [args.neighbours=1]  — also include ±N neighbours of each pick (preserves flow).
 * @param {boolean} [args.stripBoilerplate=true]
 *
 * @returns {object} {
 *   candidates: [{ index, originalIndex, text }],   // ordered by original document position
 *   skipped:    [{ originalIndex, text, reason }],  // boilerplate dropped pre-rank
 *   totalParagraphs: number,                        // paragraphs after boilerplate strip
 * }
 */
function selectCandidates({
  bodyText,
  argument = '',
  k = 15,
  neighbours = 1,
  stripBoilerplate = true,
} = {}) {
  let body = String(bodyText || '');
  if (stripBoilerplate) {
    body = stripBoilerplateSections(stripAbstractPrelude(body));
  }
  // Split paragraphs, then dice any giant paragraphs into smaller chunks so
  // BM25 ranks at the warrant-sentence level instead of the whole-block level.
  // Critical for K-card sources where one huge paragraph contains dozens of
  // theoretical claims; without this, model picks ~5 sentences randomly.
  const rawParagraphs = splitParagraphs(body);
  const paragraphs = splitGiantParagraphs(rawParagraphs);
  if (!paragraphs.length) {
    return { candidates: [], skipped: [], totalParagraphs: 0 };
  }

  // For very short articles, return everything in original order.
  if (paragraphs.length <= k) {
    return {
      candidates: paragraphs.map((text, i) => ({ index: i, originalIndex: i, text })),
      skipped: [],
      totalParagraphs: paragraphs.length,
    };
  }

  const trimmedQuery = argument.trim();
  let chosenIndices;

  if (trimmedQuery && tokenize(trimmedQuery).length >= 1) {
    // BM25 path.
    const ranked = bm25Rank({ corpus: paragraphs, query: trimmedQuery })
      .sort((a, b) => b.score - a.score);

    const chosen = new Set();
    // Pick top K above zero.
    for (const r of ranked) {
      if (chosen.size >= k) break;
      if (r.score <= 0) break;
      chosen.add(r.index);
    }
    // If BM25 returned fewer than K, top up with leading paragraphs (article body).
    if (chosen.size < k) {
      for (let i = 0; i < paragraphs.length && chosen.size < k; i++) {
        chosen.add(i);
      }
    }
    // Add neighbours.
    if (neighbours > 0) {
      const expanded = new Set(chosen);
      for (const idx of chosen) {
        for (let d = 1; d <= neighbours; d++) {
          if (idx - d >= 0) expanded.add(idx - d);
          if (idx + d < paragraphs.length) expanded.add(idx + d);
        }
      }
      chosenIndices = [...expanded].sort((a, b) => a - b);
    } else {
      chosenIndices = [...chosen].sort((a, b) => a - b);
    }
  } else {
    // No argument → first K paragraphs.
    chosenIndices = [];
    for (let i = 0; i < Math.min(k, paragraphs.length); i++) chosenIndices.push(i);
  }

  const candidates = chosenIndices.map((origIdx, i) => ({
    index: i,                 // index in candidate set (what the model emits)
    originalIndex: origIdx,   // index in source article
    text: paragraphs[origIdx],
  }));

  return {
    candidates,
    skipped: [],
    totalParagraphs: paragraphs.length,
  };
}

module.exports = {
  selectCandidates,
  tokenize,            // exported for tests
  bm25Rank,            // exported for tests
  splitParagraphs,
  splitGiantParagraphs,
  MAX_PARAGRAPH_CHARS,
  TARGET_CHUNK_CHARS,
  STOPWORDS,
};
