'use strict';

/**
 * Tests for the v3 cost-optimized card cutter pipeline (CHARACTER OFFSETS).
 *
 * Verifies the structural guarantees: paragraph integrity and verbatim
 * fidelity are mathematically impossible to violate, regardless of what
 * the LLM emits.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  selectCandidates, tokenize, bm25Rank,
} = require('../server/services/argumentRelevance');

const {
  reconstructCard, clampSpan, mergeSpans,
  filterContainedIn, applyMarks,
  trimToHighlightCap, trimToUnderlineCap,
  CARD_PICKS_JSON_SCHEMA, HIGHLIGHT_CAPS, UNDERLINE_CAPS,
  MAX_HIGHLIGHT_RUN_CHARS,
} = require('../server/services/cardReconstructor');

const {
  buildSelectionSystemPrompt, buildSelectionUserPrompt,
  annotateParagraphWithRuler, HARDCODED_CALIBRATION,
} = require('../server/prompts/cardCutter');

// ── argumentRelevance ─────────────────────────────────────────────

test('argumentRelevance: tokenize drops stopwords and short words', () => {
  const t = tokenize('The U.S. faces a credibility crisis in 2024.');
  assert.ok(t.includes('credibility'));
  assert.ok(t.includes('crisis'));
  assert.ok(t.includes('2024'));
  assert.ok(!t.includes('the'));
  assert.ok(!t.includes('a'));
  assert.ok(!t.includes('in'));
});

test('argumentRelevance: BM25 ranks topical paragraphs above filler', () => {
  const corpus = [
    'Today the weather forecast calls for sunny skies and a high of 72 degrees.',
    'U.S. credibility is collapsing as deterrence fails against rising powers like China and Russia.',
    'The chef recommends pairing the salmon with a crisp Sauvignon Blanc.',
    'Hypersonic weapons are accelerating the breakdown of nuclear stability and shrinking decision windows.',
  ];
  const ranked = bm25Rank({ corpus, query: 'U.S. credibility deterrence China Russia' })
    .sort((a, b) => b.score - a.score);
  assert.equal(ranked[0].index, 1);
  assert.ok(ranked[0].score > ranked[2].score);
});

test('argumentRelevance: selectCandidates returns first K when no argument', () => {
  const body = Array.from({ length: 8 }, (_, i) => `Paragraph ${i} body text here.`).join('\n\n');
  const r = selectCandidates({ bodyText: body, argument: '', k: 3, neighbours: 0 });
  assert.equal(r.candidates.length, 3);
  assert.equal(r.candidates[0].originalIndex, 0);
  assert.equal(r.candidates[2].originalIndex, 2);
});

test('argumentRelevance: selectCandidates includes neighbours of picks', () => {
  const paras = [
    'unrelated text about cuisine and travel.',
    'unrelated text about gardening and weather.',
    'unrelated text about astronomy and stars.',
    'NUCLEAR DETERRENCE COLLAPSES under hypersonic threats and shrinking warning windows.',
    'unrelated text about literature.',
    'unrelated text about chess strategy.',
  ];
  const r = selectCandidates({
    bodyText: paras.join('\n\n'),
    argument: 'nuclear deterrence collapse hypersonic',
    k: 1, neighbours: 1,
  });
  const picked = r.candidates.map(c => c.originalIndex).sort((a, b) => a - b);
  assert.deepEqual(picked, [2, 3, 4]);
});

test('argumentRelevance: candidate index is 0-based and sequential', () => {
  const paras = ['p0.', 'p1.', 'p2.', 'p3.', 'p4.'];
  const r = selectCandidates({
    bodyText: paras.join('\n\n'), argument: '', k: 5, neighbours: 0,
  });
  for (let i = 0; i < r.candidates.length; i++) {
    assert.equal(r.candidates[i].index, i);
  }
});

// ── cardReconstructor (CHAR offsets) ──────────────────────────────

test('cardReconstructor: clampSpan drops invalid char ranges', () => {
  assert.equal(clampSpan([5, 5], 100), null);
  assert.equal(clampSpan([6, 4], 100), null);
  assert.deepEqual(clampSpan([-2, 1000], 100), [0, 100]);
  assert.deepEqual(clampSpan([2, 4], 100), [2, 4]);
  assert.equal(clampSpan(null, 100), null);
});

test('cardReconstructor: mergeSpans combines overlap', () => {
  assert.deepEqual(mergeSpans([[0, 30], [20, 50], [70, 90]]), [[0, 50], [70, 90]]);
});

test('cardReconstructor: filterContainedIn drops free-floating', () => {
  const u = [[0, 100]];
  assert.deepEqual(filterContainedIn([[20, 50], [110, 150]], u), [[20, 50]]);
});

test('cardReconstructor: applyMarks emits marks at exact char boundaries', () => {
  const text = 'The U.S. faces a credibility crisis.';
  // text:        T h e   U . S .   f a c e s   a   c  r  e  d  i  b  i  l  i  t  y     c  r  i  s  i  s  .
  // index:       0 1 2 3 4 5 6 7 8 9 10 ...                          17 18 19 ...        28 29 30 31 32 33 34 35
  const out = applyMarks({
    paragraphText: text,
    underlines: [[0, 36]],
    highlights: [[17, 35]], // "credibility crisis"
    bolds: [],
    loudestSpan: null,
  });
  assert.match(out, /<u>The U\.S\. faces a ==credibility crisis==\.<\/u>/);
});

test('cardReconstructor: applyMarks supports partial-word highlights', () => {
  // The U.S. faces ... to highlight just "U" and "S" of "United States"
  const text = 'The United States and Russia.';
  // T h e   U n i t e d   S  t  a  t  e  s     a  n  d     R  u  s  s  i  a  .
  // 0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28
  const out = applyMarks({
    paragraphText: text,
    underlines: [[0, 29]],
    highlights: [[4, 5], [11, 12]],   // just "U" of United, "S" of States
    bolds: [],
    loudestSpan: null,
  });
  // Expect: <u>The ==U==nited ==S==tates and Russia.</u>
  assert.match(out, /<u>The ==U==nited ==S==tates and Russia\.<\/u>/);
});

test('cardReconstructor: 100% verbatim — output is exact source after stripping marks', () => {
  const sourceParagraph = 'Hypersonic weapons compress the window between launch and strike from thirty minutes to under five.';
  const candidates = [{ index: 0, originalIndex: 0, text: sourceParagraph }];

  const picksJson = {
    tag: 'Hypersonic weapons collapse C2.',
    cite: 'Author 24 [...]',
    picks: [{
      p: 0,
      u: [[0, sourceParagraph.length]],
      h: [[0, 19], [29, 35]], // "Hypersonic weapons", "window"
      b: [[0, 19]],
    }],
  };
  const r = reconstructCard({ picksJson, candidates, density: 'heavy' });

  const stripped = r.body_markdown
    .replace(/\*\*<u>([\s\S]*?)<\/u>\*\*/g, '$1')
    .replace(/<\/?u>/g, '')
    .replace(/==/g, '')
    .replace(/\*\*/g, '');
  assert.equal(stripped, sourceParagraph);
});

test('cardReconstructor: adversarial picks cannot break verbatim', () => {
  const source = 'Climate emissions hit a record high last year, outpacing every IPCC mitigation pathway.';
  const candidates = [{ index: 0, originalIndex: 0, text: source }];

  const picksJson = {
    tag: 'Climate.',
    cite: 'Author [...]',
    picks: [
      { p: 0, u: [[-50, 9999]], h: [[20, 9999]], b: [[5000, 6000]] },
      { p: 99, u: [[0, 5]], h: [[0, 1]] },
      { p: 0, u: [[0, 50]], h: [[0, 7]] },
    ],
  };
  const r = reconstructCard({ picksJson, candidates, density: 'heavy' });

  const stripped = r.body_markdown
    .replace(/<\/?u>/g, '').replace(/==/g, '').replace(/\*\*/g, '');
  assert.ok(source.includes(stripped) || stripped === source,
    `Stripped output must be verbatim. Got: ${stripped}`);
});

test('cardReconstructor: graceful fallback when zero valid picks', () => {
  const candidates = [
    { index: 0, originalIndex: 0, text: 'Paragraph one verbatim.' },
    { index: 1, originalIndex: 1, text: 'Paragraph two verbatim.' },
  ];
  const picksJson = {
    tag: 'fallback', cite: 'Author [...]',
    picks: [{ p: 999, u: [[0, 1]] }, { p: 50, u: [[0, 1]] }],
  };
  const r = reconstructCard({ picksJson, candidates, density: 'heavy' });
  assert.equal(r.fallback, true);
  assert.match(r.body_markdown, /Paragraph one verbatim\./);
});

test('cardReconstructor: highlight runs over MAX_HIGHLIGHT_RUN_CHARS get trimmed', () => {
  // Realistic text with word boundaries (so snap doesn't collapse).
  // Each "word " is 5 chars, ~100 words = 500 chars.
  const text = ('alpha bravo charlie delta echo foxtrot golf hotel india juliet ').repeat(8);
  const candidates = [{ index: 0, originalIndex: 0, text }];
  // Underline 400 chars; highlight 150 chars (will be max-run-trimmed to 20).
  const picksJson = {
    tag: 't', cite: 'c',
    picks: [{ p: 0, u: [[0, 400]], h: [[0, 150]] }],
  };
  const r = reconstructCard({ picksJson, candidates, density: 'heavy' });
  const hMatch = r.body_markdown.match(/==([^=]+)==/);
  assert.ok(hMatch, 'should still have a highlight after trim');
  assert.ok(hMatch[1].length <= MAX_HIGHLIGHT_RUN_CHARS,
    `highlight should be trimmed to ≤${MAX_HIGHLIGHT_RUN_CHARS} chars, got ${hMatch[1].length}`);
});

test('cardReconstructor: snap to word boundary fixes mid-word edges', () => {
  // "with U.S. extended deterrence" → if model emits [0, 13] (cuts "extended"
  // at "exte"), snap should pull `to` back to end of "U.S." (8) since pos 13
  // is mid-word "extended" (text[12]='e', text[13]='n').
  const text = 'with U.S. extended deterrence';
  // chars: w(0) i(1) t(2) h(3) ' '(4) U(5) .(6) S(7) .(8) ' '(9) e(10)x(11)t(12)e(13)n(14)d(15)e(16)d(17) ' '(18) ...
  // Wait let me recount
  // 0:'w' 1:'i' 2:'t' 3:'h' 4:' ' 5:'U' 6:'.' 7:'S' 8:'.' 9:' ' 10:'e' 11:'x' 12:'t' 13:'e' 14:'n' 15:'d' 16:'e' 17:'d'
  // Span [0, 14] covers "with U.S. exte" — cuts "extended" mid-word.
  // text[13]='e' (wordchar), text[14]='n' (wordchar) → mid-word, snap backward.
  // Snap pulls to back through 'e','t','x','e' until it hits text[10]='e' / text[9]=' '. So to=10.
  const out = applyMarks({
    paragraphText: text,
    underlines: [[0, text.length]],
    highlights: [],
    bolds: [],
    loudestSpan: null,
  });
  // Just ensure rendering works on this corpus; the snap-specific assertion
  // is below.
  assert.match(out, /<u>with U\.S\. extended deterrence<\/u>/);

  const { snapToWordBoundaries } = require('../server/services/cardReconstructor');
  const snapped = snapToWordBoundaries([0, 14], text);
  // Snap should pull `to` back from mid-"extended" to end of "U.S." (pos 9),
  // and trim trailing whitespace (so no trailing space included).
  assert.deepEqual(snapped, [0, 9], `Expected [0, 9] (with U.S.), got ${JSON.stringify(snapped)}`);

  // Span [13, text.length] cuts "extended" mid-word at start, ends cleanly.
  // Snap should pull from past "extended" + space to start of "deterrence".
  const snapped2 = snapToWordBoundaries([13, text.length], text);
  assert.ok(snapped2 && snapped2[0] >= 18, `Expected from past 'extended', got ${JSON.stringify(snapped2)}`);
});

test('cardReconstructor: snap trims trailing whitespace and leading punctuation', () => {
  const text = 'Korea, China and Russia.';
  // 0:K 1:o 2:r 3:e 4:a 5:, 6:' ' 7:C 8:h 9:i 10:n 11:a 12:' ' 13:a 14:n 15:d 16:' ' 17:R 18:u 19:s 20:s 21:i 22:a 23:.
  const { snapToWordBoundaries } = require('../server/services/cardReconstructor');
  // Span [0, 7] = "Korea, " (with trailing comma+space). Should trim to "Korea," (no trailing space).
  const r = snapToWordBoundaries([0, 7], text);
  assert.deepEqual(r, [0, 6], `Expected [0, 6] (Korea,), got ${JSON.stringify(r)}`);
  // Span [5, 12] = ", China " — should snap from past leading comma+space to start of "China", trim trailing space.
  const r2 = snapToWordBoundaries([5, 12], text);
  assert.deepEqual(r2, [7, 12], `Expected [7, 12] (China), got ${JSON.stringify(r2)}`);
});

test('cardReconstructor: highlight cap enforced (heavy)', () => {
  // 100-char paragraph; heavy highlight cap = 65% = 65 chars
  const text = 'x'.repeat(100);
  const candidates = [{ index: 0, originalIndex: 0, text }];
  // Try to highlight 90 chars (90%)
  const picksJson = {
    tag: 't', cite: 'c',
    picks: [{
      p: 0,
      u: [[0, 100]],
      h: [[0, 30], [40, 70], [75, 100]],   // 30+30+25 = 85 chars
    }],
  };
  const r = reconstructCard({ picksJson, candidates, density: 'heavy' });
  let highlightedChars = 0;
  for (const m of r.body_markdown.matchAll(/==([^=]+)==/g)) {
    highlightedChars += m[1].length;
  }
  assert.ok(highlightedChars / 100 <= HIGHLIGHT_CAPS.heavy + 0.001,
    `${highlightedChars}/100 > heavy cap ${HIGHLIGHT_CAPS.heavy}`);
});

test('cardReconstructor: bolds outside underline are dropped', () => {
  const text = 'one two three four five.';
  const candidates = [{ index: 0, originalIndex: 0, text }];
  const picksJson = {
    tag: 't', cite: 'c',
    picks: [{ p: 0, u: [[0, 7]], h: [[0, 3]], b: [[15, 23]] }],
  };
  const r = reconstructCard({ picksJson, candidates, density: 'heavy' });
  assert.equal(r.stats.dropped.bolds, 1);
});

test('cardReconstructor: paragraphs come out in source document order', () => {
  const candidates = [
    { index: 0, originalIndex: 5, text: 'fifth source paragraph.' },
    { index: 1, originalIndex: 2, text: 'second source paragraph.' },
    { index: 2, originalIndex: 9, text: 'ninth source paragraph.' },
  ];
  const picksJson = {
    tag: 't', cite: 'c',
    picks: [
      { p: 2, u: [[0, 5]] },
      { p: 0, u: [[0, 5]] },
      { p: 1, u: [[0, 6]] },
    ],
  };
  const r = reconstructCard({ picksJson, candidates, density: 'heavy' });
  const order = r.body_markdown.indexOf('second') < r.body_markdown.indexOf('fifth') &&
                r.body_markdown.indexOf('fifth')  < r.body_markdown.indexOf('ninth');
  assert.ok(order);
});

// ── selection prompt ──────────────────────────────────────────────

test('selection prompt: annotateParagraphWithRuler shows char positions', () => {
  const out = annotateParagraphWithRuler('The U.S. faces a crisis.');
  // Should have a tens row, ones row, and the text
  const lines = out.split('\n');
  assert.ok(lines.length >= 3);
  assert.ok(lines[lines.length - 1].includes('The U.S. faces'));
});

test('selection prompt: HARDCODED_CALIBRATION includes empirical patterns', () => {
  // 2026-05-03: rewritten to reference real hand-cut LD cards rather than
  // "Vanguard cards" — same gold-standard, more general phrasing.
  assert.match(HARDCODED_CALIBRATION, /hand-cut/i);
  assert.match(HARDCODED_CALIBRATION, /warrant/i);
  assert.match(HARDCODED_CALIBRATION, /landing/i);
});

test('selection prompt: system prompt embeds calibration and quote-based language', () => {
  // Iteration 8 (2026-05-03): switched from char-offset picks to quote-based.
  // Model now emits VERBATIM strings instead of [from,to] ranges.
  const p = buildSelectionSystemPrompt({ density: 'heavy', length: 'long' });
  assert.match(p, /VERBATIM/i);
  assert.match(p, /hand-cut/i);
  assert.match(p, /JSON/);
  assert.match(p, /WORKFLOW|UNDERSTAND THE ARGUMENT|composed speech/i);
});

test('selection prompt: user prompt includes paragraph indices for verbatim quotes', () => {
  // Iter 8: dropped char rulers (model emits quotes, not offsets).
  const candidates = [
    { index: 0, originalIndex: 0, text: 'First paragraph here.' },
    { index: 1, originalIndex: 1, text: 'Second paragraph here.' },
  ];
  const out = buildSelectionUserPrompt({
    argument: 'test', candidates, density: 'heavy', length: 'long',
  });
  assert.match(out, /\[P0\]/);
  assert.match(out, /\[P1\]/);
  assert.match(out, /verbatim/i);
});

// ── JSON schema sanity ────────────────────────────────────────────

test('CARD_PICKS_JSON_SCHEMA: requires tag, cite, argument, picks', () => {
  const s = CARD_PICKS_JSON_SCHEMA.schema;
  assert.deepEqual(s.required.sort(), ['argument', 'cite', 'picks', 'tag']);
  assert.equal(s.additionalProperties, false);
});

test('CARD_PICKS_JSON_SCHEMA: each pick requires p and u', () => {
  const item = CARD_PICKS_JSON_SCHEMA.schema.properties.picks.items;
  assert.deepEqual(item.required.sort(), ['p', 'u']);
});

// ── 2026-05-03: quality fixes (cite, bolds, filler-prefix) ────────

const {
  isBadBoldSpan, dropBadBolds, trimFillerEdges, trimFillerEdgesAll,
} = require('../server/services/cardReconstructor');
const { reduceShortCiteToLastName } = require('../server/services/cutCardV2');

test('reduceShortCiteToLastName: full-name prefix → lastname only', () => {
  assert.equal(reduceShortCiteToLastName("Ian Bowers '23"), "Bowers '23");
  assert.equal(reduceShortCiteToLastName("James M. Acton '24"), "Acton '24");
  assert.equal(reduceShortCiteToLastName("Bowers '23"), "Bowers '23");
  assert.equal(reduceShortCiteToLastName("Smith"), "Smith");
  assert.equal(reduceShortCiteToLastName(""), "");
  assert.equal(reduceShortCiteToLastName("Dr. Jane Goodall '21"), "Goodall '21");
  // Comma form: "Bowers, Ian '23" → "Bowers '23".
  assert.equal(reduceShortCiteToLastName("Bowers, Ian '23"), "Bowers '23");
  // 4-digit year form.
  assert.equal(reduceShortCiteToLastName("Smith 2024"), "Smith 2024");
  assert.equal(reduceShortCiteToLastName("John Smith 2024"), "Smith 2024");
});

test('isBadBoldSpan: rejects single-char bolds', () => {
  const text = 'extreme threats';
  assert.equal(isBadBoldSpan([0, 1], text), true);   // "e" alone
  assert.equal(isBadBoldSpan([0, 7], text), false);  // "extreme"
});

test('isBadBoldSpan: rejects stopword-only bolds', () => {
  const text = 'the upper hand';
  assert.equal(isBadBoldSpan([0, 3], text), true);    // "the"
  assert.equal(isBadBoldSpan([4, 9], text), false);   // "upper"
  assert.equal(isBadBoldSpan([4, 14], text), false);  // "upper hand"
});

test('dropBadBolds: filters single-char and stopword-only', () => {
  const text = 'the asymmetric arms';
  const spans = [[0, 3], [4, 14], [0, 1]];  // "the", "asymmetric", "t"
  const out = dropBadBolds(spans, text);
  assert.deepEqual(out, [[4, 14]]);
});

test('trimFillerEdges: strips leading "As a result," from highlight', () => {
  const text = 'As a result, conventional counterforce is impossible';
  const span = [0, text.length];
  const out = trimFillerEdges(span, text);
  // Should start at "conventional", not at "As".
  assert.ok(out, 'should not return null');
  assert.equal(text.slice(out[0], out[1]).startsWith('conventional'), true);
});

test('trimFillerEdges: strips leading "First," from highlight', () => {
  const text = 'First, conventional counterforce is hard';
  const span = [0, text.length];
  const out = trimFillerEdges(span, text);
  assert.ok(out);
  assert.equal(text.slice(out[0], out[1]).startsWith('conventional'), true);
});

test('trimFillerEdges: leaves clean spans alone', () => {
  const text = 'asymmetric arms race';
  const span = [0, text.length];
  const out = trimFillerEdges(span, text);
  assert.deepEqual(out, [0, text.length]);
});

test('reconstructCard: drops single-char and stopword bolds in pipeline', () => {
  const candidates = [
    { index: 0, originalIndex: 0, text: 'The asymmetric arms race is impossible to win.' },
  ];
  const picksJson = {
    tag: 'test', cite: 'X', argument: 'asymmetric arms race',
    picks: [{
      p: 0,
      u: [[0, 46]],
      h: [[4, 14]],
      // bolds: single "T", stopword "the", and good "asymmetric"
      b: [[0, 1], [0, 3], [4, 14]],
    }],
  };
  const out = reconstructCard({ picksJson, candidates, density: 'heavy' });
  // The valid bold "asymmetric" survives. The renderer nests bold OUTSIDE
  // highlight when both cover the same span (`**==asymmetric==**`), so
  // check for the bold-marker pair around "asymmetric" rather than the
  // strict `**asymmetric**` literal.
  assert.ok(/\*\*[^*]*asymmetric[^*]*\*\*/.test(out.body_markdown),
    `should bold "asymmetric", got: ${out.body_markdown}`);
  // Bad bolds must NOT appear: no single "T" bold, no "The" bold, and
  // no clustered "The asymmetric" bold (the trap fixDanglingEnds used to
  // produce when extending a stopword-only span).
  assert.ok(!/\*\*T\s/.test(out.body_markdown), 'must not bold single "T"');
  assert.ok(!/\*\*[Tt]he\*\*/.test(out.body_markdown), 'must not bold "the"');
  assert.ok(!/\*\*[Tt]he\s+[a-z]+\*\*/.test(out.body_markdown),
    'must not cluster-bold "The asymmetric"');
});

test('reconstructCard: trims filler prefix from highlight', () => {
  // Padding to a realistic paragraph length so the highlight cap doesn't
  // drop the only highlight (cap is % of paragraph, so a 30-char highlight
  // in a 50-char paragraph exceeds it).
  const sentence1 = 'First, conventional counterforce is hard to deploy. ';
  const filler = 'There are many reasons why this is the case in modern military strategy and policy. '.repeat(3);
  const text = sentence1 + filler;
  const candidates = [
    { index: 0, originalIndex: 0, text },
  ];
  const picksJson = {
    tag: 'test', cite: 'X', argument: 'conventional counterforce is hard',
    picks: [{
      p: 0,
      u: [[0, text.length]],
      h: [[0, 33]],   // span includes "First, conventional counterforce"
      b: [],
    }],
  };
  const out = reconstructCard({ picksJson, candidates, density: 'heavy' });
  // The highlight must NOT include "First," — should start at "conventional".
  // The phrase "conventional counterforce" may stay whole (with bumped
  // 30-char cap) or be split into 2-word fragments. Either way, the
  // highlighted region must START at "conventional".
  assert.ok(/==conventional( |=)/.test(out.body_markdown),
    `highlight should start at "conventional", got: ${out.body_markdown}`);
  assert.ok(!/==First,? conventional/.test(out.body_markdown),
    `highlight must not include "First," prefix, got: ${out.body_markdown}`);
});

// ── Anti-bot / captcha detection (scraper) ──────────────────────────

const { isBotBlockedPage } = require('../server/services/scraper');

test('isBotBlockedPage: detects Cloudflare "Just a moment..." title', () => {
  assert.equal(isBotBlockedPage({ title: 'Just a moment...', html: '', bodyText: '' }), true);
  assert.equal(isBotBlockedPage({ title: 'Just a moment', html: '', bodyText: '' }), true);
});

test('isBotBlockedPage: detects "Attention Required" Cloudflare WAF', () => {
  assert.equal(isBotBlockedPage({ title: 'Attention Required! | Cloudflare', html: '', bodyText: '' }), true);
});

test('isBotBlockedPage: detects "Performing security verification" body text', () => {
  const bodyText = 'www.tandfonline.com\n\nPerforming security verification';
  assert.equal(isBotBlockedPage({ title: '', html: '', bodyText }), true);
});

test('isBotBlockedPage: detects Cloudflare challenge platform marker in HTML', () => {
  const html = '<html><body><script src="/cdn-cgi/challenge-platform/h/g/scripts/jsd/main.js"></script></body></html>';
  assert.equal(isBotBlockedPage({ title: 'Article title', html, bodyText: 'normal content' }), true);
});

test('isBotBlockedPage: lets through normal article pages', () => {
  const bodyText = 'A long article about nuclear deterrence policy in the Korean peninsula. '.repeat(50);
  const title = 'Nuclear Deterrence in Northeast Asia';
  const html = '<html><head><title>Nuclear Deterrence in Northeast Asia</title></head>...';
  assert.equal(isBotBlockedPage({ title, html, bodyText }), false);
});

test('isBotBlockedPage: short body without captcha keywords is NOT blocked', () => {
  // Short bodies without verification keywords pass — handled by separate
  // [SCRAPE LIMITED] check in scrapeUrl.
  const bodyText = 'Brief article about climate change.';
  assert.equal(isBotBlockedPage({ title: 'Climate', html: '', bodyText }), false);
});

test('isBotBlockedPage: detects "verifying you are human" body text', () => {
  const bodyText = 'tandfonline.com\n\nVerifying you are human. This may take a few seconds.';
  assert.equal(isBotBlockedPage({ title: '', html: '', bodyText }), true);
});

test('isBotBlockedPage: detects "Pardon Our Interruption" PerimeterX', () => {
  assert.equal(isBotBlockedPage({ title: 'Pardon Our Interruption', html: '', bodyText: '' }), true);
});

// ── Span bridging + edge trim (formatting polish) ────────────────────

const { bridgeAdjacentSpans, trimSpanEdges } = require('../server/services/cardReconstructor');

test('bridgeAdjacentSpans: bridges two spans separated by single space', () => {
  const text = 'Kim Jong-un policy';
  const spans = [[0, 3], [4, 11]]; // "Kim", "Jong-un"
  const out = bridgeAdjacentSpans(spans, text);
  assert.deepEqual(out, [[0, 11]], `Should bridge to "Kim Jong-un", got ${JSON.stringify(out)}`);
});

test('bridgeAdjacentSpans: bridges across possessive "\'s "', () => {
  // "Kim's policy" — model emits "Kim" and "policy" separately.
  // Gap = "'s " (apostrophe + s + space) → bridgeable as possessive.
  const text = "Kim's policy is failing";
  // K(0)i(1)m(2)'(3)s(4) (5)p(6)o(7)l(8)i(9)c(10)y(11)
  const spans = [[0, 3], [6, 12]];
  const out = bridgeAdjacentSpans(spans, text);
  assert.deepEqual(out, [[0, 12]],
    `Should bridge across "'s ", got ${JSON.stringify(out)}`);
});

test('bridgeAdjacentSpans: respects maxLen cap', () => {
  // Two 11-char spans with single space gap → combined 23 chars.
  // With maxLen=22 should NOT bridge (preserves splitter fragments).
  const text = 'aaaaaaaaaaa bbbbbbbbbbb';  // 11 a's, space, 11 b's = 23 chars
  const spans = [[0, 11], [12, 23]];
  const out = bridgeAdjacentSpans(spans, text, 22);
  assert.deepEqual(out, [[0, 11], [12, 23]], 'Should NOT bridge — over cap');
  // Without cap, should bridge.
  const out2 = bridgeAdjacentSpans(spans, text, 100);
  assert.deepEqual(out2, [[0, 23]], 'Should bridge with high cap');
});

test('bridgeAdjacentSpans: does NOT bridge across content words', () => {
  const text = 'Kim met with Trump';
  const spans = [[0, 3], [13, 18]]; // "Kim", "Trump"
  const out = bridgeAdjacentSpans(spans, text);
  assert.deepEqual(out, [[0, 3], [13, 18]],
    'Should NOT bridge across "met with" (content words)');
});

test('bridgeAdjacentSpans: does NOT bridge if gap is too long', () => {
  const text = 'A      B';   // 6 spaces between
  const spans = [[0, 1], [7, 8]];
  const out = bridgeAdjacentSpans(spans, text);
  assert.deepEqual(out, [[0, 1], [7, 8]],
    'Should NOT bridge if gap >3 chars');
});

test('trimSpanEdges: strips leading whitespace', () => {
  // 'word here' — w(0) o(1) r(2) d(3) ' '(4) h(5) e(6) r(7) e(8). length 9.
  const text = 'word here';
  assert.deepEqual(trimSpanEdges([5, 9], text), [5, 9]);  // "here" no change
  assert.deepEqual(trimSpanEdges([4, 9], text), [5, 9]);  // " here" → "here"
});

test('trimSpanEdges: strips trailing whitespace', () => {
  // 'word here ' — last char is space at index 9.
  const text = 'word here ';
  assert.deepEqual(trimSpanEdges([0, 5], text), [0, 4]);  // "word "→"word"
  assert.deepEqual(trimSpanEdges([0, 10], text), [0, 9]); // strip final space
});

test('trimSpanEdges: returns null if span collapses', () => {
  const text = '   ';
  assert.equal(trimSpanEdges([0, 3], text), null);
});

test('reconstructCard: bridges two adjacent highlights into one render', () => {
  // "Kim Jong-un" — model emits "Kim" and "Jong-un" as separate highlights.
  // Expected: rendered as one continuous ==Kim Jong-un== span.
  const candidates = [
    { index: 0, originalIndex: 0, text: 'A statement about Kim Jong-un policy.' },
  ];
  const picksJson = {
    tag: 't', cite: 'C', argument: 'Kim Jong-un policy',
    picks: [{
      p: 0,
      u: [[0, 37]],
      h: [[18, 21], [22, 29]],   // "Kim", "Jong-un"
      b: [],
    }],
  };
  const out = reconstructCard({ picksJson, candidates, density: 'heavy' });
  // After bridging: ==Kim Jong-un== as one continuous span.
  assert.ok(/==Kim Jong-un==/.test(out.body_markdown),
    `Adjacent highlights should bridge, got: ${out.body_markdown}`);
  // Should NOT have two separate ==..== blocks for the bridged words.
  assert.ok(!/==Kim== ==Jong-un==/.test(out.body_markdown),
    `Should not render as two separate highlights, got: ${out.body_markdown}`);
});

// ── Giant-paragraph splitter for BM25 stability ──────────────────────

const {
  splitGiantParagraphs,
  MAX_PARAGRAPH_CHARS,
  TARGET_CHUNK_CHARS,
} = require('../server/services/argumentRelevance');

test('splitGiantParagraphs: short paragraphs pass through unchanged', () => {
  const paras = ['Short first.', 'Short second sentence here.'];
  assert.deepEqual(splitGiantParagraphs(paras), paras);
});

test('splitGiantParagraphs: dices a giant paragraph at sentence boundaries', () => {
  // Build one paragraph way over MAX_PARAGRAPH_CHARS with clear sentences.
  const sentence = 'This is a sentence with enough content to register as substantial. ';
  const giant = sentence.repeat(40); // ~2700 chars
  const out = splitGiantParagraphs([giant]);
  assert.ok(out.length >= 4, `Should produce multiple chunks, got ${out.length}`);
  // Each chunk should be near targetChars, never wildly over.
  for (const chunk of out) {
    assert.ok(chunk.length <= TARGET_CHUNK_CHARS + sentence.length,
      `Chunk exceeded target by too much: ${chunk.length}`);
  }
  // Recombined text should equal the original (modulo whitespace).
  const rejoined = out.join(' ').replace(/\s+/g, ' ').trim();
  const original = giant.replace(/\s+/g, ' ').trim();
  assert.equal(rejoined, original, 'Splitting must preserve all source text verbatim');
});

test('splitGiantParagraphs: never splits in the middle of a sentence', () => {
  const oneLongSentence = 'A'.repeat(800) + '.';   // single 801-char "sentence"
  const out = splitGiantParagraphs([oneLongSentence]);
  // No clean sentence boundary → keep as one chunk even though over target.
  assert.equal(out.length, 1);
  assert.equal(out[0], oneLongSentence);
});

test('splitGiantParagraphs: mixed input — small + giant + small', () => {
  const giant = 'This is one sentence. '.repeat(80);  // ~1760 chars, multiple sentences
  const paras = ['Small intro.', giant, 'Small outro.'];
  const out = splitGiantParagraphs(paras);
  assert.equal(out[0], 'Small intro.');
  assert.equal(out[out.length - 1], 'Small outro.');
  // Middle giant should have produced multiple chunks.
  assert.ok(out.length >= 4, `Expected at least 4 chunks, got ${out.length}`);
});
