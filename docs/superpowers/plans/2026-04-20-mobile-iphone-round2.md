# Mobile iPhone Revamp — Round 2

**Date:** 2026-04-20
**Branch:** main
**Scope:** Close gaps from round-1 (2026-04-19). Fix hamburger conflict, remove global search on mobile, convert card preview to modal, polish evidence + search bar, establish sync pattern.

## User Intent (verbatim)

> fix everything that even has a chance of looking off of cut off or not formatted correctly on mobile. please ensure the hamburger menu actually works and that the ui elements like the search bar or evidence library look appropriate. you can change how they are layed out. ie global search not necessary. card preview can load as a modal perhaps. every time i change the main website code the mobile should change accordingly.

## Current State (surveyed)

- Round-1 added `@media (max-width:768px)` block `public/app.html:1414-1591` + 480 block at 1592.
- Mobile drawer IIFE appended to `public/app-main.js` (end of file).
- `initSidebarCollapse` at `public/app-main.js:2121-2134` binds `flip()` (toggles `.sb-collapsed`) to BOTH `#sb-toggle` AND `#sb-open-fab` — on mobile tap, BOTH `.sb-collapsed` and `.sb-open` flip. Round-1 patched via CSS neutralization (commit 1fc6a98) but handler still fires. **Root fix needed.**
- `.side-search` / `#cmd-trigger` at `public/app.html:1618` — global search entry. Not hidden on mobile.
- `.ap-card-chip` at `public/app.html:1085-1094` — card chip; current click opens something inline. Needs mobile modal.
- `.evidence-grid` stacks on mobile but `.ev-item .row-actions` likely hover-only.
- Three unrelated stashes live in git stash list — untouched.

## Tasks

---

### Task 1: Fix hamburger dual-handler conflict

**Problem:** `initSidebarCollapse` in `public/app-main.js:~2121-2134` toggles `.sb-collapsed` on `#sb-open-fab` click. On mobile, mobile-drawer IIFE ALSO toggles `.sb-open` on same element. Two classes flip per tap.

**Fix:** Guard `flip()` handler on `#sb-open-fab` with viewport check. Mobile drawer IIFE owns `#sb-open-fab`; desktop icon-rail toggle stays on `#sb-toggle`.

**Edit** `public/app-main.js` `initSidebarCollapse`:
- Remove the `openFab.addEventListener('click', flip)` line entirely, OR
- Wrap: `if (window.matchMedia('(min-width:769px)').matches) flip();` inside the handler.

Prefer **remove** — simpler, `#sb-toggle` already handles desktop flip, and `#sb-open-fab` is hidden on desktop anyway per round-1 CSS.

**Verify:** On 375px viewport, tap hamburger → `.sb-open` toggles, `.sb-collapsed` does NOT. On desktop, `#sb-toggle` still toggles icon-rail.

**Commit:** `fix(mobile): hamburger no longer toggles desktop icon-rail state`

---

### Task 2: Remove global search + ⌘K on mobile

**Files:** `public/app.html` mobile block.

Add to `@media (max-width:768px)`:
```css
.side-search,#cmd-trigger{display:none!important}
#ks-modal,#cmd-palette{display:none!important}
.topbar .kbd,.kbd-hint{display:none}
```

Round-1 already hides `#ks-modal`; extend to cmd palette and side search.

**Verify:** No search affordance visible on mobile. Desktop unchanged.

**Commit:** `feat(mobile): drop global search surface`

---

### Task 3: Card preview as modal on mobile

**Files:** `public/app.html`, `public/app-main.js`.

Survey first: find where `.ap-card-chip` click handler lives (likely `app-main.js`). Confirm current behavior (inline expand vs popover).

**Approach:**
- Reuse existing modal shell if `#card-preview` / similar exists. If not, add minimal `<div id="mobile-card-modal" class="modal" hidden>` with close button and body slot.
- Intercept `.ap-card-chip` click: if `window.matchMedia('(max-width:768px)').matches`, prevent default expand, populate modal body with chip's data (tag, cite, highlight text from chip dataset/DOM), show modal.
- CSS: modal already full-screen on mobile per round-1 `.modal` override.

**Verify:** On mobile tap a card chip → modal opens full-screen with same content. Desktop inline preview unchanged.

**Commit:** `feat(mobile): card chip opens full-screen modal preview`

---

### Task 4: Evidence library polish

**Files:** `public/app.html` mobile block.

Add:
```css
@media (max-width:768px){
  .ev-item{padding:10px 12px;gap:8px}
  .ev-item .row-actions{opacity:1!important;visibility:visible!important;position:static;display:flex;gap:6px;margin-top:6px}
  .ev-item .ev-meta{font-size:12px;flex-wrap:wrap}
  .ev-item .ev-title{font-size:14px;line-height:1.35}
  .evidence-grid{gap:8px}
  .ev-toolbar{flex-wrap:wrap;gap:6px}
  .ev-toolbar input,.ev-toolbar select{flex:1 1 140px;min-width:0}
}
```

**Verify:** Actions (edit/delete) always visible on mobile; rows don't overflow; toolbar inputs wrap.

**Commit:** `feat(mobile): evidence library row actions always visible`

---

### Task 5: Research bar + Add controls

**Files:** `public/app.html` mobile block.

Ensure `.research-bar` children stack + Add button is full-width:
```css
@media (max-width:768px){
  .research-bar{flex-direction:column;align-items:stretch;gap:8px}
  .research-bar input,.research-bar select,.research-bar button{width:100%}
  .research-bar .btn-group{display:flex;gap:6px}
  .research-bar .btn-group>*{flex:1}
}
```

**Verify:** No horizontal overflow on 375px. Buttons tappable (>=44px).

**Commit:** `feat(mobile): research bar stacks + full-width controls`

---

### Task 6: Audit sweep

Walk every `#page-*` section at 375/390/430 widths. For each: look for `grid-template-columns` with fixed px, `width:` with fixed px > 300, `flex-wrap:nowrap` on containers, `position:absolute` elements that could overlap sticky topbar.

Pages: library, evidence, history, matrix, settings, cutter, saved, contradictions, workbench.

For each issue found, add an override in the mobile block (not per-page inline). Commit per-page.

**Commit pattern:** `fix(mobile): <page> overflow/overlap fixes`

---

### Task 7: Sync pattern — mobile contract

**File:** `docs/mobile-contract.md` (new).

Content (concise):
- Single source of truth for mobile rules: `public/assets/mobile.css` + `@media (max-width:768px)` block in each HTML.
- Rule: any new `grid-template-columns` with >1 track MUST have a mobile override collapsing to `1fr`.
- Rule: any new fixed-width element (`width:Npx` where N>300) MUST set `max-width:100%`.
- Rule: any new input MUST have `font-size>=16px` on mobile (iOS zoom).
- Rule: any hover-only affordance MUST have a tap equivalent on mobile.
- Rule: new modals inherit full-screen on mobile via existing `.modal` override — don't override `.modal` width unless you also handle mobile.

**Optional guard:** `scripts/mobile-lint.sh` — grep staged HTML for `grid-template-columns:[^;]*,` without nearby `@media.*768` in same file; warn on commit. Keep out of CI first pass (noisy). Document in contract.

**Commit:** `docs: mobile contract for keeping mobile synced with desktop`

---

## Execution Order

1 → 2 → 3 → 4 → 5 → 6 → 7. Tasks 4/5 parallelizable with 2. Task 3 depends on understanding card-chip handler (survey first).

## Success Criteria

- Hamburger opens drawer WITHOUT flipping desktop `.sb-collapsed`.
- No global search visible on mobile.
- Tapping a card chip on mobile opens a full-screen modal.
- Evidence library rows usable (actions visible, no overflow).
- Research bar stacks cleanly at 375px.
- Every page scrollable without horizontal overflow at 375/390/430.
- `docs/mobile-contract.md` exists and documents sync rules.

## Out of Scope

- Round-1 Task 8 (manual device audit) — user action.
- Three stashed unrelated edits — user triages separately.
- Cmd palette redesign (just hidden on mobile).
