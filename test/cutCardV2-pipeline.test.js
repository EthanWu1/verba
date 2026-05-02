'use strict';

/**
 * Tests for the v2 cost-optimized card cutter pipeline.
 *
 * The whole point of v2 is that paragraph integrity and verbatim fidelity
 * are STRUCTURAL — they cannot be violated by any LLM output, including
 * adversarial ones. These tests verify those guarantees.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  selectCandidates, tokenize, bm25Rank,
} = require('../server/services/argumentRelevance');

const {
  reconstructCard, tokenizeWords, clampSpan, mergeSpans,
  filterContainedIn, applyMarks,
  trimToHighlightCap, trimToUnderlineCap,
  CARD_PICKS_JSON_SCHEMA, HIGHLIGHT_CAPS, UNDERLINE_CAPS,
} = require('../server/services/cardReconstructor');

const {
  buildSelectionSystemPrompt, buildSelectionUserPrompt,
  indexParagraphWords,
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
  // The two on-topic paragraphs (1 and 3) should outrank the off-topic ones.
  assert.equal(ranked[0].index, 1);
  assert.ok(ranked[0].score > ranked[2].score, 'top BM25 score should clearly beat off-topic');
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
  // Should pick paragraph 3 plus neighbours 2 and 4.
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

// ── cardReconstructor ─────────────────────────────────────────────

test('cardReconstructor: tokenizeWords keeps punctuation attached', () => {
  const w = tokenizeWords('The U.S. faces a credibility crisis.');
  assert.deepEqual(w, ['The', 'U.S.', 'faces', 'a', 'credibility', 'crisis.']);
});

test('cardReconstructor: clampSpan drops invalid ranges', () => {
  assert.equal(clampSpan([5, 5], 10), null);   // empty
  assert.equal(clampSpan([6, 4], 10), null);   // reversed
  assert.deepEqual(clampSpan([-2, 100], 10), [0, 10]);  // clipped
  assert.deepEqual(clampSpan([2, 4], 10), [2, 4]);
  assert.equal(clampSpan(null, 10), null);
  assert.equal(clampSpan([1], 10), null);
});

test('cardReconstructor: mergeSpans combines overlap', () => {
  assert.deepEqual(mergeSpans([[0, 3], [2, 5], [7, 9]]), [[0, 5], [7, 9]]);
  assert.deepEqual(mergeSpans([]), []);
});

test('cardReconstructor: filterContainedIn drops free-floating', () => {
  const u = [[0, 10]];
  assert.deepEqual(filterContainedIn([[2, 5], [11, 15]], u), [[2, 5]]);
});

test('cardReconstructor: applyMarks emits correct nesting', () => {
  const words = ['The', 'U.S.', 'faces', 'a', 'credibility', 'crisis.'];
  const out = applyMarks({
    words,
    underlines: [[0, 6]],
    highlights: [[4, 6]],
    bolds: [],
    loudestSpan: null,
  });
  assert.match(out, /<u>The U\.S\. faces a ==credibility crisis\.==<\/u>/);
});

test('cardReconstructor: applyMarks handles loudest as **<u>...</u>** wrap', () => {
  const words = ['Foo', 'bar', 'baz', 'qux'];
  const out = applyMarks({
    words,
    underlines: [[0, 4]],
    highlights: [[1, 3]],
    bolds: [],
    loudestSpan: [1, 3],
  });
  // Loudest range 1..3 should be wrapped in **...** outside <u>...</u>
  // and contain the highlight.
  assert.match(out, /\*\*bar baz\*\*|<u>.*\*\*.*==bar baz==.*\*\*.*<\/u>/);
});

test('cardReconstructor: 100% verbatim — output paragraph is exact source paragraph (no marks stripped)', () => {
  const sourceParagraph = 'Hypersonic weapons compress the window between launch and strike from thirty minutes to under five.';
  const candidates = [{ index: 0, originalIndex: 0, text: sourceParagraph }];

  const picksJson = {
    tag: 'Hypersonic weapons collapse C2.',
    cite: 'Author 24 [...]',
    picks: [{ p: 0, u: [[0, 16]], h: [[0, 2], [4, 6]], b: [[4, 6]] }],
  };
  const r = reconstructCard({ picksJson, candidates, density: 'heavy' });

  // Strip marks and compare against the source.
  const stripped = r.body_markdown
    .replace(/\*\*<u>([\s\S]*?)<\/u>\*\*/g, '$1')
    .replace(/<\/?u>/g, '')
    .replace(/==/g, '')
    .replace(/\*\*/g, '');
  assert.equal(stripped, sourceParagraph);
});

test('cardReconstructor: 100% verbatim — adversarial picks (out-of-range, paraphrase attempt) cannot break it', () => {
  // The "model" returns invalid indices, out-of-range spans, free-floating
  // highlights, AND tries to claim a paragraph that doesn't exist. Output
  // must STILL be either the verbatim source paragraph from a valid pick,
  // or the graceful fallback (no pick is valid).
  const source = 'Climate emissions hit a record high last year, outpacing every IPCC mitigation pathway.';
  const candidates = [{ index: 0, originalIndex: 0, text: source }];

  const picksJson = {
    tag: 'Climate.',
    cite: 'Author [...]',
    picks: [
      { p: 0, u: [[-5, 100]], h: [[2, 99]], b: [[50, 60]] },     // garbage offsets
      { p: 99, u: [[0, 5]], h: [[0, 1]] },                        // nonexistent paragraph
      { p: 0, u: [[0, 12]], h: [[0, 2]] },                        // duplicate paragraph
    ],
  };
  const r = reconstructCard({ picksJson, candidates, density: 'heavy' });

  const stripped = r.body_markdown
    .replace(/<\/?u>/g, '').replace(/==/g, '').replace(/\*\*/g, '');
  // The plain text must be a substring of (or equal to) the source — no paraphrasing possible.
  assert.ok(source.includes(stripped) || stripped === source,
    `Stripped output must be verbatim from source. Got: ${stripped}`);
});

test('cardReconstructor: graceful fallback when zero valid picks', () => {
  const candidates = [
    { index: 0, originalIndex: 0, text: 'Paragraph one verbatim.' },
    { index: 1, originalIndex: 1, text: 'Paragraph two verbatim.' },
  ];
  const picksJson = {
    tag: 'fallback test', cite: 'Author [...]',
    picks: [{ p: 999, u: [[0, 1]] }, { p: 50, u: [[0, 1]] }],   // none valid
  };
  const r = reconstructCard({ picksJson, candidates, density: 'heavy' });
  assert.equal(r.fallback, true);
  // Both source paragraphs included verbatim.
  assert.match(r.body_markdown, /Paragraph one verbatim\./);
  assert.match(r.body_markdown, /Paragraph two verbatim\./);
});

test('cardReconstructor: highlight runs >5 words get trimmed', () => {
  // 30-word paragraph. Underline = 14 words (≈47% — under heavy cap 72%).
  // Highlight requested = 9 words → trimmed to 5 → 5/30 ≈ 17%, under heavy
  // highlight cap 30%. Should survive.
  const text = Array.from({ length: 30 }, (_, i) => `word${i}`).join(' ') + '.';
  const candidates = [{ index: 0, originalIndex: 0, text }];
  const picksJson = {
    tag: 't', cite: 'c',
    picks: [{ p: 0, u: [[0, 14]], h: [[0, 9]] }],   // 9-word highlight requested
  };
  const r = reconstructCard({ picksJson, candidates, density: 'heavy' });
  const hMatch = r.body_markdown.match(/==([\s\S]+?)==/);
  assert.ok(hMatch, 'should still have a highlight');
  const hWords = hMatch[1].trim().split(/\s+/).length;
  assert.ok(hWords <= 5, `highlight trimmed to ≤5 words, got ${hWords}: "${hMatch[1]}"`);
});

test('cardReconstructor: highlight cap enforced (heavy = 30%)', () => {
  // 20 words; heavy cap = 30% = 6 words max highlighted.
  const text = Array.from({ length: 20 }, (_, i) => `word${i}`).join(' ') + '.';
  const candidates = [{ index: 0, originalIndex: 0, text }];
  // Try to highlight 50% (10 words).
  const picksJson = {
    tag: 't', cite: 'c',
    picks: [{
      p: 0,
      u: [[0, 21]],
      h: [[0, 3], [5, 7], [10, 13], [15, 18]], // 3+2+3+3 = 11 words
    }],
  };
  const r = reconstructCard({ picksJson, candidates, density: 'heavy' });
  // Count total words inside == ... == in the rendered output.
  let highlightedWords = 0;
  for (const m of r.body_markdown.matchAll(/==([\s\S]+?)==/g)) {
    highlightedWords += m[1].trim().split(/\s+/).length;
  }
  const total = text.split(/\s+/).length;
  assert.ok(highlightedWords / total <= HIGHLIGHT_CAPS.heavy + 0.001,
    `${highlightedWords}/${total} > heavy cap ${HIGHLIGHT_CAPS.heavy}`);
});

test('cardReconstructor: bolds outside underline are dropped', () => {
  const text = 'one two three four five.';
  const candidates = [{ index: 0, originalIndex: 0, text }];
  const picksJson = {
    tag: 't', cite: 'c',
    picks: [{ p: 0, u: [[0, 2]], h: [[0, 1]], b: [[3, 5]] }],   // bold outside u
  };
  const r = reconstructCard({ picksJson, candidates, density: 'heavy' });
  assert.equal(r.stats.dropped.bolds, 1);
  assert.ok(!/four \*\*five/.test(r.body_markdown));
});

test('cardReconstructor: paragraphs come out in original document order', () => {
  const candidates = [
    { index: 0, originalIndex: 5, text: 'fifth original.' },
    { index: 1, originalIndex: 2, text: 'second original.' },
    { index: 2, originalIndex: 9, text: 'ninth original.' },
  ];
  const picksJson = {
    tag: 't', cite: 'c',
    // Model returns picks in random order.
    picks: [
      { p: 2, u: [[0, 2]] },
      { p: 0, u: [[0, 2]] },
      { p: 1, u: [[0, 2]] },
    ],
  };
  const r = reconstructCard({ picksJson, candidates, density: 'heavy' });
  // Should appear in originalIndex order: 2 (cand 1), 5 (cand 0), 9 (cand 2).
  const order = r.body_markdown.indexOf('second') < r.body_markdown.indexOf('fifth') &&
                r.body_markdown.indexOf('fifth')  < r.body_markdown.indexOf('ninth');
  assert.ok(order, 'paragraphs should be sorted by source originalIndex');
});

// ── selection prompt ──────────────────────────────────────────────

test('selection prompt: indexParagraphWords prefixes every word with [n]', () => {
  const out = indexParagraphWords('The U.S. faces a crisis.');
  assert.equal(out, '[0]The [1]U.S. [2]faces [3]a [4]crisis.');
});

test('selection prompt: system prompt mentions structural guarantees and JSON schema', () => {
  const p = buildSelectionSystemPrompt({ density: 'heavy', length: 'long' });
  assert.match(p, /JSON/);
  assert.match(p, /picks/);
  assert.match(p, /verbatim|server pulls/i);   // tells model the server reconstructs
  assert.match(p, /word offsets|word ranges|whitespace[- ]tokenis/i);
});

test('selection prompt: user prompt embeds candidates with [P0], [P1] labels', () => {
  const candidates = [
    { index: 0, originalIndex: 0, text: 'First paragraph.' },
    { index: 1, originalIndex: 1, text: 'Second paragraph.' },
  ];
  const out = buildSelectionUserPrompt({
    argument: 'test', candidates, density: 'heavy', length: 'long',
  });
  assert.match(out, /\[P0\][\s\S]*\[0\]First/);
  assert.match(out, /\[P1\][\s\S]*\[0\]Second/);
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
