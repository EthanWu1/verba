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
