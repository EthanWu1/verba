const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createKeywordMatcher,
  scoreTextForQuery,
  pickBestExcerpt,
} = require('../server/services/instantResearch');

test('createKeywordMatcher matches independent keywords across text fields', () => {
  const matcher = createKeywordMatcher('framework fairness');

  assert.equal(matcher('Procedural fairness comes first'), true);
  assert.equal(matcher('Framework offense controls impact comparison'), true);
  assert.equal(matcher('Topicality shell about limits'), false);
});

test('scoreTextForQuery rewards denser keyword overlap', () => {
  const light = scoreTextForQuery(
    'framework fairness',
    'Framework matters in debate.'
  );
  const strong = scoreTextForQuery(
    'framework fairness',
    'Framework fairness should come first because procedural fairness structures impact comparison.'
  );

  assert.equal(strong > light, true);
});

test('pickBestExcerpt prefers the strongest matching passage', () => {
  const excerpt = pickBestExcerpt(
    'framework fairness',
    [
      'This section is about warming and sea levels.',
      'Procedural fairness is an internal link because framework determines which impacts count and how debaters compare offense.',
      'A short sentence about debate.'
    ].join('\n\n')
  );

  assert.match(excerpt, /procedural fairness/i);
  assert.match(excerpt, /framework determines/i);
});
