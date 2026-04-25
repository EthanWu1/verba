'use strict';

// Regression tests for the Tabroom search-results renderer in public/app.html.
//
// Backstory: a /codex:adversarial-review caught XSS via unescaped `e.abbr`
// in renderSearchResults — a malicious Tabroom event abbr like
// `<img src=x onerror=alert(1)>` would execute in the app origin (commit
// 9adafe7 fixed it). These tests guard the fix.
//
// We can't easily import the IIFE-wrapped renderer, and the project has no
// jsdom dep. Instead we lint the source: the renderer must call escHtml on
// every server-provided field it interpolates, and escHtml itself must
// neutralize HTML metacharacters.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP_HTML = fs.readFileSync(
  path.resolve(__dirname, '..', '..', '..', 'public', 'app.html'),
  'utf8'
);

// Re-implement escHtml here matching public/app.html's definition.
// If app.html's escHtml ever diverges from this, the source-snapshot test
// below will catch it.
function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

test('escHtml neutralizes script-injection metacharacters', () => {
  assert.equal(
    escHtml('<img src=x onerror=alert(1)>'),
    '&lt;img src=x onerror=alert(1)&gt;'
  );
  assert.equal(escHtml('"<>&'), '&quot;&lt;&gt;&amp;');
  assert.equal(escHtml(null), '');
  assert.equal(escHtml(undefined), '');
});

test('Tabroom event abbr is wrapped in escHtml in renderSearchResults', () => {
  // The exact production line. If someone reverts the fix, this fails.
  assert.match(
    APP_HTML,
    /\(m\.events \|\| \[\]\)\.map\(function \(e\) \{ return escHtml\(e && e\.abbr \|\| ''\); \}\)/,
    'renderSearchResults must escape e.abbr; raw `return e.abbr` re-introduces XSS'
  );

  // Belt-and-suspenders: there must be no surviving raw `return e.abbr`
  // in the renderer block (lines 3400–3425 area).
  const block = APP_HTML.slice(
    APP_HTML.indexOf('function renderSearchResults'),
    APP_HTML.indexOf('function renderSearchResults') + 1500
  );
  assert.doesNotMatch(
    block,
    /return e\.abbr\s*[;}]/,
    'Found unescaped `return e.abbr` in renderSearchResults — XSS regression'
  );
});

test('every escHtml definition in app.html escapes <, >, &, "', () => {
  // Function declarations hoist within their IIFE, so escHtml can sit before
  // OR after the call site — sweep all definitions instead of guessing order.
  const re = /function\s+escHtml\s*\([^)]*\)\s*\{[\s\S]*?\n\s{0,4}\}/g;
  const defs = APP_HTML.match(re) || [];
  assert.ok(defs.length >= 1, 'expected at least one escHtml definition in app.html');
  for (const def of defs) {
    for (const needle of ['&amp;', '&lt;', '&gt;', '&quot;']) {
      assert.ok(
        def.includes(needle),
        `an escHtml definition is missing ${needle} replacement: ${def.slice(0, 80)}…`
      );
    }
  }
});
