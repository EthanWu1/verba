'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const clip = require('../public/lib/clipboard.js');

test('H1 paragraph preserved with full text', () => {
  const html = clip.serializeSelectionHtmlFromString('<h1>Pocket</h1><p>body</p>', { entire: true });
  assert.match(html, /Pocket/);
  assert.match(html, /<h1/i);
});

test('H2 / H3 / H4 preserved', () => {
  const html = clip.serializeSelectionHtmlFromString('<h2>Hat</h2><h3>Block</h3><h4>Tag</h4>', { entire: true });
  assert.match(html, /<h2/i);
  assert.match(html, /<h3/i);
  assert.match(html, /<h4/i);
});

test('card-embed expands to inner HTML in copy output', () => {
  const html = clip.serializeSelectionHtmlFromString('<div class="files-card-embed"><h4>Tag</h4><p>cite</p><p>body</p></div>', { entire: true });
  assert.match(html, /Tag/);
  assert.match(html, /cite/);
  assert.match(html, /body/);
  // Inner h4 should survive
  assert.match(html, /<h4/i);
});

test('highlight span preserved', () => {
  const html = clip.serializeSelectionHtmlFromString('<p><span style="background-color:#00ffff">hi</span></p>', { entire: true });
  assert.match(html, /background-color:\s*#00ffff/i);
});
