# Cutter quality, copy fidelity, evidence pagination, UI overhaul

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Close every known quality gap in one pass: cutter still bullets + too short, recut-on-finish bug, copy-button formatting breaks, evidence tab paginates only 270 of 50k, UI polish (profile dropdown, pricing animation, shortcut cleanup, source-terminal, saved button, buttons micro-animations, global search), file upload as persistent chip.

**Architecture:**
- Vanilla-JS IIFE frontend (no React/Tailwind — port Material-UI dropdown to `<dialog>` + CSS clip-path + JS ripple).
- Cutter prompt + validator stays server-side; bump length budget, strengthen cohesive-argument few-shot, fix recut loop in streaming handler.
- Evidence: server-side pagination (20/page) + background prefetch of lightweight `{id, tag, cite}` meta into IndexedDB for instant client search over 50k.
- Copy pipeline: fix `markdownCardToHtml` → `inlineStyleBody` ordering so `<mark>` inside `<u>` preserves both styles; harden `extractAuthorYearPrefix` for more cite shapes.
- Chips persisted via localStorage (last 5).

**Tech Stack:** Node 20, Express, SQLite+FTS5, Anthropic SDK; vanilla JS, vanilla CSS, IndexedDB via idb-keyval-free inline helper.

---

### Task 1: Repro & fix cut-then-recut bug

**Files:**
- Modify: `public/app-main.js` (search for `streamCut`, `onCutDone`, `renderCardInPane`)
- Test: `test/cut-stream-no-duplicate.test.js`

- [ ] **Step 1:** Reproduce by cutting once, watch console — find which function fires twice.
- [ ] **Step 2:** Write failing test that counts invocations of the final `renderCardInPane` callback per cut.
- [ ] **Step 3:** Debounce: add `state.cutJobId` guard so only the matching completion commits to DOM.
- [ ] **Step 4:** Run test, commit.

---

### Task 2: Stronger cohesive-highlight prompt + few-shots

**Files:**
- Modify: `server/prompts/cardCutter.js`
- Test: `test/cardCutter-prompt.test.js` (extend)

- [ ] **Step 1:** RED — add test asserting prompt contains BAD-vs-GOOD example of bulleted-impacts vs subject+verb+object.
- [ ] **Step 2:** Add BAD example "*nuclear war* / *extinction* / *no recovery*" → GOOD "*nuclear war* *causes* *extinction*" as a third example block.
- [ ] **Step 3:** Add explicit rule: "If stitched highlights read as a list of noun phrases, REJECT and re-cut with an explicit verb."
- [ ] **Step 4:** Commit.

---

### Task 3: Raise long-length word budget + model output tokens

**Files:**
- Modify: `server/prompts/cardCutter.js` `LENGTH_PRESETS.long`
- Modify: `server/routes/ai.js` `LENGTH_BUDGETS.long.output`

- [ ] **Step 1:** Bump long from 760 → 1100 words, 5-8 → 6-10 paragraphs.
- [ ] **Step 2:** Bump output budget 5600 → 8000 tokens.
- [ ] **Step 3:** Commit.

---

### Task 4: Copy pipeline — preserve highlight-inside-underline

**Files:**
- Modify: `public/app-main.js` `inlineStyleBody` (must emit nested inline styles, not replace `<u>` with span that loses the `<mark>` inside)
- Modify: `public/lib/copyExport.js` `ensureHighlightStyle` → also add `text-decoration:underline` when mark sits inside `<u>`
- Test: `test/copy-export-nested.test.js`

- [ ] **Step 1:** RED — test that `<u>foo <mark>bar</mark> baz</u>` round-trips to HTML where `bar` has both `background:yellow` AND `text-decoration:underline`.
- [ ] **Step 2:** Rewrite `inlineStyleBody` as a walk (not regex `replace`) so nested tags produce nested spans with merged styles.
- [ ] **Step 3:** GREEN + 85 existing still pass. Commit.

---

### Task 5: Harden cite author-year extraction

**Files:**
- Modify: `public/lib/copyExport.js` `extractAuthorYearPrefix`
- Test: `test/copy-author-year.test.js`

- [ ] **Step 1:** RED — add cases for "O'Brien '24", "van der Berg 2023", "Smith & Jones '19", "Chen et al. 2022".
- [ ] **Step 2:** Loosen regex to handle lowercase particles (`van`, `der`, `de`, `la`), apostrophes, `&`.
- [ ] **Step 3:** Commit.

---

### Task 6: Evidence tab paginates 50k

**Files:**
- Modify: `server/routes/library.js` (already has page/limit; verify no 270 cap)
- Modify: `public/app-main.js` `loadEvidence` — add page buttons (20/page) + prev/next
- Modify: `server/services/db.js` — ensure `getLibraryCards` returns total count
- Test: `test/library-pagination-total.test.js`

- [ ] **Step 1:** RED — test `getLibraryCards({limit:20, page:3})` returns items AND `total` count.
- [ ] **Step 2:** Add `SELECT COUNT(*) OVER() AS total` or separate count query. Expose in response.
- [ ] **Step 3:** Client: render numeric page pills; default 20/page; keep existing random seed.
- [ ] **Step 4:** Commit.

---

### Task 7: Background prefetch full meta to IndexedDB

**Files:**
- Create: `public/lib/evidenceIndex.js` (IndexedDB `evidence-meta` store of `{id, tag, cite, topic}`)
- Create: `server/routes/libraryMeta.js` — `GET /api/library/meta` returns `{id, tag, cite, topic}[]` for user's entire library
- Modify: `server/index.js` — mount route
- Modify: `public/app-main.js` — on evidence tab open, kick prefetch; client search hits IDB first, falls back to server
- Test: `test/library-meta-endpoint.test.js`

- [ ] **Step 1:** RED — endpoint returns all ids for logged-in user, no body text.
- [ ] **Step 2:** Add route, stream JSON.
- [ ] **Step 3:** Client: `evidenceIndex.prefetch()` writes to IDB chunked; `evidenceIndex.search(q)` filters in-memory.
- [ ] **Step 4:** Wire into `renderEvidence` search box.
- [ ] **Step 5:** Commit.

---

### Task 8: Evidence + My Cards — icon-only copy button, drop export

**Files:**
- Modify: `public/app-main.js` `evItemHTML` — keep copy icon, drop "Copy" label already icon-only.
- Modify: `public/app-main.js` mycard row — replace `.export-btn` handler with copy logic (same as ev).
- Modify: `public/app.html` — mycard toolbar swap svg + `data-act`.
- Test: extend `test/copy-export-nested.test.js` to cover item-level handler payload.

- [ ] **Step 1:** RED — test click on mycard copy button places HTML on clipboard stub.
- [ ] **Step 2:** Extract copy logic into `copyCardToClipboard(card)` helper in `app-main.js`.
- [ ] **Step 3:** Reuse in ev, mycard, workbench.
- [ ] **Step 4:** Commit.

---

### Task 9: File upload → single chip, deletes on send, persists last 5

**Files:**
- Modify: `public/app-main.js` — source chip logic
- Create: `public/lib/chipHistory.js` — `save(chip)`, `recent()` via localStorage
- Test: `test/chip-history.test.js`

- [ ] **Step 1:** RED — save 7 chips, `recent()` returns last 5 in MRU order.
- [ ] **Step 2:** Implement.
- [ ] **Step 3:** Wire: file picker replaces current chip; on send, clear active chip + push to history.
- [ ] **Step 4:** Remove standalone upload pdf/text button from UI.
- [ ] **Step 5:** Commit.

---

### Task 10: Port Material-UI dropdown to vanilla for profile menu

**Files:**
- Create: `public/lib/m3-menu.js` — `createMenu({trigger, pages, items})` returns controller with open/close
- Create: `public/assets/m3-menu.css` — sweep-down clip-path, stagger, ripple
- Modify: `public/app.html` — replace profile dropdown markup + open handler
- Test: `test/m3-menu.test.js` (JSDOM)

- [ ] **Step 1:** RED — open menu, assert `data-state="open"` on content + first item gets `m3-item-enter`.
- [ ] **Step 2:** Implement keyframes (sweep-down/up/left/right + m3-item-cinematic) matching provided React code.
- [ ] **Step 3:** JS ripple on trigger + items; click-outside + Escape closes with sweep-out.
- [ ] **Step 4:** Wire profile button.
- [ ] **Step 5:** Commit.

---

### Task 11: Pricing page + monthly/yearly toggle animation

**Files:**
- Modify: `public/app.html` pricing modal block + CSS
- Test: manual (document steps)

- [ ] **Step 1:** Wrap `.pay-tier-row` in a flex stage; cross-fade + 120ms translate on toggle.
- [ ] **Step 2:** Price number: use `FLIP` technique (measure old, swap text, animate from delta).
- [ ] **Step 3:** Commit.

---

### Task 12: Global search cleanup

**Files:**
- Modify: `public/app.html` — drop old side-search; recolor command icons `currentColor` only
- Modify: `public/app-main.js` — Escape closes overlay (already there? verify), delete dead `cmd-trigger` if unused
- Test: manual

- [ ] **Step 1:** Grep for all `.side-search` + `#cmd-trigger` — remove stale desktop versions.
- [ ] **Step 2:** Rename `"⌘K Cutter"` label → `"Cutter"`.
- [ ] **Step 3:** All palette icons: strip `stroke="#hex"` → `stroke="currentColor"`, set parent color to `--muted`.
- [ ] **Step 4:** Verify Escape handler active.
- [ ] **Step 5:** Commit.

---

### Task 13: Keyboard-shortcut modal prune

**Files:**
- Modify: `public/app.html` `#ks-modal` list
- Modify: any shortcut wire-up in `public/app-main.js`

- [ ] **Step 1:** Keep only: Highlight (Ctrl+Alt+H), Bold (Ctrl+B), Underline (Ctrl+U), Collapse (?), Global Search (Ctrl+K).
- [ ] **Step 2:** Render `⌘` symbol → `Ctrl`, render combos as `Ctrl + Alt + H` with ` + ` separators.
- [ ] **Step 3:** Remove unused keydown handlers.
- [ ] **Step 4:** Commit.

---

### Task 14: Source-terminal polish + Saved button round + hover/open/close micro-anims

**Files:**
- Modify: `public/app.html` CSS for `.source-pane`, `.cut-saved .bub`, generic `.tool-btn`/`.pane-action-btn`

- [ ] **Step 1:** Strip extra chrome (remove unused labels/dividers) from source pane header.
- [ ] **Step 2:** `.cut-saved .bub` → `border-radius:999px; padding:6px 14px; background:var(--mint)`.
- [ ] **Step 3:** All buttons: `transition: transform .14s, background .14s, box-shadow .14s; &:hover{transform:translateY(-1px); box-shadow:0 2px 6px rgba(0,0,0,.08)}`.
- [ ] **Step 4:** Open/close for modals: 180ms scale+fade in, 140ms out.
- [ ] **Step 5:** Commit.

---

### Self-review checklist

- Task 4 + Task 8 must pass before Task 7 ships (copy must work on evidence rows).
- Task 10 depends on no Radix — ripple + stagger must match React reference.
- Task 6 + Task 7: server already has `page` + `limit` — verify no hidden 270 cap (likely `FREE_LIMIT` or similar env).

---

## Execution choice

Inline with executing-plans.
