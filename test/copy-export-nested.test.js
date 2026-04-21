'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

// Load the client module via script-eval so we can exercise inlineStyleBody
// without a browser. We only need inlineStyleBody for this test.
// Re-implement the function under test via require of a thin wrapper below,
// or pull it in via a small dedicated module once extracted.

const { inlineStyleBody } = require('../public/lib/inlineStyleBody');

test('highlight inside underline keeps BOTH yellow background AND underline in inline style output', () => {
  const input = '<u>foo <mark>bar</mark> baz</u>';
  const out = inlineStyleBody(input);
  // The <mark> span must carry underline + yellow bg so Word/Gdocs render both.
  assert.match(out, /background-color:#ffff00[\s\S]*text-decoration:underline/);
});

test('bold inside underline keeps BOTH bold AND underline', () => {
  const input = '<u>lead <b>key</b> tail</u>';
  const out = inlineStyleBody(input);
  assert.match(out, /font-weight:700[\s\S]*text-decoration:underline/);
});

test('nested bold+highlight inside underline stacks all three', () => {
  const input = '<u>a **==loud==** b</u>';
  // markdownCardToHtml would produce <u>a <b><mark>loud</mark></b> b</u> typically,
  // but test the already-normalized HTML form:
  const html = '<u>a <b><mark>loud</mark></b> b</u>';
  const out = inlineStyleBody(html);
  assert.match(out, /background-color:#ffff00/);
  assert.match(out, /font-weight:700/);
  assert.match(out, /text-decoration:underline/);
});

test('plain underline stays underlined', () => {
  const out = inlineStyleBody('<u>hello</u>');
  assert.match(out, /text-decoration:underline/);
});

test('highlight outside underline has no underline', () => {
  const out = inlineStyleBody('before <mark>x</mark> after');
  assert.match(out, /background-color:#ffff00/);
  assert.doesNotMatch(out, /text-decoration:underline/);
});
