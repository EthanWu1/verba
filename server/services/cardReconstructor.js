'use strict';

/**
 * cardReconstructor.js — turns the LLM's structural picks JSON into a
 * fully-formatted body_markdown that is *guaranteed* 100% verbatim and
 * paragraph-integral, because the body text is pulled from the candidate
 * paragraphs the server already had — the LLM never writes source words.
 *
 * v3: CHARACTER OFFSETS (was word offsets in v2). The Vanguard markup
 * style requires partial-word highlighting (e.g. ==**<u>n</u>**== of
 * "Northern", or "U.S." rendered as ==U==.==S==. by highlighting just
 * those characters). Word-level offsets cannot express this.
 *
 * Wire format the LLM emits (after json_object validation):
 *
 *   {
 *     "tag":   "...",
 *     "cite":  "...",
 *     "picks": [{
 *       "p":  3,                       // 0-indexed into candidate set
 *       "u":  [[0, 145]],              // [from, to) CHARACTER ranges
 *       "h":  [[0, 4], [12, 35]],      // half-open, into the paragraph string
 *       "b":  [[12, 35]]
 *     }],
 *     "loudest": { "p": 3, "from": 12, "to": 35 }   // optional
 *   }
 *
 * All ranges are half-open [from, to) over the paragraph's character
 * string (1-byte JS chars). Ranges can start/end mid-word — that's the
 * point. Spaces and punctuation count as characters.
 *
 * Server guarantees:
 *  - Every output paragraph is a verbatim source paragraph (100% integrity).
 *  - Marks are clamped to paragraph bounds.
 *  - Marks beyond density caps are dropped (not retried).
 *  - Bold/highlight outside any underline are dropped.
 *  - Exactly one **<u>...</u>** "loudest" mark survives per card.
 */

// Density caps are SAFETY NETS, not enforced targets. They only fire if
// the model emits something absurd. The PROMPT drives correct density via
// argument-driven reasoning; the server's only hard rule is verbatim
// integrity. Word-boundary snap + punctuation trim = cosmetic safety.
const HIGHLIGHT_CAPS = { minimal: 0.30, standard: 0.45, heavy: 0.60 };
const UNDERLINE_CAPS = { minimal: 0.55, standard: 0.70, heavy: 0.80 };
const BOLD_CAPS      = { minimal: 0.15, standard: 0.25, heavy: 0.35 };

// Maximum length of a single highlight RUN. 50 chars allows ~8-word
// phrase-level claims like "locks in catastrophic warming above 3
// degrees" without trimming.
const MAX_HIGHLIGHT_RUN_CHARS = 50;

// When the model lazily underlines 100% of a paragraph, we ABANDON its
// underline and auto-regenerate underlines wrapping the highlights with
// some context margin on each side. This prevents the "everything
// underlined" failure mode regardless of how lazy the model is.
const LAZY_UNDERLINE_THRESHOLD = 0.90;
const AUTO_UNDERLINE_MARGIN_CHARS = 40;

// --- span normalisation -----------------------------------------------------

function clampSpan(span, textLength) {
  if (!Array.isArray(span) || span.length !== 2) return null;
  let [a, b] = span;
  a = Number.isInteger(a) ? a : Math.floor(Number(a) || 0);
  b = Number.isInteger(b) ? b : Math.floor(Number(b) || 0);
  if (a < 0) a = 0;
  if (b > textLength) b = textLength;
  if (b <= a) return null;
  return [a, b];
}

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

function filterContainedIn(spans, containerSpans) {
  return spans.filter(s =>
    containerSpans.some(c => s[0] >= c[0] && s[1] <= c[1])
  );
}

// Trim spans to maxChars. After trimming the END, re-snap to nearest
// word boundary so we don't cut "extended" into "exte". Pass `text` to
// enable the snap; without text, falls back to plain truncation.
function trimMaxRun(spans, maxChars = MAX_HIGHLIGHT_RUN_CHARS, text = '') {
  return spans
    .map(s => {
      if (s[1] - s[0] <= maxChars) return s;
      const truncated = [s[0], s[0] + maxChars];
      if (!text) return truncated;
      // Snap the truncated end backward to a word boundary so we don't
      // leave a partial word at the cut.
      const snapped = snapToWordBoundaries(truncated, text);
      return snapped || null;
    })
    .filter(s => s && s[1] > s[0]);
}

// Snap a span to nearest word boundaries. The model emits char offsets that
// often cut through the middle of words ("exte|nded" instead of "extended").
// Snap conservatively — shrink mid-word edges inward to preserve readability.
//
// Rules:
//  - If `from` is mid-word (text[from-1] AND text[from] are both word chars),
//    move from forward until we hit a word boundary.
//  - If `to` is mid-word (text[to-1] AND text[to] are both word chars),
//    move to backward until we hit a word boundary.
//  - If span collapses to empty after snapping, return null (drop).
//  - Punctuation and whitespace are NOT word chars, so they act as boundaries.
//  - Single-char highlights at word boundaries (e.g. "U" of "United" with a
//    space before and "." after) are PRESERVED — that's the partial-word
//    abbreviation feature.
function snapToWordBoundaries(span, text) {
  if (!span) return null;
  let [from, to] = span;
  const isWord = (i) => i >= 0 && i < text.length && /[a-zA-Z0-9]/.test(text[i]);

  // Snap 'from' forward past mid-word position.
  while (from < to && isWord(from - 1) && isWord(from)) from++;
  // Snap 'from' forward past leading whitespace and punctuation — highlights
  // shouldn't START with a space/comma/period/quote.
  while (from < to && /[\s,.;:!?")\]}]/.test(text[from] || '')) from++;

  // Snap 'to' backward past mid-word position.
  while (to > from && isWord(to - 1) && isWord(to)) to--;
  // Snap 'to' backward past trailing whitespace — highlights shouldn't END
  // with a space (visually "highlights spaces"). Trailing punctuation is
  // OK because it's part of the read (e.g. "U.S.").
  while (to > from && /\s/.test(text[to - 1] || '')) to--;

  if (to <= from) return null;
  return [from, to];
}

function snapSpansToWordBoundaries(spans, text) {
  return spans.map(s => snapToWordBoundaries(s, text)).filter(Boolean);
}

// --- priority scoring (used when over cap) ----------------------------------

const PRIORITY_VERBS = new Set([
  'causes','triggers','collapses','undermines','prevents','locks','ends',
  'eliminates','accelerates','threatens','guarantees','reduces','increases',
  'drives','erodes','destroys','spurs','provokes','induces','sparks',
  'forces','blocks','breaks','crashes','wins','loses','rises','falls',
  'risk','collapse','war','threat','death','kill','destroy',
]);
const PRIORITY_NOUNS = new Set([
  'extinction','war','collapse','recession','breakdown','escalation','crisis',
  'genocide','famine','depression','meltdown','catastrophe','annihilation',
  'death','nuclear','weapons','attack','bomb',
]);
const PRIORITY_ENTITIES = new Set([
  'us','u.s.','china','russia','iran','israel','korea','nato','eu','un',
  'putin','trump','biden','xi','kim',
]);

function spanTextLower(span, paraText) {
  return paraText.slice(span[0], span[1]).toLowerCase();
}

function spanPriority(span, paraText) {
  const t = spanTextLower(span, paraText);
  let score = 0;
  if (/\d/.test(t)) score += 4;                         // numbers / years
  for (const w of t.split(/[^a-z0-9.]+/).filter(Boolean)) {
    if (PRIORITY_VERBS.has(w))    score += 3;
    if (PRIORITY_NOUNS.has(w))    score += 3;
    if (PRIORITY_ENTITIES.has(w)) score += 2;
  }
  // Prefer 1–4 word spans (~5–25 chars in english).
  const len = span[1] - span[0];
  if (len >= 1 && len <= 25) score += 1;
  if (len > MAX_HIGHLIGHT_RUN_CHARS) score -= 2;
  return score;
}

function trimToHighlightCap(highlights, cap, totalChars, paraText) {
  if (totalChars === 0 || !highlights.length) return highlights;
  let kept = [...highlights];
  let used = kept.reduce((a, s) => a + (s[1] - s[0]), 0);
  if (used / totalChars <= cap) return kept;

  kept = kept
    .map(s => ({ s, score: spanPriority(s, paraText) }))
    .sort((a, b) => a.score - b.score)
    .map(x => x.s);

  while (kept.length && used / totalChars > cap) {
    const dropped = kept.shift();
    used -= (dropped[1] - dropped[0]);
  }
  return kept.sort((a, b) => a[0] - b[0]);
}

function trimToUnderlineCap(underlines, highlights, cap, totalChars, paragraphText = '') {
  if (totalChars === 0 || !underlines.length) return underlines;
  let kept = [...underlines];
  let used = kept.reduce((a, s) => a + (s[1] - s[0]), 0);
  if (used / totalChars <= cap) return kept;

  const scored = kept.map(s => {
    const containedHi = highlights.filter(h => h[0] >= s[0] && h[1] <= s[1]);
    const containedHiChars = containedHi.reduce((a, h) => a + (h[1] - h[0]), 0);
    return { s, protected: containedHi.length > 0, containedHiChars, len: s[1] - s[0] };
  });

  scored.sort((a, b) => {
    if (a.protected !== b.protected) return a.protected ? 1 : -1;
    if (a.containedHiChars !== b.containedHiChars) return a.containedHiChars - b.containedHiChars;
    return b.len - a.len;
  });

  // Phase 1: drop unprotected spans that exceed the cap.
  const protectedRemaining = () => kept.filter(s => !dropSet.has(s) &&
    highlights.some(h => h[0] >= s[0] && h[1] <= s[1])
  ).length;
  const dropSet = new Set();
  for (const x of scored) {
    if (used / totalChars <= cap) break;
    if (highlights.length && x.protected && protectedRemaining() <= 1) continue;
    dropSet.add(x.s);
    used -= x.len;
  }
  let final = kept.filter(s => !dropSet.has(s)).map(s => s.slice());

  // Phase 2: if still over cap (because orphan-protection skipped drops),
  // CLIP the longest remaining underline. Without this, a 100% underline
  // span containing highlights would survive at full coverage — exactly
  // the "everything underlined" failure the user reported.
  let usedAfter = final.reduce((a, s) => a + (s[1] - s[0]), 0);
  if (usedAfter / totalChars > cap) {
    const target = Math.floor(cap * totalChars);
    let overshoot = usedAfter - target;
    // Shrink longest first.
    final.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]));
    for (let i = 0; i < final.length && overshoot > 0; i++) {
      const span = final[i];
      const containedHi = highlights.filter(h => h[0] >= span[0] && h[1] <= span[1]);
      const lastHiEnd = containedHi.length ? Math.max(...containedHi.map(h => h[1])) : span[0];
      // Don't shrink past the last highlight + a small buffer.
      const minEnd = Math.max(lastHiEnd, span[0] + 1);
      let newEnd = Math.max(minEnd, span[1] - overshoot);
      // Snap clipped end backward to a word boundary if we have text.
      if (paragraphText) {
        const snapped = snapToWordBoundaries([span[0], newEnd], paragraphText);
        if (snapped) newEnd = snapped[1];
      }
      const shrunk = span[1] - newEnd;
      if (shrunk > 0) {
        span[1] = newEnd;
        overshoot -= shrunk;
      }
    }
  }
  return final.sort((a, b) => a[0] - b[0]);
}

// --- mark insertion at character boundaries --------------------------------

/**
 * Walk a paragraph CHARACTER by CHARACTER and emit text with marks
 * inserted at the right positions. Spans can start/end mid-word.
 *
 * Nesting order (outer→inner): underline > bold (loudest) > bold > highlight.
 * Closes happen BEFORE opens at the same boundary so spans close before
 * new ones open (avoiding malformed `<u></u><u>` interleaving).
 */
function applyMarks({ paragraphText, underlines, highlights, bolds, loudestSpan }) {
  const N = paragraphText.length;

  // Build lists of opens/closes at each character boundary 0..N.
  const opens  = Array.from({ length: N + 1 }, () => []);
  const closes = Array.from({ length: N + 1 }, () => []);

  for (const u of underlines) {
    opens[u[0]].push({ kind: 'u',    open: '<u>', close: '</u>' });
    closes[u[1]].push({ kind: 'u',   close: '</u>' });
  }
  if (loudestSpan) {
    opens[loudestSpan[0]].push({ kind: 'loud',  open: '**', close: '**' });
    closes[loudestSpan[1]].push({ kind: 'loud', close: '**' });
  }
  for (const b of bolds) {
    opens[b[0]].push({ kind: 'b',    open: '**', close: '**' });
    closes[b[1]].push({ kind: 'b',   close: '**' });
  }
  for (const h of highlights) {
    opens[h[0]].push({ kind: 'h',    open: '==', close: '==' });
    closes[h[1]].push({ kind: 'h',   close: '==' });
  }

  let out = '';
  const closeOrder = ['h', 'b', 'loud', 'u'];
  const openOrder  = ['u', 'loud', 'b', 'h'];

  for (let i = 0; i <= N; i++) {
    for (const k of closeOrder) {
      for (const ev of closes[i]) if (ev.kind === k) out += ev.close;
    }
    for (const k of openOrder) {
      for (const ev of opens[i]) if (ev.kind === k) out += ev.open;
    }
    if (i < N) out += paragraphText[i];
  }
  return out;
}

// --- main entry -------------------------------------------------------------

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
    paragraphs: 0, totalChars: 0, underlineChars: 0, highlightChars: 0,
    dropped: { picks: 0, underlines: 0, highlights: 0, bolds: 0 },
  };

  let loudestPickIdx = null;
  if (loudest && candidateByIndex.has(loudest.p)) loudestPickIdx = loudest.p;

  const seenPicks = new Set();
  const orderedPicks = [];
  for (const pick of picks) {
    const p = pick && Number.isInteger(pick.p) ? pick.p : null;
    if (p == null) { stats.dropped.picks++; continue; }
    if (!candidateByIndex.has(p)) { stats.dropped.picks++; continue; }
    if (seenPicks.has(p)) { stats.dropped.picks++; continue; }
    seenPicks.add(p);
    orderedPicks.push(pick);
  }

  orderedPicks.sort((a, b) => {
    const ca = candidateByIndex.get(a.p).originalIndex;
    const cb = candidateByIndex.get(b.p).originalIndex;
    return ca - cb;
  });

  if (!orderedPicks.length) {
    const fallback = candidates.slice(0, 2);
    const body = fallback.map(c => c.text).join('\n\n');
    stats.paragraphs = fallback.length;
    stats.totalChars = fallback.reduce((a, c) => a + c.text.length, 0);
    return { tag, cite, body_markdown: body, stats, fallback: true };
  }

  const renderedParagraphs = [];

  for (const pick of orderedPicks) {
    const cand = candidateByIndex.get(pick.p);
    const paragraphText = cand.text;
    const N = paragraphText.length;
    if (!N) continue;

    // Pipeline order:
    //   clamp → SNAP TO WORD BOUNDARIES → merge → empty-u defense
    //     → contain-filter → max-run trim → highlight-cap trim
    //     → underline-cap trim → re-contain filter → bold-cap trim
    //
    // Snapping fixes the model's char-offset off-by-N errors that
    // produced gibberish like "with U.S. exte" / "nded deterrence".
    // The model emits arbitrary char positions; the server snaps them
    // back to word boundaries so highlights are coherent.
    const boldCap = BOLD_CAPS[density] ?? BOLD_CAPS.heavy;

    let underlines = mergeSpans(
      snapSpansToWordBoundaries((pick.u || []).map(s => clampSpan(s, N)).filter(Boolean), paragraphText)
    );
    let highlights = mergeSpans(
      snapSpansToWordBoundaries((pick.h || []).map(s => clampSpan(s, N)).filter(Boolean), paragraphText)
    );
    let bolds = mergeSpans(
      snapSpansToWordBoundaries((pick.b || []).map(s => clampSpan(s, N)).filter(Boolean), paragraphText)
    );

    // LAZY-UNDERLINE OVERRIDE: when the model emits 90%+ underline coverage
    // (it lazily underlined the entire paragraph), abandon its underlines
    // and auto-regenerate them as small wrappers around each highlight.
    // This is the structural fix for "everything underlined" — even if
    // the model is lazy, the user sees only the warrant clauses underlined.
    const totalU = underlines.reduce((a, s) => a + (s[1] - s[0]), 0);
    if (highlights.length && totalU / N >= LAZY_UNDERLINE_THRESHOLD) {
      const M = AUTO_UNDERLINE_MARGIN_CHARS;
      const wraps = highlights.map(h => {
        let from = Math.max(0, h[0] - M);
        let to   = Math.min(N, h[1] + M);
        // Snap to word boundary so we don't start/end mid-word.
        const snapped = snapToWordBoundaries([from, to], paragraphText);
        return snapped || [h[0], h[1]];
      });
      underlines = mergeSpans(wraps);
    }

    // DEFENSIVE: empty u with highlights/bolds → default to whole-paragraph
    // underline so the marks aren't orphaned by containment filter.
    if (!underlines.length && (highlights.length || bolds.length)) {
      underlines = [[0, N]];
    }
    if (!underlines.length && !highlights.length && !bolds.length) {
      underlines = [[0, N]];
    }

    const beforeHi = highlights.length;
    const beforeBo = bolds.length;
    highlights = filterContainedIn(highlights, underlines);
    bolds      = filterContainedIn(bolds, underlines);
    stats.dropped.highlights += beforeHi - highlights.length;
    stats.dropped.bolds      += beforeBo - bolds.length;

    highlights = trimMaxRun(highlights, MAX_HIGHLIGHT_RUN_CHARS, paragraphText);
    bolds      = trimMaxRun(bolds,      MAX_HIGHLIGHT_RUN_CHARS, paragraphText);

    const beforeHiCap = highlights.length;
    highlights = trimToHighlightCap(highlights, highlightCap, N, paragraphText);
    stats.dropped.highlights += beforeHiCap - highlights.length;

    const beforeBoCap = bolds.length;
    bolds = trimToHighlightCap(bolds, boldCap, N, paragraphText);
    stats.dropped.bolds += beforeBoCap - bolds.length;

    const beforeUCap = underlines.length;
    underlines = trimToUnderlineCap(underlines, highlights, underlineCap, N, paragraphText);
    stats.dropped.underlines += beforeUCap - underlines.length;

    highlights = filterContainedIn(highlights, underlines);
    bolds      = filterContainedIn(bolds, underlines);

    let loudestSpan = null;
    if (loudestPickIdx === pick.p && loudest) {
      const ls = clampSpan([loudest.from, loudest.to], N);
      if (ls && underlines.some(u => ls[0] >= u[0] && ls[1] <= u[1])) {
        loudestSpan = ls;
      }
    }

    const rendered = applyMarks({ paragraphText, underlines, highlights, bolds, loudestSpan });
    renderedParagraphs.push(rendered);

    stats.paragraphs++;
    stats.totalChars     += N;
    stats.underlineChars += underlines.reduce((a, s) => a + (s[1] - s[0]), 0);
    stats.highlightChars += highlights.reduce((a, s) => a + (s[1] - s[0]), 0);
  }

  const body_markdown = renderedParagraphs.join('\n\n');
  return { tag, cite, body_markdown, stats };
}

// --- the JSON schema for the picks output ----------------------------------

// Anthropic structured outputs reject `maxItems` and `minItems` on array
// types. Even when we use `response_format: json_object` mode, OpenRouter
// can auto-translate to Anthropic's structured output format and pass our
// schema through. So this schema must be Anthropic-compatible: NO
// minItems/maxItems anywhere.
const SPAN_SCHEMA = {
  type: 'array',
  items: {
    type: 'array',
    items: { type: 'integer', minimum: 0 },
  },
};

const CARD_PICKS_JSON_SCHEMA = {
  name: 'card_cut',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['tag', 'cite', 'argument', 'picks'],
    properties: {
      tag:  { type: 'string' },
      cite: { type: 'string' },
      // The 30-50 word spoken speech the highlights MUST deliver in order.
      // The model is required to compose this BEFORE picks, forcing
      // argument-first thinking. Server extracts the actual read-aloud
      // chain from picks and compares to this argument; if they don't
      // match, retry on Sonnet.
      argument: { type: 'string' },
      picks: {
        type: 'array',
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

// Extract the read-aloud chain — every highlight's text in document order,
// joined by " ... ". This is what the user "hears" when the debater reads
// only the highlighted portions. Compare this to the model's stated
// `argument` to detect chain incoherence.
function extractReadAloudChain(picksJson, candidates) {
  const candidateByIndex = new Map();
  for (const c of candidates) candidateByIndex.set(c.index, c);
  const chain = [];
  const picks = Array.isArray(picksJson?.picks) ? picksJson.picks : [];

  // Sort picks by paragraph original index so chain reads in document order.
  const ordered = picks
    .filter(p => Number.isInteger(p.p) && candidateByIndex.has(p.p))
    .sort((a, b) => candidateByIndex.get(a.p).originalIndex - candidateByIndex.get(b.p).originalIndex);

  for (const pick of ordered) {
    const cand = candidateByIndex.get(pick.p);
    const text = cand.text;
    const hRanges = (pick.h || [])
      .map(s => clampSpan(s, text.length))
      .filter(Boolean)
      .map(s => snapToWordBoundaries(s, text))
      .filter(Boolean)
      .sort((a, b) => a[0] - b[0]);
    for (const [a, b] of hRanges) {
      const slice = text.slice(a, b).trim();
      if (slice) chain.push(slice);
    }
  }
  return chain.join(' ... ');
}

// Word-overlap score between the model's composed argument and the
// actual highlight chain. Used to detect chain incoherence.
//   1.0 = chain contains every meaningful word of the argument
//   0.0 = no overlap
function chainArgumentOverlap(argument, chainText) {
  if (!argument || !chainText) return 0;
  const tokenize = s => String(s || '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 3);   // ignore stopwords/short connectors
  const argWords = new Set(tokenize(argument));
  const chainWords = new Set(tokenize(chainText));
  if (!argWords.size) return 0;
  let hit = 0;
  for (const w of argWords) if (chainWords.has(w)) hit++;
  return hit / argWords.size;
}

module.exports = {
  reconstructCard,
  CARD_PICKS_JSON_SCHEMA,
  HIGHLIGHT_CAPS,
  UNDERLINE_CAPS,
  BOLD_CAPS,
  MAX_HIGHLIGHT_RUN_CHARS,
  extractReadAloudChain,
  chainArgumentOverlap,
  // exposed for tests:
  clampSpan,
  mergeSpans,
  filterContainedIn,
  applyMarks,
  trimToHighlightCap,
  trimToUnderlineCap,
  snapToWordBoundaries,
  snapSpansToWordBoundaries,
};
