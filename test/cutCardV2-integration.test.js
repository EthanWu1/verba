'use strict';

/**
 * Integration test for cutCardV2 with a mocked LLM. Verifies the full
 * pipeline (BM25 → selection prompt → reconstructor → final card) and
 * the structural verbatim guarantee.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const llm = require('../server/services/llm');
const { cutCardV2, clearCache } = require('../server/services/cutCardV2');

const realCompleteJSON = llm.completeJSON;

function withMock(mockResponse, fn) {
  let callCount = 0;
  llm.completeJSON = async () => {
    callCount++;
    return {
      json: typeof mockResponse === 'function' ? mockResponse() : mockResponse,
      model: 'mock-model',
      usage: { prompt_tokens: 100, completion_tokens: 50 },
      stats: {},
      fallback: false,
    };
  };
  return fn().finally(() => { llm.completeJSON = realCompleteJSON; })
    .then(r => ({ result: r, callCount }));
}

// ── tests ─────────────────────────────────────────────────────────

test('cutCardV2: full pipeline produces a 100% verbatim card', async () => {
  clearCache();
  const sourceText = [
    'Abstract: This examines deterrence.',
    'The report concludes that despite decades of arms control, the risk of an accidental nuclear exchange between major powers remains substantial and is growing each year because of shrinking decision windows.',
    'The weather forecast calls for sunny skies and a high of seventy-two degrees.',
    'Hypersonic weapons compress the window between launch detection and strike from thirty minutes to under five minutes.',
    'Restaurant reviews from the Times rated the new bistro three stars.',
    'Analysts warn this trajectory locks in catastrophic instability and eliminates any remaining window for restraint.',
  ].join('\n\n');

  const mockPicks = {
    tag: 'Hypersonic threats collapse stability — extinction.',
    cite: 'Acton 24 [James Acton; ...]',
    picks: [
      // Char offsets — generous spans; reconstructor clamps to paragraph bounds
      { p: 0, u: [[0, 9999]], h: [[0, 30], [50, 80]], b: [[50, 80]] },
      { p: 1, u: [[0, 9999]], h: [[0, 30]], b: [[0, 30]] },
      { p: 2, u: [[0, 9999]], h: [[0, 30], [50, 80]], b: [[50, 80]] },
    ],
    loudest: { p: 0, from: 50, to: 80 },
  };

  const { result } = await withMock(mockPicks, () =>
    cutCardV2({
      argument: 'U.S. nuclear deterrence collapses, hypersonic, China',
      bodyText: sourceText,
      meta: { title: 'Hypersonic & Stability', author: 'Acton', date: '2024-03-12' },
      cite: 'Acton 24 [James Acton; Senior Fellow; ...]',
      density: 'heavy',
      length: 'long',
    })
  );

  assert.ok(result.card.body_markdown.length > 0, 'card body must not be empty');
  assert.ok(result.card.tag.length > 0);
  assert.ok(result.card.cite.length > 0);

  // STRUCTURAL VERBATIM: every output paragraph (after stripping marks) must
  // equal a verbatim source paragraph. This is the strongest guarantee.
  const sourceParas = sourceText.split(/\n\s*\n+/).map(p => p.trim());
  const cardParas = result.card.body_markdown.split(/\n\s*\n+/).map(p => p.trim());
  assert.ok(cardParas.length > 0, 'should produce at least one paragraph');

  for (const cp of cardParas) {
    const stripped = cp
      .replace(/\*\*<u>([\s\S]*?)<\/u>\*\*/g, '$1')
      .replace(/<\/?u>/g, '')
      .replace(/==/g, '')
      .replace(/\*\*/g, '');
    const isVerbatim = sourceParas.some(sp => sp === stripped);
    assert.ok(isVerbatim, `Output paragraph not verbatim:\n  output: "${stripped.slice(0, 200)}"\n  No matching source paragraph.`);
  }
});

test('cutCardV2: cache hit returns the same card without re-calling the LLM', async () => {
  clearCache();
  let callCount = 0;
  llm.completeJSON = async () => {
    callCount++;
    return {
      json: {
        tag: 'cached',
        cite: 'Author 24 [...]',
        picks: [{ p: 0, u: [[0, 5]], h: [[0, 2]] }],
      },
      model: 'mock', usage: {}, stats: {}, fallback: false,
    };
  };
  try {
    const args = {
      argument: 'specific argument',
      bodyText: 'Paragraph one verbatim text here for caching purposes.\n\nParagraph two also here in this article.',
      density: 'heavy', length: 'long',
    };
    const r1 = await cutCardV2(args);
    const r2 = await cutCardV2(args);
    assert.equal(callCount, 1, 'second identical call must hit the cache');
    assert.equal(r2.cached, true);
    assert.equal(r1.card.body_markdown, r2.card.body_markdown);
  } finally {
    llm.completeJSON = realCompleteJSON;
  }
});

test('cutCardV2: rejects bodyText shorter than 50 chars', async () => {
  await assert.rejects(
    () => cutCardV2({ argument: '', bodyText: 'too short' }),
    /at least 50/i,
  );
});

test('cutCardV2: invalid picks → graceful fallback (still returns a card)', async () => {
  clearCache();
  llm.completeJSON = async () => ({
    json: {
      tag: 'fallback',
      cite: 'Author [...]',
      picks: [{ p: 999, u: [[0, 1]] }, { p: 500, u: [[0, 1]] }],
    },
    model: 'mock', usage: {}, stats: {}, fallback: false,
  });
  try {
    const result = await cutCardV2({
      argument: 'anything',
      bodyText: 'First paragraph here with sufficient content for the validator.\n\nSecond paragraph also has enough content.',
    });
    assert.ok(result.card.body_markdown.length > 0, 'must produce a card even with no valid picks');
    assert.equal(result.reconstruct.fallback, true);
    assert.equal(result.card.body_markdown.includes('First paragraph here'), true);
  } finally {
    llm.completeJSON = realCompleteJSON;
  }
});

test('cutCardV2: server-supplied cite wins over the LLM cite', async () => {
  clearCache();
  llm.completeJSON = async () => ({
    json: {
      tag: 'cite test',
      cite: 'Wrong 99 [bad]',
      picks: [{ p: 0, u: [[0, 3]] }],
    },
    model: 'mock', usage: {}, stats: {}, fallback: false,
  });
  try {
    const result = await cutCardV2({
      argument: 'test',
      bodyText: 'Paragraph one has enough content here for the validator to accept.\n\nParagraph two contains additional content.',
      cite: 'Acton 24 [James Acton; "Title"; Source; 2024]',
    });
    assert.equal(result.card.cite, 'Acton 24 [James Acton; "Title"; Source; 2024]');
  } finally {
    llm.completeJSON = realCompleteJSON;
  }
});
