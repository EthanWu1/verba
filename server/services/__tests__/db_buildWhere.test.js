'use strict';

// Verifies _buildWhere defaults to canonical-only and honors the new
// 'all' / 'false' overrides. Avoids opening the real DB by re-extracting
// the function source — the helper is pure WRT its input.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.resolve(__dirname, '..', 'db.js'), 'utf8');
const fnSrc = src.match(/function _buildWhere[\s\S]*?\n\}/)[0];
// eslint-disable-next-line no-new-func
const buildWhere = new Function(`${fnSrc}; return _buildWhere;`)();

test('default (no canonical filter) → canonical=1', () => {
  const { sql } = buildWhere({});
  assert.match(sql, /isCanonical = 1/);
});

test('canonical="all" → no canonical clause', () => {
  const { sql } = buildWhere({ canonical: 'all' });
  assert.doesNotMatch(sql, /isCanonical/);
});

test('canonical="false" → only non-canonical', () => {
  const { sql } = buildWhere({ canonical: 'false' });
  assert.match(sql, /isCanonical = 0/);
  assert.doesNotMatch(sql, /isCanonical = 1/);
});

test('canonical="true" still works (explicit canonical-only)', () => {
  const { sql } = buildWhere({ canonical: 'true' });
  assert.match(sql, /isCanonical = 1/);
});

test('default also enforces hasHighlight=1 + non-empty typeLabel', () => {
  const { sql } = buildWhere({});
  assert.match(sql, /hasHighlight = 1/);
  assert.match(sql, /typeLabel IS NOT NULL/);
});

test('includeUnclassified=true drops the typeLabel guard', () => {
  const { sql } = buildWhere({ includeUnclassified: 'true' });
  assert.doesNotMatch(sql, /typeLabel IS NOT NULL/);
});

test('table prefix is honored on isCanonical', () => {
  const { sql } = buildWhere({}, { tablePrefix: 'c' });
  assert.match(sql, /c\.isCanonical = 1/);
});
