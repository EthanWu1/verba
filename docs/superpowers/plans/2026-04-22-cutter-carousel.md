# Cutter Carousel + Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the source panel + chip row with a full-width animated carousel of cut cards that persists across reloads, plus a pill-shaped input bar with segmented length selector and circular send button.

**Architecture:** Pure state module `public/lib/carousel.js` (reducers + localStorage codec) owns the `{items, activeIndex}` shape. `public/app-main.js` mounts that state into the DOM, wires the Cut flow / SSE stream / editor handlers against `activeItem`. `public/app.html` swaps the split-pane workbench for a single-column cutter-strip + card-carousel layout with new CSS.

**Tech Stack:** Vanilla JS (UMD), browser `crypto.randomUUID()`, `localStorage`, Node built-in test runner (`node --test`). No new npm deps.

**Reference spec:** `docs/superpowers/specs/2026-04-22-cutter-carousel-design.md`

---

## File Structure

- **Create:** `public/lib/carousel.js` — pure reducers + persistence codec (UMD).
- **Create:** `test/carousel.test.js` — unit tests (node --test).
- **Create:** `public/lib/carousel.qa.md` — manual QA checklist.
- **Modify:** `public/app.html` — delete source-pane DOM + staging; add cutter-strip + card-carousel DOM; add CSS for input bar, pill input, segmented length, carousel, card-shell, animation, dots.
- **Modify:** `public/app-main.js` — replace `queues[]` + chip code with `carouselState` + mutation API; rewire Cut flow + SSE + editor sync + copy/add-to handlers to operate on `activeItem`; add keyboard/arrow/dot nav; wire trash icon + undo toast; wire external-link icon; wire length-segmented control; wire localStorage hydrate + debounced save; delete renderPhaseLog host + source panel helpers.

---

## Task 1: Scaffold carousel.js module + test

**Files:**
- Create: `public/lib/carousel.js`
- Create: `test/carousel.test.js`

- [ ] **Step 1: Write module-contract test**

```js
// test/carousel.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const carousel = require('../public/lib/carousel.js');

test('carousel module exports required API', () => {
  ['createState','pushItem','updateItem','removeItem','setActive','clearAll',
   'serialize','deserialize','hydrate','SOFT_CAP_ITEMS','SOFT_CAP_BYTES']
    .forEach(name => assert.ok(name in carousel, `missing export: ${name}`));
});
```

- [ ] **Step 2: Run → fail**

Run: `node --test test/carousel.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Create UMD skeleton**

```js
// public/lib/carousel.js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VerbaCarousel = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  const SOFT_CAP_ITEMS = 50;
  const SOFT_CAP_BYTES = 500 * 1024;

  function createState() { return { items: [], activeIndex: 0 }; }
  function pushItem(state, partial) { return state; }
  function updateItem(state, id, patch) { return state; }
  function removeItem(state, id) { return state; }
  function setActive(state, index) { return state; }
  function clearAll(state) { return state; }
  function serialize(state) { return ''; }
  function deserialize(json) { return createState(); }
  function hydrate(json) { return createState(); }

  return {
    createState, pushItem, updateItem, removeItem, setActive, clearAll,
    serialize, deserialize, hydrate,
    SOFT_CAP_ITEMS, SOFT_CAP_BYTES
  };
}));
```

- [ ] **Step 4: Run → pass**

- [ ] **Step 5: Commit**

```
git add public/lib/carousel.js test/carousel.test.js
git commit -m "feat(carousel): scaffold state module"
```

---

## Task 2: pushItem reducer

**Files:** `public/lib/carousel.js`, `test/carousel.test.js`

- [ ] **Step 1: Write failing tests**

Append to `test/carousel.test.js`:

```js
const { createState, pushItem } = carousel;

test('pushItem appends and sets activeIndex to last', () => {
  let s = createState();
  s = pushItem(s, { id: 'a', status: 'done', tag: 'A' });
  s = pushItem(s, { id: 'b', status: 'cutting' });
  assert.equal(s.items.length, 2);
  assert.equal(s.items[0].id, 'a');
  assert.equal(s.items[1].id, 'b');
  assert.equal(s.activeIndex, 1);
});

test('pushItem returns new state (immutable)', () => {
  const a = createState();
  const b = pushItem(a, { id: 'x', status: 'done' });
  assert.notStrictEqual(a, b);
  assert.equal(a.items.length, 0);
  assert.equal(b.items.length, 1);
});

test('pushItem fills default fields', () => {
  const s = pushItem(createState(), { id: 'a', status: 'done' });
  assert.equal(typeof s.items[0].createdAt, 'number');
  assert.equal(s.items[0].tag, '');
  assert.equal(s.items[0].cite, '');
  assert.equal(s.items[0].body_html, '');
  assert.equal(s.items[0].phaseHistory.length, 0);
});
```

- [ ] **Step 2: Run → 3 fail**

- [ ] **Step 3: Implement** (replace stub)

```js
function pushItem(state, partial) {
  const item = {
    id: partial.id,
    status: partial.status || 'done',
    createdAt: typeof partial.createdAt === 'number' ? partial.createdAt : Date.now(),
    sourceUrl: partial.sourceUrl || null,
    sourceLabel: partial.sourceLabel || null,
    tag: partial.tag || '',
    cite: partial.cite || '',
    body_html: partial.body_html || '',
    body_markdown: partial.body_markdown || '',
    body_plain: partial.body_plain || '',
    phase: partial.phase || null,
    phaseHistory: partial.phaseHistory || [],
    error: partial.error || null
  };
  const items = state.items.concat(item);
  return { items, activeIndex: items.length - 1 };
}
```

- [ ] **Step 4: Run → pass**

- [ ] **Step 5: Commit**

```
git add public/lib/carousel.js test/carousel.test.js
git commit -m "feat(carousel): pushItem reducer with defaults"
```

---

## Task 3: updateItem, removeItem, setActive, clearAll

**Files:** `public/lib/carousel.js`, `test/carousel.test.js`

- [ ] **Step 1: Write failing tests**

```js
const { updateItem, removeItem, setActive, clearAll } = carousel;

test('updateItem merges patch by id', () => {
  let s = pushItem(createState(), { id: 'a', status: 'cutting' });
  s = updateItem(s, 'a', { status: 'done', tag: 'hello' });
  assert.equal(s.items[0].status, 'done');
  assert.equal(s.items[0].tag, 'hello');
});

test('updateItem is no-op for unknown id', () => {
  const s1 = pushItem(createState(), { id: 'a' });
  const s2 = updateItem(s1, 'missing', { tag: 'x' });
  assert.equal(s2.items[0].tag, '');
});

test('removeItem splices by id and clamps activeIndex', () => {
  let s = pushItem(createState(), { id: 'a' });
  s = pushItem(s, { id: 'b' });
  s = pushItem(s, { id: 'c' });
  // activeIndex is 2 (c). remove b (index 1).
  s = removeItem(s, 'b');
  assert.equal(s.items.length, 2);
  assert.deepEqual(s.items.map(i => i.id), ['a','c']);
  assert.equal(s.activeIndex, 1); // still points at c (now index 1)
});

test('removeItem clamps activeIndex when removing active last', () => {
  let s = pushItem(createState(), { id: 'a' });
  s = pushItem(s, { id: 'b' });
  s = removeItem(s, 'b'); // active was 1, now only 1 item
  assert.equal(s.activeIndex, 0);
});

test('setActive clamps to valid range', () => {
  let s = pushItem(createState(), { id: 'a' });
  s = pushItem(s, { id: 'b' });
  assert.equal(setActive(s, 99).activeIndex, 1);
  assert.equal(setActive(s, -5).activeIndex, 0);
  assert.equal(setActive(s, 0).activeIndex, 0);
});

test('clearAll empties and zeros activeIndex', () => {
  let s = pushItem(createState(), { id: 'a' });
  s = pushItem(s, { id: 'b' });
  s = clearAll(s);
  assert.equal(s.items.length, 0);
  assert.equal(s.activeIndex, 0);
});
```

- [ ] **Step 2: Run → 6 fail**

- [ ] **Step 3: Implement**

```js
function updateItem(state, id, patch) {
  const idx = state.items.findIndex(i => i.id === id);
  if (idx < 0) return state;
  const items = state.items.slice();
  items[idx] = Object.assign({}, items[idx], patch);
  return { items, activeIndex: state.activeIndex };
}

function removeItem(state, id) {
  const idx = state.items.findIndex(i => i.id === id);
  if (idx < 0) return state;
  const items = state.items.slice();
  items.splice(idx, 1);
  let activeIndex = state.activeIndex;
  if (idx < activeIndex) activeIndex -= 1;
  if (activeIndex >= items.length) activeIndex = Math.max(0, items.length - 1);
  return { items, activeIndex };
}

function setActive(state, index) {
  if (state.items.length === 0) return { items: state.items, activeIndex: 0 };
  const clamped = Math.min(Math.max(index, 0), state.items.length - 1);
  return { items: state.items, activeIndex: clamped };
}

function clearAll(state) { return { items: [], activeIndex: 0 }; }
```

- [ ] **Step 4: Run → pass**

- [ ] **Step 5: Commit**

```
git add public/lib/carousel.js test/carousel.test.js
git commit -m "feat(carousel): update/remove/setActive/clearAll reducers"
```

---

## Task 4: Persistence codec + soft-cap eviction

**Files:** `public/lib/carousel.js`, `test/carousel.test.js`

- [ ] **Step 1: Write failing tests**

```js
const { serialize, deserialize, hydrate, SOFT_CAP_ITEMS } = carousel;

test('serialize strips ephemeral fields', () => {
  let s = pushItem(createState(), {
    id: 'a', status: 'cutting', phase: 'x', phaseHistory: ['p1'], error: null
  });
  const json = serialize(s);
  const parsed = JSON.parse(json);
  assert.equal(parsed.items[0].id, 'a');
  assert.equal(parsed.items[0].phase, undefined);
  assert.equal(parsed.items[0].phaseHistory, undefined);
  assert.equal(parsed.items[0].error, undefined);
});

test('deserialize restores items with defaults for ephemeral fields', () => {
  const json = JSON.stringify({
    items: [{ id: 'a', status: 'done', tag: 'T', cite: 'C', body_html: '',
              body_markdown: '', body_plain: '', createdAt: 1, sourceUrl: null, sourceLabel: null }],
    activeIndex: 0
  });
  const s = deserialize(json);
  assert.equal(s.items.length, 1);
  assert.equal(s.items[0].phase, null);
  assert.deepEqual(s.items[0].phaseHistory, []);
});

test('hydrate converts cutting → error (interrupted)', () => {
  const json = JSON.stringify({
    items: [{ id: 'a', status: 'cutting', tag: '', cite: '', body_html: '',
              body_markdown: '', body_plain: '', createdAt: 1, sourceUrl: null, sourceLabel: null }],
    activeIndex: 0
  });
  const s = hydrate(json);
  assert.equal(s.items[0].status, 'error');
  assert.match(s.items[0].error, /interrupted/i);
});

test('hydrate returns empty state on invalid json', () => {
  assert.deepEqual(hydrate('not json').items, []);
  assert.deepEqual(hydrate('').items, []);
  assert.deepEqual(hydrate(null).items, []);
});

test('pushItem evicts oldest done when over SOFT_CAP_ITEMS', () => {
  let s = createState();
  for (let i = 0; i < SOFT_CAP_ITEMS; i++) {
    s = pushItem(s, { id: 'i' + i, status: 'done', createdAt: i });
  }
  s = pushItem(s, { id: 'new', status: 'done', createdAt: 9999 });
  assert.equal(s.items.length, SOFT_CAP_ITEMS);
  assert.equal(s.items[0].id, 'i1'); // i0 evicted
  assert.equal(s.items[s.items.length - 1].id, 'new');
});

test('pushItem never evicts cutting items', () => {
  let s = createState();
  s = pushItem(s, { id: 'cut', status: 'cutting', createdAt: 0 });
  for (let i = 0; i < SOFT_CAP_ITEMS - 1; i++) {
    s = pushItem(s, { id: 'd' + i, status: 'done', createdAt: 100 + i });
  }
  // now at cap with 1 cutting + 49 done
  s = pushItem(s, { id: 'new', status: 'done', createdAt: 9999 });
  assert.equal(s.items.length, SOFT_CAP_ITEMS);
  assert.ok(s.items.find(i => i.id === 'cut'), 'cutting item must survive');
});
```

- [ ] **Step 2: Run → 6 fail**

- [ ] **Step 3: Implement**

Add these helpers + replace `pushItem` with a version that evicts BEFORE appending:

```js
function serialize(state) {
  const items = state.items.map(i => {
    const { phase, phaseHistory, error, ...keep } = i;
    return keep;
  });
  return JSON.stringify({ items, activeIndex: state.activeIndex });
}

function deserialize(json) {
  try {
    const parsed = JSON.parse(json);
    if (!parsed || !Array.isArray(parsed.items)) return createState();
    const items = parsed.items.map(raw => ({
      id: String(raw.id || ''),
      status: raw.status || 'done',
      createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
      sourceUrl: raw.sourceUrl || null,
      sourceLabel: raw.sourceLabel || null,
      tag: raw.tag || '',
      cite: raw.cite || '',
      body_html: raw.body_html || '',
      body_markdown: raw.body_markdown || '',
      body_plain: raw.body_plain || '',
      phase: null,
      phaseHistory: [],
      error: null
    }));
    const activeIndex = Math.min(Math.max(parsed.activeIndex|0, 0), Math.max(items.length - 1, 0));
    return { items, activeIndex };
  } catch (_) { return createState(); }
}

function hydrate(json) {
  const s = deserialize(json || '');
  const items = s.items.map(i => {
    if (i.status === 'cutting') return Object.assign({}, i, { status: 'error', error: 'Cut interrupted by reload' });
    return i;
  });
  return { items, activeIndex: s.activeIndex };
}

function evictIfOverCap(items) {
  if (items.length <= SOFT_CAP_ITEMS) return items;
  const copy = items.slice();
  while (copy.length > SOFT_CAP_ITEMS) {
    const idx = copy.findIndex(i => i.status !== 'cutting');
    if (idx < 0) break; // all cutting — can't evict
    copy.splice(idx, 1);
  }
  return copy;
}
```

Update `pushItem` to call `evictIfOverCap`:

```js
function pushItem(state, partial) {
  const item = {
    id: partial.id,
    status: partial.status || 'done',
    createdAt: typeof partial.createdAt === 'number' ? partial.createdAt : Date.now(),
    sourceUrl: partial.sourceUrl || null,
    sourceLabel: partial.sourceLabel || null,
    tag: partial.tag || '',
    cite: partial.cite || '',
    body_html: partial.body_html || '',
    body_markdown: partial.body_markdown || '',
    body_plain: partial.body_plain || '',
    phase: partial.phase || null,
    phaseHistory: partial.phaseHistory || [],
    error: partial.error || null
  };
  const items = evictIfOverCap(state.items.concat(item));
  return { items, activeIndex: items.length - 1 };
}
```

Update the module return object to include `serialize`, `deserialize`, `hydrate`.

- [ ] **Step 4: Run → pass**

- [ ] **Step 5: Commit**

```
git add public/lib/carousel.js test/carousel.test.js
git commit -m "feat(carousel): persistence codec + soft-cap eviction + interrupt hydration"
```

---

## Task 5: Remove source panel + chip DOM from app.html

**Files:** `public/app.html`

- [ ] **Step 1: Locate the DOM blocks to delete**

Search `public/app.html` for these IDs / classes. Keep a scratch note of line numbers before deleting:
- `id="pane-source"`, `class="pane source"`, and any children (pane-title, pane-body hosting phase logs).
- `id="staging"` — the chip row.
- `#source-handle`, `#source-close`, `#source-reopen` controls.
- Any CSS under selectors `.pane.source`, `.pane-source`, `#pane-source`, `#staging`, `.stage-chip`, `.stage-*` status variants, `.phase-log`, `.phase-row`, `.phase-*` — remove them along with the DOM.

Leave unchanged: `#wb-body`, the editor sections, the copy/addto/trash buttons. They remain the "editor" contents of the active card shell (we'll re-mount them inside the carousel later).

- [ ] **Step 2: Delete the matching HTML + CSS**

One coherent edit. Keep `<main id="workbench">` as the outer container. Inside it, the split-pane wrapper that previously held both source + card becomes a single flow.

- [ ] **Step 3: Smoke**

Open `public/app.html` — no stray references to `pane-source`, `staging`, `stage-chip`, `phase-log`, `phase-row`, `source-handle`, `source-close`, `source-reopen`.

Run `grep -n "pane-source\|stage-chip\|phase-log\|source-handle\|source-close\|source-reopen" public/app.html` → zero matches.

- [ ] **Step 4: Commit**

```
git add public/app.html
git commit -m "refactor(app): remove source panel + staging chip DOM and CSS"
```

Note: the app will be visually broken after this commit until Task 7 restores a layout. That is intentional — each commit is a checkpoint, not a release.

---

## Task 6: Remove chip + source-panel JS from app-main.js

**Files:** `public/app-main.js`

- [ ] **Step 1: Remove these symbols + their callers**

Edit `public/app-main.js`. Delete:
- `const QUEUE_MAX_CHIPS = 6;` and `const queues = [];` (around lines 375–376).
- `renderPhaseLog(job)` function (around lines 378–393) and any caller (`renderPhaseLog(activeJob)`, etc.).
- The chip-management loop that manipulates `queues` + `#staging` (around lines 421–445).
- `createJob(input)` (around lines 447–475) — we'll add a replacement in Task 9.
- Any references to `queues.find(...)`, `activeJob`, or `job.chip`.
- Any references to `#pane-source`, `#source-handle`, `#source-close`, `#source-reopen`, `srcClose`, `srcReopen`, `srcHandle` event handlers (around lines 966–982 per prior exploration).

Temporarily stub the two code paths that used to call `createJob(input)` (search for `createJob(`) so the file still parses:

```js
// TEMP: rewired in Task 9
function startCut(input /*, opts */) { console.warn('startCut not yet wired'); }
```

Replace `createJob(val)` call sites with `startCut(val)`.

- [ ] **Step 2: Verify file parses**

Run `node --check public/app-main.js`. Expected: no syntax errors.

- [ ] **Step 3: Commit**

```
git add public/app-main.js
git commit -m "refactor(app): remove chip/queue/source-panel code paths"
```

---

## Task 7: Add cutter-strip + card-carousel DOM + CSS

**Files:** `public/app.html`

- [ ] **Step 1: Insert new DOM inside `<main id="workbench">`**

```html
<header class="cutter-strip">
  <div class="length-seg" role="radiogroup" aria-label="Card length">
    <button type="button" class="length-opt" data-length="short" aria-pressed="false">S</button>
    <button type="button" class="length-opt" data-length="medium" aria-pressed="false">M</button>
    <button type="button" class="length-opt is-active" data-length="long" aria-pressed="true">L</button>
  </div>

  <label class="cut-input-pill">
    <svg class="pill-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.72"/>
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.72-1.72"/>
    </svg>
    <input id="cut-input" type="text" placeholder="Paste URL or drop a PDF to cut from…" autocomplete="off">
    <button id="cut-submit" type="button" aria-label="Cut">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <line x1="12" y1="19" x2="12" y2="5"/>
        <polyline points="5 12 12 5 19 12"/>
      </svg>
    </button>
  </label>
</header>

<section class="card-carousel" aria-label="Cut cards">
  <button class="carousel-nav carousel-prev" aria-label="Previous card" type="button">‹</button>
  <div id="card-stage" class="card-stage"></div>
  <button class="carousel-nav carousel-next" aria-label="Next card" type="button">›</button>
  <div id="carousel-dots" class="carousel-dots" aria-hidden="true"></div>
  <div id="carousel-empty" class="carousel-empty" hidden>No cards yet — paste a URL or drop a PDF above.</div>
</section>
```

- [ ] **Step 2: Add CSS**

In the `<style>` block (or matching CSS area), add:

```css
.cutter-strip{display:flex;gap:12px;align-items:center;padding:14px 22px;background:linear-gradient(180deg,#fafafa,#f1f2f6);border-bottom:1px solid #e5e5e5}
.length-seg{display:inline-flex;padding:3px;background:#eef0f4;border:1px solid #e1e3eb;border-radius:999px}
.length-opt{border:0;background:transparent;padding:5px 14px;font:600 11.5px var(--font-display,system-ui);color:#6b7280;border-radius:999px;cursor:pointer}
.length-opt.is-active{background:#0d0d12;color:#fff}

.cut-input-pill{flex:1;display:flex;align-items:center;gap:10px;padding:8px 8px 8px 18px;background:#fff;border:1px solid #dcdfe6;border-radius:999px;box-shadow:inset 0 1px 2px rgba(0,0,0,0.03)}
.pill-icon{color:#9ca3af;flex-shrink:0}
#cut-input{flex:1;border:0;outline:0;font:400 14px var(--font-display,system-ui);background:transparent;color:#111}
#cut-submit{width:34px;height:34px;border-radius:50%;background:#0d0d12;color:#fff;border:0;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,0.18);cursor:pointer;flex-shrink:0}
#cut-submit:disabled{opacity:0.5;cursor:not-allowed}

.card-carousel{position:relative;background:linear-gradient(180deg,#fff,#f5f5f7);padding:44px 0 36px;min-height:560px}
.card-stage{max-width:1100px;margin:0 auto;padding:0 56px;position:relative}
.carousel-nav{position:absolute;top:50%;transform:translateY(-50%);width:40px;height:40px;border-radius:50%;background:#fff;border:1px solid #e2e2e2;display:flex;align-items:center;justify-content:center;color:#888;font-size:16px;cursor:pointer;z-index:2}
.carousel-prev{left:12px}
.carousel-next{right:12px}
.carousel-nav[hidden]{display:none}

.carousel-dots{display:flex;justify-content:center;gap:6px;margin-top:20px}
.dot{width:8px;height:8px;border-radius:50%;background:#ccc;border:0;padding:0;cursor:pointer}
.dot.is-active{background:#0d0d12}

.carousel-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#9ca3af;font:500 14px var(--font-display,system-ui);pointer-events:none}

.card-shell{background:#fff;border:1px solid #ececec;border-radius:18px;box-shadow:0 20px 60px rgba(15,20,40,0.08);padding:40px 48px;min-height:480px;position:relative;opacity:1;transform:translateX(0) scale(1);transition:transform 280ms cubic-bezier(0.22,1,0.36,1), opacity 220ms ease}
.card-shell.leaving-left{transform:translateX(-40px) scale(0.96);opacity:0}
.card-shell.leaving-right{transform:translateX( 40px) scale(0.96);opacity:0}
.card-shell .shell-icons{position:absolute;top:18px;right:18px;display:flex;gap:8px}
.card-shell .shell-icon{width:34px;height:34px;border-radius:8px;background:#fafafa;border:1px solid #e5e7eb;display:flex;align-items:center;justify-content:center;color:#4b5563;text-decoration:none;cursor:pointer}
.card-shell .shell-icon[hidden]{display:none}
.card-shell .cut-progress{height:4px;background:#eee;border-radius:2px;overflow:hidden;margin-bottom:24px}
.card-shell .cut-progress-bar{height:100%;background:linear-gradient(90deg,#3b7cff,#9333ea);border-radius:2px;width:0;transition:width 260ms ease}
.card-shell .cut-log{background:#0d0d12;border-radius:10px;padding:14px 18px;font:400 12px ui-monospace,Consolas,monospace;color:#b9bfd0;line-height:1.7}
.card-shell .cut-log .current{color:#6ee7b7}
.card-shell .cut-log .pending{opacity:0.4}

@media (max-width:768px){
  .card-stage{padding:0 44px}
  .cutter-strip{flex-wrap:wrap;gap:8px}
  .length-seg{order:2;margin-left:auto}
  .cut-input-pill{order:1;min-width:100%}
  .card-shell{padding:28px 20px;min-height:380px}
}
```

- [ ] **Step 2: Commit**

```
git add public/app.html
git commit -m "feat(app): add cutter-strip and card-carousel DOM + CSS"
```

---

## Task 8: Mount carousel state in app-main.js

**Files:** `public/app-main.js`

- [ ] **Step 1: Load the module + initialize state**

Near the top of the init block in `public/app-main.js` (after other `window.VerbaX` references are consumed), add:

```js
const Carousel = window.VerbaCarousel;
if (!Carousel) { console.error('VerbaCarousel not loaded'); return; }

const LS_KEY = 'verba.cutter.carousel.v1';
let carouselState = Carousel.hydrate(localStorage.getItem(LS_KEY));
let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(LS_KEY, Carousel.serialize(carouselState)); } catch (_) {}
  }, 400);
}
function applyState(next) {
  carouselState = next;
  renderCarousel();
  scheduleSave();
}
function activeItem() {
  return carouselState.items[carouselState.activeIndex] || null;
}
```

Also add the script tag `<script src="lib/carousel.js"></script>` in `public/app.html` before `app-main.js` loads.

- [ ] **Step 2: Stub `renderCarousel()`**

```js
function renderCarousel() {
  // filled in Task 9
}
```

- [ ] **Step 3: Verify page loads without errors**

Run `node --check public/app-main.js` → no syntax errors.

- [ ] **Step 4: Commit**

```
git add public/app-main.js public/app.html
git commit -m "feat(app): mount carousel state + scheduleSave scaffolding"
```

---

## Task 9: renderCarousel + shell lifecycle + navigation

**Files:** `public/app-main.js`

- [ ] **Step 1: Implement the renderer**

Replace the `renderCarousel` stub:

```js
function renderCarousel() {
  const stage = document.getElementById('card-stage');
  const empty = document.getElementById('carousel-empty');
  const prevBtn = document.querySelector('.carousel-prev');
  const nextBtn = document.querySelector('.carousel-next');
  const dots = document.getElementById('carousel-dots');
  if (!stage) return;

  const items = carouselState.items;
  empty.hidden = items.length !== 0;
  prevBtn.hidden = carouselState.activeIndex <= 0;
  nextBtn.hidden = carouselState.activeIndex >= items.length - 1;

  // Dots
  dots.innerHTML = '';
  if (items.length > 1) {
    items.forEach((_, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'dot' + (i === carouselState.activeIndex ? ' is-active' : '');
      b.addEventListener('click', () => applyState(Carousel.setActive(carouselState, i)));
      dots.appendChild(b);
    });
  }

  // Render active shell only (peek rendering is future work)
  stage.innerHTML = '';
  const item = items[carouselState.activeIndex];
  if (!item) return;
  stage.appendChild(renderCardShell(item));
}

function renderCardShell(item) {
  const shell = document.createElement('article');
  shell.className = 'card-shell';
  shell.dataset.id = item.id;

  // Icon stack
  const icons = document.createElement('div');
  icons.className = 'shell-icons';
  if (item.sourceUrl) {
    const a = document.createElement('a');
    a.className = 'shell-icon';
    a.href = item.sourceUrl;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.title = 'View Source';
    a.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
    icons.appendChild(a);
  }
  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'shell-icon';
  copyBtn.title = 'Copy card';
  copyBtn.id = 'wb-copy';
  copyBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  icons.appendChild(copyBtn);

  const trash = document.createElement('button');
  trash.type = 'button';
  trash.className = 'shell-icon';
  trash.title = 'Delete card';
  trash.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>';
  trash.addEventListener('click', () => handleTrash(item.id));
  icons.appendChild(trash);
  shell.appendChild(icons);

  if (item.status === 'cutting') {
    shell.innerHTML += renderCuttingBody(item);
  } else if (item.status === 'error') {
    shell.innerHTML += renderErrorBody(item);
  } else {
    shell.appendChild(renderEditorBody(item));
  }
  return shell;
}

function renderCuttingBody(item) {
  const pct = Math.min(95, (item.phaseHistory.length / 5) * 100);
  const logLines = item.phaseHistory.slice(-5).map((p, i, arr) => {
    const cls = i === arr.length - 1 ? 'current' : '';
    return `<div class="${cls}">${i === arr.length - 1 ? '→' : '✓'} ${escapeHtml(p)}</div>`;
  }).join('');
  return `
    <div class="cut-progress"><div class="cut-progress-bar" style="width:${pct}%"></div></div>
    <div style="font:500 12px var(--font-display,system-ui);color:#6b7280;letter-spacing:0.04em;text-transform:uppercase;margin-bottom:16px">Cutting · stage ${item.phaseHistory.length} of 5</div>
    <div class="cut-log">${logLines}</div>
  `;
}

function renderErrorBody(item) {
  return `<div style="padding:24px 0;color:#b91c1c;font:500 14px var(--font-display,system-ui)">${escapeHtml(item.error || 'Cut failed')}</div>`;
}

function renderEditorBody(item) {
  // Reuses the existing data-field contenteditable sections. Mount shell containing tag/cite/body.
  const holder = document.createElement('div');
  holder.innerHTML = `
    <div class="tag" contenteditable="true" data-field="tag">${escapeHtml(item.tag || '')}</div>
    <div class="cite-block"><div class="meta" contenteditable="true" data-field="cite">${escapeHtml(item.cite || '')}</div></div>
    <div class="body" contenteditable="true" data-field="body">${item.body_html || '<p><br></p>'}</div>
  `;
  return holder;
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
```

- [ ] **Step 2: Wire arrow buttons + keyboard**

At the end of the init block, after `renderCarousel()`:

```js
document.querySelector('.carousel-prev').addEventListener('click', () => {
  applyState(Carousel.setActive(carouselState, carouselState.activeIndex - 1));
});
document.querySelector('.carousel-next').addEventListener('click', () => {
  applyState(Carousel.setActive(carouselState, carouselState.activeIndex + 1));
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  const ae = document.activeElement;
  if (!ae) return;
  const tag = ae.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || ae.isContentEditable) return;
  if (e.key === 'ArrowLeft')  applyState(Carousel.setActive(carouselState, carouselState.activeIndex - 1));
  if (e.key === 'ArrowRight') applyState(Carousel.setActive(carouselState, carouselState.activeIndex + 1));
});
```

- [ ] **Step 3: Initial render**

Call `renderCarousel()` after state is hydrated.

- [ ] **Step 4: Commit**

```
git add public/app-main.js
git commit -m "feat(app): renderCarousel + shell lifecycle + arrow/keyboard/dot nav"
```

---

## Task 10: syncActiveFromDom + editor handlers

**Files:** `public/app-main.js`

- [ ] **Step 1: Replace syncCardFromDom with syncActiveFromDom**

Find `syncCardFromDom()` (around line 770) and rewrite against the active carousel item:

```js
function syncActiveFromDom() {
  const shell = document.querySelector('.card-shell');
  if (!shell) return;
  const item = activeItem();
  if (!item) return;
  const tagEl = shell.querySelector('[data-field="tag"]');
  const citeEl = shell.querySelector('[data-field="cite"]');
  const bodyEl = shell.querySelector('[data-field="body"]');
  const patch = {};
  if (tagEl) patch.tag = tagEl.textContent.trim();
  if (citeEl) patch.cite = citeEl.textContent.trim();
  if (bodyEl) {
    patch.body_html = bodyEl.innerHTML;
    patch.body_plain = bodyEl.textContent;
  }
  applyState(Carousel.updateItem(carouselState, item.id, patch));
}
```

- [ ] **Step 2: Point every `syncCardFromDom()` call to `syncActiveFromDom()`**

Grep for `syncCardFromDom(` (search entire file). Replace each call. Leave the old function declaration only if still needed by legacy code paths; otherwise delete.

- [ ] **Step 3: Point the copy button + add-to + trash-all handlers at `activeItem()` instead of `state.currentCard`**

Search `public/app-main.js` for `state.currentCard` usages:

- Copy button (wired to `VerbaClipboard.buildCopyHtml` per earlier spec) — read from `activeItem()` directly.
- Add-to-project popover — operate on `activeItem()`.
- Trashcan in workbench — route to `handleTrash(activeItem()?.id)`.

Any remaining `state.currentCard` reads can be polyfilled once with a getter:

```js
Object.defineProperty(state, 'currentCard', {
  get() { return activeItem() || null; },
  configurable: true
});
```

- [ ] **Step 4: Add input event on active shell body to trigger sync**

After `renderCarousel()`, attach once via event delegation at document level:

```js
document.addEventListener('input', (e) => {
  if (e.target && e.target.closest && e.target.closest('.card-shell [data-field]')) {
    syncActiveFromDom();
    if (typeof normalizeUnderlineTags === 'function') normalizeUnderlineTags(e.target);
  }
});
```

- [ ] **Step 5: Commit**

```
git add public/app-main.js
git commit -m "feat(app): editor handlers bind to active carousel item"
```

---

## Task 11: startCut + SSE stream wired to carousel

**Files:** `public/app-main.js`

- [ ] **Step 1: Implement `startCut`**

Replace the stub `startCut` from Task 6 with:

```js
function startCut(input, opts = {}) {
  const id = (crypto.randomUUID && crypto.randomUUID()) || ('c_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8));
  const sourceUrl = /^https?:\/\//i.test(input) ? input : null;
  applyState(Carousel.pushItem(carouselState, {
    id, status: 'cutting', sourceUrl, createdAt: Date.now()
  }));
  const body = { input, length: currentLength(), density: 'standard' };
  const es = openCutStream(body, id);
}

function currentLength() {
  const active = document.querySelector('.length-opt.is-active');
  return active ? active.dataset.length : 'long';
}

function openCutStream(body, id) {
  // Existing project uses SSE — wire it to the same endpoint this file already used
  // before Task 6 rewrite. Check where createJob's fetch call lived; reuse endpoint URL.
  // Each phase event:
  //   applyState(Carousel.updateItem(carouselState, id, { phase: ev.label,
  //     phaseHistory: [...activeItem().phaseHistory.slice(-4), ev.label] }));
  // On done event:
  //   applyState(Carousel.updateItem(carouselState, id, {
  //     status: 'done', tag, cite, body_html, body_plain, body_markdown, phase: null }));
  // On error:
  //   applyState(Carousel.updateItem(carouselState, id, { status: 'error', error: msg, phase: null }));
  // Preserve the existing API.mine.save() call on success so library still gets the card.
}
```

IMPLEMENT `openCutStream` by copying the SSE handling that was inside the deleted `createJob` (see git log of Task 6's commit). Replace every `queues.find(...)` / `job.*` reference with `Carousel.updateItem(carouselState, id, …)` and update the UI via `applyState`. Keep the `API.mine.save(card)` call on the done event.

- [ ] **Step 2: Wire the Cut button**

```js
const cutInput = document.getElementById('cut-input');
const cutSubmit = document.getElementById('cut-submit');
function trySubmit() {
  const val = cutInput.value.trim();
  if (!val) return;
  cutInput.value = '';
  startCut(val);
}
cutSubmit.addEventListener('click', trySubmit);
cutInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); trySubmit(); } });
```

- [ ] **Step 3: Wire the segmented length selector**

```js
document.querySelectorAll('.length-opt').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.length-opt').forEach(b => { b.classList.remove('is-active'); b.setAttribute('aria-pressed', 'false'); });
    btn.classList.add('is-active');
    btn.setAttribute('aria-pressed', 'true');
  });
});
```

- [ ] **Step 4: Commit**

```
git add public/app-main.js
git commit -m "feat(app): startCut + SSE stream wired to carousel state"
```

---

## Task 12: Shell transition animation

**Files:** `public/app-main.js`

- [ ] **Step 1: Detect activeIndex change, animate**

Replace `renderCarousel()` swap logic so it uses a direction-aware transition:

```js
let lastActiveIndex = -1;
const originalRender = renderCarousel;
renderCarousel = function () {
  const stage = document.getElementById('card-stage');
  if (!stage) return originalRender();
  const prev = stage.querySelector('.card-shell');
  const nextIdx = carouselState.activeIndex;
  if (prev && lastActiveIndex !== nextIdx && carouselState.items.length > 0) {
    const dir = nextIdx < lastActiveIndex ? 'right' : 'left';
    prev.classList.add('leaving-' + dir);
    setTimeout(() => {
      originalRender();
      lastActiveIndex = nextIdx;
    }, 240);
    return;
  }
  originalRender();
  lastActiveIndex = nextIdx;
};
```

- [ ] **Step 2: Commit**

```
git add public/app-main.js
git commit -m "feat(app): direction-aware shell transition on activeIndex change"
```

---

## Task 13: Trash icon + undo toast

**Files:** `public/app-main.js`

- [ ] **Step 1: Implement `handleTrash`**

```js
function handleTrash(id) {
  const item = carouselState.items.find(i => i.id === id);
  if (!item) return;
  const prevIndex = carouselState.items.findIndex(i => i.id === id);
  applyState(Carousel.removeItem(carouselState, id));
  // also remove from library if previously saved
  if (item.id && window.API && API.mine && typeof API.mine.remove === 'function') {
    API.mine.remove(item.id).catch(() => {});
  }
  showUndoToast(item, prevIndex);
}

function showUndoToast(item, prevIndex) {
  if (typeof toast !== 'function') return;
  const t = toast('Card removed', { action: 'Undo', duration: 4000 });
  if (t && typeof t.onAction === 'function') {
    t.onAction(() => {
      const items = carouselState.items.slice();
      items.splice(Math.min(prevIndex, items.length), 0, item);
      applyState({ items, activeIndex: prevIndex });
    });
  }
}
```

Note: the existing `toast()` helper in the project may not support an action/duration/callback contract. Grep for `function toast(` in `public/app-main.js` first. If the helper is a simple message display, wrap it: render a small `<div class="toast-undo">` manually with an Undo button and a 4-second auto-remove. The reference DOM:

```js
function showUndoToast(item, prevIndex) {
  const el = document.createElement('div');
  el.className = 'toast-undo';
  el.innerHTML = 'Card removed <button>Undo</button>';
  el.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#0d0d12;color:#fff;padding:10px 16px;border-radius:10px;display:flex;gap:12px;align-items:center;z-index:9999;box-shadow:0 6px 20px rgba(0,0,0,0.25);font:500 13px var(--font-display,system-ui)';
  document.body.appendChild(el);
  const remove = () => el.remove();
  const t = setTimeout(remove, 4000);
  el.querySelector('button').addEventListener('click', () => {
    clearTimeout(t);
    const items = carouselState.items.slice();
    items.splice(Math.min(prevIndex, items.length), 0, item);
    applyState({ items, activeIndex: prevIndex });
    remove();
  });
}
```

- [ ] **Step 2: Commit**

```
git add public/app-main.js
git commit -m "feat(app): trash icon removes card + 4s undo toast"
```

---

## Task 14: PDF drop + input bar polish

**Files:** `public/app-main.js`

- [ ] **Step 1: Wire PDF drop on the pill input**

```js
const pill = document.querySelector('.cut-input-pill');
const inputEl = document.getElementById('cut-input');
pill.addEventListener('dragover', (e) => { e.preventDefault(); pill.classList.add('is-drop'); });
pill.addEventListener('dragleave', () => pill.classList.remove('is-drop'));
pill.addEventListener('drop', (e) => {
  e.preventDefault();
  pill.classList.remove('is-drop');
  const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (!file || !/\.pdf$/i.test(file.name)) return;
  // Reuse existing PDF upload helper; grep for "upload" or "pdf" in existing code.
  if (typeof uploadPdfAndCut === 'function') {
    uploadPdfAndCut(file);
  } else {
    // Fallback: pass filename through startCut so server can route it; stop-gap only.
    startCut('pdf://' + file.name);
  }
});
```

IMPORTANT: before committing, grep for existing PDF upload path in `public/app-main.js` and `server/routes/`. If `uploadPdfAndCut` doesn't exist, adapt to whatever function the pre-rework cut flow used for PDFs (it almost certainly exists — user lists PDF import as "must preserve"). Wire drop to call that function with `file`. If the old flow called a server endpoint directly, fetch → on response `startCut(extractedText)`.

Add CSS:
```css
.cut-input-pill.is-drop{box-shadow:0 0 0 3px rgba(59,124,255,0.25),inset 0 1px 2px rgba(0,0,0,0.03)}
```

- [ ] **Step 2: Commit**

```
git add public/app-main.js public/app.html
git commit -m "feat(app): PDF drop on input pill with drop indicator"
```

---

## Task 15: Library-side removal endpoint check

**Files:** none created; verification only.

- [ ] **Step 1: Verify `API.mine.remove(id)` exists**

Grep `public/app-main.js` + `server/routes/mine*.js` for `remove` / `DELETE /api/mine`. If no removal route exists, either:
- Add a minimal DELETE endpoint in `server/routes/mine.js` that removes a card by id + corresponding client `API.mine.remove = (id) => fetch(...)`.
- OR document in Task 13 that trash only removes from carousel, not library.

If you add the server route, create:
- Test: `test/mineRoutes.test.js` with a node-test verifying `DELETE /api/mine/:id` returns 204 and subsequent `GET` no longer includes that id.
- Implementation: route handler that deletes from SQLite `cards` table by id scoped to the authenticated user.

- [ ] **Step 2: Commit (only if code was added)**

```
git add server/routes/mine.js test/mineRoutes.test.js public/app-main.js
git commit -m "feat(api): DELETE /api/mine/:id for carousel trash"
```

---

## Task 16: Manual QA doc

**Files:** `public/lib/carousel.qa.md`

- [ ] **Step 1: Write file**

```markdown
# Cutter Carousel Manual QA

Run after any change to `public/lib/carousel.js`, cutter-strip, card-shell, or Cut flow.

## Setup
1. `npm run dev` → open `/app.html`, sign in.

## Empty state
- [ ] First load with cleared `localStorage` shows empty text; no arrows / dots.

## Cut → cutting-state → done transition
- [ ] Paste URL, click Cut → new card slot appears at end of carousel.
- [ ] Progress bar fills as phases arrive; log lines stream in dark monospace block.
- [ ] On done, log fades, content fades in inside same shell — no layout jump.

## Reload persistence
- [ ] Reload → same items, same active index.
- [ ] An item left `cutting` during reload converts to `error` with "interrupted" message.

## Navigation
- [ ] `‹` / `›` arrows move active; hidden at edges.
- [ ] `ArrowLeft` / `ArrowRight` keys move active when NOT inside contenteditable.
- [ ] Dot click jumps to that index; active dot is dark.

## Editor
- [ ] Typing in tag / cite / body of the active card triggers scheduleSave (check localStorage after 400ms).
- [ ] Copy button copies current card.

## Trash + undo
- [ ] Trash icon removes card immediately + server DELETE fires.
- [ ] 4s toast with Undo reinserts at prior position when clicked.
- [ ] Undo after toast auto-dismiss: no-op (expected).

## External link
- [ ] View Source icon opens `sourceUrl` in a new tab.
- [ ] Hidden when sourceUrl is null.

## Length selector
- [ ] S / M / L pills are a single-selected group; selection persists visually.

## PDF drop
- [ ] Drop a `.pdf` onto the input pill → triggers cut; drop indicator appears during hover.

## Soft cap
- [ ] With 50 done cards, cutting a 51st evicts `items[0]` (oldest done).
- [ ] Cutting card is never evicted.

## Mobile (≤768px)
- [ ] Carousel card is edge-to-edge; arrows smaller.
- [ ] Input pill wraps below length pills if needed.
```

- [ ] **Step 2: Commit**

```
git add public/lib/carousel.qa.md
git commit -m "docs(carousel): manual QA checklist"
```

---

## Task 17: End-to-end smoke + regression cleanup

**Files:** none modified; verification.

- [ ] **Step 1: Run automated suite**

```
npm test
```
Expected: all pass (carousel.test.js additions, no regressions in earlier tests).

- [ ] **Step 2: Smoke in browser**

Walk the QA checklist above top to bottom. File any deviations back as follow-up tasks with a failing test case attached.

- [ ] **Step 3: Grep for orphans**

```
grep -n "queues\|#staging\|stage-chip\|pane-source\|phase-log\|renderPhaseLog\|createJob\|source-handle\|source-close\|source-reopen" public/app-main.js public/app.html
```
Expected: zero matches.

- [ ] **Step 4: If any orphans found, delete, recommit, re-run `npm test`.**

- [ ] **Step 5: Final commit (only if cleanup happened)**

```
git add -u
git commit -m "chore(carousel): remove orphaned references to pre-rework code"
```

---

## Self-Review

**1. Spec coverage:**
- Architecture (state shape, mutation API) → Tasks 2, 3, 4, 8.
- Input bar with segmented length + pill input + circular send → Tasks 7, 11.
- Full-width card shell with bigger size → Task 7 (CSS).
- View-source icon in card corner → Task 9 (renderCardShell).
- Cutting-state body (progress bar + monospace log) → Task 9 (renderCuttingBody) + Task 11 (SSE updates).
- Done transition fades → CSS transition on `.card-shell` (Task 7) + direction-aware animation (Task 12).
- Keyboard + arrows + dots → Task 9.
- Trash + undo toast → Task 13.
- External-link icon opens URL in new tab → Task 9.
- localStorage persistence + soft-cap eviction + interrupt hydration → Task 4 (logic) + Task 8 (wiring) + Task 11 (save-on-update via applyState).
- PDF drop → Task 14.
- Empty state → Task 9.
- Tests → Tasks 2, 3, 4 (unit). Task 16 (manual QA). Task 17 (e2e smoke).

**2. Placeholder scan:** No TBDs. Task 11 points the implementer at the deleted SSE code (via git log of Task 6's commit) — this is an explicit "copy from the deleted commit" instruction, not a placeholder. Task 15 is conditional work (add DELETE endpoint only if it doesn't already exist); this is explicit, not vague.

**3. Type consistency:** `carouselState`, `activeItem()`, `applyState`, `Carousel.pushItem` / `updateItem` / `removeItem` / `setActive` / `clearAll` / `serialize` / `deserialize` / `hydrate` are consistent across tasks. `renderCardShell` / `renderCuttingBody` / `renderErrorBody` / `renderEditorBody` match across Tasks 9 and 12. `handleTrash` is defined in Task 13 and called in Task 9.
