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
  // 300-char paragraph. Underline = first 250 chars (83% — under 95% heavy cap).
  // Highlight requested = 150 chars → trimmed to 60 chars. 60/300 = 20% (under 65%).
  const text = 'a'.repeat(300);
  const candidates = [{ index: 0, originalIndex: 0, text }];
  const picksJson = {
    tag: 't', cite: 'c',
    picks: [{ p: 0, u: [[0, 250]], h: [[0, 150]] }],
  };
  const r = reconstructCard({ picksJson, candidates, density: 'heavy' });
  const hMatch = r.body_markdown.match(/==([^=]+)==/);
  assert.ok(hMatch, 'should still have a highlight after trim');
  assert.ok(hMatch[1].length <= MAX_HIGHLIGHT_RUN_CHARS,
    `highlight should be trimmed to ≤${MAX_HIGHLIGHT_RUN_CHARS} chars, got ${hMatch[1].length}`);
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
  assert.match(HARDCODED_CALIBRATION, /Vanguard cards/i);
  assert.match(HARDCODED_CALIBRATION, /Median highlight = 1 WORD/);
  assert.match(HARDCODED_CALIBRATION, /partial-word/i);
  assert.match(HARDCODED_CALIBRATION, /U\.S\./);
  assert.match(HARDCODED_CALIBRATION, /SELECTIVITY/i);
});

test('selection prompt: system prompt embeds calibration and char-offset language', () => {
  const p = buildSelectionSystemPrompt({ density: 'heavy', length: 'long' });
  assert.match(p, /CHARACTER offsets/i);
  assert.match(p, /partial-word/i);
  assert.match(p, /Vanguard cards/i);
  assert.match(p, /JSON/);
});

test('selection prompt: user prompt includes per-paragraph rulers', () => {
  const candidates = [
    { index: 0, originalIndex: 0, text: 'First paragraph here.' },
    { index: 1, originalIndex: 1, text: 'Second paragraph here.' },
  ];
  const out = buildSelectionUserPrompt({
    argument: 'test', candidates, density: 'heavy', length: 'long',
  });
  assert.match(out, /\[P0\][\s\S]*length: 21 chars/);
  assert.match(out, /\[P1\]/);
  assert.match(out, /character.*ruler/i);
});

// ── JSON schema sanity ────────────────────────────────────────────

test('CARD_PICKS_JSON_SCHEMA: requires tag, cite, picks', () => {
  const s = CARD_PICKS_JSON_SCHEMA.schema;
  assert.deepEqual(s.required.sort(), ['cite', 'picks', 'tag']);
  assert.equal(s.additionalProperties, false);
});

test('CARD_PICKS_JSON_SCHEMA: each pick requires p and u', () => {
  const item = CARD_PICKS_JSON_SCHEMA.schema.properties.picks.items;
  assert.deepEqual(item.required.sort(), ['p', 'u']);
});
