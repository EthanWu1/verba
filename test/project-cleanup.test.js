const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('runtime helpers live under server/services and the legacy helper directory is gone', () => {
  const root = path.resolve(__dirname, '..');
  const servicesDir = path.join(root, 'server', 'services');
  const legacySkillsDir = path.join(root, 'server', 'skills');

  assert.equal(fs.existsSync(servicesDir), true);
  assert.equal(fs.existsSync(legacySkillsDir), false);
});

test('instant research helpers still load from server/services', () => {
  const {
    createKeywordMatcher,
    scoreTextForQuery,
    pickBestExcerpt,
  } = require('../server/services/instantResearch');

  const matcher = createKeywordMatcher('framework fairness');
  assert.equal(matcher('Procedural fairness determines framework offense.'), true);
  assert.equal(scoreTextForQuery('framework fairness', 'Framework only.') > 0, true);
  assert.match(
    pickBestExcerpt(
      'framework fairness',
      [
        'Climate passage.',
        'Procedural fairness matters because framework controls which offense counts.',
      ].join('\n\n')
    ),
    /framework controls/i
  );
});
