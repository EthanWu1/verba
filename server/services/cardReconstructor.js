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
// Iteration-3 calibration (2026-05-03): raised underline cap from 0.65 → 0.85.
// Long warrant paragraphs in gold cards run through 4–5 sentences
// (Moreover/Kunsan/Osan/proximity); a 0.65 cap dropped key warrant
// sentences. Lazy-underline threshold (0.90) still catches model laziness.
//
// Highlight cap stays at 0.30 — gold tops out around 22% per paragraph.
// Bold cap raised to 0.40 to allow aggressive warrant bolding.
const HIGHLIGHT_CAPS = { minimal: 0.18, standard: 0.25, heavy: 0.30 };
const UNDERLINE_CAPS = { minimal: 0.55, standard: 0.70, heavy: 0.85 };
const BOLD_CAPS      = { minimal: 0.15, standard: 0.25, heavy: 0.40 };

// Maximum length of a single highlight RUN. Iteration 2 (2026-05-03):
// dropped from 50 → 22 to match measured gold patterns (median 1.67 words
// per highlight ≈ ~10 chars). Long model spans get split into multiple
// short fragments via splitOversizeHighlight rather than naive trim.
const MAX_HIGHLIGHT_RUN_CHARS = 22;
// Bolds should be SHORT. Real cards bold single words usually, 2-3 max,
// for spoken emphasis. 14 chars covers "use them or" / "upper hand" /
// "extremely diff…" — anything longer is clause-marking, not emphasis.
const MAX_BOLD_RUN_CHARS = 14;
// Bolds shorter than this are almost always off-by-one slips ("e" of
// "extreme", "s" of "weapons") — drop them.
const MIN_BOLD_RUN_CHARS = 2;

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

// Bridge two adjacent spans whose gap is ONLY whitespace, apostrophes,
// hyphens, or possessive "'s ". Hand-cut convention: if two highlighted
// words are next to each other in source, the space (and any apostrophe-
// possessive) between them is also highlighted, rendering as one continuous
// run. Same for bolds. Without bridging, `==Kim== ==Jong-un's policy==`
// renders as two visually-separate highlights with a gap between.
//
// IMPORTANT: bridging is capped by `maxLen` so the splitter's stitched
// fragments (which intentionally split a >22-char range into 2-word chunks)
// don't get re-merged into one big run. Pass MAX_HIGHLIGHT_RUN_CHARS for
// highlights, MAX_BOLD_RUN_CHARS for bolds, Infinity for underlines.
const BRIDGE_PUNCT_ONLY = /^[\s'‘’′\-]*$/;
const BRIDGE_POSSESSIVE = /^['‘’]s\s*$/;

function isBridgeableGap(gap) {
  return BRIDGE_PUNCT_ONLY.test(gap) || BRIDGE_POSSESSIVE.test(gap);
}

function bridgeAdjacentSpans(spans, text, maxLen = Infinity) {
  if (!Array.isArray(spans) || spans.length < 2) return spans;
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  const out = [sorted[0].slice()];
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1];
    const cur = sorted[i];
    if (cur[0] <= last[1]) {
      last[1] = Math.max(last[1], cur[1]);
      continue;
    }
    const gap = String(text || '').slice(last[1], cur[0]);
    const wouldBe = cur[1] - last[0];
    if (gap.length <= 3 && isBridgeableGap(gap) && wouldBe <= maxLen) {
      last[1] = cur[1];
    } else {
      out.push(cur.slice());
    }
  }
  return out;
}

// Final-pass edge trim — strip leading/trailing whitespace from a span. The
// snap function already does most of this but extensions and re-merges can
// leave fresh edge whitespace.
function trimSpanEdges(span, text) {
  if (!span) return null;
  let [from, to] = span;
  while (from < to && /\s/.test(text[from] || '')) from++;
  while (to > from && /\s/.test(text[to - 1] || '')) to--;
  if (to <= from) return null;
  return [from, to];
}

function trimSpanEdgesAll(spans, text) {
  return spans.map(s => trimSpanEdges(s, text)).filter(Boolean);
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

// Split a long highlight range into multiple short STITCHED FRAGMENTS at
// word boundaries. The hand-cut style is many 1–2 word highlights stitched
// via underline; long model spans should be diced rather than naively
// truncated. Algorithm: tokenize the slice into words, emit 2-word groups
// as separate highlight ranges. Punctuation/whitespace between words stays
// PLAIN (acts as the stitching gap). Returns an array of [from,to) sub-ranges.
function splitOversizeHighlight(span, text, maxChars = MAX_HIGHLIGHT_RUN_CHARS, wordsPerFragment = 2) {
  if (!span) return [];
  const [from, to] = span;
  const len = to - from;
  if (len <= maxChars) return [span];
  const slice = text.slice(from, to);
  // Find every word's [start,end) within the slice.
  const words = [];
  let i = 0;
  while (i < slice.length) {
    while (i < slice.length && !/[a-zA-Z0-9'-]/.test(slice[i])) i++;
    if (i >= slice.length) break;
    const ws = i;
    while (i < slice.length && /[a-zA-Z0-9'-]/.test(slice[i])) i++;
    words.push([ws, i]);
  }
  if (words.length === 0) return [];
  if (words.length === 1) return [[from + words[0][0], from + words[0][1]]];
  // Group consecutive words into fragments of `wordsPerFragment` content words.
  const fragments = [];
  for (let g = 0; g < words.length; g += wordsPerFragment) {
    const group = words.slice(g, g + wordsPerFragment);
    if (!group.length) continue;
    const a = from + group[0][0];
    const b = from + group[group.length - 1][1];
    fragments.push([a, b]);
  }
  return fragments;
}

function splitOversizeHighlights(spans, text, maxChars = MAX_HIGHLIGHT_RUN_CHARS) {
  const out = [];
  for (const s of spans) {
    const frags = splitOversizeHighlight(s, text, maxChars);
    // Drop tiny fragments (<3 chars) that are usually punctuation-split
    // artifacts from abbreviations like "U.S." → ["U", "S"].
    for (const f of frags) {
      if (f[1] - f[0] >= 3) out.push(f);
    }
  }
  return out;
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

// Words that, when a highlight ENDS on them, leave the thought dangling.
// User feedback: "highlights end on 'to' without 'win', 'the' without 'hand',
// 'and in' without 'evidence'." Extend forward through these to complete
// the beat, or trim them off if extension would balloon the span.
const DANGLING_TAIL_WORDS = new Set([
  // prepositions
  'to','of','in','on','at','by','for','with','from','into','onto','about',
  'over','under','between','through','across','toward','towards','among',
  // articles + determiners
  'the','a','an','this','that','these','those',
  // conjunctions
  'and','or','but','so','yet','nor','as',
  // copulas / auxiliaries
  'is','are','was','were','be','been','being','am',
  'have','has','had','do','does','did','having',
  // modals
  'would','could','should','may','might','will','shall','must','can',
  // possessives
  'its','their','his','her','our','your','my',
  // qualifiers
  'more','most','very','much','also',
]);

function fixDanglingEnd(span, text, maxExtensionChars = 30) {
  if (!span) return span;
  let [from, to] = span;
  // Identify the last word in the span.
  const tail = text.slice(from, to);
  const m = tail.match(/(\w+)\s*[^\w]*\s*$/);
  if (!m) return span;
  const lastWord = m[1].toLowerCase();
  if (!DANGLING_TAIL_WORDS.has(lastWord)) return span;

  // Try to extend forward to include up to 3 more words, stopping at the
  // first non-dangling content word OR a sentence-ending punctuation.
  let extEnd = to;
  let wordsAdded = 0;
  let safety = 0;
  while (extEnd < text.length && wordsAdded < 4 && safety < 80) {
    safety++;
    // Skip whitespace
    if (/\s/.test(text[extEnd])) { extEnd++; continue; }
    // Stop at sentence-ending punctuation (include the period/question mark).
    if (/[.!?]/.test(text[extEnd])) { extEnd++; break; }
    // Skip mid-sentence punctuation (commas, semicolons) — they can be part
    // of the highlight tail.
    if (/[,;:]/.test(text[extEnd])) { extEnd++; continue; }
    // Read the next word.
    const wStart = extEnd;
    while (extEnd < text.length && /[a-zA-Z0-9'-]/.test(text[extEnd])) extEnd++;
    if (extEnd === wStart) { extEnd++; continue; }
    const w = text.slice(wStart, extEnd).toLowerCase();
    wordsAdded++;
    // If this is a content word, we're done — the beat is complete.
    if (!DANGLING_TAIL_WORDS.has(w)) break;
  }
  // Trim trailing whitespace.
  while (extEnd > to && /\s/.test(text[extEnd - 1])) extEnd--;

  // If extension stayed within limits, use it.
  if (extEnd - to <= maxExtensionChars && extEnd > to) {
    return [from, extEnd];
  }

  // Otherwise, TRIM the dangling word off the end.
  // Find where the last word starts and pull `to` back to before it.
  const endRel = (text.slice(from, to).match(/(\w+)\s*[^\w]*\s*$/) || [null])[0];
  if (endRel) {
    const trimAmount = endRel.length;
    const trimmed = to - trimAmount;
    if (trimmed > from) return [from, trimmed];
  }
  return span;
}

function fixDanglingEnds(spans, text) {
  return spans.map(s => fixDanglingEnd(s, text)).filter(Boolean);
}

// Drop highlights whose entire content is filler/transition words.
// e.g. ==However==, ==Further==, ==In addition== — these add nothing
// to the read-aloud chain. Better to silently skip than emit them and
// trigger a Sonnet retry.
const FILLER_HIGHLIGHT_WORDS = new Set([
  'further','furthermore','however','moreover','additionally','also',
  'unfortunately','accordingly','thus','therefore','hence','indeed',
  'essentially','ultimately','importantly','notably','specifically',
  'meanwhile','nonetheless','nevertheless','arguably','presumably',
  'fundamentally','crucially','clearly','obviously',
  'in addition','in essence','to be sure','in other words',
  'for instance','for example',
]);

function isFillerOnlySpan(span, text) {
  if (!span) return false;
  const slice = text.slice(span[0], span[1]).toLowerCase().replace(/[^a-z\s]/g, '').trim();
  if (!slice) return true;
  // Single filler word.
  if (FILLER_HIGHLIGHT_WORDS.has(slice)) return true;
  // Multi-word filler phrase.
  for (const phrase of FILLER_HIGHLIGHT_WORDS) {
    if (phrase.includes(' ') && slice === phrase) return true;
  }
  return false;
}

function dropFillerOnlySpans(spans, text) {
  return spans.filter(s => !isFillerOnlySpan(s, text));
}

// Stopwords that should NEVER be the entire content of a bold. Bolds are
// for spoken emphasis — bolding "the" or "and" alone is a slip.
const STOPWORD_ONLY_BAD_BOLDS = new Set([
  'a','an','the','and','or','but','of','to','in','on','at','by','for',
  'with','from','into','onto','about','as','is','are','was','were','be',
  'been','being','am','have','has','had','do','does','did','its','their',
  'his','her','our','your','my','this','that','these','those','it','they',
  'we','he','she','i','you',
]);

function isBadBoldSpan(span, text) {
  if (!span) return true;
  const len = span[1] - span[0];
  // Single-char bolds: almost always off-by-one ("e" of "extreme").
  if (len < MIN_BOLD_RUN_CHARS) return true;
  const slice = text.slice(span[0], span[1]).trim();
  if (!slice) return true;
  // Bolds that are entirely a single stopword.
  const lower = slice.toLowerCase().replace(/[^a-z']/g, '');
  if (STOPWORD_ONLY_BAD_BOLDS.has(lower)) return true;
  return false;
}

function dropBadBolds(spans, text) {
  return spans.filter(s => !isBadBoldSpan(s, text));
}

// Split each bold span at every highlight boundary so the resulting bolds
// are either FULLY inside a highlight or FULLY outside any highlight. This
// fixes the markdown interleaving bug where `**==text**` (bold close before
// highlight close) renders as garbage like `**==text==** more text==`.
//
// Strategy: for each bold [a, b], collect all highlight boundaries within
// that range and split at each one. Each resulting sub-bold is then either
// entirely inside a highlight (renders as `**==text==**`) or entirely
// outside (renders as `**text**`). No partial overlaps survive.
function splitBoldsAtHighlightBoundaries(bolds, highlights) {
  if (!bolds.length || !highlights.length) return bolds;
  const sortedHi = [...highlights].sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [a, b] of bolds) {
    // Collect all highlight starts and ends that fall STRICTLY inside (a, b).
    const cuts = new Set();
    for (const [h0, h1] of sortedHi) {
      if (h0 > a && h0 < b) cuts.add(h0);
      if (h1 > a && h1 < b) cuts.add(h1);
    }
    if (!cuts.size) { out.push([a, b]); continue; }
    const sortedCuts = [...cuts].sort((x, y) => x - y);
    let cur = a;
    for (const c of sortedCuts) {
      if (c > cur) out.push([cur, c]);
      cur = c;
    }
    if (cur < b) out.push([cur, b]);
  }
  return out;
}

// Trim filler prefixes/suffixes from a HIGHLIGHT span. Catches highlights
// like "==As a result, conventional counterforce==" — the "As a result,"
// portion gets snipped so only "conventional counterforce" highlights.
// Symmetric: also trims trailing filler.
const FILLER_TRIM_PREFIX_PATTERNS = [
  /^(further(?:more)?|however|moreover|additionally|also|unfortunately|accordingly|thus|therefore|hence|indeed|essentially|ultimately|importantly|notably|specifically|meanwhile|nonetheless|nevertheless|arguably|presumably|fundamentally|crucially|clearly|obviously|first|second|third|fourth|fifth|finally|lastly)\s*[,;:]?\s+/i,
  /^(in\s+addition|in\s+essence|to\s+be\s+sure|in\s+other\s+words|for\s+instance|for\s+example|as\s+a\s+result|on\s+top\s+of\s+(?:that|this))\s*[,;:]?\s+/i,
];

function trimFillerEdges(span, text) {
  if (!span) return null;
  let [from, to] = span;
  let slice = text.slice(from, to);
  let progress = true;
  let safety = 4;
  while (progress && safety-- > 0) {
    progress = false;
    for (const re of FILLER_TRIM_PREFIX_PATTERNS) {
      const m = slice.match(re);
      if (m) {
        from += m[0].length;
        slice = text.slice(from, to);
        progress = true;
        break;
      }
    }
  }
  if (to <= from) return null;
  // Re-snap to word boundary so we don't leave leading whitespace/punct.
  const snapped = snapToWordBoundaries([from, to], text);
  return snapped || null;
}

function trimFillerEdgesAll(spans, text) {
  return spans.map(s => trimFillerEdges(s, text)).filter(Boolean);
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
// Render spans into markdown using PROPER LIFO STACK NESTING. Earlier
// versions used fixed open/close orders which produced malformed output
// like `==text **bold==**` when a bold opened inside a highlight but both
// closed at the same boundary (close order should be inner-first).
//
// Strategy: build an event list sorted by position. At each position, do
// closes in reverse-open-order (LIFO), then opens in order of nesting
// preference. Track an open stack so closes always pop in LIFO order.
function applyMarks({ paragraphText, underlines, highlights, bolds, loudestSpan }) {
  const N = paragraphText.length;

  // Collect all spans as (kind, from, to). Tier order at OPEN: u, loud, b, h
  // so when multiple kinds open at the same position, u is outermost and h
  // is innermost. For subsequent same-position opens, ordering is by tier.
  const tierIdx = { u: 0, loud: 1, b: 2, h: 3 };
  const openTokens  = { u: '<u>', loud: '**', b: '**', h: '==' };
  const closeTokens = { u: '</u>', loud: '**', b: '**', h: '==' };

  const spans = [];
  let nextId = 0;
  for (const u of underlines) spans.push({ id: nextId++, kind: 'u', from: u[0], to: u[1] });
  if (loudestSpan) spans.push({ id: nextId++, kind: 'loud', from: loudestSpan[0], to: loudestSpan[1] });
  for (const b of bolds)      spans.push({ id: nextId++, kind: 'b', from: b[0], to: b[1] });
  for (const h of highlights) spans.push({ id: nextId++, kind: 'h', from: h[0], to: h[1] });

  // Sort spans for deterministic open ordering when multiple start at same pos.
  // Open priority: outer kind first (lower tierIdx), then earlier id breaks ties.
  spans.sort((a, b) => a.from - b.from || tierIdx[a.kind] - tierIdx[b.kind] || a.id - b.id);

  // Bucket opens by position; closes processed via LIFO stack.
  const opensAt = new Map();
  for (const s of spans) {
    if (!opensAt.has(s.from)) opensAt.set(s.from, []);
    opensAt.get(s.from).push(s);
  }

  let out = '';
  const stack = [];   // currently-open spans, LIFO
  for (let i = 0; i <= N; i++) {
    // Pre-collapse touching same-kind close+open at this position:
    // if a span of kind k is on top of stack with to==i AND another span
    // of kind k starts at i, suppress BOTH the close and the open. They
    // logically continue as one span and avoid `====` / `****` artifacts.
    const startingHere = opensAt.get(i) || [];
    const collapsedOpenIds = new Set();
    {
      let suppressed = true;
      while (suppressed) {
        suppressed = false;
        if (!stack.length) break;
        const top = stack[stack.length - 1];
        if (top.to !== i) break;
        // Find a starting-here span of same kind not already collapsed.
        const idx = startingHere.findIndex(s => s.kind === top.kind && !collapsedOpenIds.has(s.id) && s.to > i);
        if (idx === -1) break;
        const matched = startingHere[idx];
        // Suppress: keep `top` on stack but EXTEND its end to matched.to,
        // so it'll close when matched would have. Mark matched as collapsed
        // so we don't open it.
        top.to = matched.to;
        collapsedOpenIds.add(matched.id);
        suppressed = true;
      }
    }
    // Close any spans whose `to` == i, in LIFO order (innermost first).
    while (stack.length && stack[stack.length - 1].to === i) {
      const s = stack.pop();
      out += closeTokens[s.kind];
    }
    while (stack.length && stack[stack.length - 1].to < i) {
      const s = stack.pop();
      out += closeTokens[s.kind];
    }
    // Open any spans starting at i (skipping collapsed ones).
    if (startingHere.length) {
      const list = startingHere
        .filter(s => !collapsedOpenIds.has(s.id))
        .sort((a, b) => (b.to - a.to) || (tierIdx[a.kind] - tierIdx[b.kind]) || (a.id - b.id));
      for (const s of list) {
        if (s.to <= s.from) continue;
        out += openTokens[s.kind];
        stack.push(s);
      }
    }
    if (i < N) out += paragraphText[i];
  }
  while (stack.length) {
    const s = stack.pop();
    out += closeTokens[s.kind];
  }
  return out;
}

// --- quote-based pick resolver ---------------------------------------------
// Iteration 8 (2026-05-03): switched from char-offset picks to quote-based.
// The model emits the EXACT verbatim string it wants marked, and the server
// finds it via indexOf. This eliminates the "model can't precisely count
// characters" failure mode that produced mid-word boundaries and bloated
// 50-char block ranges.
//
// Resolver behavior:
//   - Each string is normalized (collapse whitespace) before matching.
//   - First occurrence is returned. If string appears multiple times,
//     first match wins (model can disambiguate by including more context).
//   - If string not found verbatim, try a fuzzy match (collapse all
//     whitespace and re-find). If still not found, drop with warning.
//   - Punctuation is matched STRICTLY — model must echo source exactly.

function normalizeForMatch(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

// Map Unicode "smart" punctuation back to ASCII so a quote emitted with
// straight quotes/apostrophes matches source text using curly ones (and
// vice versa). Articles imported via OCR/PDF/Word frequently mix these.
function normalizeUnicodePunct(s) {
  return String(s || '')
    .replace(/[‘’‚‛′]/g, "'")     // ' ' ‚ ‛ ′ → '
    .replace(/[“”„‟″]/g, '"')     // " " „ ‟ ″ → "
    .replace(/[–—−]/g, '-')                  // – — − → -
    .replace(/…/g, '...')                              // …  → ...
    .replace(/ /g, ' ');                               // NBSP → space
}

// Find a quote in paragraph text. Returns [from, to] or null.
// Strategy: try strict match first; fall back to Unicode-normalized match;
// fall back to whitespace-tolerant regex match. The match is performed
// against the NORMALIZED source, but the returned offsets index the
// ORIGINAL source — we keep a position map for that.
function findQuoteInText(quote, text, searchStart = 0) {
  if (!quote || !text) return null;
  const q = String(quote);
  // 1. Strict match against original.
  let idx = text.indexOf(q, searchStart);
  if (idx !== -1) return [idx, idx + q.length];
  // 2. Unicode-normalized match. Normalize both sides 1:1 (same length, so
  //    offsets in normalized == offsets in original).
  const qNorm = normalizeUnicodePunct(q);
  const tNorm = normalizeUnicodePunct(text);
  if (qNorm.length === q.length && tNorm.length === text.length) {
    idx = tNorm.indexOf(qNorm, searchStart);
    if (idx !== -1) return [idx, idx + qNorm.length];
  }
  // 3. Whitespace-tolerant regex match (also Unicode-normalized).
  const pattern = qNorm
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\s+/g, '\\s+');
  const re = new RegExp(pattern);
  const m = re.exec(tNorm.slice(searchStart));
  if (m) return [searchStart + m.index, searchStart + m.index + m[0].length];
  return null;
}

// Resolve a list of quote strings against paragraph text. Tracks search
// cursor so adjacent quotes find their later occurrences in order.
function resolveQuotesInParagraph(quotes, text) {
  const ranges = [];
  let cursor = 0;
  const dropped = [];
  for (const raw of (quotes || [])) {
    const q = normalizeForMatch(raw);
    if (!q) continue;
    let r = findQuoteInText(q, text, cursor);
    // If not found from cursor, try from start of paragraph (model may have
    // emitted quotes out of order).
    if (!r) r = findQuoteInText(q, text, 0);
    if (!r) { dropped.push(q.slice(0, 60)); continue; }
    ranges.push(r);
    cursor = r[1];
  }
  return { ranges, dropped };
}

// Convert a quote-based picks JSON (strings) into a range-based picks JSON
// (offsets) by looking up each quote in the candidate paragraphs. Returns
// the same shape as the old picksJson so the rest of the reconstructor
// pipeline works unchanged.
function resolveQuotePicks(picksJson, candidates) {
  const candidateByIndex = new Map();
  for (const c of candidates) candidateByIndex.set(c.index, c);

  const droppedTotal = [];
  const newPicks = [];
  for (const pick of (picksJson?.picks || [])) {
    const cand = candidateByIndex.get(pick.p);
    if (!cand) continue;
    const text = cand.text;
    // Auto-detect: if u/h/b items are arrays of NUMBERS, this is the old
    // range-based format — pass through unchanged.
    const uIsRange = Array.isArray(pick.u) && pick.u.length && Array.isArray(pick.u[0]) && typeof pick.u[0][0] === 'number';
    if (uIsRange) {
      newPicks.push(pick);
      continue;
    }
    const u = resolveQuotesInParagraph(pick.u || [], text);
    const h = resolveQuotesInParagraph(pick.h || [], text);
    const b = resolveQuotesInParagraph(pick.b || [], text);
    droppedTotal.push(...u.dropped.map(q => `u: "${q}"`));
    droppedTotal.push(...h.dropped.map(q => `h: "${q}"`));
    droppedTotal.push(...b.dropped.map(q => `b: "${q}"`));
    newPicks.push({ p: pick.p, u: u.ranges, h: h.ranges, b: b.ranges });
  }

  if (droppedTotal.length) {
    console.warn(`[resolveQuotePicks] dropped ${droppedTotal.length} unmatched quotes:`,
      droppedTotal.slice(0, 8).join(' | '));
  }

  return {
    ...picksJson,
    picks: newPicks,
  };
}

// --- main entry -------------------------------------------------------------

function reconstructCard({ picksJson, candidates, density = 'heavy' } = {}) {
  // Resolve quote-based picks to range-based first (no-op if already ranges).
  picksJson = resolveQuotePicks(picksJson, candidates);

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

    let underlines = bridgeAdjacentSpans(
      mergeSpans(
        trimFillerEdgesAll(
          snapSpansToWordBoundaries((pick.u || []).map(s => clampSpan(s, N)).filter(Boolean), paragraphText),
          paragraphText
        )
      ),
      paragraphText
    );
    // Highlights AND bolds get dangling-end fix: if a span ends on a
    // preposition/article/conjunction (e.g. "the upper", "impossible to"),
    // extend forward to include the completing word(s) or trim the dangler.
    // This is the structural fix for "highlights cut off mid-thought".
    // Pipeline: clamp → snap → fix-danglers → drop-filler-only → merge.
    // Filler-only highlights ("==However==", "==Further==") get dropped
    // silently so the chain quality check doesn't retry-on-Sonnet for
    // something we can fix structurally.
    // Pipeline: clamp → snap → trim-filler-edges → fix-danglers
    //   → drop-filler-only → SPLIT-OVERSIZE → merge.
    // splitOversize: model often emits 50-100 char block ranges; we dice
    // them into 2-word stitched fragments to match the hand-cut style.
    // trimFillerEdges runs BEFORE fixDanglingEnds: a span like
    // "As a result, conventional counterforce is impossible to" first
    // gets the "As a result," prefix trimmed → "conventional counterforce
    // is impossible to" → then dangler fix extends "to" → "to operationalize".
    let highlights = mergeSpans(
      splitOversizeHighlights(
        dropFillerOnlySpans(
          fixDanglingEnds(
            trimFillerEdgesAll(
              snapSpansToWordBoundaries((pick.h || []).map(s => clampSpan(s, N)).filter(Boolean), paragraphText),
              paragraphText
            ),
            paragraphText
          ),
          paragraphText
        ),
        paragraphText,
        MAX_HIGHLIGHT_RUN_CHARS
      )
    );
    // Bolds pipeline: same fragmentation logic as highlights — model
    // emits long block bolds; we dice them into 1-word fragments. Then
    // bad-bold drop catches single-char/stopword artifacts. The bold-cap
    // trim later keeps only the highest-priority bolds.
    let bolds = dropBadBolds(
      mergeSpans(
        splitOversizeHighlights(
          dropFillerOnlySpans(
            fixDanglingEnds(
              dropBadBolds(
                trimFillerEdgesAll(
                  snapSpansToWordBoundaries((pick.b || []).map(s => clampSpan(s, N)).filter(Boolean), paragraphText),
                  paragraphText
                ),
                paragraphText
              ),
              paragraphText
            ),
            paragraphText
          ),
          paragraphText,
          MAX_BOLD_RUN_CHARS
        )
      ),
      paragraphText
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
    // Bolds get a tighter cap — they're for spoken emphasis on 1-3 words,
    // not for marking whole clauses. User feedback: "shouldn't bold
    // multiple words at a time most of the time."
    bolds      = trimMaxRun(bolds,      MAX_BOLD_RUN_CHARS, paragraphText);

    // RE-APPLY dangler fix: trimMaxRun cuts spans at the cap then snaps
    // to a word boundary — but the resulting boundary may now end on a
    // dangler ("is impossible to win" → trimmed to "is impossible to").
    // Re-extending here catches that.
    highlights = fixDanglingEnds(highlights, paragraphText);
    bolds      = fixDanglingEnds(bolds,      paragraphText);
    // fixDanglingEnds can extend a span forward past the start of the next
    // span, creating overlap. Re-merge so highlights/bolds remain
    // non-overlapping (renderer assumes non-overlap).
    highlights = mergeSpans(highlights);
    bolds      = mergeSpans(bolds);
    // BRIDGE adjacent spans separated only by whitespace/apostrophe/hyphen
    // (or possessive "'s "). Two highlights right next to each other in
    // source render as one continuous highlight. Capped by per-kind max
    // run length so splitter fragments (>22 chars combined) don't re-merge.
    highlights = bridgeAdjacentSpans(highlights, paragraphText, MAX_HIGHLIGHT_RUN_CHARS);
    bolds      = bridgeAdjacentSpans(bolds,      paragraphText, MAX_BOLD_RUN_CHARS);
    // Final edge-trim: ensure no leading/trailing whitespace in any span.
    highlights = trimSpanEdgesAll(highlights, paragraphText);
    bolds      = trimSpanEdgesAll(bolds,      paragraphText);
    // Final bad-bold pass: trimMaxRun could shrink a 14-char "the upper" to
    // "the" or a 14-char "asymmetric" to "asymm" depending on snap; reject.
    bolds      = dropBadBolds(bolds, paragraphText);

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
    // Split bolds at highlight boundaries so each bold is fully-inside or
    // fully-outside a highlight. Prevents interleaved `**==x**` markup bugs.
    bolds      = splitBoldsAtHighlightBoundaries(bolds, highlights);
    // After splitting, drop any too-short or stopword fragments that emerged.
    bolds      = dropBadBolds(bolds, paragraphText);
    // Re-merge any bolds that overlap or touch — touching bolds at the same
    // boundary render as `****` which markdown sees as bold-italic. Merge first,
    // then dedupe identical ranges.
    bolds      = mergeSpans(bolds);
    // Final dedupe by [a,b] tuple in case duplicates slipped through from
    // multiple processing passes.
    {
      const seen = new Set();
      bolds = bolds.filter(s => {
        const k = `${s[0]}-${s[1]}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    }

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

// Iteration 8 (2026-05-03): switched from char-offset spans to QUOTE-based.
// Each u/h/b is now an array of VERBATIM strings to find in the paragraph.
// Backward-compat: resolveQuotePicks auto-detects old [from,to] arrays.
const QUOTE_SCHEMA = {
  type: 'array',
  items: { type: 'string' },
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
      argument: { type: 'string' },
      picks: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['p', 'u'],
          properties: {
            p: { type: 'integer', minimum: 0 },
            u: QUOTE_SCHEMA,
            h: QUOTE_SCHEMA,
            b: QUOTE_SCHEMA,
          },
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
  // Resolve quotes first (no-op if already ranges).
  picksJson = resolveQuotePicks(picksJson, candidates);

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
    let hRanges = (pick.h || [])
      .map(s => clampSpan(s, text.length))
      .filter(Boolean)
      .map(s => snapToWordBoundaries(s, text))
      .filter(Boolean);
    // Apply same auto-fixes the reconstructor uses, so chain reflects
    // what the user will actually see.
    hRanges = trimFillerEdgesAll(hRanges, text);
    hRanges = fixDanglingEnds(hRanges, text);
    hRanges = dropFillerOnlySpans(hRanges, text);
    hRanges.sort((a, b) => a[0] - b[0]);
    for (const [a, b] of hRanges) {
      const slice = text.slice(a, b).trim();
      if (slice) chain.push(slice);
    }
  }
  return chain.join(' ... ');
}

// Two-way scoring between the model's composed argument and the
// actual highlight chain. Returns:
//   coverage: fraction of argument's content words that appear in chain (0-1)
//   bloat:    fraction of chain words that are NOT in argument (0-1)
//   filler:   chain words that look like transitional/filler ("further",
//             "unfortunately", "however", "moreover", etc.) — should be 0
// Good chain: high coverage, low bloat, zero filler.
const FILLER_WORDS = new Set([
  'further','furthermore','however','moreover','additionally','also',
  'unfortunately','accordingly','thus','therefore','hence','indeed',
  'essentially','ultimately','importantly','notably','specifically',
  'meanwhile','nonetheless','nevertheless','arguably','presumably',
  'fundamentally','crucially','clearly','obviously',
]);
function chainArgumentScore(argument, chainText) {
  const tokenize = s => String(s || '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 3);
  const argTokens = tokenize(argument);
  const chainTokens = tokenize(chainText);
  const argSet = new Set(argTokens);
  const chainSet = new Set(chainTokens);

  let coverageHits = 0;
  for (const w of argSet) if (chainSet.has(w)) coverageHits++;
  const coverage = argSet.size ? coverageHits / argSet.size : 0;

  let bloatHits = 0;
  for (const w of chainTokens) if (!argSet.has(w)) bloatHits++;
  const bloat = chainTokens.length ? bloatHits / chainTokens.length : 0;

  const fillerHits = chainTokens.filter(w => FILLER_WORDS.has(w)).length;

  // Count phrases that end on a dangling word — these are incomplete beats
  // ("impossible to" without "win", "the upper" without "hand").
  const phrases = String(chainText || '').split(/\s*\.\.\.\s*/).filter(Boolean);
  let danglerCount = 0;
  for (const phrase of phrases) {
    const m = phrase.toLowerCase().trim().match(/(\w+)\s*[^\w]*\s*$/);
    if (m && DANGLING_TAIL_WORDS.has(m[1])) danglerCount++;
  }

  // Fragmentation: average words per highlight phrase. Hand-cut gold:
  // 5–6 phrases, 3–5 words each → avg 3.5+ words/phrase. Confetti machine
  // cut: 15+ phrases, 1–2 words each → avg <2 words/phrase.
  // Lower = worse. Used as informational diagnostic only — no retry.
  const avgWordsPerPhrase = phrases.length
    ? phrases.reduce((a, p) => a + p.trim().split(/\s+/).filter(Boolean).length, 0) / phrases.length
    : 0;

  return {
    coverage, bloat, filler: fillerHits, danglers: danglerCount,
    argSize: argSet.size, chainSize: chainTokens.length, phraseCount: phrases.length,
    avgWordsPerPhrase,
  };
}

// Backward-compat: simple overlap (used by existing tests).
function chainArgumentOverlap(argument, chainText) {
  return chainArgumentScore(argument, chainText).coverage;
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
  chainArgumentScore,
  // exposed for tests:
  clampSpan,
  mergeSpans,
  filterContainedIn,
  applyMarks,
  trimToHighlightCap,
  trimToUnderlineCap,
  snapToWordBoundaries,
  snapSpansToWordBoundaries,
  fixDanglingEnd,
  fixDanglingEnds,
  DANGLING_TAIL_WORDS,
  isFillerOnlySpan,
  dropFillerOnlySpans,
  FILLER_HIGHLIGHT_WORDS,
  isBadBoldSpan,
  dropBadBolds,
  trimFillerEdges,
  trimFillerEdgesAll,
  STOPWORD_ONLY_BAD_BOLDS,
  MIN_BOLD_RUN_CHARS,
  // quote-based resolver (iteration 8):
  resolveQuotePicks,
  resolveQuotesInParagraph,
  findQuoteInText,
  normalizeForMatch,
  // bridging + edge trim (post-deploy formatting fixes):
  bridgeAdjacentSpans,
  trimSpanEdges,
  trimSpanEdgesAll,
};
