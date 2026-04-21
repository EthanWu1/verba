# UI Polish Sprint — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 14 UI/UX fixes across `app.html`, `landing.html`, and `app-main.js` — visual polish, behavior corrections, and auth redirect.

**Architecture:** All changes are CSS/HTML/JS edits to existing single-file pages. No new files. Test each change by opening the page in a browser after saving.

**Tech Stack:** Vanilla HTML, CSS, JavaScript. No build step. Files live in `public/`.

---

## File Map

| File | Tasks |
|------|-------|
| `public/app.html` | 1, 2, 4, 5, 9 (app), 12, 13 |
| `public/landing.html` | 6, 7, 8, 9 (landing), 10, 11, 14 |
| `public/app-main.js` | 3 |
| `public/assets/mobile.css` | Any layout changes needing mobile parity |

---

## Task 1 — Remove gap below toolbar buttons in card pane

**Files:** `public/app.html`

**What:** Bottom of the card pane has whitespace between the Highlight/Underline/Bold toolbar row and the pane's bottom border.

**Why:** `.pane-foot-tools` uses `padding:6px 14px 2px` and `position:sticky;bottom:0` (CSS line ~332). If the containing flex column has extra height, empty space appears below the toolbar. Remove bottom padding and pin it tight.

- [ ] **Step 1: Find the toolbar CSS**

  In `app.html`, search for `.pane-foot-tools{` (~line 332). Confirm the padding is `6px 14px 2px`.

- [ ] **Step 2: Remove the bottom padding gap**

  Change:
  ```css
  .pane-foot-tools{flex:0 0 auto;display:flex;gap:2px;align-items:center;justify-content:flex-start;padding:6px 14px 2px;border-top:1px solid var(--line-soft);background:#fafafa;position:sticky;bottom:0}
  ```
  To:
  ```css
  .pane-foot-tools{flex:0 0 auto;display:flex;gap:2px;align-items:center;justify-content:flex-start;padding:6px 14px 0;border-top:1px solid var(--line-soft);background:#fafafa;position:sticky;bottom:0}
  ```

- [ ] **Step 3: Also fix the gradient override on the next line**

  The next line re-declares background with gradient. Change to also have no gap:
  ```css
  .pane-foot-tools{background:linear-gradient(180deg,#fafafa,#f5f5f5);padding-bottom:0}
  ```

- [ ] **Step 4: Verify in browser**

  Open `/app`. Load or create a card. Confirm no gap between toolbar icons and the pane bottom border.

---

## Task 2 — X button on research chip (stage-chip) on hover

**Files:** `public/app.html`

**What:** When hovering a `.stage-chip` (the research chips shown while queries run), show an ✕ button that cancels/stops that research job.

**Current state:** `.chip` (smaller inline chip) has `.chip .x` CSS (~line 388). `.stage-chip` has no x button.

- [ ] **Step 1: Add x button CSS for stage-chip**

  After the existing `.stage-chip.active` rule (~line 319), add:
  ```css
  .stage-chip .chip-x{display:none;align-items:center;justify-content:center;width:14px;height:14px;border-radius:50%;background:rgba(0,0,0,.08);color:inherit;font-size:10px;line-height:1;margin-left:2px;cursor:pointer;flex:0 0 auto}
  .stage-chip:hover .chip-x{display:inline-flex}
  .stage-chip .chip-x:hover{background:rgba(0,0,0,.18)}
  ```

- [ ] **Step 2: Find where stage-chips are created in app-main.js**

  Search for `stage-chip stage-pending` in `app-main.js` (~line 453). Chips are created there.

- [ ] **Step 3: Inject x button into chip HTML**

  Find the chip creation code (look for `chip.className = 'stage-chip stage-pending'` and nearby `chip.textContent` or `chip.innerHTML`). Add the x button element:

  ```js
  // After creating chip element and setting its text:
  const xBtn = document.createElement('span');
  xBtn.className = 'chip-x';
  xBtn.innerHTML = '&times;';
  xBtn.title = 'Stop';
  xBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    // dismiss the chip
    chip.classList.add('dismissing');
    setTimeout(() => chip.remove(), 200);
    // cancel the associated job if possible
    if (job && job.abort) job.abort();
  });
  chip.appendChild(xBtn);
  ```

- [ ] **Step 4: Verify in browser**

  Paste a URL in the research bar and submit. Hover the chip — confirm ✕ appears. Click it — chip dismisses.

---

## Task 3 — PDF/URL upload = scrape only, no research

**Files:** `public/app-main.js`

**What:** When user attaches a PDF or pastes a URL and submits, it should scrape and open the source in the pane — but NOT kick off a full AI research job. Research should only run for plain text argument queries.

**Detection logic:** A URL submission (starts with `http://` or `https://`) or an attached file should route to scrape-only. Plain text goes to research.

- [ ] **Step 1: Find the submit handler**

  In `app-main.js`, search for `zone-enter` or `zone-input` to find the research bar submit handler.

- [ ] **Step 2: Identify current routing**

  The handler likely calls something like `startResearch(query)` or posts to `/api/research-source-stream`. Find where the decision is made.

- [ ] **Step 3: Add URL/file detection branch**

  In the submit handler, add detection before the research call:

  ```js
  const raw = zoneInput.value.trim();
  const isUrl = /^https?:\/\//i.test(raw);
  const hasFile = !!window.__verbaAttachedFile;

  if (isUrl || hasFile) {
    // Scrape only — load into source pane, no research
    if (hasFile) {
      // File already uploaded via /api/scrape/file, source pane should already be populated
      // Just clear the input and return
    } else {
      // Trigger scrape-only load for the URL
      await loadSourcePane(raw); // use existing scrape-and-load function
    }
    zoneInput.value = '';
    return; // <-- skip research
  }
  // Existing research flow continues below
  ```

  Adjust function names (`loadSourcePane` or equivalent) to match whatever function currently loads a URL into the source pane.

- [ ] **Step 4: Verify in browser**

  Paste a URL → submit. Source pane loads. No research chip appears, no AI research fires.
  Attach a PDF → submit. Same — source loads, no research.
  Type a plain argument → submit. Research chips appear as before.

---

## Task 4 — My Cards: hide copy/export, show date, hover-to-copy animation

**Files:** `public/app.html`

**What:**
- `.mycard .export-btn` and `.mycard .mc-copy-btn` should NOT show by default or on hover.
- Date should show on the right (already at `position:absolute;top:10px;right:12px`).
- On card hover: date fades out, a copy icon fades in (using existing `.copy-fx` animation pattern).
- Copy icon must NOT be white — use `var(--ink)` or `var(--muted)`.

**Current state:** CSS lines ~882–920. `.mycard .export-btn` and `.mc-copy-btn` are absolutely positioned and shown on hover.

- [ ] **Step 1: Hide the export button permanently**

  Find `.mycard .export-btn` (~line 882). Change `opacity:.92` to `display:none`:
  ```css
  .mycard .export-btn{display:none}
  .mycard:hover .export-btn{display:none}
  ```

- [ ] **Step 2: Repurpose mc-copy-btn as hover-reveal date replacement**

  Change `.mycard .mc-copy-btn` to be hidden by default and positioned over the date on hover:
  ```css
  .mycard .mc-copy-btn{
    position:absolute;top:8px;right:10px;
    width:22px;height:22px;border-radius:5px;display:grid;place-items:center;
    color:var(--muted);background:transparent;border:none;
    opacity:0;transition:opacity .18s ease;cursor:pointer;z-index:2;
  }
  .mycard .mc-copy-btn svg{width:13px;height:13px;stroke-width:1.7;color:var(--ink)}
  ```

- [ ] **Step 3: Animate date out, copy icon in on hover**

  Change `.mycard .date` to transition on hover, and show copy button:
  ```css
  .mycard .date{
    position:absolute;top:10px;right:12px;
    font:11px/1 var(--font-mono);color:var(--muted);
    transition:opacity .18s ease;
  }
  .mycard:hover .date{opacity:0}
  .mycard:hover .mc-copy-btn{opacity:1}
  ```

- [ ] **Step 4: Add copied feedback state**

  Keep the existing `.mc-copy-btn.copied` CSS (green flash, line ~907) but update the color to be visible on white background:
  ```css
  .mycard .mc-copy-btn.copied{color:#047857 !important;background:#dcfce7 !important;border:1px solid #86efac !important;opacity:1 !important}
  ```

- [ ] **Step 5: Mobile parity**

  In `public/assets/mobile.css`, add:
  ```css
  .mycard .mc-copy-btn{opacity:1}
  .mycard .date{opacity:0}
  ```
  So on mobile (no hover), copy button is always visible.

- [ ] **Step 6: Verify in browser**

  Open My Cards. Cards show date in top-right. Hover → date fades, copy icon appears in ink color. Click → green feedback. No export button anywhere.

---

## Task 5 — Profile menu animation: bottom-to-top reveal

**Files:** `public/app.html`

**What:** The profile dropdown `.user-menu` currently reveals top-to-bottom (`clip-path:inset(0 0 100% 0)` → `inset(0 0 0 0)`). Change to reveal bottom-to-top.

**Current CSS** (~lines 1253–1267):
```css
@keyframes um-sweep-down{from{clip-path:inset(0 0 100% 0 round 12px)}to{clip-path:inset(0 0 0 0 round 12px)}}
@keyframes um-sweep-out{from{clip-path:inset(0 0 0 0 round 12px);opacity:1}to{clip-path:inset(0 0 100% 0 round 12px);opacity:0}}
.user-menu{...transform-origin:top center;clip-path:inset(0 0 100% 0 round 12px)...}
```

- [ ] **Step 1: Change the open keyframe**

  The menu appears ABOVE the account row (since account is at sidebar bottom). For bottom-to-top reveal, clip from the top first (bottom of menu appears first):

  Change `um-sweep-down` keyframe:
  ```css
  @keyframes um-sweep-down{from{clip-path:inset(100% 0 0 0 round 12px)}to{clip-path:inset(0 0 0 0 round 12px)}}
  ```

- [ ] **Step 2: Change the close keyframe**

  ```css
  @keyframes um-sweep-out{from{clip-path:inset(0 0 0 0 round 12px);opacity:1}to{clip-path:inset(100% 0 0 0 round 12px);opacity:0}}
  ```

- [ ] **Step 3: Change the initial clip-path**

  In `.user-menu{...}`, change:
  ```css
  clip-path:inset(100% 0 0 0 round 12px);
  ```
  (was `inset(0 0 100% 0 round 12px)`)

- [ ] **Step 4: Change transform-origin**

  Change `transform-origin:top center` → `transform-origin:bottom center` in `.user-menu`.

- [ ] **Step 5: Verify in browser**

  Click profile row at bottom of sidebar. Menu sweeps upward (bottom visible first, top reveals last). Close — reverses direction.

---

## Task 6 — Landing: remove toolbar + "cited 0×" from live demo

**Files:** `public/landing.html`

**What:** The card cutter live demo (`.cutter` section) shows a `Highlight | Underline | Bold | Save` toolbar and "Saved to library · cited 0×" in the save bubble. Remove both.

- [ ] **Step 1: Remove the toolbar**

  In `landing.html`, find (~line 504):
  ```html
  <div class="cut-toolbar">
    <div class="cut-tool" data-i="0">Highlight</div>
    <div class="cut-tool" data-i="1">Underline</div>
    <div class="cut-tool" data-i="2">Bold</div>
    <div class="cut-tool" data-i="3">Save</div>
  </div>
  ```
  Delete this entire `<div class="cut-toolbar">` block.

- [ ] **Step 2: Remove "cited 0×" from save bubble**

  Find (~line 510):
  ```html
  <div class="cut-saved" id="cutSaved"><div class="bub"><svg .../>Saved to library · cited 0×</div></div>
  ```
  Change to:
  ```html
  <div class="cut-saved" id="cutSaved"><div class="bub"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="5 12 10 17 20 7"/></svg>Saved to library</div></div>
  ```

- [ ] **Step 3: Check JS still works without toolbar**

  Search landing.html `<script>` for references to `.cut-tool` or `data-i`. If the demo JS steps through toolbar states, remove or simplify those steps so it still animates (just without the toolbar UI).

- [ ] **Step 4: Verify in browser**

  Scroll to cutter section on landing page. Demo plays — no toolbar shows. Save bubble shows "Saved to library" without "cited 0×".

---

## Task 7 — Landing assistant demo: match actual app UI

**Files:** `public/landing.html`

**What:** The `.asst-demo` in landing uses a simplified chat UI (`.msg.you`, `.msg.bot`, `.av`, `.bubble`). The real app's assistant panel (`app.html`) uses `.ap-msg.user` (dark pill, right-aligned) and `.ap-msg.bot` (transparent, left). Match the landing demo to the real UI.

**Real app UI structure** (from `app.html` ~lines 1141–1175):
- User messages: `<div class="ap-msg user">message text</div>` — dark bg (`#111`), white text, right-aligned, `border-radius:12px`, `max-width:85%`
- Bot messages: `<div class="ap-msg bot"><span class="ap-bot-label"></span>response text</div>` — transparent, left
- Input: `.ap-composer` with textarea and send button

- [ ] **Step 1: Add real assistant CSS to landing.html**

  In landing.html `<style>` block, REPLACE the existing `.msg`, `.asst-body`, `.asst-input`, `.typing` CSS block with the actual app CSS. Copy from `app.html` (lines ~1140–1176):

  ```css
  .asst-body{flex:1;overflow:auto;padding:14px 16px;display:flex;flex-direction:column;gap:10px;min-height:480px}
  .ap-msg{font:13px/1.55 var(--font-ui);max-width:100%;color:var(--ink)}
  .ap-msg.user{align-self:flex-end;padding:7px 11px;border-radius:12px;background:#111;color:#fff;max-width:85%}
  .ap-msg.bot{align-self:stretch;background:transparent;color:var(--ink);border:0;padding:2px 0;white-space:pre-wrap}
  .ap-msg.bot .ap-bot-label{display:inline-block;font:600 10px/1 var(--font-mono);color:var(--muted);letter-spacing:.14em;padding:3px 7px;border:1px solid var(--line);border-radius:4px;background:#fafafa;margin-bottom:8px}
  .ap-msg.bot .ap-bot-label::before{content:'> ';color:#10B981;font-weight:700}
  .ap-msg.bot p{margin:0 0 10px}
  .ap-msg.bot p:last-child{margin-bottom:0}
  .ap-card-chip{display:flex;gap:8px;padding:6px 10px;border:1px solid var(--line);border-radius:6px;background:#fff;margin:4px 0;cursor:pointer;transition:background .2s;align-items:center;font:12.5px/1.35 var(--font-display)}
  .ap-card-chip .ap-cc-tag{font-weight:600;color:var(--ink);max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .ap-card-chip .ap-cc-author{color:var(--muted);font:500 11.5px/1.2 var(--font-mono)}
  .typing{display:inline-flex;gap:3px;padding:6px 0}
  .typing span{width:6px;height:6px;border-radius:50%;background:var(--muted-2);animation:typing 1.2s infinite ease-in-out}
  .typing span:nth-child(2){animation-delay:.15s}
  .typing span:nth-child(3){animation-delay:.3s}
  @keyframes typing{0%,60%,100%{opacity:.3;transform:translateY(0)}30%{opacity:1;transform:translateY(-3px)}}
  .asst-input{display:flex;align-items:center;gap:8px;padding:10px 14px;border-top:1px solid var(--line);background:var(--panel)}
  .asst-input .slash{font:600 10.5px/1 var(--font-mono);color:var(--ink);background:#fff;padding:4px 6px;border:1px solid var(--line);border-radius:4px}
  .asst-input .ph{flex:1;color:var(--muted-2);font-size:13px}
  .asst-input .send{width:28px;height:28px;border-radius:6px;background:var(--ink);color:#fff;display:grid;place-items:center}
  ```

- [ ] **Step 2: Update the injected message structure**

  In landing.html `<script>`, find where `#asstBody` messages are injected (look for `asstBody.innerHTML` or `insertAdjacentHTML`). Change messages to use `.ap-msg.user` and `.ap-msg.bot` structure:

  ```js
  // User message:
  `<div class="ap-msg user">Find cards on sanctions triggering escalation</div>`

  // Bot message:
  `<div class="ap-msg bot"><span class="ap-bot-label">Verba</span><p>Found 3 cards on sanctions escalation…</p>
  <div class="ap-card-chip"><span class="ap-cc-tag">Pressure without exit ramp produces behavior it claims to deter</span><span class="ap-cc-author">Mahbubani · 3/24</span></div>
  </div>`

  // Typing indicator:
  `<div class="ap-msg bot"><div class="typing"><span></span><span></span><span></span></div></div>`
  ```

- [ ] **Step 3: Remove old .msg, .av, .bubble CSS** from landing.html style block.

- [ ] **Step 4: Verify in browser**

  Scroll to assistant section. Demo messages use dark right-aligned user bubbles and transparent bot responses — matches actual app assistant panel.

---

## Task 8 — Landing: remove scratchpad feat, fix slash commands

**Files:** `public/landing.html`

**What:**
- Remove the "Scratchpad + pinned cites" list item from `.asst-feats`.
- Update the "Slash commands" list item with accurate descriptions.

- [ ] **Step 1: Remove scratchpad list item**

  In `landing.html`, find (~line 554):
  ```html
  <li>
    <span class="ico">...</span>
    <span><b>Scratchpad + pinned cites.</b> Drop cards into the thread, pin the ones you need for the 2AR, export the whole block with one keystroke.</span>
  </li>
  ```
  Delete this entire `<li>` block.

- [ ] **Step 2: Update slash commands description**

  Find (~line 546):
  ```html
  <span><b>Slash commands for the grunt work.</b> <code>/find</code>, <code>/compare</code>, <code>/answer</code>, <code>/block</code>.</span>
  ```
  Change to accurate descriptions:
  ```html
  <span><b>Slash commands for the grunt work.</b>
    <code style="font-family:var(--font-mono);font-size:12px;background:var(--panel);padding:1px 4px;border-radius:3px">/find</code> searches your library,
    <code style="font-family:var(--font-mono);font-size:12px;background:var(--panel);padding:1px 4px;border-radius:3px">/compare</code> contrasts two cards,
    <code style="font-family:var(--font-mono);font-size:12px;background:var(--panel);padding:1px 4px;border-radius:3px">/answer</code> drafts a response to an argument,
    <code style="font-family:var(--font-mono);font-size:12px;background:var(--panel);padding:1px 4px;border-radius:3px">/block</code> assembles a full block.
  </span>
  ```

- [ ] **Step 3: Verify in browser**

  Scroll to assistant section. Only 3 feature bullets (100k cards, slash commands, every claim traced). Scratchpad bullet gone. Slash command descriptions are accurate.

---

## Task 9 — Remove filter chips from landing library demo

**Files:** `public/landing.html`

**What:** Remove the `.lib-chips` row (All, Policy, K, Phil, Theory, Tricks buttons) from the evidence library preview section.

- [ ] **Step 1: Remove lib-chips HTML**

  Find (~line 612):
  ```html
  <div class="lib-chips" id="libChips">
    <button class="lib-chip on" data-f="all">All<span class="ct">1,284</span></button>
    <button class="lib-chip" data-f="policy">Policy<span class="ct">812</span></button>
    <button class="lib-chip" data-f="k">K<span class="ct">164</span></button>
    <button class="lib-chip" data-f="phil">Phil<span class="ct">168</span></button>
    <button class="lib-chip" data-f="theory">Theory<span class="ct">72</span></button>
    <button class="lib-chip" data-f="tricks">Tricks<span class="ct">68</span></button>
  </div>
  ```
  Delete the entire `<div class="lib-chips">` block.

- [ ] **Step 2: Remove filter JS**

  In landing.html `<script>`, find the filter click handler for `#libChips` or `[data-f]`. Remove it (items will always show all without filter).

- [ ] **Step 3: Show all items unconditionally**

  Remove any `data-f` attribute checks that hide items. All `.lib-item` elements should be visible.

- [ ] **Step 4: Verify in browser**

  Library section shows search bar + list only. No filter chips row.

---

## Task 10 — Remove cited count and rating from library items

**Files:** `public/landing.html`

**What:** Each `.lib-item` has a `.lib-meta` column showing `<b>0.91</b>cited 12×`. Remove it.

- [ ] **Step 1: Remove lib-meta from all lib-items**

  In `landing.html`, find all occurrences of:
  ```html
  <div class="lib-meta"><b>0.xx</b>cited N×</div>
  ```
  (There are ~7 items, lines ~625–660.) Delete every `.lib-meta` div.

- [ ] **Step 2: Update the lib-item grid**

  In landing.html `<style>`, find:
  ```css
  .lib-item{display:grid;grid-template-columns:72px 1fr 120px;gap:14px;align-items:start;...}
  ```
  Change to:
  ```css
  .lib-item{display:grid;grid-template-columns:72px 1fr;gap:14px;align-items:start;...}
  ```

- [ ] **Step 3: Verify in browser**

  Library items show category badge + title/cite only. No rating column.

---

## Task 11 — Remove source citation line from library items

**Files:** `public/landing.html`

**What:** Each `.lib-item .lib-main` has a `<p class="cite">` showing the author/source (e.g., "Mahbubani · Foreign Affairs · 3/24"). Remove these.

- [ ] **Step 1: Remove all .cite paragraphs in lib-main**

  Find and delete every `<p class="cite">...</p>` inside `.lib-main` elements in the library section. Example:
  ```html
  <!-- DELETE this line in each lib-item: -->
  <p class="cite">Mahbubani · Foreign Affairs · 3/24</p>
  ```
  There are ~7 items. Delete the `.cite` `<p>` from each one.

- [ ] **Step 2: Verify in browser**

  Library items show badge + card title only. No source/author line below the title.

---

## Task 12 — Add animations to settings, pricing toggle, keyboard shortcuts

**Files:** `public/app.html`

**What:**
- Settings page: tab content should animate in when switching tabs.
- Pricing toggle: monthly/yearly switch should animate the price number (already has `.pt-price[data-morph]` CSS but verify it's wired up).
- Keyboard shortcuts modal: add entrance animation.

- [ ] **Step 1: Settings tab content fade-in**

  In `app.html` CSS, find `.spane` (~line 1362). Add:
  ```css
  .spane.on{display:block;animation:spaneIn .22s cubic-bezier(.2,.8,.2,1)}
  @keyframes spaneIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
  ```

- [ ] **Step 2: Settings tab button transition**

  In `.stab` CSS (~line 1354), add:
  ```css
  .stab{...transition:background .14s,box-shadow .14s,color .14s}
  ```

- [ ] **Step 3: Pricing toggle animation — verify price morph is wired**

  In landing.html `<script>`, find the `#price-toggle` click handler. It should toggle `data-plan` on the toggle and trigger the `.pt-price[data-morph]` animation. If it doesn't call the morph animation, add:
  ```js
  document.querySelectorAll('.pt-price[data-morph]').forEach(el => {
    const monthly = el.dataset.monthly;
    const yearly = el.dataset.yearly;
    if (!monthly && !yearly) return;
    el.classList.add('swap');
    setTimeout(() => {
      el.querySelector('.amt').textContent = plan === 'yearly' ? yearly : monthly;
      el.classList.remove('swap');
      el.classList.add('in-new');
      setTimeout(() => el.classList.remove('in-new'), 420);
    }, 200);
  });
  ```
  (CSS for `.pt-price[data-morph]` already exists in landing.html ~line 363.)

- [ ] **Step 4: Keyboard shortcuts modal entrance animation**

  In `app.html`, find the `#ks-modal` or `.ks-modal` element. It likely uses the generic `.inline-modal` or `.modal-backdrop` CSS which already has animations (~line 1204–1208). If it's a custom element, add:
  ```css
  #ks-modal{animation:none} /* handled by backdrop */
  ```
  Verify the modal uses `.inline-modal.open` pattern and the `transform:translateY(8px) scale(.98)` → `translateY(0) scale(1)` animation fires correctly.

- [ ] **Step 5: Verify in browser**

  Settings: switch tabs → content slides up smoothly.
  Landing pricing: click Yearly → prices animate out/in.
  App: open keyboard shortcuts → modal slides in with scale animation.

---

## Task 13 — Fix "Save" button in General settings tab

**Files:** `public/app.html`

**What:** The "Save" button in the General settings tab uses `.sfield-save` which has no border and slightly different sizing from other buttons in the settings. Match it to `.btn .btn-primary` style.

**Current CSS** (~line 1376):
```css
.sfield-save{
  padding:9px 14px;background:var(--ink);color:#fff;border:0;border-radius:8px;
  font:600 13px/1 var(--font-display);cursor:pointer;
}
```

**Target style** (matches `.btn.btn-primary`): same border-radius, border, padding.

- [ ] **Step 1: Update .sfield-save CSS**

  Change:
  ```css
  .sfield-save{
    padding:9px 14px;background:var(--ink);color:#fff;border:0;border-radius:8px;
    font:600 13px/1 var(--font-display);cursor:pointer;
  }
  ```
  To:
  ```css
  .sfield-save{
    padding:7px 12px;background:var(--ink);color:#fff;
    border:1px solid transparent;border-radius:6px;
    font:500 13px/1 var(--font-display);cursor:pointer;
    box-shadow:var(--shadow-sm),0 1px 0 rgba(255,255,255,0.6) inset;
    transition:background .14s;
  }
  .sfield-save:hover{background:var(--lilac-2)}
  ```

- [ ] **Step 2: Verify in browser**

  Open Settings → General. The Save button next to the display name field matches the size and shape of other primary buttons.

---

## Task 14 — Redirect signed-in users from landing to app

**Files:** `public/landing.html`

**What:** When a user visits `landing.html` and is already signed in, redirect immediately to `/app`.

- [ ] **Step 1: Find where VerbaAPI is available on landing**

  Check if `landing.html` includes `api.js`. Search for `<script src` in landing.html. If `api.js` is NOT included, add it before the closing `</body>`:
  ```html
  <script src="api.js"></script>
  ```

- [ ] **Step 2: Add auth check script in landing.html**

  Before the closing `</body>` tag, add:
  ```html
  <script>
  (async () => {
    try {
      const API = window.VerbaAPI;
      if (!API) return;
      const who = await API.auth.me();
      if (who && who.user && who.user.email) {
        window.location.replace('/app');
      }
    } catch (_) {}
  })();
  </script>
  ```

- [ ] **Step 3: Verify no flash**

  The check is async so landing briefly renders. If you want to suppress flash, add to landing.html `<style>`:
  ```css
  body.auth-check{visibility:hidden}
  ```
  And in the script:
  ```js
  document.body.classList.add('auth-check');
  // ... after check ...
  document.body.classList.remove('auth-check');
  ```

- [ ] **Step 4: Verify in browser**

  Sign in. Navigate to `/landing` (or the root if it maps there). Page immediately redirects to `/app`. Sign out → landing page shows normally.

---

## Self-Review

**Spec coverage check:**
1. ✅ Toolbar gap — Task 1
2. ✅ X on chip hover — Task 2
3. ✅ Upload = scrape only — Task 3
4. ✅ My cards date/copy — Task 4
5. ✅ Profile menu animation direction — Task 5
6. ✅ Landing toolbar + cited removal — Task 6
7. ✅ Assistant chat UI match — Task 7
8. ✅ Scratchpad removal + slash commands — Task 8
9. ✅ Evidence preview filters — Task 9
10. ✅ Cited and rating — Task 10
11. ✅ Source citation line — Task 11
12. ✅ Animations (settings, pricing, shortcuts) — Task 12
13. ✅ Save button style — Task 13
14. ✅ Auth redirect — Task 14

**Mobile parity:** Task 4 Step 5 covers mobile copy button visibility. Other tasks are visual-only and don't affect mobile layout.

**Type/selector consistency:** All CSS selectors reference classes verified in the source files. `sfield-save`, `stage-chip`, `mycard`, `user-menu`, `cut-toolbar`, `lib-chips`, `lib-meta`, `spane` all confirmed present.
