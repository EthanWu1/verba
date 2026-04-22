# Card Cutter UI Rework + Carousel Persistence — Design Spec

**Date:** 2026-04-22
**Scope:** Replaces original Specs B1 (chip persistence) and B3 (UI overhaul) — user chose to combine them into a single redesign of the cutter workspace. Spec B2 (cutter prompt overhaul) remains separate.
**Previous spec:** `docs/superpowers/specs/2026-04-21-copy-paste-cite-fix-design.md` (Spec A, shipped).

## Problem

The current cutter workspace has three related UX problems:

1. **Cards cut in a session are ephemeral.** A `queues[]` array holds chip-style indicators of recently cut cards, but this state is in-memory only. A page reload wipes them; no history, no easy way to flip between the last few cuts.

2. **The source panel is mostly noise.** It eats roughly half the cutter's horizontal space to show article text (which the user rarely re-reads once a cut starts) and doubles as a phase-log host during cut execution. The phase log looks like a terminal, which feels out of place in an otherwise polished product.

3. **Chips are a weak UI.** The staging row of chips communicates status but isn't something you can actually interact with — you can't flip back to a card cut two minutes ago, edit it inline, or review its body.

## Goal

Replace chips + source panel + separate editor with a single animated carousel:

- Each recent card is a full-size, in-place editable item in the carousel.
- Navigate left/right with arrow buttons or keyboard.
- Cards persist across browser reloads.
- A compact input bar sits above the carousel: segmented length selector, pill-shaped text/URL input with an embedded circular Cut button.
- The article URL is reachable via a small external-link icon pinned to the active card's top-right corner.
- While a cut is running, the carousel shows a "cutting" state card in its slot — thin gradient progress bar + compact monospace log — which fades out and becomes the finished card when the stream completes.

The result: an uncluttered, focused workspace where the card is the main object and auxiliary chrome stays out of the way.

## Non-goals

- Spec B2 cutter prompt tuning (longer cuts, richer highlights) — separate.
- Drag-reorder, pinning, search/filter over carousel items.
- Undo for removed cards.
- Changing the server-side cut endpoint or SSE protocol.
- Changing how cards are saved to the library; `API.mine.save()` is unchanged.

## Architecture

### What gets removed

- `#pane-source` (the source panel wrapper + header + body).
- `#source-handle`, `#source-close`, `#source-reopen` open/close controls.
- `#staging` element and the `<span class="stage-chip">` rendering system.
- `queues[]` array and all chip eviction / rendering code in `public/app-main.js` (around lines 376–475).
- Split-pane CSS for `.pane.source` and sibling `.pane:not(.source)` — the cutter view becomes single-column.
- The phase-log as a standalone host inside the source panel. It moves inside the cutting-state card.

### What gets added

**Input bar — `<header class="cutter-strip">`:**
- Segmented length selector (S / M / L). Active pill is filled dark `#0d0d12`; inactive pills are muted text on a light pill group background. Three buttons, aria-pressed, keyboard-navigable.
- Pill-shaped `<input>` with left-side link icon + placeholder "Paste URL or drop a PDF to cut from…". Accepts drop of `.pdf` files (uses existing upload pathway).
- Circular dark Cut button (↑ arrow SVG) embedded at the right edge of the input pill, 34px square, dark fill, subtle shadow. Disabled state when input is empty and no PDF is pending.

**Carousel — `<section class="card-carousel">`:**
- Full width up to ~1100px, gentle vertical gradient background.
- Single visible card slot at a time (`.card-shell`).
- Flanking `‹` `›` arrow buttons, hidden when at the list edges.
- Page-dot row beneath the card.
- Empty state text when `items` is empty.

**Card shell — `.card-shell`:**
- Inner content identical to today's editor (tag, cite, body — all `contenteditable`), but the shell is bigger (min-height ~480px, 40px vertical + 48px horizontal padding, 18px border-radius, soft drop-shadow).
- Top-right icon stack (16–18px from edges):
  - External-link icon — opens `item.sourceUrl` in a new tab; hidden if `sourceUrl` is falsy.
  - Trash icon — immediate removal from carousel AND library (no modal confirm). A 4-second toast with "Undo" action reinserts at the prior index if clicked.
- Tag line has right-padding so the icon stack never collides with long tag text.

### State model — single source of truth

In `public/app-main.js`, replace `queues[]` and `state.currentCard`:

```js
const carouselState = {
  items: [
    {
      id: string,                // crypto.randomUUID() — stable across reloads, no extra dep
      status: 'cutting' | 'done' | 'error',
      createdAt: number,         // Date.now()
      sourceUrl: string | null,
      sourceLabel: string | null,// optional "example.com" hint for screen readers
      // card fields (empty during cutting):
      tag: string,
      cite: string,
      body_html: string,
      body_markdown: string,
      body_plain: string,
      // ephemeral — not persisted:
      phase: string | null,
      phaseHistory: string[],    // last 5 phase labels, cutting state only
      error: string | null
    }
  ],
  activeIndex: number
};
```

Mutation API (the only way UI code touches the state):

- `pushItem(partial)` — append, set `activeIndex = items.length - 1`.
- `updateItem(id, patch)` — shallow-merge into matching item.
- `removeItem(id)` — splice, clamp `activeIndex`.
- `setActive(index)` — clamp to `[0, items.length - 1]`.
- `clearAll()` — wipe carousel (trash-all action).

Each mutation triggers a render and schedules a save.

### Cut flow

1. User presses Cut (or ↵ in the input).
2. Front-end calls `pushItem({ status: 'cutting', sourceUrl, createdAt: Date.now(), id: crypto.randomUUID()() })` and auto-scrolls the carousel to the new item.
3. Client opens SSE stream to the cut endpoint.
4. Each `phase` event → `updateItem(id, { phase: label, phaseHistory: [...last 4, label] })`.
5. On terminal `done` event → `updateItem(id, { status: 'done', tag, cite, body_html, body_plain, body_markdown, phase: null })`. The server-side `API.mine.save()` call is unchanged from today.
6. On `error` → `updateItem(id, { status: 'error', error: msg, phase: null })`.

## Persistence

**Storage:** `localStorage`, key `verba.cutter.carousel.v1`.

**Format:** JSON of `{ items: Item[], activeIndex: number }` with ephemeral fields stripped:

```js
function serialize(state) {
  return JSON.stringify({
    items: state.items.map(({ phase, phaseHistory, error, ...keep }) => keep),
    activeIndex: state.activeIndex
  });
}
```

**Write cadence:** debounced 400ms after any mutation. Writes are synchronous but tiny (typical cut: ~3–8KB). A debounce prevents thrashing during streaming updates.

**Read on init:** parse, validate shape, clamp `activeIndex`. If parse fails, reset to empty.

**Soft cap:**
- 50 items OR 500KB serialized — whichever hits first.
- Eviction order: oldest `done` or `error` item first. Never evict an item with `status === 'cutting'`.
- Eviction happens in `pushItem` before appending.

**Reload behavior for interrupted cuts:**
- Any item loaded with `status === 'cutting'` is converted on hydrate to `status: 'error', error: 'Cut interrupted by reload'`. SSE streams cannot be resumed mid-run; surfacing this honestly is better than faking "still cutting".

## Animation + navigation

**Card transitions:**

```css
.card-shell {
  transition: transform 280ms cubic-bezier(0.22, 1, 0.36, 1),
              opacity   220ms ease;
}
.card-shell.leaving-left  { transform: translateX(-40px) scale(0.96); opacity: 0; }
.card-shell.leaving-right { transform: translateX( 40px) scale(0.96); opacity: 0; }
.card-shell.entering      { transform: translateX(0) scale(1);       opacity: 1; }
```

The renderer swaps which DOM node is the active shell; previous active runs its `leaving-*` class, next shell starts with `entering` on next frame. No continuous track translation — only the active shell is mounted at full fidelity (contenteditable-wise). Adjacent items show their peek via static previews if future work adds them (not in this spec).

**Keyboard:** when `document.activeElement` is not a `contenteditable` node or input, Left/Right arrows call `setActive(activeIndex ± 1)`. Home / End jump to first / last.

**Mouse:** arrow buttons, dots. Trash icon uses its own click handler; external-link icon is a regular anchor with `target="_blank" rel="noopener noreferrer"`.

**Empty state:** when `items.length === 0`, carousel renders a centered muted message: "No cards yet — paste a URL or drop a PDF above." Dots + arrows hidden.

## Cutting state + phase log replacement

Cutting-state card content (when `status === 'cutting'`):

- Top: 4px gradient progress bar (linear `#3b7cff` → `#9333ea`). Width derived from `phaseHistory.length / expectedPhases` (expected phases default to 5; cap at 95% until done).
- Caption: `Cutting · stage N of 5` (current N = `phaseHistory.length`).
- Compact log block: `background:#0d0d12; border-radius:10px; padding:14px 18px`; font `ui-monospace, Consolas, monospace` 12px; `color:#b9bfd0`; line-height 1.7. Shows the last 5 phases. Current phase is colored `#6ee7b7`, pending ones dimmed.

On `done`:
- Progress bar animates to 100%, holds 150ms, then fades (200ms).
- Log block fades out (200ms).
- Card fields (tag / cite / body) fade in (220ms, 80ms delay) replacing the log.

The source panel and its standalone phase-log host are deleted entirely. There is no reason to show phase logs outside the cutting-state card.

## Testing

**Automated (node --test, no DOM):**

New file `public/lib/carousel.js` — pure state reducers + persistence codec.

Unit cases:

- `pushItem` appends and sets activeIndex to last.
- `updateItem` merges by id; no-op for unknown id.
- `removeItem` splices and clamps activeIndex.
- `setActive` clamps to valid range.
- `clearAll` empties and zeroes activeIndex.
- Persistence codec: serialize strips `phase`, `phaseHistory`, `error`; roundtrip preserves stable fields.
- Soft-cap eviction: when 51st item pushed, oldest `done` is dropped; never drops `cutting`.
- Hydrate: items marked `cutting` on read convert to `error`.

**Manual QA — new file `public/lib/carousel.qa.md`:**

- Empty state renders on first load.
- Cut → cutting-state card appears, progress bar animates, log lines stream.
- Cut finishes → content fades into same shell, no layout shift.
- Reload → same carousel items, same active index, cutting items converted to error with "Cut interrupted by reload".
- Navigate left/right with keyboard, buttons, and dots.
- Trash removes item from carousel AND library (verify via `/api/mine`).
- External-link icon opens `sourceUrl` in a new tab; hidden when sourceUrl is missing.
- 51st cut evicts oldest done card; cutting card is never evicted.
- Mobile layout (≤768px): carousel card becomes edge-to-edge; arrows smaller; input bar stacks segmented pills above input if too cramped.

## Open questions

Resolved in brainstorming.

## Out of scope (future specs)

- Spec B2: cutter prompt overhaul — longer cuts, 30–50 word highlights, complete-thought density, partial-word spans.
- Carousel drag-to-reorder.
- Pinned / starred cards.
- Per-card undo history.
- Search or filter across carousel items.
- Sharing / export of carousel state across devices.
