# Files Tab + Word-like Editor — Design Spec

**Date:** 2026-04-23
**Status:** Design approved, ready for implementation plan

## Goal

Add a Files tab to Verbatim with a Word/Google-Docs-style rich-text editor. Supports nested folders, auto-saved rich documents, AI-assisted content generation (block builder + analytic writer) pulling from the user's 77k-canonical card library, and native Verbatim formatting (pockets/hats/blocks/tags). Exports to .docx.

## Scope

Included: Files tab navigation, file tree (CRUD + drag-move), rich-text editor with toolbar, AI palette (Ctrl+K), card insertion from library, AI block/analytic generation, autosave, .docx export, native + button copy preserving formatting.

Not included: Docx import (open existing .docx in editor), chat AI in editor, selection rewriting AI, templates, collaboration, sharing, version history.

## Architecture

**Client:** Vanilla JS + Quill 2.x (CDN). Single-page Files tab with tree view and editor view.

**Server:** Express routes on top of SQLite. Reuses existing card retrieval (FTS + sqlite-vec), DeepSeek + Gemini via OpenRouter, and the `docx` npm package for export.

**Data flow:** User edits → Quill change event → 1.5s idle debounce → PATCH `/api/docs/:id` with contentHtml → SQLite. Export: POST `/api/docs/:id/export` → server renders HTML → docx Buffer → client download.

## Storage

New SQLite table `docs`:

```sql
CREATE TABLE docs (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  parentId TEXT NULL,              -- NULL = root
  kind TEXT NOT NULL,              -- 'folder' | 'file'
  name TEXT NOT NULL,
  contentHtml TEXT,                -- NULL for folders
  sortOrder INTEGER NOT NULL DEFAULT 0,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  FOREIGN KEY (parentId) REFERENCES docs(id) ON DELETE CASCADE
);
CREATE INDEX idx_docs_parent ON docs(userId, parentId);
CREATE INDEX idx_docs_updated ON docs(userId, updatedAt DESC);
```

## Layout

### Tab placement

New top-level tab "Files" in main nav, alongside Home, Library, Tournament, Rankings.

### Tree index view (no file open)

- Main sidebar visible (normal app chrome)
- Right pane = file tree
  - Nested folders, indented, triangle expand/collapse
  - Each row: name + (on hover) rename / move / delete / duplicate icons
  - Drag row onto folder → move into that folder; drag onto same-level row → reorder
  - Top toolbar: `[+ New folder]` `[+ New file]` + name-search input
- Empty state: centered `[+ New file]` CTA + hint text

### Editor view (file open)

- **Main sidebar hidden entirely** (editor takes full width)
- Top row 1 (path bar): `[← Files]` + breadcrumb `Folder > Subfolder > File` + save status (`● saving…` animated / `✓ saved`)
- Top row 2 (toolbar): bold, italic, underline, highlight (cyan), font family (Calibri default), font size, H1/H2/H3/H4 buttons (labeled Pocket/Hat/Block/Tag), bullet list, numbered list, `[Insert Card]`, `[Ask AI]`, undo, redo, `[Export .docx]`, `[Copy all]`
- Left pane: vertical outline navbar — collapsible tree of doc's H1-H4 with expand triangles. Matches Verbatim navigation pane style. Click heading → scrolls editor to that heading.
- Right pane: Quill editor, full remaining width

On file open: remember last-opened file id in localStorage. On tab return, reopen that file.

## Editor

**Library:** Quill 2.x loaded from CDN.

**Registered formats:**
- `bold`, `italic`, `underline` (standard)
- `background` (cyan highlight, hex `#00ffff`)
- `font` (Calibri default, Times New Roman, Arial as alternates)
- `size` (11, 13, 16, 22, 26 pt)
- `header` (1-4)
- Custom blot `card-embed`: stores card id + rendered HTML, renders as non-editable block

**Font + size defaults:** Calibri, 11pt for normal body.

### Heading styles

| Level | Role | Style |
|-------|------|-------|
| H1 | Pocket | 26pt bold, solid 1px paragraph border on all four sides (full-width box) |
| H2 | Hat | 22pt bold, double underline |
| H3 | Block | 16pt bold, single underline |
| H4 | Tag | 13pt bold |

Applied via Quill CSS rules on `h1/h2/h3/h4` inside the editor surface and in exported output.

### Cite formatting (inside inserted cards)

- Author-year prefix (e.g. `Smith '24`) — 13pt bold
- Rest of cite line — 11pt Calibri regular
- Matches existing `clipboard.js` spec.

### Body formatting (inside inserted cards)

- 11pt Calibri regular
- `<u>` underlines preserved
- Cyan highlight spans preserved (`background-color:#00ffff`)

## Autosave

- 1.5 second idle debounce on Quill `text-change` events
- Save indicator: `●` pulsing while dirty, transitions to `✓ saved` within 200ms of successful save
- Save failure: `⚠ error saving` + retry button, retry backoff doubles on each failure up to 30s

## Copy behavior

Both native `Ctrl+C` on selection AND `[Copy all]` toolbar button must preserve:
- Heading formatting (H1 box, H2 double underline, H3 underline, H4 bold)
- Card embed formatting (tag + cite + body with underlines + highlights)
- Inline formatting (bold, italic, underline, highlight, font, size)

Implementation: reuse `public/lib/clipboard.js` `serializeSelectionHtml` logic. Extend for heading styles + card-embed unwrapping. Attach clipboard listener on the editor DOM root. Copy button calls same serialization on the full doc.

## Export to .docx

Toolbar `[Export .docx]` button → POST `/api/docs/:id/export` → server converts stored HTML to .docx buffer via the existing `docx` package → client downloads as `<filename>.docx`.

Mapping:
- Quill `<h1>` → `Paragraph` with `HeadingLevel.HEADING_1` + 26pt bold + `border` property on paragraph
- Quill `<h2>` → `HEADING_2` + 22pt bold + double-underline via `Run.underline({ type: 'double' })`
- Quill `<h3>` → `HEADING_3` + 16pt bold + single underline
- Quill `<h4>` → `HEADING_4` + 13pt bold
- `<u>` → `Run.underline({ type: 'single' })`
- Highlight span → `Run.highlight({ color: 'cyan' })`
- `<b>` → `Run.bold`
- Card embed → unwraps to: H4 tag paragraph, cite paragraph (with bold 13pt author-year prefix + 11pt rest), body paragraph (underlines + highlights preserved)

## AI palette (Ctrl+K)

Trigger: `Ctrl+K` or typing `/` at start of line. Opens floating palette anchored to cursor position.

Palette options:

1. **Insert card** — text input, live query against library (FTS + optional vector rerank), top 10 results listed with tag + short cite + body-snippet preview. Arrow keys navigate, Enter inserts, `Esc` closes. Also triggerable as `/card <query>`.
2. **Generate block** — text input describes intent ("China DA uniqueness"). On submit:
   - **Card retrieval**: Gemini 2.5 Flash-Lite retrieves top 10 candidate cards via semantic search + FTS over canonicals (filters: `isCanonical=1`; scoring uses classifier metadata — `argumentTypes`, `argumentTags`, `typeLabel`, `topicLabel` — to bias toward cards matching inferred type/topic from intent and surrounding headings)
   - **Analytics retrieval**: same pass also pulls top 5 relevant passages from the `analytics` FTS table (39k+ imported uncited prose paragraphs, ~776M words of debate-domain writing). These serve as style and domain grounding for DeepSeek.
   - Candidate cards sent to DeepSeek include each card's `tag`, `shortCite`, `body_plain` (trimmed), `argumentTypes`, `argumentTags`, `typeLabel`, `topicLabel`. Retrieved analytics passages are sent as a separate reference block.
   - DeepSeek V3.1 reads intent + 10 candidate cards + 5 analytics passages + surrounding headings, picks 1-3 cards, writes H4 tag and 1-3 sentences of analytic glue. The prompt instructs DeepSeek to ground prose in both the retrieved analytics (for voice and domain detail) and its own trained debate knowledge (for reasoning when the corpus lacks coverage).
   - Result inserted at cursor as H4 tag + card embeds (formatted Verbatim) + analytic paragraphs
   - Below inserted block: "More like this" strip with 4-5 alt candidate cards. Click any card → swap with the currently-selected inserted card. Click `X` to dismiss strip (commits block).
3. **Generate analytic** — text input describes intent. DeepSeek V3.1 writes 1-3 short sentences or short paragraph. No card insertion.
   - **Analytics retrieval**: top 5-10 relevant analytics passages pulled from the `analytics` FTS table by Gemini 2.5 Flash-Lite, matched against intent + surrounding headings.
   - DeepSeek receives: intent, surrounding heading context, retrieved analytics passages. Prompt instructs it to synthesize a short, on-voice analytic paragraph grounded in the retrieved corpus evidence while leaning on its own trained debate knowledge when the corpus is sparse.
   - Inserted at cursor as plain paragraph (no heading).
4. **Insert heading** — Pocket / Hat / Block / Tag shortcuts. Inserts empty heading at cursor ready to type into. Redundant with toolbar buttons but keyboard-friendly.

**AI context:** For options 2 and 3, the nearest preceding H1, H2, H3 headings found by scanning upward from cursor are bundled as `headingContext` into the prompt so AI stays on-topic. (Nearest one of each level; if a level has no preceding occurrence, that field is empty.)

**Models:**
- Retrieval / card picking (RAG): **Gemini 2.5 Flash-Lite** via OpenRouter
- Block + analytic prose: **DeepSeek V3.1** via OpenRouter
- No per-generation model toggle

**Progress UI:** Because generation takes several seconds, palette shows a loading spinner + placeholder text ("Generating block…") while waiting. User can cancel with `Esc`.

## File tree CRUD operations

- **New file** — creates `docs` row with `kind='file'`, `name='Untitled'`, empty `contentHtml`, under currently-selected folder (or root)
- **New folder** — creates `docs` row with `kind='folder'`, no contentHtml, under currently-selected folder
- **Rename** — inline edit name on double-click or rename icon
- **Move** — drag-drop to folder or sibling; updates `parentId` and `sortOrder`
- **Delete** — confirm dialog. Cascades (folder delete = child delete via foreign key ON DELETE CASCADE)
- **Duplicate** — clone row, new id, `(copy)` appended to name

## API endpoints

```
GET    /api/docs              → list all docs+folders for user (shallow, with parentIds for tree build)
GET    /api/docs/:id          → one doc with full contentHtml
POST   /api/docs              → create (body: { kind, name, parentId, contentHtml? })
PATCH  /api/docs/:id          → update (body: partial { name?, parentId?, contentHtml?, sortOrder? })
DELETE /api/docs/:id          → delete (cascades for folders)
POST   /api/docs/:id/export   → returns .docx buffer as attachment
POST   /api/docs/ai/block     → body { intent, headingContext, docId? } → JSON { tag, cards[], analytics }
POST   /api/docs/ai/analytic  → body { intent, headingContext } → JSON { text }
POST   /api/docs/ai/card-search → body { q, k? } → JSON { cards[] } (reuses library semantic search)
```

All doc routes require auth; `userId` enforced server-side.

## Error handling

- Autosave failure → UI indicator + retry backoff, does not lose in-memory edits (stays dirty until save succeeds)
- AI generation failure → palette shows error, offers retry
- Deleted folder with open file → editor returns to tree, shows toast "File deleted"
- Quill crash → fall back to plain `<textarea>` of raw HTML (last resort safety)

## Testing strategy

- Unit tests for HTML → docx mapping (node --test) — every format round-trip
- Unit tests for clipboard serialization (extends existing `clipboard.test.js`)
- Integration test for `/api/docs` CRUD (create, update, cascade delete)
- Integration test for AI block route: mocks LLM, asserts output shape
- Manual QA: open + type + autosave + export + native copy into Word + reimport visually matches

## Open questions

None — all clarified during design.
