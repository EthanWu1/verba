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

// Density caps measured as fraction of paragraph CHARACTERS (not words)
// inside the mark. Calibrated against 85 hand-cut Vanguard cards.
const HIGHLIGHT_CAPS = { minimal: 0.30, standard: 0.45, heavy: 0.65 };
const UNDERLINE_CAPS = { minimal: 0.60, standard: 0.80, heavy: 0.95 };

// Maximum length of a single highlight RUN. 60 chars ≈ 10 words. Real
// Vanguard cards rarely exceed this; the model mostly emits short fragments.
const MAX_HIGHLIGHT_RUN_CHARS = 60;

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

function trimMaxRun(spans, maxChars = MAX_HIGHLIGHT_RUN_CHARS) {
  return spans
    .map(s => (s[1] - s[0] > maxChars ? [s[0], s[0] + maxChars] : s))
    .filter(s => s[1] > s[0]);
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

function trimToUnderlineCap(underlines, highlights, cap, totalChars) {
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

  const dropSet = new Set();
  for (const x of scored) {
    if (used / totalChars <= cap) break;
    dropSet.add(x.s);
    used -= x.len;
  }
  return kept.filter(s => !dropSet.has(s)).sort((a, b) => a[0] - b[0]);
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

    let underlines = mergeSpans((pick.u || []).map(s => clampSpan(s, N)).filter(Boolean));
    let highlights = mergeSpans((pick.h || []).map(s => clampSpan(s, N)).filter(Boolean));
    let bolds      = mergeSpans((pick.b || []).map(s => clampSpan(s, N)).filter(Boolean));

    const beforeHi = highlights.length;
    const beforeBo = bolds.length;
    highlights = filterContainedIn(highlights, underlines);
    bolds      = filterContainedIn(bolds, underlines);
    stats.dropped.highlights += beforeHi - highlights.length;
    stats.dropped.bolds      += beforeBo - bolds.length;

    highlights = trimMaxRun(highlights, MAX_HIGHLIGHT_RUN_CHARS);

    const beforeHiCap = highlights.length;
    highlights = trimToHighlightCap(highlights, highlightCap, N, paragraphText);
    stats.dropped.highlights += beforeHiCap - highlights.length;

    const beforeUCap = underlines.length;
    underlines = trimToUnderlineCap(underlines, highlights, underlineCap, N);
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
  MAX_HIGHLIGHT_RUN_CHARS,
  // exposed for tests:
  clampSpan,
  mergeSpans,
  filterContainedIn,
  applyMarks,
  trimToHighlightCap,
  trimToUnderlineCap,
};
