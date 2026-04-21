'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { filterEvidenceClient } = require('../public/app-main.search.js');

test('filterEvidenceClient matches tag substring case-insensitive', () => {
  const cards = [
    { id: '1', tag: 'Nuclear deterrence fails', body_plain: '', cite: 'Smith 22' },
    { id: '2', tag: 'Econ DA turns',           body_plain: 'growth collapses', cite: 'Lee 21' },
  ];
  const out = filterEvidenceClient(cards, 'NUKE');
  assert.equal(out.length, 0, 'NUKE should not match Nuclear');
  const out2 = filterEvidenceClient(cards, 'nuclear');
  assert.equal(out2.length, 1);
  assert.equal(out2[0].id, '1');
});

test('filterEvidenceClient matches body text', () => {
  const cards = [{ id: '1', tag: 't', body_plain: 'collapse warrants', cite: '' }];
  assert.equal(filterEvidenceClient(cards, 'warrant').length, 1);
});

test('filterEvidenceClient matches cite', () => {
  const cards = [{ id: '1', tag: 't', body_plain: '', cite: 'Korsgaard 96' }];
  assert.equal(filterEvidenceClient(cards, 'kors').length, 1);
});

test('filterEvidenceClient returns full list on empty query', () => {
  const cards = [{ id: '1' }, { id: '2' }];
  assert.equal(filterEvidenceClient(cards, '').length, 2);
  assert.equal(filterEvidenceClient(cards, '   ').length, 2);
});

test('filterEvidenceClient case-insensitive', () => {
  const cards = [{ id: '1', tag: 'Moral Skepticism', body_plain: '', cite: '' }];
  assert.equal(filterEvidenceClient(cards, 'SKEPTIC').length, 1);
});
