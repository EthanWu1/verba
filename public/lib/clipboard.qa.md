# Clipboard Manual QA

Run this checklist after any change to `public/lib/clipboard.js`, the copy button handler, the native copy listener, or `.cite-block` CSS.

## Setup
1. `npm run dev`
2. Open `http://localhost:<port>/app.html`
3. Sign in, open any existing card (or cut a fresh one).

## Copy button — paste into Microsoft Word (desktop)
- [ ] Cite prefix (first surname + year) is 13pt bold black.
- [ ] Rest of cite is 11pt regular black, Calibri stack.
- [ ] Tag line is 13pt bold black above cite.
- [ ] Body preserves bold, underline, highlight (yellow).
- [ ] Nested bold+underline text is still both bold and underlined.
- [ ] Highlight spanning an underline still shows both.

## Native Ctrl+C (no copy button) — paste into Microsoft Word
- [ ] Select a word with underline only → Ctrl+C → paste: underline preserved.
- [ ] Select a phrase with bold + underline → Ctrl+C → paste: both preserved.
- [ ] Select across the cite + body → paste: cite prefix still 13pt bold.

## Google Docs (best-effort)
- [ ] Copy button paste preserves bold + underline (Docs may strip font sizes).

## Two-surname / multi-author cites
- [ ] Cut a card with cite "Van Dyke 24, ..." — prefix captured fully.
- [ ] Cut a card with cite "Tuck and Yang 24, ..." — prefix captured fully.
- [ ] Cut a card with cite "Last et al. 24, ..." — prefix captured fully.

## Mobile (Chrome DevTools device emulation, width ≤ 768px)
- [ ] Cite remains legible (no overflow into next card).
- [ ] 11pt / 13pt sizes render without clipping.

## Regression
- [ ] Copy button on a card with no tag: only cite + body in clipboard.
- [ ] Copy button on an empty card: toast "Nothing to copy".
- [ ] Selection outside `.wb-body` / `.card-preview` / `.cite-block` uses default browser copy (e.g. sidebar text copies plain).
