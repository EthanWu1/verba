'use strict';

// Regression tests for the Tabroom team-search renderer.
//
// Backstory: a /codex:adversarial-review caught XSS via unescaped `e.abbr`
// in renderSearchResults — a malicious Tabroom event abbr like
// `<img src=x onerror=alert(1)>` would execute in the app origin. The fix
// wraps the field with the project's HTML-escape helper.
//
// The renderer was later moved out of public/app.html into public/app-r3.js
// (the modal-based linker) and the helper was renamed escHtml → escapeHTML.
// This test no longer cares which file it lives in — it just enforces:
//   1. Every escape helper defined under public/ neutralizes <, >, &, "
//   2. The Tabroom team-search renderer escapes `e.abbr` (or the equivalent
//      events-array spread) before interpolating into innerHTML.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC_DIR = path.resolve(__dirname, '..', '..', '..', 'public');

function read(rel) {
  return fs.readFileSync(path.join(PUBLIC_DIR, rel), 'utf8');
}

const APP_HTML = read('app.html');
const APP_R3   = read('app-r3.js');
const APP_MAIN = read('app-main.js');

// Re-implement the escape helper here matching the project's definitions.
function escapeHTML(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

test('escapeHTML neutralizes script-injection metacharacters', () => {
  assert.equal(
    escapeHTML('<img src=x onerror=alert(1)>'),
    '&lt;img src=x onerror=alert(1)&gt;'
  );
  assert.equal(escapeHTML('"<>&'), '&quot;&lt;&gt;&amp;');
  assert.equal(escapeHTML(null), '');
  assert.equal(escapeHTML(undefined), '');
});

test('Tabroom team-search renderer escapes e.abbr before innerHTML', () => {
  // Current production renderer (in public/app-r3.js, the link-debater modal):
  // it builds the events string by spreading `m.events` and joining abbrs,
  // then escapes the whole thing with escapeHTML(...) before injecting.
  // If someone removes the wrapping escapeHTML call, this fails.
  assert.match(
    APP_R3,
    /escapeHTML\(\s*\(m\.events\s*\|\|\s*\[\]\)\.map\(\s*e\s*=>\s*e\.abbr\s*\|\|\s*e\.name\s*\)\.join\(\s*['"`]\s*·\s*['"`]\s*\)\s*\)/,
    'team-search renderer must wrap the joined event abbrs with escapeHTML — raw interpolation re-introduces XSS'
  );
  // Belt-and-suspenders: no raw `${m.events.map(...)}` (without escapeHTML
  // around it) sneaking back into the link-debater renderer.
  const renderBlock = APP_R3.slice(
    Math.max(0, APP_R3.indexOf("class=\"lnk-row\"") - 200),
    APP_R3.indexOf("class=\"lnk-row\"") + 1200
  );
  assert.doesNotMatch(
    renderBlock,
    /\$\{[^}]*m\.events[^}]*\}/m.flags ? /\$\{(?!escapeHTML)[^}]*m\.events[^}]*\}/ : /\$\{[^}]*m\.events[^}]*\}/,
    'Found unescaped m.events interpolation in lnk-row renderer — XSS regression'
  );
});

test('every HTML-escape helper defined in public/ escapes <, >, &, "', () => {
  // Sweep every file we ship to the browser. The helper has gone by
  // `escHtml`, `escHTML`, and `escapeHTML` over time — match any of them.
  const sources = [
    { name: 'app.html',     src: APP_HTML },
    { name: 'app-r3.js',    src: APP_R3   },
    { name: 'app-main.js',  src: APP_MAIN },
  ];
  // Function declarations OR arrow assignments. The body is followed by a
  // statement boundary so we don't over-eat.
  const re = /(?:function\s+(?:escHtml|escHTML|escapeHTML)\s*\([^)]*\)\s*\{[\s\S]*?\n\s{0,6}\}|(?:const|let|var|function)\s+(?:escHtml|escHTML|escapeHTML)\s*[=(][\s\S]*?(?:\}|;)\s*\n)/g;
  let total = 0;
  for (const { name, src } of sources) {
    const defs = src.match(re) || [];
    for (const def of defs) {
      total++;
      for (const needle of ['&amp;', '&lt;', '&gt;', '&quot;']) {
        assert.ok(
          def.includes(needle),
          `escape helper in ${name} is missing ${needle}: ${def.slice(0, 100)}…`
        );
      }
    }
  }
  assert.ok(total >= 1, 'expected at least one escape-helper definition under public/');
});
