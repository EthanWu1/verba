# Mobile Contract

When you change desktop CSS or add new components under `public/*.html` or `public/assets/*.css`, also update the matching mobile rules. Mobile must keep parity with every desktop change.

## Where mobile rules live

- Shared primitives: `public/assets/mobile.css` (safe-area vars, tap targets, input zoom fix, overflow guards).
- Per-page overrides: the `@media (max-width:768px)` block inside each HTML file's inline `<style>`. Small-phone (≤480px) block follows immediately after.

## Rules

1. **Grids.** Any new `grid-template-columns` with more than one track must have a mobile override collapsing to `1fr` (or `repeat(2, 1fr)` max for chip-like grids).
2. **Fixed widths.** No element with `width: Npx` where N > 300 without `max-width: 100%`. Prefer `min(Npx, 92vw)`.
3. **Inputs.** `font-size >= 16px` on every mobile input, textarea, select (iOS auto-zoom trigger).
4. **Tap targets.** Interactive elements `min-height: 44px` on mobile. No hover-only affordances — anything revealed on `:hover` must be tap-accessible too.
5. **Modals.** Existing `.modal` override in `app.html` makes them full-screen on mobile. Do not override `.modal{width:...}` without adding a mobile fallback.
6. **Hover reveals.** `.row-actions`, tooltips, popovers: if visibility depends on `:hover`, force `opacity:1; pointer-events:auto; position:static` on mobile.
7. **Fixed-position.** Any `position: fixed` element anchored right/bottom must respect `var(--safe-r)` / `var(--safe-b)`.
8. **Global search.** The command palette (`#cmd-trigger`, `#cmd-overlay`, `Cmd/Ctrl+K`) is disabled on mobile. Do not wire new surfaces into it without a mobile alternative.
9. **Hamburger.** `#sb-open-fab` is owned solely by the mobile drawer IIFE at the end of `public/app-main.js`. Do not add extra click handlers to it. Desktop sidebar collapse binds `#sb-toggle` only.
10. **Card preview.** On mobile, tapping a chip opens `window.__verba.openCardPreview({title, cite, html|text, onSave})`. New clickable card surfaces should reuse this modal, not inline popovers.

## Checklist before merging a UI change

- [ ] Added/updated `@media (max-width:768px)` rules for any new class.
- [ ] Tested at 320, 375, 390, 414 widths. Zero horizontal body scroll.
- [ ] New inputs tested on iOS — no auto-zoom.
- [ ] New interactive elements tappable with finger (≥44px).
- [ ] Any new modal still full-screen on mobile.
- [ ] Cmd/Ctrl+K still bypassed on mobile.
