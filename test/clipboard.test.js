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

const { flattenInlineStyles } = clipboard;

test('flatten: wraps <u> text in tag with inline underline style', () => {
  const out = flattenInlineStyles('<u>under</u>');
  assert.match(out, /<u style="text-decoration:underline">under<\/u>/);
});

test('flatten: wraps <b> in tag with inline bold style', () => {
  const out = flattenInlineStyles('<b>bold</b>');
  assert.match(out, /<b style="font-weight:700">bold<\/b>/);
});

test('flatten: wraps <mark> in tag with inline yellow background', () => {
  const out = flattenInlineStyles('<mark>hi</mark>');
  assert.match(out, /<mark style="[^"]*background-color:#ffff00[^"]*">hi<\/mark>/);
});

test('flatten: nested <b><u>x</u></b> emits nested u>b tags', () => {
  const out = flattenInlineStyles('<b><u>x</u></b>');
  assert.match(out, /<u[^>]*><b[^>]*>x<\/b><\/u>/);
});

test('flatten: nested <u><b><mark>x</mark></b></u> emits all three tags', () => {
  const out = flattenInlineStyles('<u><b><mark>x</mark></b></u>');
  assert.match(out, /<u[^>]*><b[^>]*><mark[^>]*>x<\/mark><\/b><\/u>/);
});

test('flatten: preserves non-format tags like <p>', () => {
  const out = flattenInlineStyles('<p><u>hi</u></p>');
  assert.match(out, /<p>/);
  assert.match(out, /<\/p>/);
  assert.match(out, /text-decoration:underline/);
});

test('flatten: plain text with no formatting passes through', () => {
  assert.equal(flattenInlineStyles('just text'), 'just text');
});

const { buildCopyHtml } = clipboard;

test('buildCopyHtml: cite wraps in Calibri 11pt paragraph', () => {
  const html = buildCopyHtml({ cite: 'Smith 24', body_html: '<p>x</p>' });
  assert.match(html, /font-family:\s*Calibri/i);
  assert.match(html, /font-size:\s*11pt/);
  assert.match(html, /Smith 24/);
});

test('buildCopyHtml: author-year prefix is 13pt bold', () => {
  const html = buildCopyHtml({
    cite: 'Smith 24, professor of law',
    body_html: '<p>x</p>'
  });
  assert.match(html, /font-size:\s*13pt[^"']*font-weight:\s*700[^"']*"[^>]*>\s*Smith 24/i);
});

test('buildCopyHtml: tag rendered bold 13pt above cite', () => {
  const html = buildCopyHtml({
    tag: 'Deterrence fails',
    cite: 'Doe 25',
    body_html: '<p>x</p>'
  });
  assert.match(html, /font-size:\s*13pt[^"']*font-weight:\s*700[^"']*">Deterrence fails/);
});

test('buildCopyHtml: body underline survives via flatten', () => {
  const html = buildCopyHtml({
    cite: 'Doe 25',
    body_html: '<p><u>under</u></p>'
  });
  assert.match(html, /text-decoration:underline/);
});

test('buildCopyHtml: body highlight survives', () => {
  const html = buildCopyHtml({
    cite: 'Doe 25',
    body_html: '<p><mark>key</mark></p>'
  });
  assert.match(html, /background-color:#ffff00/);
});

test('buildCopyHtml: nested b+u emits nested tags in body', () => {
  const html = buildCopyHtml({
    cite: 'Doe 25',
    body_html: '<p><b><u>x</u></b></p>'
  });
  assert.match(html, /<u[^>]*><b[^>]*>x<\/b><\/u>/);
});

test('buildCopyHtml: escapes HTML-dangerous chars in cite and tag', () => {
  const html = buildCopyHtml({
    tag: 'A & B < C',
    cite: 'Smith 24 "quote"',
    body_html: '<p>x</p>'
  });
  // Tag is a single escaped run, so the contiguous match is fine:
  assert.match(html, /A &amp; B &lt; C/);
  // Cite is split into prefix + rest spans. Verify both pieces are present AND escaped.
  assert.match(html, /Smith 24/);
  assert.match(html, /&quot;quote&quot;/);
  // And verify no unescaped double-quote leaked into text content (only in style="" attrs).
  assert.doesNotMatch(html, />[^<]*"quote"[^<]*</);
});

test('buildCopyHtml: empty card produces empty-safe output', () => {
  const html = buildCopyHtml({});
  assert.equal(typeof html, 'string');
});

const { buildCopyPlain } = clipboard;

test('buildCopyPlain: joins tag, cite, body with newlines', () => {
  const out = buildCopyPlain({
    tag: 'Tag here',
    cite: 'Smith 24',
    body_plain: 'Body text.'
  });
  assert.equal(out, 'Tag here\nSmith 24\n\nBody text.');
});

test('buildCopyPlain: falls back to body_markdown', () => {
  const out = buildCopyPlain({ tag: 'T', cite: 'S 24', body_markdown: 'md' });
  assert.equal(out, 'T\nS 24\n\nmd');
});

test('buildCopyPlain: empty card safe', () => {
  assert.equal(buildCopyPlain({}), '\n\n\n');
});

const { serializeSelectionHtmlFromString } = clipboard;

test('serializeFromString: card-body context flattens nested formatting', () => {
  const { html } = serializeSelectionHtmlFromString('<b><u>x</u></b>', 'card-body');
  assert.match(html, /font-weight:700/);
  assert.match(html, /text-decoration:underline/);
});

test('serializeFromString: cite context splits prefix', () => {
  const { html } = serializeSelectionHtmlFromString('Smith 24, Prof', 'cite');
  assert.match(html, /font-size:\s*13pt[^"']*font-weight:\s*700[^"']*">Smith 24/);
  assert.match(html, /font-size:\s*11pt[^"']*">, Prof/);
});

test('serializeFromString: strips class and data attributes', () => {
  const { html } = serializeSelectionHtmlFromString(
    '<span class="foo" data-x="y">hi</span>',
    'card-body'
  );
  assert.doesNotMatch(html, /class=/);
  assert.doesNotMatch(html, /data-/);
});

test('serializeFromString: strips inline event handlers', () => {
  const { html } = serializeSelectionHtmlFromString(
    '<p onclick="alert(1)">x</p>',
    'card-body'
  );
  assert.doesNotMatch(html, /onclick/i);
});

test('serializeFromString: plain text fallback for non-cite context', () => {
  const { plain } = serializeSelectionHtmlFromString('<p>hello <b>world</b></p>', 'card-body');
  assert.match(plain, /hello world/);
});

// Gap tests ported from legacy suites

test('buildCopyHtml: body_plain fallback renders in output', () => {
  const html = buildCopyHtml({ cite: 'X 24', body_plain: 'hello world' });
  assert.match(html, /hello world/);
});

test('flatten: highlight outside underline has no underline style', () => {
  const out = flattenInlineStyles('before <mark>x</mark> after');
  assert.match(out, /background-color:#ffff00/);
  assert.doesNotMatch(out, /text-decoration:underline/);
});

test('serializeFromString: neutralizes javascript: href', () => {
  const { html } = serializeSelectionHtmlFromString(
    '<a href="javascript:alert(1)">click</a>',
    'card-body'
  );
  assert.doesNotMatch(html, /javascript:/i);
  assert.match(html, /href=/i);
});

test('serializeFromString: neutralizes data: href', () => {
  const { html } = serializeSelectionHtmlFromString(
    '<a href="data:text/html,<script>alert(1)</script>">x</a>',
    'card-body'
  );
  assert.doesNotMatch(html, /data:text\/html/i);
});

test('serializeFromString: preserves safe http/https href', () => {
  const { html } = serializeSelectionHtmlFromString(
    '<a href="https://example.com">x</a>',
    'card-body'
  );
  assert.match(html, /href="https:\/\/example\.com"/);
});

test('extract prefix: straight apostrophe year', () => {
  assert.equal(extractAuthorYearPrefix("Miller '21, Professor"), "Miller '21");
});

test('extract prefix: curly apostrophe year', () => {
  assert.equal(extractAuthorYearPrefix("Miller ’21, Professor"), "Miller ’21");
});

test('extract prefix: curly apostrophe in surname', () => {
  assert.equal(extractAuthorYearPrefix("O’Brien 24, book"), "O’Brien 24");
});

test('extract prefix: apostrophe-year with multi-author', () => {
  assert.equal(extractAuthorYearPrefix("Tuck and Yang '24, paper"), "Tuck and Yang '24");
});
