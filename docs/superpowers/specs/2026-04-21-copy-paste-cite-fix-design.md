# Copy/Paste + Citation Fix — Design Spec

**Date:** 2026-04-21
**Scope:** Spec A of a 3-part split (A: copy/paste fixes, B: chip persistence, C: Files tab + editor). A ships first.

## Problem

Two related bugs in Verba's card cutter:

1. **Citation rendering mismatch.** The in-app cite display does not match the intended visual spec. Currently `.cite-block .meta` renders at `11.5px` using `var(--font-display)` (Inter), with the bold prefix in gray (`var(--ink-2)`) at `font-weight: 600`. The intended spec is: prefix (LastName YY) in **13pt bold black**, rest of the cite in **11pt regular black**, using the same font family as the card body text (Calibri-compatible sans).

2. **Underline paste unreliability.** Pasting cards (or portions selected via native Ctrl+C) into Microsoft Word sometimes loses underline formatting. Symptom is intermittent and correlates with nested/overlapping styles (bold + underline, highlight + underline). Cause: the copy button path runs through `inlineStyleBody()` which merges styles, but native Ctrl+C relies on the browser's default DOM serialization — and `<u>` tags without an inline `style="text-decoration:underline"` attribute are sometimes stripped by Word's paste filter.

## Goal

- In-app cite display matches the typographic spec exactly (13pt bold black prefix, 11pt regular black rest, body font).
- Native Ctrl+C from inside a card produces the same clipboard output as the copy button.
- Underline survives paste into Microsoft Word reliably, including when combined with bold or highlight.

## Non-goals

- Changing the stored data model for citations (no schema migration).
- Public share page styling, export to PDF/docx, or card-preview thumbnails outside the editor.
- Rebuilding the editor or verbatim feature set (covered in Spec C).

## Approach

Unified clipboard pipeline. A single serializer function is the sole source of truth for what HTML reaches the clipboard, invoked by both the copy button and a scoped `copy` event listener. The editor also normalizes underline tags on input so stored card HTML always carries an inline `text-decoration:underline` style.

### Architecture

```
copy-button click ───────┐
                         ├──► serializeSelectionHtml(range) ──► ClipboardItem(text/html + text/plain)
document 'copy' event ───┘        (inline: b, u, mark, cite split, span wrappers)
(scoped to card DOM)
```

New module: `public/lib/clipboard.js`.

Deprecated and deleted after migration:
- `public/lib/copyExport.js`
- `public/lib/inlineStyleBody.js`

### Serializer contract

```
serializeSelectionHtml(range: Range, opts?: { citeMode?: 'split' | 'passthrough' })
  => { html: string, plain: string }
```

HTML output rules:

- `<b>`, `<strong>` → `<span style="font-weight:700">…</span>`
- `<u>` → `<span style="text-decoration:underline">…</span>`
- `<mark>` → `<span style="background-color:#ffeb3b">…</span>`
- Nested combinations are flattened into a single `<span>` with merged styles (e.g. `<b><u>x</u></b>` → `<span style="font-weight:700;text-decoration:underline">x</span>`).
- Body text default wrap: `<span style="font-size:11pt;font-family:Calibri, Arial, sans-serif">…</span>` when the range spans a card body.
- `.cite-block`: prefix is extracted via regex (below), wrapped in `<span style="font-size:13pt;font-weight:700;color:#000">`, rest in `<span style="font-size:11pt;font-weight:400;color:#000">`.
- Stripped on output: `class`, `data-*`, `<script>`, HTML comments, inline event handlers (`onclick` etc.).
- Preserved: `<a href>`, `<img src alt>`, line breaks, paragraphs.

Plain text output: `range.toString()` with the cite prefix on its own line followed by the rest.

### Cite prefix regex

```
/^((?:[A-Z][a-zA-Z'\-]+|and|&|et\s+al\.?)(?:\s+(?:[A-Z][a-zA-Z'\-]+|and|&|et\s+al\.?))*\s+\d{2,4})/
```

Must match: `Smith 24`, `Van Dyke 24`, `Tuck and Yang 24`, `Smith & Yang 24`, `Last et al. 24`, `Van Dyke and Smith 2024`.

Must not match: lowercase-initial surnames, cites with no year token, cites starting with a non-name word.

### Integration points

1. **Copy button handler** (currently at `public/app-main.js` around line 935): replace the existing cite-splitting + `inlineStyleBody()` logic with a single call to `serializeSelectionHtml(rangeForCard)`. One call site.

2. **Native copy listener** (new, registered once on DOMContentLoaded):
   ```js
   document.addEventListener('copy', e => {
     const sel = window.getSelection();
     if (!sel || !sel.rangeCount) return;
     const range = sel.getRangeAt(0);
     const container = range.commonAncestorContainer;
     const node = container.nodeType === 1 ? container : container.parentElement;
     if (!node?.closest?.('.wb-body, .card-preview, .cite-block')) return;
     const { html, plain } = serializeSelectionHtml(range);
     e.clipboardData.setData('text/html', html);
     e.clipboardData.setData('text/plain', plain);
     e.preventDefault();
   });
   ```
   Selections outside card DOM fall through to default browser behavior.

3. **Underline normalization on input.** In the editor's input handler for `.wb-body [data-field="body"]`, walk newly inserted nodes, and for every `<u>` without an inline `text-decoration` style add `style="text-decoration:underline"`. Also handle the inverse case (`<span style="text-decoration:underline">` with no `<u>` wrapper) — that form is already correct, leave alone.

4. **CSS update** in `public/app.html`:
   ```css
   .cite-block .meta {
     font: 400 11pt/1.35 Calibri, "Helvetica Neue", Arial, sans-serif;
     color: #000;
   }
   .cite-block .meta b {
     font-size: 13pt;
     font-weight: 700;
     color: #000;
   }
   ```
   The cite uses the Calibri stack so the in-app display matches the clipboard output (which already targets Calibri for Word compatibility). Do not use `var(--font-display)` here — that is Inter and is for UI chrome, not body/cite text. If a `--font-body` variable is introduced later, swap the stack to use it so cite display and copy output stay aligned in one place.

### Mobile parity

Per `docs/mobile-contract.md`, check the `@media (max-width:768px)` block in `app.html`. The 11pt/13pt absolute values render acceptably on mobile (~14.7px / ~17.3px). No mobile override needed. If crowding occurs in cards grid at <400px widths, an implementation follow-up may scale to 10pt/12pt inside the mobile block — not a blocker.

## Testing

**Unit tests** — new file `public/lib/clipboard.test.js` (node + jsdom, or equivalent harness already used in the repo if one exists):

- Regex matches: all 6 positive examples above.
- Regex rejects: `smith 24` (lowercase), `Smith` (no year), `and Yang 24` (starts with conjunction).
- Serializer flattens `<b><u>x</u></b>` to single span with both styles.
- Serializer inlines `<mark>` background color.
- Serializer strips `class` and `onclick` attributes.
- Cite split: `"Smith 24, Professor…"` → prefix `"Smith 24"`, rest `", Professor…"`.
- Cite split: `"Van Dyke and Smith 2024, Source…"` → full multi-word prefix captured.

**Manual QA checklist** (recorded in `public/lib/clipboard.qa.md`):

- [ ] Copy button → paste into Word desktop: cite styled 13pt bold + 11pt regular, body retains bold/underline/highlight.
- [ ] Ctrl+C selection inside card → paste into Word desktop: identical output.
- [ ] Underline spanning bold text survives Word paste.
- [ ] Underline spanning highlight survives Word paste.
- [ ] Paste into Google Docs preserves at least bold + underline (best-effort; Docs has its own filter).
- [ ] Two-surname cite (`Van Dyke 24`) renders correctly in-app and in copied output.
- [ ] `et al.` cite renders correctly.
- [ ] Mobile view (viewport ≤ 768px): cite legible, no overflow.

## Open questions

None remaining — all resolved in brainstorming.

## Out of scope (for later specs)

- Spec B: chip persistence across sessions (small).
- Spec C: Files tab + folder/project rename + rich-text doc editor with embedded cards (large).
- Export to docx/pdf.
- Card-to-doc insertion (handled in Spec C).
