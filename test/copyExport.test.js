'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildCopyHtml } = require('../public/lib/copyExport.js');

test('cite wraps in Calibri 11pt paragraph', () => {
  const html = buildCopyHtml({ cite: 'Smith 24', body_html: '<p>x</p>' });
  assert.match(html, /font-family:\s*Calibri/i);
  assert.match(html, /font-size:\s*11pt/);
  assert.match(html, /Smith 24/);
});

test('Author-Last-YY prefix is bold Calibri 13pt', () => {
  const html = buildCopyHtml({
    cite: 'Smith 24, professor of law, "Title," Journal, 1-2-24',
    body_html: '<p>x</p>'
  });
  assert.match(html, /<(b|strong)[^>]*font-size:\s*13pt[^>]*>\s*Smith 24/i);
});

test('preserves highlight mark tags in body', () => {
  const html = buildCopyHtml({
    cite: 'Doe 25',
    body_html: '<p>fact <mark>key phrase</mark> ends.</p>'
  });
  assert.match(html, /<mark[^>]*>key phrase<\/mark>/);
});

test('preserves underline and bold formatting', () => {
  const html = buildCopyHtml({
    cite: 'Doe 25',
    body_html: '<p><u>under</u> <b>bold</b></p>'
  });
  assert.match(html, /<u[^>]*>under<\/u>/);
  assert.match(html, /<b[^>]*>bold<\/b>/);
});

test('tag rendered bold above cite', () => {
  const html = buildCopyHtml({
    tag: 'Deterrence fails',
    cite: 'Smith 24',
    body_html: '<p>body</p>'
  });
  const tagIdx = html.indexOf('Deterrence fails');
  const citeIdx = html.indexOf('Smith 24');
  assert.ok(tagIdx >= 0 && citeIdx >= 0 && tagIdx < citeIdx);
});

test('highlights carry yellow background inline style', () => {
  const html = buildCopyHtml({
    cite: 'Doe 25',
    body_html: '<mark class="hl">x</mark>'
  });
  assert.match(html, /background[^;"]*(yellow|#FFEB3B|#ffeb3b|#FFFF00)/i);
});

test('missing cite does not crash', () => {
  const html = buildCopyHtml({ body_html: '<p>x</p>' });
  assert.ok(typeof html === 'string' && html.length > 0);
});

test('body_plain fallback wraps in paragraph', () => {
  const html = buildCopyHtml({ cite: 'X 24', body_plain: 'hello world' });
  assert.match(html, /hello world/);
});
