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
