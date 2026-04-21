# Evidence / Chat / Cutter Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix eight UX defects across the Evidence tab, chat slash-commands, loading indicator, card-cutter prompt quality, and mobile cutter toolbar.

**Architecture:** Frontend changes isolated to `public/app-main.js`, `public/app.html`, `public/assets/mobile.css`. Backend changes in `server/routes/library.js` (search fallback) and `server/prompts/cardCutter.js` (highlight rules). Chat UX rework keeps the display message separate from the prompt sent to the LLM (hidden-payload pattern on the client — server API shape unchanged).

**Tech Stack:** Vanilla JS frontend, Express backend, better-sqlite3 FTS, Anthropic SDK (Opus 4.7) for cutter + chat.

---

## File Structure

- Modify: [public/app-main.js](../../../public/app-main.js) — evidence list (virtual pagination + client search), slash-command Enter bug, hidden command payload, rotating loading lines variability.
- Modify: [public/app.html](../../../public/app.html) — add `#ev-load-more` sentinel, default shorter assistant responses via system prompt hint passed through API body (or kept client-side).
- Modify: [public/assets/mobile.css](../../../public/assets/mobile.css) — shrink/hide cutter `pane-foot-tools` buttons on ≤768px.
- Modify: [server/prompts/cardCutter.js](../../../server/prompts/cardCutter.js) — loosen "1–5 whole words" rule to allow sub-word highlights; add cohesive-subject rule; bias toward efficiency/brevity when preserving meaning.
- Modify: [server/routes/chat.js](../../../server/routes/chat.js) — honor optional `responseLength` hint ("short" → cap tokens, add system nudge).
- Create: [test/evidence-search.test.js](../../../test/evidence-search.test.js) — unit test that `getLibraryCards({ q })` returns matches for a known keyword.
- Create: [test/cardCutter-prompt.test.js](../../../test/cardCutter-prompt.test.js) — snapshot assertions on new prompt clauses.
- Create: [test/slash-enter.test.js](../../../test/slash-enter.test.js) — DOM test simulating typed text → Enter preserves text when command already selected.

---

## Task 1: Evidence client-side search filter

**Context:** `loadEvidence()` hits `/library/cards` with `q` but on empty DB result (or when semantic path throws) we return zero items, so UI prints "No cards match." We want: if user typed a query, always keyword-filter the already-loaded evidence list on the client as a fallback, so typed keywords never produce the empty state when a match exists in-memory.

**Files:**
- Modify: [public/app-main.js:1029-1069](../../../public/app-main.js#L1029-L1069)
- Create: [test/evidence-search.test.js](../../../test/evidence-search.test.js)

- [ ] **Step 1: Write the failing test**

```js
// test/evidence-search.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { filterEvidenceClient } = require('../public/app-main.search.js'); // extracted helper

test('filterEvidenceClient matches tag substring case-insensitive', () => {
  const cards = [
    { id: '1', tag: 'Nuclear deterrence fails', body_plain: '', cite: 'Smith 22' },
    { id: '2', tag: 'Econ DA turns',           body_plain: 'growth collapses', cite: 'Lee 21' },
  ];
  const out = filterEvidenceClient(cards, 'NUKE');
  assert.equal(out.length, 1);
  assert.equal(out[0].id, '1');
});

test('filterEvidenceClient matches body text', () => {
  const cards = [{ id: '1', tag: 't', body_plain: 'collapse warrants', cite: '' }];
  assert.equal(filterEvidenceClient(cards, 'warrant').length, 1);
});

test('filterEvidenceClient returns full list on empty query', () => {
  const cards = [{ id: '1' }, { id: '2' }];
  assert.equal(filterEvidenceClient(cards, '').length, 2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/evidence-search.test.js`
Expected: FAIL — module `public/app-main.search.js` not found.

- [ ] **Step 3: Extract the helper**

Create `public/app-main.search.js`:

```js
'use strict';
function filterEvidenceClient(cards, q) {
  const needle = String(q || '').trim().toLowerCase();
  if (!needle) return cards.slice();
  return cards.filter((c) => {
    const hay = [c.tag, c.cite, c.shortCite, c.body_plain, c.body_markdown, c.topic, c.topicLabel]
      .filter(Boolean).join(' ').toLowerCase();
    return hay.includes(needle);
  });
}
if (typeof module !== 'undefined') module.exports = { filterEvidenceClient };
if (typeof window !== 'undefined') window.__filterEvidenceClient = filterEvidenceClient;
```

Add `<script src="assets/app-main.search.js"></script>` — actually keep it inline. Instead, inline the helper at the top of `app-main.js` IIFE scope AND `module.exports` it via a small wrapper file that re-requires. Simpler: duplicate the function — the Node test file imports from the helper module; browser uses the IIFE copy.

Put the function at the top of `public/app-main.js` (inside the IIFE) verbatim. For the Node test, keep `public/app-main.search.js` as the single source of truth used by the test ONLY; the browser copy stays inline so it ships in the existing bundle.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/evidence-search.test.js`
Expected: PASS (3/3).

- [ ] **Step 5: Wire the helper into renderEvidence**

Edit `public/app-main.js`, replace the body of `renderEvidence()` (currently at lines 1061–1093):

```js
function renderEvidence() {
  const list = $('#ev-list'); if (!list) return;
  const nonLd = state.evidenceCards.filter((c) => !isGeneralLd(c));
  const filtered = filterEvidenceClient(nonLd, state.evSearch);
  $('#ev-count').textContent = String(filtered.length);
  if (!filtered.length) {
    list.innerHTML = state.evSearch
      ? `<div style="padding:24px;color:var(--muted);font-size:13px">No cards match "${esc(state.evSearch)}".</div>`
      : '<div style="padding:24px;color:var(--muted);font-size:13px">No cards in library yet.</div>';
    return;
  }
  state.evFiltered = filtered;
  const shown = filtered.slice(0, state.evShown || 50);
  list.innerHTML = shown.map((c, i) => evItemHTML(c, i === 0)).join('')
    + (filtered.length > shown.length ? `<div id="ev-sentinel" style="height:40px"></div>` : '');
  attachEvItemHandlers(list, filtered);
  maybeInstallEvIntersectionObserver();
}
```

Also add `filterEvidenceClient` copy at top of IIFE and declare `state.evShown = 50`, `state.evFiltered = []` in the initial `state` object on line 235.

- [ ] **Step 6: Change the input handler to skip server round-trip for text search**

Replace [public/app-main.js:1165-1169](../../../public/app-main.js#L1165-L1169):

```js
$('#ev-search')?.addEventListener('input', (e) => {
  state.evSearch = e.target.value.trim();
  state.evShown = 50;
  renderEvidence(); // client-only filter on the already-loaded list
});
```

- [ ] **Step 7: Manual verification**

Run the server (`npm run dev`), open `/app`, go to Evidence tab, type a keyword that appears in any loaded card tag — matching cards appear; empty query shows all.

- [ ] **Step 8: Commit**

```bash
git add public/app-main.js public/app-main.search.js test/evidence-search.test.js
git commit -m "fix(evidence): client-side search fallback + extract helper for test"
```

---

## Task 2: Evidence virtualized "show 50, load more on scroll"

**Context:** `/library/cards` currently fetches `limit:60`. We want initial payload randomized and capped at 50, then page 2+ loaded automatically as the user scrolls near the bottom. "Randomized" = server-side `ORDER BY random()` path when no explicit sort/query.

**Files:**
- Modify: [server/services/libraryQuery.js:23-52](../../../server/services/libraryQuery.js#L23-L52)
- Modify: [public/app-main.js:1029-1044](../../../public/app-main.js#L1029-L1044)

- [ ] **Step 1: Write the failing test**

Append to `test/evidence-search.test.js`:

```js
const { getLibraryCards } = require('../server/services/libraryQuery');
test('getLibraryCards sort=random returns ≤ limit items', async () => {
  const out = await getLibraryCards({ limit: 50, sort: 'random' });
  assert.ok(Array.isArray(out.items));
  assert.ok(out.items.length <= 50);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/evidence-search.test.js`
Expected: FAIL — `sort:'random'` is not recognized, falls through to relevance (may still pass the length check, but add a separate assertion that two consecutive calls return different first-ids to verify randomness):

```js
test('getLibraryCards sort=random randomizes between calls', async () => {
  const a = await getLibraryCards({ limit: 50, sort: 'random' });
  const b = await getLibraryCards({ limit: 50, sort: 'random' });
  assert.notEqual(a.items[0]?.id, b.items[0]?.id);
});
```

Expected: FAIL on randomness assertion.

- [ ] **Step 3: Implement `sort:'random'` branch**

Edit `server/services/libraryQuery.js` inside `getLibraryCards`, add before the existing `wantSemantic` branch:

```js
if (filters.sort === 'random' && !filters.q) {
  const rows = db.queryCards({ filters: { ...filters, sort: 'random' }, sort: 'random', page, limit, lite: true }).rows;
  return { total: rows.length, page, limit, items: rows.map(hydrateRow), filters: getCachedFacets(), meta: loadMeta() };
}
```

Then edit `server/services/db.js` `queryCards` (not shown above — find the ORDER BY block) to branch: when `sort === 'random'`, use `ORDER BY random()`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/evidence-search.test.js`
Expected: PASS.

- [ ] **Step 5: Client change — page 1 uses random, page 2+ re-uses same random seed**

Because `random()` in SQLite is non-deterministic across calls we need a seed. Switch to a deterministic pseudo-random: `ORDER BY ((id * 2654435761) % 1000000)` where the multiplier comes from `filters.randomSeed` (a number the client sends and re-uses). Client picks one seed per session. Update `db.queryCards` accordingly.

Update `public/app-main.js` `loadEvidence` and add `loadMoreEvidence`:

```js
async function loadEvidence() {
  const list = $('#ev-list'); if (!list) return;
  list.innerHTML = '<div style="padding:24px;color:var(--muted);font-size:13px">Loading library…</div>';
  state.evPage = 1;
  state.evSeed = state.evSeed || Math.floor(Math.random() * 1e9);
  try {
    const data = await API.libraryCards({ limit: 50, page: 1, sort: 'random', seed: state.evSeed });
    state.evidenceCards = data.items || [];
    state.evidenceTotal = data.total || 0;
    state.evShown = 50;
    renderEvidence();
    if (state.evidenceCards[0]) renderEvidenceDetail(state.evidenceCards[0]);
  } catch (err) {
    list.innerHTML = `<div style="padding:24px;color:#c33;font-size:13px">Error: ${esc(err.message)}</div>`;
  }
}
async function loadMoreEvidence() {
  if (state.evLoading) return;
  state.evLoading = true;
  try {
    const next = state.evPage + 1;
    const data = await API.libraryCards({ limit: 50, page: next, sort: 'random', seed: state.evSeed });
    const fresh = (data.items || []).filter(c => !state.evidenceCards.some(x => x.id === c.id));
    if (!fresh.length) { state.evDone = true; return; }
    state.evidenceCards.push(...fresh);
    state.evPage = next;
    state.evShown += fresh.length;
    renderEvidence();
  } finally { state.evLoading = false; }
}
function maybeInstallEvIntersectionObserver() {
  const sentinel = document.getElementById('ev-sentinel');
  if (!sentinel) return;
  if (state.evObserver) state.evObserver.disconnect();
  state.evObserver = new IntersectionObserver((entries) => {
    if (entries.some(e => e.isIntersecting)) loadMoreEvidence();
  }, { root: $('#ev-list'), rootMargin: '200px' });
  state.evObserver.observe(sentinel);
}
```

- [ ] **Step 6: Manual verification**

Open Evidence tab → 50 cards shown, card order differs between reloads, scrolling near bottom auto-loads more until server returns none.

- [ ] **Step 7: Commit**

```bash
git add server/services/libraryQuery.js server/services/db.js public/app-main.js test/evidence-search.test.js
git commit -m "feat(evidence): randomized paging, 50 initial + infinite scroll"
```

---

## Task 3: Slash-command Enter no longer deletes typed arg

**Context:** In [app-main.js:1896-1905](../../../public/app-main.js#L1896-L1905), when the slash popup is open, Enter calls `selectSlash(slashSel)` which overwrites `input.value` with `c.cmd + ' '`, discarding the user's typed argument. Fix: after the command has been fully typed (user typed a space, or the exact command text matches `c.cmd`), close the popup and let Enter submit normally.

**Files:**
- Modify: [public/app-main.js:1808-1842](../../../public/app-main.js#L1808-L1842)
- Modify: [public/app-main.js:1896-1905](../../../public/app-main.js#L1896-L1905)

- [ ] **Step 1: Write the failing test**

Create `test/slash-enter.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { shouldKeepSlashOpen } = require('../public/slash-helpers.js');

test('popup closes once the command is fully typed + space', () => {
  assert.equal(shouldKeepSlashOpen('/block ', ['/block', '/blockade']), false);
});
test('popup stays open while typing a prefix', () => {
  assert.equal(shouldKeepSlashOpen('/bl', ['/block']), true);
});
test('popup closes once an exact command is typed (no space yet, no further matches)', () => {
  assert.equal(shouldKeepSlashOpen('/clear', ['/clear']), false);
});
```

- [ ] **Step 2: Run to verify FAIL**

Run: `node --test test/slash-enter.test.js`
Expected: FAIL — `public/slash-helpers.js` missing.

- [ ] **Step 3: Implement helper**

Create `public/slash-helpers.js`:

```js
'use strict';
function shouldKeepSlashOpen(inputValue, matchedCmds) {
  const v = String(inputValue || '');
  if (!v.startsWith('/')) return false;
  if (!matchedCmds || !matchedCmds.length) return false;
  const firstWord = v.split(' ')[0];
  if (v.includes(' ')) return false;
  if (matchedCmds.length === 1 && matchedCmds[0] === firstWord) return false;
  return true;
}
if (typeof module !== 'undefined') module.exports = { shouldKeepSlashOpen };
if (typeof window !== 'undefined') window.__shouldKeepSlashOpen = shouldKeepSlashOpen;
```

- [ ] **Step 4: Run to verify PASS**

Run: `node --test test/slash-enter.test.js`
Expected: PASS (3/3).

- [ ] **Step 5: Use helper in refreshSlashPop**

In `public/app-main.js`, inline the same helper (copy/paste) and change `refreshSlashPop`:

```js
function refreshSlashPop() {
  if (!slashPop) return;
  const v = input.value || '';
  const first = v.slice(1).split(' ')[0].toLowerCase();
  const matches = COMMANDS.filter(c => c.cmd.slice(1).startsWith(first));
  const matchCmds = matches.map(m => m.cmd);
  if (!shouldKeepSlashOpen(v, matchCmds)) { slashPop.classList.remove('open'); return; }
  slashSel = Math.min(slashSel, matches.length - 1);
  slashPop.innerHTML = matches.map((c, i) =>
    `<div class="ap-slash-row${i === slashSel ? ' sel' : ''}" data-i="${i}"><span class="cmd">${esc(c.cmd)}</span><span>${esc(c.desc)}</span>${c.arg ? `<span class="desc">${esc(c.arg)}</span>` : ''}</div>`).join('');
  slashPop._matches = matches;
  slashPop.classList.add('open');
  slashPop.querySelectorAll('.ap-slash-row').forEach((row, i) => {
    row.addEventListener('mouseenter', () => { slashSel = i; refreshSlashHighlight(); });
    row.addEventListener('click', () => selectSlash(i));
  });
}
```

- [ ] **Step 6: Manual verification**

Type `/block crime is bad`, press Enter — chat sends `/block crime is bad` (the argument is preserved). Type `/bl`, press Enter — popup picks `/block `. Both cases work.

- [ ] **Step 7: Commit**

```bash
git add public/app-main.js public/slash-helpers.js test/slash-enter.test.js
git commit -m "fix(chat): slash popup closes once command fully typed so Enter keeps arg"
```

---

## Task 4: Hidden command payload (display ≠ send)

**Context:** `runCommand` for `/block` and `/explain` overwrites `input.value` with a long English prompt, then calls `doSend()` which appends that long text as the user's visible message. User wants the chat bubble to show what they typed (`/block crime is bad`) while the LLM receives the expanded instructions invisibly.

**Files:**
- Modify: [public/app-main.js:1770-1792](../../../public/app-main.js#L1770-L1792) (`runCommand`)
- Modify: [public/app-main.js:1866-1894](../../../public/app-main.js#L1866-L1894) (`doSend`)
- Modify: [public/api.js](../../../public/api.js) if chat API shape changes (probably not needed — we build the full prompt client-side into the `messages` array but separately track the display string).

- [ ] **Step 1: Refactor `runCommand` to return { display, send }**

```js
function expandCommand(name, arg) {
  arg = (arg || '').trim();
  switch (name) {
    case '/clear':   return { action: 'clear' };
    case '/find':    return { action: 'find', arg };
    case '/block':   return {
      action: 'send',
      display: `/block ${arg}`.trim(),
      send: `Write a block on: ${arg}. Use cards only if they actually help; otherwise give analytics, warrants, and framing. Choose the number of cards based on what's useful — not a fixed count.`,
    };
    case '/explain': return {
      action: 'send',
      display: `/explain ${arg}`.trim(),
      send: `Explain: ${arg}. State warrants, impact, and a response to the most likely answer.`,
    };
  }
  return null;
}
```

- [ ] **Step 2: Thread display/send through doSend**

```js
async function doSend(opts = {}) {
  const typed = (input.value || '').trim();
  let display = opts.display ?? typed;
  let send    = opts.send    ?? typed;
  if (!send) return;
  // Slash handling
  if (typed.startsWith('/') && !opts.send) {
    const sp = typed.indexOf(' ');
    const name = (sp === -1 ? typed : typed.slice(0, sp)).toLowerCase();
    const arg  = sp === -1 ? '' : typed.slice(sp + 1);
    const cmd = expandCommand(name, arg);
    if (cmd) {
      if (cmd.action === 'clear')  { convo.length = 0; lastChatCards.clear(); msgs.innerHTML = ''; renderEmpty(); input.value = ''; autosize(); return; }
      if (cmd.action === 'find')   { /* existing find behavior */ input.value = ''; autosize(); return; }
      if (cmd.action === 'send')   { display = cmd.display; send = cmd.send; }
    }
  }
  input.value = ''; autosize();
  convo.push({ role: 'user', content: send });   // what the LLM sees
  appendUser(display);                            // what the user sees
  const thinking = showThinking();
  try {
    const r = await API.chat({ messages: convo });
    thinking.stop();
    refreshUsage();
    const reply = r.reply || r.message || r.content || '';
    if (Array.isArray(r.cards)) { lastChatCards.clear(); r.cards.forEach(c => { if (c?.id) lastChatCards.set(c.id, c); }); }
    convo.push({ role: 'assistant', content: reply });
    renderBot(reply);
  } catch (err) {
    thinking.stop();
    if (handleLimitError(err)) return;
    const el = document.createElement('div'); el.className = 'ap-msg bot'; el.style.color = 'var(--danger)'; el.textContent = 'Error: ' + err.message; msgs.appendChild(el);
  }
}
```

- [ ] **Step 3: Remove the old `runCommand` + `handleSlashSubmit` now-dead branches**

Delete [public/app-main.js:1770-1805](../../../public/app-main.js#L1770-L1805). Replace the Enter handler's call path to only use `doSend()`.

- [ ] **Step 4: Manual verification**

Type `/block crime is bad`, Enter. Chat shows `/block crime is bad`; response is a full block. Inspect network request to `/api/chat`: the last user message in the array is the expanded prompt.

- [ ] **Step 5: Commit**

```bash
git add public/app-main.js
git commit -m "feat(chat): slash commands send hidden expanded prompt, display user's shorthand"
```

---

## Task 5: Shorter chat responses by default

**Context:** User wants brief answers unless they ask for more. Current `server/routes/chat.js` sets `maxTokens: 1500`.

**Files:**
- Modify: [server/routes/chat.js:14-51](../../../server/routes/chat.js#L14-L51)
- Modify: [server/routes/chat.js:97-105](../../../server/routes/chat.js#L97-L105)

- [ ] **Step 1: Add brevity to SYSTEM_PROMPT**

Append to `SYSTEM_PROMPT`:

```
LENGTH DEFAULT — STRICT:
- Default to ≤4 short sentences. Do NOT pad with restatement, setup, or summary.
- Only exceed 4 sentences when the user explicitly asks for: a block, frontline, overview, long explanation, full case, or multiple labeled responses (Turn./Perm./etc — those require the labeled-paragraph format above).
- If the user asked "what", "why", "explain briefly", answer in 1–3 sentences. Stop.
```

- [ ] **Step 2: Lower default maxTokens, raise on block intent**

```js
const isBlock = BLOCK_INTENT.test(lastUserMsg);
const result = await complete({
  messages: [{ role: 'system', content: systemContent }, ...messages.slice(-20)],
  temperature: 0.4,
  maxTokens: isBlock ? 1500 : 450,
  forceModel: process.env.CHAT_MODEL || 'anthropic/claude-opus-4-7',
});
```

- [ ] **Step 3: Manual verification**

Ask "what is uniqueness in a DA?" — reply ≤4 sentences. Ask "write a block against moral skepticism" — full labeled block still returned.

- [ ] **Step 4: Commit**

```bash
git add server/routes/chat.js
git commit -m "feat(chat): short-response default, full length only for blocks/overviews"
```

---

## Task 6: Variability in loading/thinking lines

**Context:** `THINK_LINES` cycles linearly through 6 strings. User wants more lines and randomized order.

**Files:**
- Modify: [public/app-main.js:1732-1760](../../../public/app-main.js#L1732-L1760)

- [ ] **Step 1: Expand list + pick randomly each tick**

```js
const THINK_LINES = [
  'reading your question…',
  'framing the argument…',
  'checking response labels…',
  'picking warrants…',
  'checking library for backfile…',
  'drafting block…',
  'weighing turn vs. non-unique…',
  'pulling impact calc…',
  'checking link chain…',
  'scanning 2NR-viable cards…',
  'testing uniqueness…',
  'lining up author quals…',
  'matching stance to tag…',
  'comparing warrants side-by-side…',
  'tightening the underline…',
];
function showThinking() {
  const el = document.createElement('div');
  el.className = 'ap-think';
  el.innerHTML = '<span class="ap-think-dot"></span><span class="ap-think-line"></span>';
  msgs.appendChild(el);
  msgs.scrollTop = msgs.scrollHeight;
  const line = el.querySelector('.ap-think-line');
  let last = -1;
  function pick() {
    let i; do { i = Math.floor(Math.random() * THINK_LINES.length); } while (i === last && THINK_LINES.length > 1);
    last = i; return THINK_LINES[i];
  }
  line.textContent = pick();
  const iv = setInterval(() => {
    line.classList.add('fade-out');
    setTimeout(() => {
      line.textContent = pick();
      line.classList.remove('fade-out');
      line.classList.add('fade-in');
      setTimeout(() => line.classList.remove('fade-in'), 360);
    }, 320);
  }, 1600 + Math.random() * 900); // 1.6–2.5s variable cadence
  return { el, stop: () => { clearInterval(iv); el.remove(); } };
}
```

- [ ] **Step 2: Manual verification**

Ask 3 different questions — loading lines appear in different order each time, with variable cadence.

- [ ] **Step 3: Commit**

```bash
git add public/app-main.js
git commit -m "feat(chat): randomized thinking lines + variable cadence"
```

---

## Task 7: Better card highlighting — cohesive arguments, sub-word cuts

**Context:** User: highlights should form a coherent argument with a subject (e.g. "nukes cause extinction" not bare "extinction"). Sub-word highlights allowed ("nuc" for "nuclear", "U S" for "United States") for efficiency. Rewrite the HIGHLIGHT IS SURGICAL section of the system prompt.

**Files:**
- Modify: [server/prompts/cardCutter.js:34-46](../../../server/prompts/cardCutter.js#L34-L46)
- Create: [test/cardCutter-prompt.test.js](../../../test/cardCutter-prompt.test.js)

- [ ] **Step 1: Write the failing test**

```js
// test/cardCutter-prompt.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { SYSTEM_PROMPT } = require('../server/prompts/cardCutter');

test('prompt demands cohesive subject+verb+object in stitched highlights', () => {
  assert.match(SYSTEM_PROMPT, /subject/i);
  assert.match(SYSTEM_PROMPT, /coherent/i);
});
test('prompt allows partial-word highlights', () => {
  assert.match(SYSTEM_PROMPT, /partial[- ]word|sub[- ]word|inside a word|mid[- ]word/i);
});
test('prompt rule still preserves paragraph integrity', () => {
  assert.match(SYSTEM_PROMPT, /PARAGRAPH INTEGRITY/);
});
```

- [ ] **Step 2: Run test FAIL**

Run: `node --test test/cardCutter-prompt.test.js`
Expected: FAIL on partial-word and cohesive-subject checks.

- [ ] **Step 3: Rewrite the highlight section**

Replace lines 34–46 of `server/prompts/cardCutter.js` with:

```js
HIGHLIGHT IS SURGICAL, COHERENT, AND EFFICIENT — STRICT
- ${d.highlightRule}. Fewer is better.
- Each run is 1–5 consecutive characters OR words. You MAY cut in the middle of a word when doing so preserves meaning and saves reading time (e.g. highlight "nuc" inside "nuclear", "U" and "S" inside "United States", "econ" inside "economy"). Only cut mid-word when the shortened form is still unambiguous in context.
- ${d.unhighlightedRule} of the words in each paragraph remain UNHIGHLIGHTED.
- Runs are non-contiguous; leave unhighlighted words/chars between them.
- EVERY HIGHLIGHT RUN MUST CARRY PURPOSE: a new actor, causal verb, mechanism, magnitude, timeframe, or impact.
- COHESIVE ARGUMENT — HARD RULE: Stitched together in reading order, the highlighted fragments must form a SELF-CONTAINED argument with an explicit subject, a verb, and an object/impact. A judge reading ONLY the highlights must understand WHO does WHAT with WHAT effect. Never highlight just an impact ("extinction") without its subject ("nuc war causes extinction"). Never highlight just modifiers or bullet-fragment noun phrases. Prefer "U S econ collapse triggers war" over "collapse … war".
- Skip connectives between runs: the, a, an, of, and, or, but, that, which, to, in, on, for, because, however, although, moreover, additionally — UNLESS dropping one breaks the subject-verb-object chain.
- PRIORITIZE EFFICIENCY: pick the shortest contiguous span (including mid-word cuts) that still carries the warrant. If a 3-char cut works, do not use 5.
```

- [ ] **Step 4: Run test PASS**

Run: `node --test test/cardCutter-prompt.test.js`
Expected: PASS (3/3).

- [ ] **Step 5: Smoke-test a live cut**

Run the server, cut a source paragraph about nuclear war — expect highlights like `nuc war`, `trig extinction` rather than bare noun phrases, and the stitched highlights read as a sentence with a subject.

- [ ] **Step 6: Commit**

```bash
git add server/prompts/cardCutter.js test/cardCutter-prompt.test.js
git commit -m "feat(cutter): cohesive subject-verb-object highlights, allow mid-word cuts"
```

---

## Task 8: Mobile cutter toolbar — shrink or hide the 3 tool buttons

**Context:** `#wb-foot-tools` holds 3 `.tool-btn.icon-only` buttons (highlight, underline, bold). Desktop CSS makes them 32x28; `mobile.css` min-height:44 rule doesn't match (`.tool-btn` not in the selector list), but user reports them as "huge". Best theory: `@media (max-width:768px) { button { font-size:16px !important } }` from mobile.css inflates padding via line-height. Fix: explicit mobile rule to cap `.pane-foot-tools .tool-btn.icon-only` at 28×28 with 12px svg, OR hide the toolbar on mobile since mobile users rarely hand-highlight.

Decision: keep visible, make tiny. If visual check still shows them oversized, fall back to hide.

**Files:**
- Modify: [public/assets/mobile.css:19-21](../../../public/assets/mobile.css#L19-L21)

- [ ] **Step 1: Add mobile rule**

Append to `public/assets/mobile.css`:

```css
/* Cutter inline formatting toolbar — force tiny on mobile (overrides the 16px button rule) */
@media (max-width:768px){
  .pane-foot-tools .tool-btn.icon-only{
    width:28px !important;
    height:28px !important;
    min-height:28px !important;
    padding:0 !important;
    font-size:0 !important;
  }
  .pane-foot-tools .tool-btn.icon-only svg{width:12px !important;height:12px !important}
  #wb-foot-tools{gap:6px;padding:4px 8px}
}
```

- [ ] **Step 2: Manual verification on mobile viewport**

Open DevTools mobile emulation (iPhone 14 Pro, 393x852), Evidence tab → cutter → the three icon buttons fit inline and look proportional (≈28px tall).

- [ ] **Step 3: If still too large, hide instead**

Swap the rule to:

```css
@media (max-width:768px){
  #wb-foot-tools{display:none}
}
```

- [ ] **Step 4: Commit**

```bash
git add public/assets/mobile.css
git commit -m "fix(mobile): shrink cutter formatting toolbar so buttons aren't huge"
```

---

## Self-Review Checklist

**Spec coverage:**
- Evidence speed / 50-first / load more → Task 2 ✅
- Keyword search "no cards match" bug → Task 1 ✅
- Assistant cards missing / unhighlighted → partially addressed by Task 7 (better prompt) + Task 5 (shorter replies still include cards). Note: card extraction itself is unchanged; if cards still missing in replies after Task 5/7, follow-up plan needed.
- Shorter responses default → Task 5 ✅
- Slash Enter deletes text → Task 3 ✅
- Hide expanded prompt from displayed message → Task 4 ✅
- Variability in loading lines → Task 6 ✅
- Better cuts (cohesive subject, sub-word) → Task 7 ✅
- Mobile cutter icon → Task 8 ✅

**Placeholder scan:** No TODOs. All steps have concrete code. `db.queryCards` random-sort edit in Task 2 Step 3 references internal code not shown — the implementing engineer must open `server/services/db.js`, locate the ORDER BY in `queryCards`, and add the `sort === 'random'` branch with seed support.

**Type consistency:** `state.evSeed`, `state.evPage`, `state.evShown`, `state.evFiltered`, `state.evLoading`, `state.evDone`, `state.evObserver` all declared consistently. `filterEvidenceClient`, `shouldKeepSlashOpen`, `expandCommand` names stable across tasks.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-20-evidence-chat-cutter-fixes.md`. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
