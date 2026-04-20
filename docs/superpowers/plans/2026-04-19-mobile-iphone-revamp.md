# Mobile iPhone Revamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every Verba page render correctly on iPhone (down to iPhone SE @ 375px) with no overlapping elements, no horizontal scroll, no iOS input zoom, readable text, tappable controls, and a working mobile nav for the app shell.

**Architecture:** The project ships five static HTML pages from `public/` served by an Express server. All CSS is inline in each file's `<style>` block. We will (1) add a single shared `public/assets/mobile.css` for cross-page primitives (safe-area, input font-size, tap target minimums, overflow guards) linked from every HTML page, and (2) add targeted `@media (max-width: 768px)` blocks inside each file's existing `<style>` for page-specific layout changes — preserving the current per-file inline-style pattern. For `app.html` we convert the 240 px grid sidebar into an overlay drawer triggered by the existing (currently hidden) `#sb-open-fab` button.

**Tech Stack:** Vanilla HTML/CSS, no framework. Express static serving. Target: iOS Safari 15+, Chrome Android, iPhone SE (375 px) through iPhone 15 Pro Max (430 px). Test via Chrome DevTools device emulation; final pass on a real iPhone if available.

**Breakpoints used throughout this plan:**
- `max-width: 768px` → tablet/phone (primary mobile rules)
- `max-width: 480px` → small phone (iPhone-specific tightening)

**Files touched:**
- Create: `public/assets/mobile.css`
- Modify: `public/landing.html` (inline `<style>`, `<link>`, viewport meta)
- Modify: `public/signin.html`
- Modify: `public/forgot.html`
- Modify: `public/reset.html`
- Modify: `public/app.html` (inline `<style>`, tiny JS for drawer toggle)

No server, no JS logic, no tests exist for CSS — verification is manual via Chrome DevTools iPhone emulation.

---

## Task 1: Shared mobile base stylesheet + viewport hardening

**Files:**
- Create: `public/assets/mobile.css`
- Modify: `public/landing.html` (head)
- Modify: `public/signin.html` (head)
- Modify: `public/forgot.html` (head)
- Modify: `public/reset.html` (head)
- Modify: `public/app.html` (head)

- [ ] **Step 1: Create shared mobile base stylesheet**

Create `public/assets/mobile.css` with content:

```css
/* ─────────────────────────────────────────────────────────
   Verba shared mobile primitives
   Loaded by every HTML page; runs AFTER each page's inline
   <style> block so it can safely override where needed.
   ───────────────────────────────────────────────────────── */

/* Safe-area env vars default to 0 on desktop browsers */
:root{
  --safe-t:env(safe-area-inset-top,0px);
  --safe-b:env(safe-area-inset-bottom,0px);
  --safe-l:env(safe-area-inset-left,0px);
  --safe-r:env(safe-area-inset-right,0px);
}

/* Never allow sideways scroll from a stray wide element */
html,body{max-width:100vw;overflow-x:hidden}

/* Prevent iOS Safari auto-zoom: any focusable input must be ≥16px */
@media (max-width:768px){
  input,select,textarea,button{font-size:16px !important}
}

/* 44x44 minimum tap target for interactive pills, icons */
@media (max-width:768px){
  .icon-btn,.nav-item,.soc-btn,.submit,.mode-tab,.back,.brand,button[type="submit"]{
    min-height:44px;
  }
  .icon-btn{min-width:44px}
}

/* Respect notch / home indicator */
@media (max-width:768px){
  body{
    padding-left:var(--safe-l);
    padding-right:var(--safe-r);
  }
}

/* Images never overflow their container */
img,svg,video,canvas{max-width:100%;height:auto}

/* Long unbroken strings (URLs, tokens) wrap instead of overflowing */
.cut-body,.card,.modal,.pay-shell,.form-wrap{overflow-wrap:anywhere}
```

- [ ] **Step 2: Add viewport-fit=cover + link tag to `public/landing.html`**

Find the line (around line 6):
```html
<meta name="viewport" content="width=device-width,initial-scale=1">
```

Replace with:
```html
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
```

Find the closing `</style>` tag of the main inline style block (the one before `</head>`). Immediately **after** it, insert:
```html
<link rel="stylesheet" href="assets/mobile.css">
```

- [ ] **Step 3: Repeat step 2 for `public/signin.html`**

Same viewport replacement. Same `<link>` insertion after the inline `</style>`.

- [ ] **Step 4: Repeat step 2 for `public/forgot.html`**

Same viewport replacement. Same `<link>` insertion after the inline `</style>`.

- [ ] **Step 5: Repeat step 2 for `public/reset.html`**

Same viewport replacement. Same `<link>` insertion after the inline `</style>`.

- [ ] **Step 6: Repeat step 2 for `public/app.html`**

Same viewport replacement. Same `<link>` insertion after the inline `</style>`.

- [ ] **Step 7: Verify server serves the new stylesheet**

Start server: `npm start` (or whatever the project start script is — confirm by reading `package.json`).
Open `http://localhost:<port>/assets/mobile.css` → expect HTTP 200 and the CSS text.
Open `http://localhost:<port>/signin` in Chrome DevTools, toggle device mode to iPhone 14 (390 px), focus an email input → page should NOT zoom in. If it zooms, inputs are still <16 px; check cascade.

- [ ] **Step 8: Commit**

```bash
git add public/assets/mobile.css public/landing.html public/signin.html public/forgot.html public/reset.html public/app.html
git commit -m "feat(mobile): add shared mobile.css with safe-area, 16px inputs, tap targets"
```

---

## Task 2: Landing page mobile layout

**Files:**
- Modify: `public/landing.html` inline `<style>` (the existing `@media (max-width:900px)` block around line 377)

Current state: hero uses `.wrap{max-width:1180px;padding:0 32px}`, hero font `clamp(...)`, workbench demo `.cut-body` is `max-width:780px; padding:40px 56px 56px; min-height:520px`, CTA band is flex row, footer likely fixed layout.

- [ ] **Step 1: Locate and extend the existing `@media (max-width:900px)` block**

Find the block (starts around line 377):
```css
@media (max-width:900px){
  .cut-body{padding:30px 24px 70px}
  ...
  .hero{padding:56px 0 32px}
  ...
}
```

- [ ] **Step 2: Add a new `@media (max-width:768px)` block immediately after it**

Insert:
```css
@media (max-width:768px){
  .wrap{padding:0 20px}
  .hero{padding:40px 0 24px}
  .hero h1{font-size:clamp(34px,9vw,46px);line-height:1.04;letter-spacing:-0.025em}
  .hero-sub{font-size:15.5px;margin-top:16px;max-width:100%}
  .hero-ctas{margin-top:22px;gap:8px}
  .hero-ctas > *{flex:1 1 auto;min-width:0;text-align:center}
  .hero-meta{gap:10px 14px;margin-top:18px;font-size:12px}
  section{padding:60px 0}
  .sec-title{font-size:clamp(28px,7.5vw,40px);line-height:1.06}
  .sec-sub{font-size:15px;margin-top:14px}
  .cut-body{padding:24px 18px 80px;min-height:auto;max-width:100%}
  .cta-band h3{font-size:clamp(28px,8vw,40px);max-width:100%}
  .cta-band .wrap{flex-direction:column;align-items:flex-start;gap:18px}
  .foot,.brandbar{padding-left:20px;padding-right:20px}
}
@media (max-width:480px){
  .wrap{padding:0 16px}
  .hero{padding:28px 0 18px}
  .hero-ctas > *{flex:1 1 100%}  /* CTAs stack full-width */
}
```

- [ ] **Step 3: Handle horizontal-scrolling toolbars inside the workbench demo**

Find `.cut-toolbar{position:absolute;bottom:18px;left:50%;transform:translateX(-50%);...}`. On mobile this toolbar can overflow.

Inside the new `@media (max-width:768px)` block add:
```css
  .cut-toolbar{
    position:static;transform:none;margin-top:16px;
    overflow-x:auto;-webkit-overflow-scrolling:touch;
    justify-content:flex-start;flex-wrap:nowrap;
    width:100%;max-width:100%;
  }
  .cut-tool{flex:0 0 auto}
  .key-hud{display:none}  /* keyboard shortcut HUD is meaningless on touch */
```

- [ ] **Step 4: Verify visually**

Start server, open `http://localhost:<port>/` in Chrome DevTools → Device: iPhone SE (375 px) and iPhone 14 Pro Max (430 px).
Check:
- No horizontal scroll anywhere (scroll sideways — nothing should move)
- Hero headline fits without wrapping awkwardly
- Workbench demo box fits entirely inside viewport
- CTA band stacks vertically
- Footer stays inside the viewport

- [ ] **Step 5: Commit**

```bash
git add public/landing.html
git commit -m "feat(mobile): responsive landing page layout for phones"
```

---

## Task 3: Sign-in page — stack to single column on mobile

**Files:**
- Modify: `public/signin.html` inline `<style>` (extend existing `@media (max-width:920px)` block, line ~253)

Current state: `body{display:grid;grid-template-columns:1fr 1fr}` — left side has the form, right side is the visual promo panel. On phones the right panel squeezes the form off-screen.

- [ ] **Step 1: Locate existing `@media (max-width:920px)` block**

Around line 253 of `signin.html`.

- [ ] **Step 2: Add a new `@media (max-width:768px)` block right after it**

```css
@media (max-width:768px){
  body{grid-template-columns:1fr;min-height:100vh}
  .left{padding:20px 20px 28px}
  .right{display:none}              /* promo panel hidden on phone */
  .form-wrap{max-width:100%;padding:20px 0}
  .headline{font-size:clamp(32px,8.5vw,42px);line-height:1.05}
  .subline{font-size:14.5px;margin-top:12px}
  .mode-tabs{margin-top:18px;width:100%}
  .mode-tab{flex:1 1 50%;text-align:center;padding:10px 12px}
  .socials{margin-top:16px}
  .soc-btn{padding:13px 14px}
  .divider{margin:16px 0 14px}
  form{gap:12px}
  .field input{padding:13px 13px;font-size:16px}  /* iOS no-zoom */
  .field-row{flex-wrap:wrap;gap:6px}
  .submit{padding:14px 16px}
  .brandbar{padding:0;margin-bottom:14px}
  .brand-mark{width:40px;height:40px}
  .foot{margin-top:24px;padding-top:18px;flex-wrap:wrap;gap:8px 14px;font-size:11px}
}
```

- [ ] **Step 3: Verify**

Load `http://localhost:<port>/signin` in iPhone SE (375 px) emulation.
Check:
- Right-side visual panel not visible
- Form fits with ≥16 px horizontal margin
- Google Sign-In button is full-width and 44 px+ tall
- Inputs do not zoom on focus
- Mode tabs (Sign in / Create account) stack side-by-side and fit

- [ ] **Step 4: Commit**

```bash
git add public/signin.html
git commit -m "feat(mobile): stack sign-in page to single column, hide promo panel on phone"
```

---

## Task 4: Forgot/reset pages — tighten padding on phone

**Files:**
- Modify: `public/forgot.html` inline `<style>` (existing `@media (max-width:640px)` near bottom)
- Modify: `public/reset.html` inline `<style>` (existing `@media (max-width:640px)` near bottom)

Both pages are already close to mobile-ready — single-column, centered card. Just need padding tightening and input sizing.

- [ ] **Step 1: Extend `forgot.html` mobile rules**

Find `@media (max-width:640px){ .brandbar{padding:24px 28px 0} .foot{padding:24px 28px} }` and replace with:

```css
@media (max-width:640px){
  .brandbar{padding:20px 18px 0}
  .foot{padding:20px 18px;flex-wrap:wrap;gap:8px}
  .wrap{padding:24px 18px}
  .card{max-width:100%}
  .headline{font-size:clamp(28px,8vw,36px)}
  .subline{font-size:14.5px;margin:12px 0 20px}
  .field input{font-size:16px}
  .submit{padding:14px 16px}
}
```

- [ ] **Step 2: Apply identical change to `reset.html`**

Find the same `@media (max-width:640px)` block in `reset.html` and replace with the same CSS from Step 1.

- [ ] **Step 3: Verify**

Load `/forgot` and `/reset` on iPhone SE emulation. Confirm: card fills width with 16–18 px gutters, input not auto-zooming, no horizontal scroll.

- [ ] **Step 4: Commit**

```bash
git add public/forgot.html public/reset.html
git commit -m "feat(mobile): tighten forgot/reset page padding and input sizing on phone"
```

---

## Task 5: App shell — sidebar becomes drawer, body scrolls, topbar collapses

**Files:**
- Modify: `public/app.html` inline `<style>` (extend near the existing `@media (max-width:820px)` block around line 1384)
- Modify: `public/app.html` body (hamburger FAB already exists: `#sb-open-fab`)
- Modify: `public/app-main.js` (small addition) — OR inline `<script>` at bottom of `app.html` if `app-main.js` already handles `#sb-open-fab`

**Context read first:** Before editing JS, `grep -n "sb-open-fab\|sb-toggle" public/app-main.js` to see what wiring already exists. If a click handler exists and just toggles `.sb-collapsed`, we will add a new class `.sb-open` for the mobile drawer state instead of reusing `.sb-collapsed` (which means icon-rail on desktop). Do not reuse `.sb-collapsed` for mobile.

- [ ] **Step 1: Check existing sidebar JS wiring**

Run: `grep -n "sb-open-fab\|sb-toggle\|sb-collapsed" public/app-main.js` (via Grep tool).

Record what's there — you will extend it in Step 4. Expected: a click handler on `#sb-toggle` that toggles `.shell.sb-collapsed`.

- [ ] **Step 2: Add a mobile `@media (max-width:768px)` block in app.html's inline `<style>`**

Insert immediately before `</style>` (near line 1395-ish, after the existing `.pricing-cards` 820 px rule):

```css
/* ─────────────────────────────────────────────
   Mobile shell — drawer sidebar, scrollable body
   ───────────────────────────────────────────── */
@media (max-width:768px){
  /* Release the desktop overflow lock so the page scrolls */
  body{overflow:auto;height:auto;min-height:100vh}
  .shell{
    display:block;height:auto;min-height:100vh;
    grid-template-columns:none;  /* cancel desktop grid */
  }
  .main{height:auto;min-height:100vh;overflow:visible}

  /* Sidebar: off-canvas drawer */
  .sidebar{
    position:fixed;top:0;left:0;bottom:0;
    width:min(280px,84vw);height:100vh;
    z-index:400;
    transform:translateX(-100%);
    transition:transform .22s ease;
    box-shadow:0 0 0 9999px rgba(0,0,0,0);  /* no scrim yet */
    overflow-y:auto;
    padding-top:calc(18px + var(--safe-t));
    padding-bottom:calc(14px + var(--safe-b));
  }
  .shell.sb-open .sidebar{
    transform:translateX(0);
    box-shadow:0 0 0 9999px rgba(15,15,25,.42);  /* scrim */
  }

  /* Hide desktop-only toggle, show hamburger FAB in topbar */
  .sb-toggle{display:none}
  .sb-open-fab{
    display:inline-flex;align-items:center;justify-content:center;
    position:static;  /* lives inside topbar */
    width:40px;height:40px;border-radius:8px;
    background:#fff;border:1px solid var(--line);color:var(--ink-2);
    margin-right:8px;
  }

  /* Topbar: compact, allow horizontal scroll for tabs */
  .topbar{
    flex-wrap:wrap;gap:8px;padding:10px 14px;min-height:auto;
    padding-top:calc(10px + var(--safe-t));
    position:sticky;top:0;z-index:30;
    border-bottom:1px solid var(--line);
  }
  .topbar .crumb{font-size:13px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .tabs{order:10;width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch;flex-wrap:nowrap;padding-bottom:4px}
  .tabs > *{flex:0 0 auto}
  .top-actions{gap:4px}
  .top-actions .icon-btn{width:40px;height:40px}

  /* Content padding gets smaller */
  .content{padding:16px 14px 80px;overflow:visible}

  /* Stack every multi-column layout to single column */
  .workbench,
  .mine-layout,
  .evidence-grid,
  .hist-wrap,
  .cont-grid,
  .saved-grid,
  .settings-body{
    grid-template-columns:1fr !important;
    gap:14px;
    min-height:auto;
  }
  .matrix{
    grid-template-columns:1fr !important;
    grid-template-rows:auto !important;
    min-height:auto;
  }
  .cards-grid{grid-template-columns:1fr}
  .font-cards,.hl-cards{grid-template-columns:repeat(2,minmax(0,1fr))}
  .pay-tier-row,.ap-suggestions{grid-template-columns:1fr}

  /* Hide the collapsible-source handle — meaningless when stacked */
  .source-handle,.source-reopen{display:none}

  /* Filter/staging chip rows scroll horizontally */
  .filter-row,.staging,.check-row,.nx-pinned{
    flex-wrap:nowrap;overflow-x:auto;-webkit-overflow-scrolling:touch;
    padding-bottom:6px;
  }
  .filter-row > *,.staging > *,.check-row > *,.nx-pinned > *{flex:0 0 auto}

  /* History rows: reflow to 2-line layout */
  .hist-row{
    grid-template-columns:auto 1fr !important;
    grid-template-areas:"time title" "meta meta";
    row-gap:4px;padding:10px 6px !important;
  }

  /* Modals: near-full-screen on phones */
  .modal-backdrop{padding:0}
  .modal{
    width:100vw !important;max-width:100vw !important;
    min-height:100vh;max-height:100vh;
    border-radius:0 !important;
    display:flex;flex-direction:column;
  }
  .modal-body{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch}
  .pay-shell{width:100vw;max-width:100vw;height:100vh;max-height:100vh;border-radius:0}

  /* Keep usage/chip text readable */
  .usage-pill{white-space:normal}
  .ap-card-chip .ap-cc-tag{max-width:100%;white-space:normal;overflow:visible;text-overflow:unset}
}

@media (max-width:480px){
  .content{padding:14px 12px 100px}
  .topbar{padding:8px 12px}
  .nav-item{padding:12px 12px}  /* taller rows in drawer */
  .font-cards,.hl-cards{grid-template-columns:1fr}
}
```

- [ ] **Step 3: Move the hamburger FAB inside the topbar DOM**

Currently `<button class="sb-open-fab" id="sb-open-fab" ...>` sits just before `<div class="shell">`. That is fine when it uses `position:fixed`, but we just made it `position:static` on mobile — it needs to be inside the topbar so it appears at the left of the topbar.

Find in `app.html`:
```html
<button class="sb-open-fab" id="sb-open-fab" ...>
  <svg ...><path d="M3 6h18M3 12h18M3 18h18"/></svg>
</button>

<div class="shell">
```

Delete that FAB and re-insert it as the **first child** of the topbar. Locate the topbar (search `<header class="topbar"` or `<div class="topbar"`) and insert the hamburger as its first child, before the `.crumb`:

```html
<button class="sb-open-fab" id="sb-open-fab" aria-label="Open menu" title="Menu">
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
</button>
```

Also update its desktop hidden rule — the CSS already has `.sb-open-fab{display:none}` outside media queries, which is what we want. The mobile media query re-enables it. Good.

- [ ] **Step 4: Wire drawer open/close in `public/app-main.js`**

Inside the existing DOMContentLoaded (or wherever `sb-toggle` is wired — confirmed in Step 1), add:

```js
// Mobile drawer toggle
(function(){
  var shell = document.querySelector('.shell');
  var openBtn = document.getElementById('sb-open-fab');
  if (!shell || !openBtn) return;

  function close(){ shell.classList.remove('sb-open'); }

  openBtn.addEventListener('click', function(e){
    e.stopPropagation();
    shell.classList.toggle('sb-open');
  });

  // Tap outside the sidebar → close (scrim area)
  document.addEventListener('click', function(e){
    if (!shell.classList.contains('sb-open')) return;
    var sidebar = shell.querySelector('.sidebar');
    if (sidebar && !sidebar.contains(e.target) && e.target !== openBtn) close();
  });

  // Tapping a nav item inside the drawer closes it
  shell.querySelectorAll('.sidebar .nav-item').forEach(function(el){
    el.addEventListener('click', close);
  });

  // Esc closes
  document.addEventListener('keydown', function(e){
    if (e.key === 'Escape') close();
  });
})();
```

If unsure where to place it, put it at the bottom of `app-main.js` inside an IIFE (as shown). It is self-contained.

- [ ] **Step 5: Verify the app shell on mobile**

Start the server, sign in, load `/app` in Chrome DevTools @ iPhone 14 (390 px).

Checklist:
- Sidebar not visible by default
- Hamburger icon visible at top-left of topbar
- Tap hamburger → sidebar slides in from left, dark scrim covers rest of screen
- Tap scrim → drawer closes
- Tap a nav item → drawer closes and page switches
- Page content is vertically scrollable (body scroll works)
- No horizontal scroll on any page (Cutter, Cards, Evidence, History, Contentions, Matrix, Settings)
- Topbar tabs scroll horizontally when they overflow
- Opening a modal (e.g. Keyboard Shortcuts via `⌘?` — on mobile, open via UI) fills the screen and its body scrolls independently

- [ ] **Step 6: Commit**

```bash
git add public/app.html public/app-main.js
git commit -m "feat(mobile): sidebar becomes drawer, topbar compacts, body scrolls on phone"
```

---

## Task 6: Per-page layout fixes inside `#page-home` (Cutter)

**Files:**
- Modify: `public/app.html` inline `<style>` — extend the `@media (max-width:768px)` block from Task 5

The Cutter is the primary workspace: workbench with Source (PDF/article) pane on left, Cut Editor on right. On mobile we already stacked them in Task 5, but several Cutter-specific elements need tuning.

- [ ] **Step 1: Identify Cutter-specific overflow hotspots**

Search `app.html` for these class names and note their desktop styles:
- `.cut-toolbar` (bottom-floating action bar)
- `.cut-saved` (save confirmation overlay)
- `.research-bar` / `.research-bar-wrap` (top-of-page instant-research input)
- `.staging` (chip row above workbench)
- `.source-pane`, `.cut-pane` (the two halves)

Use Grep tool. You do not need to paste results here; just know where they are.

- [ ] **Step 2: Add Cutter-specific mobile rules**

Inside the existing `@media (max-width:768px)` block in `app.html`, append:

```css
  /* Cutter */
  .research-bar-wrap{padding:8px 0}
  .research-bar{
    flex-wrap:wrap;gap:8px;padding:10px;border-radius:10px;
  }
  .research-bar input,.research-bar textarea{
    width:100%;min-width:0;font-size:16px;
  }
  .research-bar button{flex:1 1 auto}

  .source-pane,.cut-pane{min-width:0;width:100%}
  .source-pane{max-height:50vh;overflow:auto}  /* keeps source pane bounded */
  .cut-pane{min-height:auto}

  .cut-toolbar{
    position:sticky;bottom:0;left:0;right:0;transform:none;
    width:100%;border-radius:0;border-left:0;border-right:0;
    padding:8px 10px;gap:6px;
    padding-bottom:calc(8px + var(--safe-b));
    overflow-x:auto;-webkit-overflow-scrolling:touch;flex-wrap:nowrap;
    z-index:20;
  }
  .cut-tool{flex:0 0 auto}

  .cut-saved .bub{font-size:12px;padding:10px 16px}
```

- [ ] **Step 3: Verify**

On iPhone 14 emulation, open the Cutter. Scroll the source pane; scroll the page; trigger an AI cut (or mock). The Cut Toolbar should stick to the bottom of the viewport without overlapping the save confirmation or the iOS home indicator.

- [ ] **Step 4: Commit**

```bash
git add public/app.html
git commit -m "feat(mobile): Cutter page — stack source/cut panes, sticky toolbar with safe-area"
```

---

## Task 7: Library, Evidence, History, Contentions, Matrix, Settings, Pricing — page-specific polish

**Files:**
- Modify: `public/app.html` inline `<style>` (extend existing `@media (max-width:768px)` block)

Most of these already got their grid stacking from Task 5. This task handles the remaining visual issues per page.

- [ ] **Step 1: Append page-specific mobile rules**

Inside the `@media (max-width:768px)` block (still in `app.html`), add:

```css
  /* Library / Cards */
  .mine-layout > :first-child{position:static;width:100%}  /* projects rail */
  .proj-swatches{flex-wrap:wrap}
  .cards-grid{grid-template-columns:1fr;gap:10px}

  /* Evidence */
  .ev-item .head{flex-wrap:wrap;gap:4px 6px}
  .ev-item{padding:10px}

  /* History */
  .hist-wrap > :first-child{width:100%}  /* date rail */
  .hist-row{
    display:flex;flex-direction:column;align-items:flex-start;
    gap:2px;padding:10px 0;border-bottom:1px solid var(--line-soft);
  }

  /* Contentions */
  .cont-grid{min-height:auto}

  /* Matrix (2x2 on desktop) */
  .matrix{gap:10px}
  .matrix > *{min-height:160px}

  /* Settings */
  .settings-body{min-height:0}
  .settings-body > :first-child{
    position:sticky;top:0;background:var(--bg);z-index:2;
    overflow-x:auto;-webkit-overflow-scrolling:touch;
    display:flex;flex-wrap:nowrap;gap:4px;padding:6px 0;
  }
  .settings-body > :first-child > *{flex:0 0 auto}

  /* Pricing modal */
  .pp-tier{padding:18px}
  .pp-price{font-size:32px}

  /* Payment modal tier rows */
  .pay-tier{padding:14px}

  /* Keyboard-shortcut modal — hide on phone (no keyboard) */
  #ks-modal{display:none !important}
```

- [ ] **Step 2: Sweep for leftover fixed widths**

In `app.html`, search for `max-width:` followed by a px value over 600 that is inside a component (not a container wrapper). Example offenders to review:
- `.staging{max-width:820px}` → on mobile this is overridden by `width:100%` from `max-width:100vw` on `html,body`, but verify
- Any `.ap-cc-tag{max-width:260px}` → we set `max-width:100%` above in Task 5 step 2
- `.modal[style="width:min(480px,92vw)"]` inline style on `#ks-modal` → overridden by our mobile rule

If any still cause horizontal scroll on mobile, override inside the mobile block.

- [ ] **Step 3: Verify every page in the app shell**

Load `/app` and navigate through: Cutter → Cards → Evidence → History → Contentions → Matrix → Settings (each tab). On each, scroll top to bottom. Check:
- No sideways scroll
- Content never hides behind the sticky topbar
- Every interactive pill or button is tappable (≥44 px finger target)
- No element overlaps another

- [ ] **Step 4: Commit**

```bash
git add public/app.html
git commit -m "feat(mobile): page-specific polish for Library, Evidence, History, Matrix, Settings"
```

---

## Task 8: Final manual iPhone audit + regression sweep

**Files:** none modified unless bugs found.

- [ ] **Step 1: Desktop regression**

Resize a desktop browser to ≥1024 px. Load `/`, `/signin`, `/forgot`, `/reset`, `/app`. Everything should look identical to pre-change. Any visual diff → our mobile CSS is leaking. Tighten media-query scope.

- [ ] **Step 2: iPhone emulation audit**

Chrome DevTools device mode, iterate:
- iPhone SE (375 × 667)
- iPhone 12/13/14 (390 × 844)
- iPhone 14 Pro Max (430 × 932)

For each, load every page and exercise:
- Landing: scroll to bottom, tap every CTA
- Signin: toggle between Sign in / Create account, tap Google button, focus inputs (no zoom)
- Forgot: submit form
- App: open drawer, navigate to each page, open a modal, close it, open pricing modal

Checklist per device:
- [ ] No horizontal scroll on any page
- [ ] No text overlapping another element
- [ ] Every button/link is at least 44×44 tappable
- [ ] Inputs do not auto-zoom on focus
- [ ] Drawer open/close animates smoothly
- [ ] Safe-area respected (content does not hide under notch or home indicator when tested in iOS Simulator if available)

- [ ] **Step 3: Real iPhone test (if available)**

If you have an iPhone on the same network, point Safari at `http://<your-machine-ip>:<port>/`. Repeat the audit. iOS Safari sometimes differs from Chrome's emulation — particularly around `position:fixed`, `100vh`, and scroll chaining. Fix anything that emulation missed.

- [ ] **Step 4: Lighthouse mobile pass (optional but recommended)**

In Chrome DevTools → Lighthouse → Mobile → Accessibility + Best Practices. Aim for green on "Tap targets are sized appropriately" and "Content is sized correctly for the viewport".

- [ ] **Step 5: Final commit if any follow-up fixes were made**

```bash
git add <files>
git commit -m "fix(mobile): audit findings from iPhone manual test"
```

- [ ] **Step 6: Ready to open a PR**

Branch: `feat/auth-and-limits` (current). Push, open a PR titled "Mobile iPhone revamp" summarizing:
- Shared `mobile.css` primitives
- Per-page responsive rules for all 5 HTML files
- New drawer sidebar for the app shell
- No behavior changes on desktop

---

## Done when

Every page in `public/` renders correctly on an iPhone emulation at 375 px through 430 px with:
1. Zero horizontal scroll
2. Zero element overlap
3. Zero iOS form-focus zoom
4. A working drawer sidebar in the app shell
5. Unchanged desktop visual appearance
