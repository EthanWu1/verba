# User Menu + Sidebar Collapse Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three bugs in the Settings/Pricing revamp: user-menu actions do nothing, sidebar collapse hides the sidebar entirely instead of showing an icon rail, and the collapsed rail loses the profile trigger.

**Architecture:** Root cause of the dead menu is script load order — `<script src="app-main.js">` runs before the `#settings-v2`, `#pricing-overlay`, `#pay-overlay`, `#ks-modal` elements exist, so each `init*()` IIFE early-exits on `if (!back) return;` and never registers `window.__verba.openSettings|openPricing|openPayment|openShortcuts`. Fix by moving the script tags to the bottom of `<body>`. Replace the current collapse implementation (`translateX(-100%)` off-screen) with an icon-rail (≈64px wide, text hidden, icons kept). Mount a persistent avatar trigger inside the rail that opens the same `#user-menu`.

**Tech Stack:** vanilla JS/HTML/CSS single-page app (`public/app.html` + `public/app-main.js`), no frameworks.

---

### Task 1: Load app-main.js after the overlays so init functions can find their DOM

**Files:**
- Modify: `public/app.html:1996-1997` (remove inline script tags)
- Modify: `public/app.html` end of `<body>` (add script tags there)

**Context:**
Current state (app.html):
- line 1996: `<script src="api.js"></script>`
- line 1997: `<script src="app-main.js"></script>`
- line 2000: `<div class="settings-backdrop" id="settings-v2" …>` (opens settings)
- line 2125: `<div class="pricing-overlay" id="pricing-overlay" …>`
- line 2174 (approx): `<div class="pay-backdrop" id="pay-overlay" …>`
- line 2207: `<div class="modal-backdrop" id="ks-modal" …>`

Because scripts run before the overlays parse, `document.getElementById('settings-v2')` returns `null` in each init IIFE. The `if (!back) return;` guard trips and `window.__verba.openSettings` is never assigned. Clicks from `#user-menu` fire `window.__verba.openSettings('general')` → `TypeError: openSettings is not a function` (or silently undefined) → nothing happens.

- [ ] **Step 1: Delete the early script tags at lines 1996-1997**

In `public/app.html` delete these exact lines:

```html
<script src="api.js"></script>
<script src="app-main.js"></script>
```

- [ ] **Step 2: Re-insert both script tags immediately before the closing `</body>` tag**

Find the `</body>` line in `public/app.html` (use Grep `</body>`). Insert just above it:

```html
<script src="api.js"></script>
<script src="app-main.js"></script>
</body>
```

- [ ] **Step 3: Verify DOM IDs exist above the script tags**

Run:
```bash
grep -n 'id="settings-v2"\|id="pricing-overlay"\|id="pay-overlay"\|id="ks-modal"\|src="app-main.js"' public/app.html
```

Expected: all four `id=` lines have smaller line numbers than the `app-main.js` `<script src=...>` line.

- [ ] **Step 4: Manual sanity check — boot the app and click each user-menu item**

Start the server (`npm start`), open `http://localhost:3000/app`, click the sidebar nameplate to open `#user-menu`, then click each:
- "Settings" → `#settings-v2` overlay opens
- "Upgrade plan" → `#pricing-overlay` opens
- "Keyboard shortcuts" → `#ks-modal` opens
- "Log out" → redirects to `/signin`

Expected: all four work. No console errors.

- [ ] **Step 5: Commit**

```bash
git add public/app.html
git commit -m "fix(ui): move app-main.js after overlay DOM so user-menu actions bind"
```

---

### Task 2: Replace collapsed-sidebar off-screen slide with an icon-rail

**Files:**
- Modify: `public/app.html:112-114` (existing collapse CSS rules)
- Modify: `public/app.html` CSS block — add new rail rules beside the existing ones

**Context:**
Current CSS (`public/app.html:112-114`):
```css
.shell.sb-collapsed{grid-template-columns:0px minmax(0,1fr)}
.shell.sb-collapsed .sidebar{transform:translateX(-100%);transition:transform .22s cubic-bezier(.2,.9,.3,1.1)}
.shell:not(.sb-collapsed) .sidebar{transform:translateX(0);transition:transform .22s cubic-bezier(.2,.9,.3,1.1)}
```

This slides the whole sidebar off-screen. Replace with a 64px icon rail that:
- Keeps `.sidebar` on screen at 64px width
- Hides every `.nav-label`, `.section-title`, `.side-brand-text`, `.side-account-meta`, `.user-menu-email-label`, `.nav-count`, etc. — anything that is text in the rail
- Keeps nav icons (`.nav-icon`), the brand mark, and a shrunk account row visible
- Centers visible elements horizontally

Inspect existing class names in the sidebar by running `grep -nE 'class="(nav-item|nav-label|nav-icon|section-title|side-brand|side-account|nav-count)' public/app.html | head -40`. Use those exact class names below — do **not** invent new ones.

- [ ] **Step 1: Replace the three collapse rules at lines 112-114**

Delete the three lines above. In their place write:

```css
.shell.sb-collapsed{grid-template-columns:64px minmax(0,1fr)}
.shell:not(.sb-collapsed) .sidebar{transition:width .18s ease}
.shell.sb-collapsed .sidebar{width:64px;overflow:hidden;transition:width .18s ease}
```

- [ ] **Step 2: Add rail visibility rules directly after those three lines**

Before adding, confirm the real class names by running the grep in the Context block. Then add (adjust class names to match what the grep actually shows — the list below is what to hide when they exist):

```css
.shell.sb-collapsed .nav-label,
.shell.sb-collapsed .section-title,
.shell.sb-collapsed .side-brand-text,
.shell.sb-collapsed .side-account-meta,
.shell.sb-collapsed .nav-count,
.shell.sb-collapsed .sidebar .sb-toggle,
.shell.sb-collapsed .side-account-caret{display:none}

.shell.sb-collapsed .nav-item{justify-content:center;padding:8px 0}
.shell.sb-collapsed .side-account{justify-content:center;padding:8px 0;gap:0}
.shell.sb-collapsed .sidebar .side-brand{justify-content:center}
.shell.sb-collapsed .nav-icon{margin:0}
```

If `grep` shows different class names (e.g. `.side-label` instead of `.nav-label`), use the real ones — this CSS just needs to hit the text-bearing selectors that actually exist.

- [ ] **Step 3: Verify the `#sb-open-fab` does not show while collapsed**

The rail stays visible while collapsed, so the floating "open" FAB should stay hidden. Find `.shell.sb-collapsed .sb-open-fab{display:flex}` (around line 123) and change to:

```css
.shell.sb-collapsed .sb-open-fab{display:none}
```

- [ ] **Step 4: Toggle control — keep the chevron inside `.sidebar` working**

Verify `#sb-toggle` is still clickable in the collapsed state. Its handler already flips `sb-collapsed` (see `public/app-main.js:2072-2085`). If Step 2 hid `.sb-toggle` in the rail via the `display:none` rule, remove it from that hide-list so the user can re-expand by clicking the chevron (we already put `.sidebar .sb-toggle` in the hide-list — **remove that line**). Resulting section:

```css
.shell.sb-collapsed .nav-label,
.shell.sb-collapsed .section-title,
.shell.sb-collapsed .side-brand-text,
.shell.sb-collapsed .side-account-meta,
.shell.sb-collapsed .nav-count,
.shell.sb-collapsed .side-account-caret{display:none}
```

- [ ] **Step 5: Manual sanity check**

Reload the app. Click the chevron in the sidebar. Expected:
- Sidebar shrinks to 64px rail
- Nav icons visible and centered
- Section titles and nav labels hidden
- Chevron still visible (rotated is fine) and re-clicks expand
- `#sb-open-fab` stays hidden while rail is visible
- Keyboard `⌘.` still toggles

- [ ] **Step 6: Commit**

```bash
git add public/app.html
git commit -m "fix(ui): collapsed sidebar becomes icon rail instead of sliding off-screen"
```

---

### Task 3: Keep the profile avatar trigger visible in the collapsed rail

**Files:**
- Modify: `public/app.html` near line 1462 (`<div class="side-account" id="side-account-row">`) — shrink its layout in collapsed mode so only the avatar is visible and still opens `#user-menu`
- Modify: `public/app-main.js:98-103` (`positionMenu` inside `initUserMenu`) — reposition the popup when row is narrow

**Context:**
Current trigger markup (approx `public/app.html:1462`):
```html
<div class="side-account" id="side-account-row" role="button" tabindex="0" aria-haspopup="menu">
  <div class="side-avatar">…</div>
  <div class="side-account-meta">
    <div class="side-account-name">…</div>
    <div class="side-account-email">…</div>
  </div>
  <!-- caret chevron -->
</div>
```

Task 2 already hides `.side-account-meta`. The avatar remains, but the row was flex with `justify-content: flex-start`, so in collapsed mode we want it centered (Task 2 added `justify-content:center`). The existing click handler (`row.addEventListener('click', …)` in `initUserMenu`) already opens `#user-menu` — nothing to do for wiring.

The remaining issue is menu positioning: `positionMenu()` sets `menu.style.left = r.left`, `menu.style.width = r.width`. When the row is 64px wide, the popup becomes 64px — unusable. Override width when sidebar is collapsed.

- [ ] **Step 1: Verify the avatar element class name**

Run:
```bash
grep -n 'side-avatar\|side-account' public/app.html | head -10
```

Note the avatar's class name (likely `.side-avatar`). If different, substitute it below.

- [ ] **Step 2: Update `positionMenu()` in `public/app-main.js:98-103` to widen the popup when collapsed**

Replace:
```javascript
    function positionMenu() {
      const r = row.getBoundingClientRect();
      menu.style.left = r.left + 'px';
      menu.style.bottom = (window.innerHeight - r.top + 6) + 'px';
      menu.style.width = r.width + 'px';
    }
```

With:
```javascript
    function positionMenu() {
      const r = row.getBoundingClientRect();
      const collapsed = document.querySelector('.shell')?.classList.contains('sb-collapsed');
      const width = collapsed ? 260 : r.width;
      menu.style.left = r.left + 'px';
      menu.style.bottom = (window.innerHeight - r.top + 6) + 'px';
      menu.style.width = width + 'px';
    }
```

- [ ] **Step 3: Ensure the avatar stays visible in the rail**

In the CSS block from Task 2 Step 2, the line `.shell.sb-collapsed .side-account{justify-content:center;padding:8px 0;gap:0}` already handles centering. Add one safety line right after it so the avatar never shrinks:

```css
.shell.sb-collapsed .side-avatar{flex:0 0 auto}
```

- [ ] **Step 4: Manual sanity check**

With sidebar collapsed, click the avatar. Expected:
- `#user-menu` opens
- Width is 260px (not 64px) and readable
- All four menu items clickable (Settings, Upgrade, Shortcuts, Log out)
- Escape closes it
- Expanding the sidebar and re-clicking still works (menu width matches row width)

- [ ] **Step 5: Commit**

```bash
git add public/app.html public/app-main.js
git commit -m "fix(ui): avatar stays visible in collapsed rail and opens 260px user menu"
```

---

### Task 4: Regression pass — run tests and verify nothing else broke

**Files:** none modified (verification only)

- [ ] **Step 1: Run the full test suite**

```bash
npm test
```

Expected: `ℹ pass 24  ℹ fail 0`.

- [ ] **Step 2: Manual walkthrough**

With `npm start` running:
1. Click sidebar nameplate → menu opens, all four actions work (Settings/Upgrade/Shortcuts/Logout).
2. Click `⌘,` → Settings opens; tabs General/Account/Billing each switch and hydrate.
3. Click `⌘/` → Shortcuts modal opens; Escape closes.
4. Click chevron in sidebar → rail shrinks to 64px; icons visible; labels hidden.
5. Click avatar in rail → same menu opens, 260px wide.
6. Click chevron or `⌘.` → rail expands back with full text.

- [ ] **Step 3: Commit a no-op marker if anything needed a tweak (skip otherwise)**

If Steps 1-2 required an additional edit, commit with `fix(ui): <thing>`. If everything passed, skip this step.

---

## Self-Review

**Spec coverage:**
- "Settings/Upgrade/Shortcuts click do nothing" → Task 1
- "Collapse messes up spacing; should show icons" → Task 2
- "Settings button disappears when profile clicked; clicking profile should open same menu" → user menu was already the profile trigger; the real gap is that Task 2's rail hides the meta, leaving only the avatar. Task 3 keeps the avatar + repositions the popup to be usable.
- "Make sure all text visible" (restated: hide text in collapsed, show full text when expanded) → Task 2 only hides labels inside `.shell.sb-collapsed`; expanded state is untouched.

**Placeholder scan:** no TBD/TODO/handle-edge-cases phrases.

**Type consistency:** class names (`.nav-label`, `.section-title`, `.side-brand-text`, `.side-account-meta`, `.side-avatar`, `.sb-toggle`, `.sb-open-fab`) are referenced identically across Tasks 2 and 3, with explicit verification steps because this project's sidebar CSS was not fully enumerated here.
