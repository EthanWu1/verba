# Copy/Paste + Citation Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the in-app citation display to the typographic spec (13pt bold black prefix, 11pt regular black rest, Calibri stack) and unify copy-button + native Ctrl+C through one clipboard serializer so underline + highlight + bold survive paste into Microsoft Word reliably.

**Architecture:** Consolidate `public/lib/copyExport.js` and `public/lib/inlineStyleBody.js` into a single UMD module `public/lib/clipboard.js` exposing `buildCopyHtml(card)`, `buildCopyPlain(card)`, `extractAuthorYearPrefix(cite)`, and `serializeSelectionHtml(range)`. The card-centric builders stay for the copy button. A scoped `copy` event listener on the document uses `serializeSelectionHtml` to route native selections through the same style-flattening pipeline. CSS in `public/app.html` is updated so the in-app `.cite-block` preview matches the clipboard output exactly.

**Tech Stack:** Vanilla JS (UMD), Node 18+ built-in test runner (`node --test`), no DOM mocking library required — string-based helpers are unit tested directly; Range-based entry point is validated via manual QA.

**Reference spec:** `docs/superpowers/specs/2026-04-21-copy-paste-cite-fix-design.md`

---

## File Structure

- **Create:** `public/lib/clipboard.js` — consolidated UMD module (regex, flatten, cite split, buildCopyHtml/Plain, serializeSelectionHtml).
- **Create:** `test/clipboard.test.js` — node-test unit suite.
- **Create:** `public/lib/clipboard.qa.md` — manual QA checklist.
- **Modify:** `public/app.html` — CSS update for `.cite-block .meta` + `.meta b`; load `lib/clipboard.js` in place of the two old scripts.
- **Modify:** `public/app-main.js` — replace the copy-button handler body; add native `copy` event listener; add underline normalization on editor input.
- **Delete:** `public/lib/copyExport.js`
- **Delete:** `public/lib/inlineStyleBody.js`
- **Delete:** `test/copyExport.test.js` (replaced by new suite with compatible assertions)
- **Delete:** `test/copy-export-nested.test.js` (content merged into new suite)

---

## Task 1: Scaffold clipboard.js module + test harness

**Files:**
- Create: `public/lib/clipboard.js`
- Create: `test/clipboard.test.js`

- [ ] **Step 1: Write the failing test for module loading**

```js
// test/clipboard.test.js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/clipboard.test.js`
Expected: FAIL with `Cannot find module '../public/lib/clipboard.js'`.

- [ ] **Step 3: Create the UMD skeleton**

```js
// public/lib/clipboard.js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VerbaClipboard = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  function extractAuthorYearPrefix() { return null; }
  function splitCite() { return { prefix: '', rest: '' }; }
  function flattenInlineStyles(html) { return String(html || ''); }
  function buildCopyHtml() { return ''; }
  function buildCopyPlain() { return ''; }
  function serializeSelectionHtml() { return { html: '', plain: '' }; }

  return {
    extractAuthorYearPrefix,
    splitCite,
    flattenInlineStyles,
    buildCopyHtml,
    buildCopyPlain,
    serializeSelectionHtml,
  };
}));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/clipboard.test.js`
Expected: PASS (1/1 test).

- [ ] **Step 5: Commit**

```bash
git add public/lib/clipboard.js test/clipboard.test.js
git commit -m "feat(clipboard): scaffold unified clipboard module"
```

---

## Task 2: Cite prefix regex — positive matches

**Files:**
- Modify: `public/lib/clipboard.js`
- Modify: `test/clipboard.test.js`

- [ ] **Step 1: Write the failing positive-match tests**

Append to `test/clipboard.test.js`:

```js
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
```

- [ ] **Step 2: Run to verify all fail**

Run: `node --test test/clipboard.test.js`
Expected: 8 new tests FAIL (stub returns `null`).

- [ ] **Step 3: Implement the regex**

In `public/lib/clipboard.js`, replace the stub:

```js
function extractAuthorYearPrefix(cite) {
  if (!cite) return null;
  const m = String(cite).match(
    /^((?:[A-Z][A-Za-z'\-]+|and|&|et\s+al\.?)(?:\s+(?:[A-Z][A-Za-z'\-]+|and|&|et\s+al\.?))*\s+\d{2,4})/
  );
  return m ? m[1] : null;
}
```

- [ ] **Step 4: Run to verify all pass**

Run: `node --test test/clipboard.test.js`
Expected: PASS (9/9).

- [ ] **Step 5: Commit**

```bash
git add public/lib/clipboard.js test/clipboard.test.js
git commit -m "feat(clipboard): author-year prefix regex with multi-author + et al."
```

---

## Task 3: Cite prefix regex — negative cases

**Files:**
- Modify: `test/clipboard.test.js`

- [ ] **Step 1: Add negative tests**

```js
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
```

Note: the conjunction-only case relies on the first alternative of the regex requiring a capitalized name. Because the first character class `[A-Z]` would not match `a` in `and`, this currently passes — the regex's first atom will attempt `and` via the alternation. If this test FAILS after the regex as written, anchor the first atom to require a capitalized surname only.

- [ ] **Step 2: Run tests**

Run: `node --test test/clipboard.test.js`
Expected: if "conjunction-only start" FAILS, proceed to Step 3. If all PASS, skip to Step 4.

- [ ] **Step 3 (if needed): Tighten the regex**

If the conjunction-only test fails, change the regex so the **first** token must be a capitalized name:

```js
const m = String(cite).match(
  /^([A-Z][A-Za-z'\-]+(?:\s+(?:[A-Z][A-Za-z'\-]+|and|&|et\s+al\.?))*\s+\d{2,4})/
);
```

Re-run — all tests should now pass.

- [ ] **Step 4: Commit**

```bash
git add public/lib/clipboard.js test/clipboard.test.js
git commit -m "test(clipboard): negative cases for prefix regex"
```

---

## Task 4: splitCite helper

**Files:**
- Modify: `public/lib/clipboard.js`
- Modify: `test/clipboard.test.js`

- [ ] **Step 1: Write failing tests**

```js
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
```

- [ ] **Step 2: Run to verify fail**

Run: `node --test test/clipboard.test.js`
Expected: 4 new tests FAIL.

- [ ] **Step 3: Implement**

In `public/lib/clipboard.js`:

```js
function splitCite(cite) {
  const s = String(cite == null ? '' : cite);
  if (!s) return { prefix: '', rest: '' };
  const prefix = extractAuthorYearPrefix(s);
  if (!prefix) return { prefix: '', rest: s };
  return { prefix, rest: s.slice(prefix.length) };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/clipboard.test.js`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add public/lib/clipboard.js test/clipboard.test.js
git commit -m "feat(clipboard): splitCite helper with prefix/rest"
```

---

## Task 5: flattenInlineStyles — nested b/u/mark merge

**Files:**
- Modify: `public/lib/clipboard.js`
- Modify: `test/clipboard.test.js`

- [ ] **Step 1: Write failing tests**

```js
const { flattenInlineStyles } = clipboard;

test('flatten: wraps <u> text in span with text-decoration', () => {
  const out = flattenInlineStyles('<u>under</u>');
  assert.match(out, /<span style="[^"]*text-decoration:underline[^"]*">under<\/span>/);
});

test('flatten: wraps <b> in span with font-weight:700', () => {
  const out = flattenInlineStyles('<b>bold</b>');
  assert.match(out, /<span style="[^"]*font-weight:700[^"]*">bold<\/span>/);
});

test('flatten: wraps <mark> in span with yellow background', () => {
  const out = flattenInlineStyles('<mark>hi</mark>');
  assert.match(out, /<span style="[^"]*background-color:#ffff00[^"]*">hi<\/span>/);
});

test('flatten: nested <b><u>x</u></b> merges into single span', () => {
  const out = flattenInlineStyles('<b><u>x</u></b>');
  // x should appear inside ONE span that has BOTH styles
  const m = out.match(/<span style="([^"]*)">x<\/span>/);
  assert.ok(m, `expected single span wrapping x, got: ${out}`);
  assert.match(m[1], /font-weight:700/);
  assert.match(m[1], /text-decoration:underline/);
});

test('flatten: nested <u><b><mark>x</mark></b></u> merges all three', () => {
  const out = flattenInlineStyles('<u><b><mark>x</mark></b></u>');
  const m = out.match(/<span style="([^"]*)">x<\/span>/);
  assert.ok(m);
  assert.match(m[1], /font-weight:700/);
  assert.match(m[1], /text-decoration:underline/);
  assert.match(m[1], /background-color:#ffff00/);
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
```

- [ ] **Step 2: Run to verify fail**

Run: `node --test test/clipboard.test.js`
Expected: 7 new tests FAIL.

- [ ] **Step 3: Port + extend the token walker**

Replace the stub in `public/lib/clipboard.js`:

```js
function flattenInlineStyles(html) {
  const src = String(html == null ? '' : html);
  const FMT_TAGS = /^(u|b|strong|mark)$/i;
  const stack = [];
  let out = '';
  let i = 0;

  function currentStyle() {
    let underline = false, bold = false, highlight = false;
    for (const t of stack) {
      if (t === 'u') underline = true;
      else if (t === 'b' || t === 'strong') bold = true;
      else if (t === 'mark') highlight = true;
    }
    const parts = ['color:#000', 'font-style:normal'];
    if (highlight) parts.push('background-color:#ffff00');
    if (bold) parts.push('font-weight:700');
    if (underline) parts.push('text-decoration:underline');
    return parts.join(';');
  }

  function emit(text) {
    if (!text) return;
    if (!stack.length) { out += text; return; }
    out += `<span style="${currentStyle()}">${text}</span>`;
  }

  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) { emit(src.slice(i)); break; }
    emit(src.slice(i, lt));
    const gt = src.indexOf('>', lt);
    if (gt < 0) { out += src.slice(lt); break; }
    const raw = src.slice(lt + 1, gt).trim();
    const isClose = raw.startsWith('/');
    const name = (isClose ? raw.slice(1) : raw.split(/\s/)[0]).toLowerCase();
    if (FMT_TAGS.test(name)) {
      if (isClose) {
        for (let j = stack.length - 1; j >= 0; j--) {
          if (stack[j] === name) { stack.splice(j, 1); break; }
        }
      } else {
        stack.push(name);
      }
    } else {
      out += src.slice(lt, gt + 1);
    }
    i = gt + 1;
  }
  return out;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/clipboard.test.js`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add public/lib/clipboard.js test/clipboard.test.js
git commit -m "feat(clipboard): flatten nested bold/underline/highlight into merged spans"
```

---

## Task 6: buildCopyHtml — card object to clipboard HTML

**Files:**
- Modify: `public/lib/clipboard.js`
- Modify: `test/clipboard.test.js`

- [ ] **Step 1: Write failing tests**

```js
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
  // prefix must be in an element with font-size:13pt AND font-weight:700
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

test('buildCopyHtml: nested b+u merge in body', () => {
  const html = buildCopyHtml({
    cite: 'Doe 25',
    body_html: '<p><b><u>x</u></b></p>'
  });
  const m = html.match(/<span style="([^"]*)">x<\/span>/);
  assert.ok(m);
  assert.match(m[1], /font-weight:700/);
  assert.match(m[1], /text-decoration:underline/);
});

test('buildCopyHtml: escapes HTML-dangerous chars in cite and tag', () => {
  const html = buildCopyHtml({
    tag: 'A & B < C',
    cite: 'Smith 24 "quote"',
    body_html: '<p>x</p>'
  });
  assert.match(html, /A &amp; B &lt; C/);
  assert.match(html, /Smith 24 &quot;quote&quot;/);
});

test('buildCopyHtml: empty card produces empty-safe output', () => {
  const html = buildCopyHtml({});
  assert.equal(typeof html, 'string');
});
```

- [ ] **Step 2: Run to verify fail**

Run: `node --test test/clipboard.test.js`
Expected: 8 new tests FAIL.

- [ ] **Step 3: Implement**

In `public/lib/clipboard.js`, add the `esc` helper (above `buildCopyHtml`), then implement:

```js
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildCopyHtml(card) {
  card = card || {};
  const tag = card.tag || '';
  const cite = card.cite || card.shortCite || '';
  let body = card.body_html;
  if (!body && card.body_plain) {
    body = '<p>' + esc(card.body_plain).replace(/\n+/g, '</p><p>') + '</p>';
  }
  body = flattenInlineStyles(body || '');

  const { prefix, rest } = splitCite(cite);
  let citeHtml;
  if (prefix) {
    citeHtml =
      `<span style="font-family:Calibri,Arial,sans-serif;font-size:13pt;font-weight:700;color:#000">${esc(prefix)}</span>` +
      `<span style="font-family:Calibri,Arial,sans-serif;font-size:11pt;font-weight:400;color:#000">${esc(rest)}</span>`;
  } else {
    citeHtml = `<span style="font-family:Calibri,Arial,sans-serif;font-size:11pt;font-weight:400;color:#000">${esc(cite)}</span>`;
  }

  const parts = [];
  parts.push('<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#000">');
  if (tag) {
    parts.push(`<p style="font-family:Calibri,Arial,sans-serif;font-size:13pt;font-weight:700;margin:0 0 4pt 0">${esc(tag)}</p>`);
  }
  parts.push(`<p style="font-family:Calibri,Arial,sans-serif;font-size:11pt;margin:0 0 6pt 0">${citeHtml}</p>`);
  parts.push(`<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt">${body}</div>`);
  parts.push('</div>');
  return parts.join('');
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/clipboard.test.js`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add public/lib/clipboard.js test/clipboard.test.js
git commit -m "feat(clipboard): buildCopyHtml with prefix/rest split + nested style flatten"
```

---

## Task 7: buildCopyPlain

**Files:**
- Modify: `public/lib/clipboard.js`
- Modify: `test/clipboard.test.js`

- [ ] **Step 1: Write failing tests**

```js
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
```

- [ ] **Step 2: Run to verify fail**

Run: `node --test test/clipboard.test.js`
Expected: 3 new tests FAIL.

- [ ] **Step 3: Implement**

```js
function buildCopyPlain(card) {
  card = card || {};
  const tag = card.tag || '';
  const cite = card.cite || card.shortCite || '';
  const body = card.body_plain || card.body_markdown || '';
  return `${tag}\n${cite}\n\n${body}`;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/clipboard.test.js`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add public/lib/clipboard.js test/clipboard.test.js
git commit -m "feat(clipboard): buildCopyPlain"
```

---

## Task 8: serializeSelectionHtml — DOM Range entry point

**Files:**
- Modify: `public/lib/clipboard.js`
- Modify: `test/clipboard.test.js`

The Range-based path cannot be unit-tested in node without a DOM library. We instead split it: `serializeSelectionHtml(range)` extracts the range's HTML via `range.cloneContents()` + a temporary container, and delegates to `serializeSelectionHtmlFromString(html, context)`, which **is** unit-testable. Context is one of `'card-body'`, `'cite'`, or `'mixed'` and controls whether cite-split runs and what default wrapper is applied.

- [ ] **Step 1: Write failing tests for the string helper**

```js
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
```

- [ ] **Step 2: Run to verify fail**

Run: `node --test test/clipboard.test.js`
Expected: new tests FAIL (function not exported).

- [ ] **Step 3: Implement the string helper + the Range wrapper**

In `public/lib/clipboard.js`:

```js
function stripDangerousAttrs(html) {
  return String(html || '')
    // strip event handlers
    .replace(/\s+on[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*'[^']*'/gi, '')
    // strip class attrs
    .replace(/\s+class\s*=\s*"[^"]*"/gi, '')
    .replace(/\s+class\s*=\s*'[^']*'/gi, '')
    // strip data-* attrs
    .replace(/\s+data-[a-z0-9\-]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\s+data-[a-z0-9\-]+\s*=\s*'[^']*'/gi, '')
    // strip script blocks entirely
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    // strip HTML comments
    .replace(/<!--[\s\S]*?-->/g, '');
}

function htmlToPlain(html) {
  return String(html || '')
    .replace(/<\/(p|div|br|li)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function serializeSelectionHtmlFromString(rawHtml, context) {
  const cleaned = stripDangerousAttrs(rawHtml);
  let html;
  if (context === 'cite') {
    const text = htmlToPlain(cleaned);
    const { prefix, rest } = splitCite(text);
    if (prefix) {
      html =
        `<span style="font-family:Calibri,Arial,sans-serif;font-size:13pt;font-weight:700;color:#000">${esc(prefix)}</span>` +
        `<span style="font-family:Calibri,Arial,sans-serif;font-size:11pt;font-weight:400;color:#000">${esc(rest)}</span>`;
    } else {
      html = `<span style="font-family:Calibri,Arial,sans-serif;font-size:11pt;font-weight:400;color:#000">${esc(text)}</span>`;
    }
  } else {
    // card-body or mixed
    const flat = flattenInlineStyles(cleaned);
    html = `<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#000">${flat}</div>`;
  }
  return { html, plain: htmlToPlain(cleaned) };
}

function serializeSelectionHtml(range) {
  if (!range || typeof range.cloneContents !== 'function') {
    return { html: '', plain: '' };
  }
  // In a browser environment — extract the range's HTML.
  const frag = range.cloneContents();
  const tmp = (typeof document !== 'undefined' && document.createElement)
    ? document.createElement('div') : null;
  if (!tmp) return { html: '', plain: '' };
  tmp.appendChild(frag);
  const rawHtml = tmp.innerHTML;

  // Detect context from the range's common ancestor.
  const container = range.commonAncestorContainer;
  const node = container && container.nodeType === 1 ? container : (container && container.parentElement);
  let context = 'card-body';
  if (node && typeof node.closest === 'function') {
    if (node.closest('.cite-block')) context = 'cite';
    else if (node.closest('.wb-body, .card-preview, [data-field="body"]')) context = 'card-body';
    else context = 'mixed';
  }
  return serializeSelectionHtmlFromString(rawHtml, context);
}
```

Add both to the returned object at the bottom of the module:

```js
return {
  extractAuthorYearPrefix,
  splitCite,
  flattenInlineStyles,
  buildCopyHtml,
  buildCopyPlain,
  serializeSelectionHtmlFromString,
  serializeSelectionHtml,
};
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/clipboard.test.js`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add public/lib/clipboard.js test/clipboard.test.js
git commit -m "feat(clipboard): serializeSelectionHtml + string helper for native copy"
```

---

## Task 9: Swap app.html script tags + CSS update

**Files:**
- Modify: `public/app.html`

- [ ] **Step 1: Replace old script tags with clipboard.js**

In `public/app.html`, search for the lines that include `copyExport.js` and `inlineStyleBody.js`. They look like:

```html
<script src="lib/copyExport.js"></script>
<script src="lib/inlineStyleBody.js"></script>
```

Replace with a single line:

```html
<script src="lib/clipboard.js"></script>
```

- [ ] **Step 2: Update `.cite-block .meta` CSS**

Locate the block (around line 485–493 per exploration):

```css
.cite-block .meta { font-size: 11.5px; font-family: var(--font-display); color: #000; }
.cite-block .meta b { color: var(--ink-2); font-weight: 600; }
```

Replace with:

```css
.cite-block .meta {
  font: 400 11pt/1.35 Calibri, "Helvetica Neue", Arial, sans-serif;
  color: #000;
}
.cite-block .meta b {
  font-size: 13pt;
  font-weight: 700;
  color: #000;
}
```

- [ ] **Step 3: Check mobile parity**

In the `@media (max-width:768px)` block in the same file, ensure no override for `.cite-block .meta` or `.cite-block .meta b` exists. If one does, remove it — the new absolute-pt values render fine on mobile. If the mobile block is empty for cite, no change.

- [ ] **Step 4: Smoke-test in browser**

Run: `npm run dev`
Open: `http://localhost:<port>/app.html`
Load any existing card. Verify:
- Cite prefix (first surname + year) appears bold 13pt black.
- Rest of cite appears regular 11pt black, Calibri-style font.
- No console errors mentioning `VerbaCopyExport`, `VerbaInlineStyle`, or `clipboard.js`.

- [ ] **Step 5: Commit**

```bash
git add public/app.html
git commit -m "feat(app): load unified clipboard.js + align cite CSS to 13pt/11pt Calibri spec"
```

---

## Task 10: Rewire copy button in app-main.js

**Files:**
- Modify: `public/app-main.js` (around line 935)

- [ ] **Step 1: Replace the copy-button handler**

Locate the handler starting at `$('#wb-copy')?.addEventListener('click', async () => {`. Replace the entire handler body with:

```js
$('#wb-copy')?.addEventListener('click', async () => {
  syncCardFromDom();
  const c = state.currentCard;
  if (!c || (!c.tag && !c.body_html)) { toast('Nothing to copy'); return; }
  const VC = window.VerbaClipboard;
  if (!VC) { toast('Clipboard module missing'); return; }
  const html = VC.buildCopyHtml(c);
  const plain = VC.buildCopyPlain(c);
  try {
    if (window.ClipboardItem && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([plain], { type: 'text/plain' }),
      })]);
    } else {
      await navigator.clipboard.writeText(plain);
    }
    const b = $('#wb-copy');
    if (b) { b.classList.add('copied'); setTimeout(() => b.classList.remove('copied'), 1400); }
  } catch (err) {
    console.error(err);
    toast('Copy blocked');
  }
});
```

Note: this removes the inline `inlineStyleBody()` + `markdownCardToHtml()` calls. The `flatten` work now happens inside `buildCopyHtml`. If `markdownCardToHtml` was the only path for cards that have `body_markdown` but not `body_html`, verify `buildCopyHtml` handles that (it does — via the `body_plain` fallback path that converts to `<p>…</p>`). If a card has ONLY `body_markdown`, you may need to pre-render it; grep for `body_markdown` to confirm current flow. If needed, add a pre-step:

```js
const card = { ...c, body_html: c.body_html || (c.body_markdown ? markdownCardToHtml(c.body_markdown) : undefined) };
const html = VC.buildCopyHtml(card);
const plain = VC.buildCopyPlain(card);
```

- [ ] **Step 2: Manual smoke**

Run: `npm run dev`
Open a card with bold + underline + highlight.
Click the copy button → paste into a plain text editor.
Expected: tag + cite + body appear in plain form.

- [ ] **Step 3: Commit**

```bash
git add public/app-main.js
git commit -m "feat(app): route copy button through VerbaClipboard.buildCopyHtml"
```

---

## Task 11: Native copy event listener

**Files:**
- Modify: `public/app-main.js`

- [ ] **Step 1: Add the listener registration**

Find the `DOMContentLoaded` or main init function in `public/app-main.js`. Add this once at the end of the init block (after the copy-button handler):

```js
// Native Ctrl+C / Cmd+C — route through same serializer as copy button
document.addEventListener('copy', (e) => {
  const VC = window.VerbaClipboard;
  if (!VC) return;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
  const range = sel.getRangeAt(0);
  const container = range.commonAncestorContainer;
  const node = container.nodeType === 1 ? container : container.parentElement;
  if (!node || !node.closest) return;
  if (!node.closest('.wb-body, .card-preview, .cite-block, [data-field="body"]')) return;
  const { html, plain } = VC.serializeSelectionHtml(range);
  if (!html) return;
  e.clipboardData.setData('text/html', html);
  e.clipboardData.setData('text/plain', plain);
  e.preventDefault();
});
```

- [ ] **Step 2: Manual smoke**

Run: `npm run dev`
Open a card with bold + underline.
Select a mixed range with Ctrl+A (or manual drag) → Ctrl+C → paste into Microsoft Word.
Expected: bold, underline, highlight all preserved.

- [ ] **Step 3: Commit**

```bash
git add public/app-main.js
git commit -m "feat(app): native copy event listener routes through unified serializer"
```

---

## Task 12: Underline normalization on editor input

**Files:**
- Modify: `public/app-main.js`

- [ ] **Step 1: Add normalization helper**

In a utilities section near the other DOM helpers in `public/app-main.js`, add:

```js
function normalizeUnderlineTags(root) {
  if (!root) return;
  const us = root.querySelectorAll ? root.querySelectorAll('u') : [];
  for (const u of us) {
    const existing = u.getAttribute('style') || '';
    if (!/text-decoration\s*:\s*underline/i.test(existing)) {
      const sep = existing && !existing.trim().endsWith(';') ? ';' : '';
      u.setAttribute('style', existing + sep + 'text-decoration:underline');
    }
  }
}
```

- [ ] **Step 2: Wire into the editor input event**

Locate the `input` listener on `.wb-body [data-field="body"]` (search for `data-field="body"` + `addEventListener`). After the existing input handler runs, call:

```js
normalizeUnderlineTags(evt.target);
```

If no input listener exists yet for this element, add one that calls both `syncCardFromDom()` (if that's the existing pattern) and `normalizeUnderlineTags(evt.target)`.

- [ ] **Step 3: Manual smoke**

Run: `npm run dev`
Type text → select → click underline button → inspect the editor DOM.
Expected: the `<u>` element has `style="text-decoration:underline"` attribute.

- [ ] **Step 4: Commit**

```bash
git add public/app-main.js
git commit -m "feat(app): normalize underline tags on editor input for paste reliability"
```

---

## Task 13: Delete old modules + migrate leftover tests

**Files:**
- Delete: `public/lib/copyExport.js`
- Delete: `public/lib/inlineStyleBody.js`
- Delete: `test/copyExport.test.js`
- Delete: `test/copy-export-nested.test.js`

- [ ] **Step 1: Diff the old tests against the new suite**

Run: `git diff --no-index test/copyExport.test.js test/clipboard.test.js`

Scan the old file for any test case (or assertion) NOT already covered in `test/clipboard.test.js`. For each missing case, port it to `test/clipboard.test.js` using `buildCopyHtml` / `buildCopyPlain` via the new module. Common gaps to check:
- Tag-empty-but-body-present path.
- `body_markdown` fallback.
- Character escaping in body.

Repeat for `test/copy-export-nested.test.js` — that file focuses on nested formatting, which Task 5 already covers, but port any unique nesting pattern (e.g. interleaved open/close) as a regression case.

- [ ] **Step 2: Confirm no other file imports the old modules**

Run (PowerShell or bash):
```
rg -n "copyExport|inlineStyleBody|VerbaCopyExport|VerbaInlineStyle" --type-add 'web:*.{js,html}' --type web
```

Expected: the only matches should be the two files slated for deletion and any already-updated locations. If a stray match exists, fix it before deleting.

- [ ] **Step 3: Delete the old files**

```bash
git rm public/lib/copyExport.js public/lib/inlineStyleBody.js
git rm test/copyExport.test.js test/copy-export-nested.test.js
```

- [ ] **Step 4: Run full test suite**

Run: `npm test`
Expected: all tests PASS, including any newly-ported cases in `test/clipboard.test.js`.

- [ ] **Step 5: Commit**

```bash
git commit -m "refactor(clipboard): remove legacy copyExport + inlineStyleBody modules"
```

---

## Task 14: Manual QA checklist document

**Files:**
- Create: `public/lib/clipboard.qa.md`

- [ ] **Step 1: Write the QA doc**

```markdown
# Clipboard Manual QA

Run this checklist after any change to `public/lib/clipboard.js`, the copy button handler, the native copy listener, or `.cite-block` CSS.

## Setup
1. `npm run dev`
2. Open `http://localhost:<port>/app.html`
3. Sign in, open any existing card (or cut a fresh one).

## Copy button — paste into Microsoft Word (desktop)
- [ ] Cite prefix (first surname + year) is 13pt bold black.
- [ ] Rest of cite is 11pt regular black, Calibri stack.
- [ ] Tag line is 13pt bold black above cite.
- [ ] Body preserves bold, underline, highlight (yellow).
- [ ] Nested bold+underline text is still both bold and underlined.
- [ ] Highlight spanning an underline still shows both.

## Native Ctrl+C (no copy button) — paste into Microsoft Word
- [ ] Select a word with underline only → Ctrl+C → paste: underline preserved.
- [ ] Select a phrase with bold + underline → Ctrl+C → paste: both preserved.
- [ ] Select across the cite + body → paste: cite prefix still 13pt bold.

## Google Docs (best-effort)
- [ ] Copy button paste preserves bold + underline (Docs may strip font sizes).

## Two-surname / multi-author cites
- [ ] Cut a card with cite `"Van Dyke 24, ..."` — prefix captured fully.
- [ ] Cut a card with cite `"Tuck and Yang 24, ..."` — prefix captured fully.
- [ ] Cut a card with cite `"Last et al. 24, ..."` — prefix captured fully.

## Mobile (Chrome DevTools device emulation, width ≤ 768px)
- [ ] Cite remains legible (no overflow into next card).
- [ ] 11pt / 13pt sizes render without clipping.

## Regression
- [ ] Copy button on a card with no tag: only cite + body in clipboard.
- [ ] Copy button on an empty card: toast "Nothing to copy".
- [ ] Selection outside `.wb-body` / `.card-preview` / `.cite-block` uses default browser copy (e.g. sidebar text copies plain).
```

- [ ] **Step 2: Commit**

```bash
git add public/lib/clipboard.qa.md
git commit -m "docs(clipboard): manual QA checklist"
```

---

## Task 15: End-to-end test run + smoke

**Files:** None modified

- [ ] **Step 1: Full test run**

Run: `npm test`
Expected: all tests pass. Zero failures, zero errors.

- [ ] **Step 2: Dev server smoke**

Run: `npm run dev`
In browser:
1. Cut or open a card with bold + underline + highlight in body.
2. Click copy button → paste into Word desktop → verify Task 14 checklist items for the copy-button path.
3. Select the same content manually → Ctrl+C → paste into Word → verify the native path gives identical output.
4. Open a card with a two-word-surname cite → verify in-app display shows correct prefix styling.

- [ ] **Step 3: Fix any QA failures**

If any QA item fails, locate the responsible task above, add a regression test to `test/clipboard.test.js` that captures the failure, then fix the code. Do not commit fixes without a test.

- [ ] **Step 4: Final commit (if anything changed during QA)**

```bash
git add -u
git commit -m "fix(clipboard): QA-driven adjustments"
```

Otherwise, no action.

---

## Self-Review

- **Spec coverage:**
  - Cite CSS → Task 9.
  - Unified serializer pipeline → Tasks 1, 5, 6, 7, 8.
  - Copy button → Task 10.
  - Native copy event → Task 11.
  - Underline storage normalization → Task 12.
  - Delete legacy modules → Task 13.
  - Mobile parity → Task 9, Step 3.
  - Tests → Tasks 2–8 (unit); Task 14 (manual QA); Task 15 (e2e smoke).
  - Cite regex (two-surname, et al., multi-author) → Task 2.
- **Placeholder scan:** No TBDs; every step contains runnable code or an exact command.
- **Type consistency:** `buildCopyHtml`, `buildCopyPlain`, `splitCite`, `flattenInlineStyles`, `extractAuthorYearPrefix`, `serializeSelectionHtml`, `serializeSelectionHtmlFromString` are consistently referenced throughout. Global exposure is `window.VerbaClipboard` (used in Tasks 10 and 11).
