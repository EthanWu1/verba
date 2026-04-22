'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const clipboard = require('../public/lib/clipboard.js');

test('clipboard module exports required API', () => {
  assert.equal(typeof clipboard.buildCopyHtml, 'function');
  assert.equal(typeof clipboard.buildCopyPlain, 'function');
  assert.equal(typeof clipboard.extractAuthorYearPrefix, 'function');
  assert.equal(typeof clipboard.flattenInlineStyles, 'function');
  assert.equal(typeof clipboard.splitCite, 'function');
});

const { extractAuthorYearPrefix } = clipboard;

test('extract prefix: single surname with 2-digit year', () => {
  assert.equal(extractAuthorYearPrefix('Smith 24, Professor of Law'), 'Smith 24');
});

test('extract prefix: two-word surname', () => {
  assert.equal(extractAuthorYearPrefix('Van Dyke 24, Stanford'), 'Van Dyke 24');
});

test('extract prefix: two authors joined by "and"', () => {
  assert.equal(extractAuthorYearPrefix('Tuck and Yang 24, "Decolonization"'), 'Tuck and Yang 24');
});

test('extract prefix: two authors joined by "&"', () => {
  assert.equal(extractAuthorYearPrefix('Smith & Yang 24, journal'), 'Smith & Yang 24');
});

test('extract prefix: "et al."', () => {
  assert.equal(extractAuthorYearPrefix('Last et al. 24, study'), 'Last et al. 24');
});

test('extract prefix: two-word surname + conjunction + second author', () => {
  assert.equal(extractAuthorYearPrefix('Van Dyke and Smith 2024, report'), 'Van Dyke and Smith 2024');
});

test('extract prefix: 4-digit year', () => {
  assert.equal(extractAuthorYearPrefix('Smith 2024, report'), 'Smith 2024');
});

test('extract prefix: hyphenated surname', () => {
  assert.equal(extractAuthorYearPrefix("O'Brien-Jones 24, book"), "O'Brien-Jones 24");
});

test('extract prefix: returns null for lowercase start', () => {
  assert.equal(extractAuthorYearPrefix('smith 24, journal'), null);
});

test('extract prefix: returns null with no year', () => {
  assert.equal(extractAuthorYearPrefix('Smith, Professor of Law'), null);
});

test('extract prefix: returns null for conjunction-only start', () => {
  assert.equal(extractAuthorYearPrefix('and Yang 24'), null);
});

test('extract prefix: returns null for empty string', () => {
  assert.equal(extractAuthorYearPrefix(''), null);
  assert.equal(extractAuthorYearPrefix(null), null);
  assert.equal(extractAuthorYearPrefix(undefined), null);
});

const { splitCite } = clipboard;

test('splitCite: splits prefix and rest', () => {
  const r = splitCite('Smith 24, Professor of Law, 2024');
  assert.equal(r.prefix, 'Smith 24');
  assert.equal(r.rest, ', Professor of Law, 2024');
});

test('splitCite: multi-author prefix', () => {
  const r = splitCite('Van Dyke and Smith 2024, report');
  assert.equal(r.prefix, 'Van Dyke and Smith 2024');
  assert.equal(r.rest, ', report');
});

test('splitCite: no prefix match returns full string as rest', () => {
  const r = splitCite('not a valid cite');
  assert.equal(r.prefix, '');
  assert.equal(r.rest, 'not a valid cite');
});

test('splitCite: empty / null input', () => {
  assert.deepEqual(splitCite(''), { prefix: '', rest: '' });
  assert.deepEqual(splitCite(null), { prefix: '', rest: '' });
});
