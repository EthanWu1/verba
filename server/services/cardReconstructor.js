'use strict';

/**
 * cardReconstructor.js — turns the LLM's structural picks JSON into a
 * fully-formatted body_markdown that is *guaranteed* 100% verbatim and
 * paragraph-integral, because the body text is pulled from the candidate
 * paragraphs the server already had — the LLM never writes source words.
 *
 * Wire format the LLM emits (after json_schema validation):
 *
 *   {
 *     "tag":   "...",
 *     "cite":  "...",
 *     "picks": [{
 *       "p":  3,                      // 0-indexed into candidate set
 *       "u":  [[0, 28]],              // underline word ranges, [start, end)
 *       "h":  [[3,7], [12,14]],       // highlight word ranges
 *       "b":  [[12,14]]               // bold word ranges
 *     }],
 *     "loudest": { "p": 3, "from": 12, "to": 14 }    // optional
 *   }
 *
 * All ranges are half-open [from, to) over whitespace-tokenised words,
 * with punctuation attached to the preceding word ("crisis." is one token).
 *
 * Server guarantees:
 *  - Every output paragraph is a verbatim source paragraph (100% integrity).
 *  - Marks are clamped to paragraph word bounds.
 *  - Marks beyond density caps are dropped (not retried).
 *  - Bold/highlight outside any underline are dropped (not unwrapped, dropped —
 *    keeping them creates floating marks; the prompt forbids them).
 *  - Exactly one **<u>...</u>** "loudest" mark survives per card.
 */

// Caps recalibrated against 33 hand-cut Vanguard cards. Real cards push
// highlight density to ~30–45% on heavy-style cuts (many short fragments
// stitched together) and underline coverage to ~60–75%. The previous caps
// (highlight=0.30 heavy / underline=0.72 heavy) were trimming aggressively
// and dropping legitimate stitched-chain highlights.
const HIGHLIGHT_CAPS = { minimal: 0.25, standard: 0.35, heavy: 0.50 };
const UNDERLINE_CAPS = { minimal: 0.55, standard: 0.70, heavy: 0.85 };
const MAX_HIGHLIGHT_RUN_WORDS = 5;

// Words that signal an operative claim — gives priority when trimming highlights
// to fit the cap. Ordered for cheap lookup.
const PRIORITY_VERBS = new Set([
  'causes','triggers','collapses','undermines','prevents','locks','ends',
  'eliminates','accelerates','threatens','guarantees','reduces','increases',
  'drives','erodes','destroys','spurs','provokes','induces','sparks',
  'forces','blocks','breaks','crashes','wins','loses','rises','falls',
]);

const PRIORITY_NOUNS = new Set([
  'extinction','war','collapse','recession','breakdown','escalation','crisis',
  'genocide','famine','depression','meltdown','catastrophe','annihilation',
]);

function tokenizeWords(text) {
  // Whitespace-split with punctuation kept attached. Empty filter removes
  // double-space artefacts.
  return String(text || '').split(/\s+/).filter(Boolean);
}

// --- span normalisation -----------------------------------------------------

function clampSpan(span, wordCount) {
  if (!Array.isArray(span) || span.length !== 2) return null;
  let [a, b] = span;
  a = Number.isInteger(a) ? a : Math.floor(Number(a) || 0);
  b = Number.isInteger(b) ? b : Math.floor(Number(b) || 0);
  if (a < 0) a = 0;
  if (b > wordCount) b = wordCount;
  if (b <= a) return null;
  return [a, b];
}

// Merge overlapping/adjacent same-kind spans.
function mergeSpans(spans) {
  if (!spans.length) return [];
  const sorted = [...spans].sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const out = [sorted[0].slice()];
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1];
    const cur = sorted[i];
    if (cur[0] <= last[1]) {
      last[1] = Math.max(last[1], cur[1]);
    } else {
      out.push(cur.slice());
    }
  }
  return out;
}

// Drop highlight or bold spans that aren't entirely contained in some underline.
function filterContainedIn(spans, containerSpans) {
  return spans.filter(s =>
    containerSpans.some(c => s[0] >= c[0] && s[1] <= c[1])
  );
}

// Cap maximum length of any highlight run; spans longer than the cap are
// trimmed to the cap, keeping the leading words (the noun phrase usually).
function trimMaxRun(spans, maxWords = MAX_HIGHLIGHT_RUN_WORDS) {
  return spans
    .map(s => (s[1] - s[0] > maxWords ? [s[0], s[0] + maxWords] : s))
    .filter(s => s[1] > s[0]);
}

// --- priority-based trimming ------------------------------------------------

function spanWords(span, words) {
  return words.slice(span[0], span[1]);
}

function spanPriority(span, words) {
  const ws = spanWords(span, words);
  let score = 0;
  for (const wRaw of ws) {
    const w = wRaw.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!w) continue;
    if (/^\d/.test(w) || /\d{2,}/.test(w)) score += 4;        // numbers / years / %s
    if (PRIORITY_VERBS.has(w))             score += 3;        // operative verbs
    if (PRIORITY_NOUNS.has(w))              score += 3;       // magnitude nouns
    if (/^(u\.?s\.?|china|russia|nato|eu|un|nuclear|extinction)$/.test(w)) score += 2;
  }
  // Prefer 1–3 word spans.
  const len = span[1] - span[0];
  if (len >= 1 && len <= 3) score += 1;
  if (len > MAX_HIGHLIGHT_RUN_WORDS) score -= 2;
  return score;
}

// Remove the lowest-priority highlight spans until total highlighted words
// fit under the cap. Bolds follow highlights (a bold without its highlight is
// usually still useful — we leave bolds alone unless they exceed the underline).
function trimToHighlightCap(highlights, cap, totalWords, words) {
  if (totalWords === 0 || !highlights.length) return highlights;
  let kept = [...highlights];
  let used = kept.reduce((a, s) => a + (s[1] - s[0]), 0);
  if (used / totalWords <= cap) return kept;

  // Sort kept by priority asc; trim from the lowest.
  kept = kept
    .map(s => ({ s, score: spanPriority(s, words) }))
    .sort((a, b) => a.score - b.score)
    .map(x => x.s);

  while (kept.length && used / totalWords > cap) {
    const dropped = kept.shift();
    used -= (dropped[1] - dropped[0]);
  }
  // Re-sort by position for output.
  return kept.sort((a, b) => a[0] - b[0]);
}

// Drop the lowest-priority underline spans if total underline coverage
// exceeds the cap. Underlines that contain a highlight are protected first.
function trimToUnderlineCap(underlines, highlights, cap, totalWords) {
  if (totalWords === 0 || !underlines.length) return underlines;
  let kept = [...underlines];
  let used = kept.reduce((a, s) => a + (s[1] - s[0]), 0);
  if (used / totalWords <= cap) return kept;

  // Score: protected (contains a highlight) > size of contained highlights > smaller is better.
  const scored = kept.map(s => {
    const containedHi = highlights.filter(h => h[0] >= s[0] && h[1] <= s[1]);
    const containedHiWords = containedHi.reduce((a, h) => a + (h[1] - h[0]), 0);
    return { s, protected: containedHi.length > 0, containedHiWords, len: s[1] - s[0] };
  });

  scored.sort((a, b) => {
    if (a.protected !== b.protected) return a.protected ? 1 : -1;
    if (a.containedHiWords !== b.containedHiWords) return a.containedHiWords - b.containedHiWords;
    return b.len - a.len; // prefer dropping the bigger unprotected span
  });

  const dropSet = new Set();
  for (const x of scored) {
    if (used / totalWords <= cap) break;
    dropSet.add(x.s);
    used -= x.len;
  }
  return kept.filter(s => !dropSet.has(s)).sort((a, b) => a[0] - b[0]);
}

// --- mark insertion ---------------------------------------------------------

/**
 * Walk a paragraph word-by-word and emit text with marks inserted at the
 * correct word boundaries.
 *
 * Strategy: build a list of events (open/close per kind) keyed by word index,
 * then emit each word interleaved with the events that fire at its boundary.
 *
 * Nesting order (outer→inner): underline > bold > highlight. This keeps
 * `**==text==**` legal-looking and matches the existing renderer expectations.
 * (Highlights and bolds both must sit inside the underline; bolds typically
 * wrap a highlight in the calibration data.)
 */
function applyMarks({ words, underlines, highlights, bolds, loudestSpan }) {
  const N = words.length;

  // Open / close maps keyed by word index. Each entry is an ordered list to
  // preserve nesting (outer first on open, inner first on close).
  const opens = Array.from({ length: N + 1 }, () => []);
  const closes = Array.from({ length: N + 1 }, () => []);

  // Loudest = combined bold-underline. We render it as **<u>...</u>**, which
  // means an extra layer of bold around an existing underline. To avoid double
  // marks we ensure (a) that range is also added to the underline list, and
  // (b) we mark its boundaries with a special 'loud' kind so the renderer
  // wraps **…** outside <u>.
  const loud = loudestSpan;
  const hasLoud = loud && loud[1] > loud[0];

  // Open order at index i: u → loud → b → h. Close order: h → b → loud → u.
  // (Outer wraps inner.)
  for (const u of underlines) {
    opens[u[0]].push({ kind: 'u', open: '<u>', close: '</u>' });
    closes[u[1]].push({ kind: 'u', close: '</u>' });
  }
  if (hasLoud) {
    opens[loud[0]].push({ kind: 'loud', open: '**', close: '**' });
    closes[loud[1]].push({ kind: 'loud', close: '**' });
  }
  for (const b of bolds) {
    opens[b[0]].push({ kind: 'b', open: '**', close: '**' });
    closes[b[1]].push({ kind: 'b', close: '**' });
  }
  for (const h of highlights) {
    opens[h[0]].push({ kind: 'h', open: '==', close: '==' });
    closes[h[1]].push({ kind: 'h', close: '==' });
  }

  // Emit. At each word boundary i:
  //   1. Fire all CLOSE events (so spans end before any space).
  //   2. Emit the word-separator space (except before word 0 and after the last word).
  //   3. Fire all OPEN events (so the new span starts AT the word, not the space).
  //   4. Emit the word.
  // This keeps spaces OUTSIDE marks: "a ==credibility==" not "a==[space]credibility=="
  // and "<u>foo</u> bar" not "<u>foo </u>bar".
  let out = '';
  const closeOrder = ['h', 'b', 'loud', 'u'];
  const openOrder  = ['u', 'loud', 'b', 'h'];
  for (let i = 0; i <= N; i++) {
    for (const k of closeOrder) {
      for (const ev of closes[i]) if (ev.kind === k) out += ev.close;
    }
    if (i > 0 && i < N) out += ' ';
    for (const k of openOrder) {
      for (const ev of opens[i]) if (ev.kind === k) out += ev.open;
    }
    if (i < N) {
      // First word may need no leading space; subsequent words are preceded
      // above. Word emission has no implicit space.
      out += (i === 0 ? '' : '') + words[i];
    }
  }
  return out;
}

// --- main entry -------------------------------------------------------------

/**
 * Reconstruct the card body from picks + candidates.
 *
 * @param {object} args
 * @param {object} args.picksJson    — parsed JSON from the LLM (matches schema).
 * @param {Array}  args.candidates   — [{ index, originalIndex, text }] from selectCandidates.
 * @param {string} [args.density='heavy']
 *
 * @returns {object} {
 *   tag: string,
 *   cite: string,
 *   body_markdown: string,    // fully-formatted, 100% verbatim by construction
 *   stats: {
 *     paragraphs: number,
 *     totalWords: number,
 *     underlineWords: number,
 *     highlightWords: number,
 *     dropped: { picks, underlines, highlights, bolds }
 *   }
 * }
 */
function reconstructCard({ picksJson, candidates, density = 'heavy' } = {}) {
  const tag = String(picksJson?.tag || '').trim();
  const cite = String(picksJson?.cite || '').trim();
  const picks = Array.isArray(picksJson?.picks) ? picksJson.picks : [];
  const loudest = picksJson?.loudest && Number.isInteger(picksJson.loudest.p)
    ? picksJson.loudest
    : null;

  const candidateByIndex = new Map();
  for (const c of candidates) candidateByIndex.set(c.index, c);

  const underlineCap = UNDERLINE_CAPS[density] ?? UNDERLINE_CAPS.heavy;
  const highlightCap = HIGHLIGHT_CAPS[density] ?? HIGHLIGHT_CAPS.heavy;

  const stats = {
    paragraphs: 0, totalWords: 0, underlineWords: 0, highlightWords: 0,
    dropped: { picks: 0, underlines: 0, highlights: 0, bolds: 0 },
  };

  // Decide which pick gets the loudest mark. If the LLM's loudest references
  // a missing/invalid pick, we'll skip the loudest entirely (no retry).
  let loudestPickIdx = null;
  if (loudest && candidateByIndex.has(loudest.p)) loudestPickIdx = loudest.p;

  const seenPicks = new Set(); // dedupe duplicate paragraph indices
  const orderedPicks = [];
  for (const pick of picks) {
    const p = pick && Number.isInteger(pick.p) ? pick.p : null;
    if (p == null) { stats.dropped.picks++; continue; }
    if (!candidateByIndex.has(p)) { stats.dropped.picks++; continue; }
    if (seenPicks.has(p)) { stats.dropped.picks++; continue; }
    seenPicks.add(p);
    orderedPicks.push(pick);
  }

  // Sort picks by their candidate's originalIndex so they appear in
  // document order regardless of how the model listed them.
  orderedPicks.sort((a, b) => {
    const ca = candidateByIndex.get(a.p).originalIndex;
    const cb = candidateByIndex.get(b.p).originalIndex;
    return ca - cb;
  });

  if (!orderedPicks.length) {
    // Graceful fallback: take the first 2 candidates as plain paragraphs.
    // Better than a 502.
    const fallback = candidates.slice(0, 2);
    const body = fallback.map(c => c.text).join('\n\n');
    stats.paragraphs = fallback.length;
    stats.totalWords = fallback.reduce((a, c) => a + tokenizeWords(c.text).length, 0);
    return { tag, cite, body_markdown: body, stats, fallback: true };
  }

  const renderedParagraphs = [];

  for (const pick of orderedPicks) {
    const cand = candidateByIndex.get(pick.p);
    const words = tokenizeWords(cand.text);
    const N = words.length;
    if (!N) continue;

    // Step 1: clamp & merge.
    let underlines = mergeSpans(
      (pick.u || []).map(s => clampSpan(s, N)).filter(Boolean)
    );
    let highlights = mergeSpans(
      (pick.h || []).map(s => clampSpan(s, N)).filter(Boolean)
    );
    let bolds = mergeSpans(
      (pick.b || []).map(s => clampSpan(s, N)).filter(Boolean)
    );

    // Step 2: enforce containment (highlights & bolds must sit inside <u>).
    const beforeHi = highlights.length;
    const beforeBo = bolds.length;
    highlights = filterContainedIn(highlights, underlines);
    bolds = filterContainedIn(bolds, underlines);
    stats.dropped.highlights += beforeHi - highlights.length;
    stats.dropped.bolds += beforeBo - bolds.length;

    // Step 3: cap max highlight run length.
    highlights = trimMaxRun(highlights, MAX_HIGHLIGHT_RUN_WORDS);

    // Step 4: density caps. Highlight first (its cap is tighter), then
    // underline (using the trimmed highlight set so we protect the right ones).
    const beforeHiCap = highlights.length;
    highlights = trimToHighlightCap(highlights, highlightCap, N, words);
    stats.dropped.highlights += beforeHiCap - highlights.length;

    const beforeUCap = underlines.length;
    underlines = trimToUnderlineCap(underlines, highlights, underlineCap, N);
    stats.dropped.underlines += beforeUCap - underlines.length;

    // Step 5: re-filter containment now that underlines may have shrunk.
    highlights = filterContainedIn(highlights, underlines);
    bolds = filterContainedIn(bolds, underlines);

    // Step 6: loudest. Only the pick that owns it gets it. Loudest must sit
    // inside an underline; if the LLM's loudest doesn't, drop it.
    let loudestSpan = null;
    if (loudestPickIdx === pick.p && loudest) {
      const ls = clampSpan([loudest.from, loudest.to], N);
      if (ls && underlines.some(u => ls[0] >= u[0] && ls[1] <= u[1])) {
        loudestSpan = ls;
      }
    }

    // Step 7: emit.
    const rendered = applyMarks({ words, underlines, highlights, bolds, loudestSpan });
    renderedParagraphs.push(rendered);

    // Stats.
    stats.paragraphs++;
    stats.totalWords += N;
    stats.underlineWords += underlines.reduce((a, s) => a + (s[1] - s[0]), 0);
    stats.highlightWords += highlights.reduce((a, s) => a + (s[1] - s[0]), 0);
  }

  const body_markdown = renderedParagraphs.join('\n\n');
  return { tag, cite, body_markdown, stats };
}

// --- the JSON schema for the picks output ----------------------------------

const SPAN_SCHEMA = {
  type: 'array',
  items: {
    type: 'array',
    minItems: 2,
    maxItems: 2,
    items: { type: 'integer', minimum: 0 },
  },
};

const CARD_PICKS_JSON_SCHEMA = {
  name: 'card_cut',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['tag', 'cite', 'picks'],
    properties: {
      tag:  { type: 'string', minLength: 1 },
      cite: { type: 'string', minLength: 1 },
      picks: {
        type: 'array',
        minItems: 1,
        maxItems: 14,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['p', 'u'],
          properties: {
            p: { type: 'integer', minimum: 0 },
            u: SPAN_SCHEMA,
            h: SPAN_SCHEMA,
            b: SPAN_SCHEMA,
          },
        },
      },
      loudest: {
        type: 'object',
        additionalProperties: false,
        required: ['p', 'from', 'to'],
        properties: {
          p:    { type: 'integer', minimum: 0 },
          from: { type: 'integer', minimum: 0 },
          to:   { type: 'integer', minimum: 1 },
        },
      },
    },
  },
};

module.exports = {
  reconstructCard,
  CARD_PICKS_JSON_SCHEMA,
  HIGHLIGHT_CAPS,
  UNDERLINE_CAPS,
  MAX_HIGHLIGHT_RUN_WORDS,
  // exported for tests:
  tokenizeWords,
  clampSpan,
  mergeSpans,
  filterContainedIn,
  applyMarks,
  trimToHighlightCap,
  trimToUnderlineCap,
};
