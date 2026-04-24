# Chat Tab Design Spec (Phase C)

**Date:** 2026-04-24
**Status:** Design approved, ready for implementation plan
**Replaces:** existing chat/research sidebar in the Cutter page.

## Goal

Turn the AI assistant from an embedded sidebar into a dedicated top-level **Chat** tab modeled after ChatGPT / Claude / Manus / Perplexity. Adds persistent history, per-user context imports (docx for RAG), slash commands (`/analytic`, `/block`, `/explain`), streaming responses, and a Claude-style split-view that renders a formatted block file when `/block` is used.

## Scope

Included:
- New **Chat** top-level tab
- Thread list (sidebar-in-tab), persistent history (SQLite)
- Message list + composer
- Slash commands: `/analytic`, `/block`, `/explain`
- Token streaming via SSE
- Context panel — per-user docx uploads indexed into `analytics` FTS for RAG
- Split-view display pane when `/block` output arrives (read-only formatted render, not an editor)
- Remove existing chat/research sidebar

Not included:
- Real-time collaboration, sharing, teams
- Rich editor on generated blocks (display only; user copies out)
- Image/audio/file attachments other than docx for context
- Non-debate general AI chat (scoped to debate domain)

## Architecture

**Client:** vanilla JS single-page Chat tab, single-column by default with on-demand overlays:
- **Main column** (flex, centered, max 780px) — active message thread + composer
- **Top-left History button** (like Claude Code) — click opens floating thread-list dropdown; click thread to switch; archive toggle inside dropdown
- **Top-left Context button** — opens floating panel listing user's uploaded docx context; `+ Import docx` inside. Context is universal across threads (not per-thread).
- **Inline block file cards** — when `/block` output arrives, chat shows a clickable "file" card (tag + cite snippet + "Open" affordance). Clicking opens **split-view** on the right (50% width). Clicking X or the same file card again closes split-view.

**Server:** new Express router `server/routes/chat.js` replacing the old (or reuse file, rewrite handlers). Reuses:
- `server/services/llm.js` (`complete`, `parseJSON`) — OpenRouter wrapper
- `server/services/analytics` (FTS) — 39k passages existing corpus + user-imported docx
- `server/services/vectorSearch.js` — card retrieval
- `server/services/docxImport.js` — docx→text extraction for context

**Data flow** (streaming):
1. User submits message with optional slash command.
2. Server identifies command, runs parallel: (a) RAG retrieval (cards + analytics) and (b) prefetch LLM streaming.
3. Server SSE-streams LLM tokens to client.
4. Client appends tokens to active message bubble.
5. `/block` output arrives as JSON (not streaming) on separate endpoint; opens right-split display pane.

## Storage

New SQLite tables:

```sql
CREATE TABLE chat_threads (
  id         TEXT PRIMARY KEY,
  userId     TEXT NOT NULL,
  title      TEXT NOT NULL,
  archived   INTEGER NOT NULL DEFAULT 0,
  createdAt  INTEGER NOT NULL,
  updatedAt  INTEGER NOT NULL
);
CREATE INDEX idx_chat_threads_user ON chat_threads(userId, archived, updatedAt DESC);

CREATE TABLE chat_messages (
  id         TEXT PRIMARY KEY,
  threadId   TEXT NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  content    TEXT NOT NULL,
  command    TEXT NULL,                -- '/block' | '/analytic' | '/explain' | NULL
  blockJson  TEXT NULL,                -- for /block output
  createdAt  INTEGER NOT NULL,
  FOREIGN KEY (threadId) REFERENCES chat_threads(id) ON DELETE CASCADE
);
CREATE INDEX idx_chat_messages_thread ON chat_messages(threadId, createdAt);

CREATE TABLE chat_context (
  id          TEXT PRIMARY KEY,
  userId      TEXT NOT NULL,
  name        TEXT NOT NULL,          -- original filename
  kind        TEXT NOT NULL,          -- 'docx' (extensible later)
  wordCount   INTEGER NOT NULL,
  content     TEXT NOT NULL,          -- extracted plain text
  createdAt   INTEGER NOT NULL
);
CREATE INDEX idx_chat_context_user ON chat_context(userId, createdAt DESC);

-- FTS virtual for chat_context
CREATE VIRTUAL TABLE chat_context_fts USING fts5(
  content, name, content='chat_context', content_rowid='rowid'
);
```

Triggers to sync `chat_context_fts` with `chat_context` mirror the existing `analytics_fts` pattern.

## Endpoints

```
GET    /api/chat/threads                  → list user's threads (non-archived by default, ?archived=1 to include)
POST   /api/chat/threads                  → create thread (body: { title? })
PATCH  /api/chat/threads/:id              → update { title?, archived? }
DELETE /api/chat/threads/:id              → cascade delete

GET    /api/chat/threads/:id/messages     → all messages in thread
POST   /api/chat/threads/:id/messages     → SSE stream assistant response (body: { content, command })
                                              -- writes user message + assistant message rows
                                              -- command='/block' returns JSON (no stream) with blockJson populated

GET    /api/chat/context                  → list user's context docs
POST   /api/chat/context                  → multipart upload docx → extract + index
DELETE /api/chat/context/:id              → remove (also strips from FTS)
```

Auth: all routes behind `requireUser` middleware.

## Slash commands

### `/explain [topic | pasted text]`
- Default general debate Q&A
- If user types `/explain this:\n<paragraph>` the paragraph becomes the subject
- Model: **Gemini 2.5 Flash-Lite** (fast, cheap)
- Streamed response
- No card insertion

### `/analytic <intent>`
- Writes 1-3 sentences grounded in user's analytics corpus + user's context docs
- Retrieval: top 10 passages from `analytics` + `chat_context` FTS
- Model: **Gemini 2.5 Flash-Lite** streaming
- Response shown inline in chat bubble as plain paragraph

### `/block <intent>`
- Builds a full block (1-3 cards + tag + optional analytic glue) — same as Files-tab design
- Retrieval: top 10 canonicals (cards FTS + vector rerank) + top 5 analytics/context passages
- Model: **DeepSeek V3.1** (better reasoning for structured output)
- Response NOT streamed — arrives as JSON: `{ tag, cardIds, analyticBefore, glueBetween[], analyticAfter }` (and inline candidate-card payloads)
- Server persists to `chat_messages.blockJson`.
- On arrival: assistant message renders as an inline **file card** in the chat thread (icon + tag + short cite preview + `[Open ▸]`). Clicking the card opens split-view on the right; clicking it again (or ✕/Esc in split-view) closes it.
- Split-view pane shows fully formatted block (tag as H4, cite bold 13pt + 11pt, body with underlines + highlights). Pane has **Copy all** button (reuses existing `clipboard.js` serializer) and **Close** button. Read-only display — no editor.

## Context import

UI: Context panel (collapsible section above thread list). Shows list of user's imports with remove buttons. `+ Import docx` opens file picker. On upload:
1. Server multipart endpoint extracts text via `docxImport.js` (already handles paragraphs).
2. Inserts row into `chat_context`; FTS trigger indexes.
3. During retrieval, `chat_context_fts` is queried alongside `analytics_fts` (scoped to `userId` for privacy).

Storage: plain-text content only (no formatting preserved — user just wants AI reference). Average docx ≈ 50KB text. 100 files ≈ 5MB per user. FTS handles.

## Speed

Techniques:
- **SSE streaming** for `/explain` and `/analytic` (tokens arrive incrementally → perceived latency near-zero).
- **Parallel RAG + LLM** — retrieval + initial prompt build start simultaneously; LLM stream begins as soon as prompt assembled.
- **LRU cache** on retrieval layer (key = normalized query hash + userId; 1000-entry cap; 10min TTL). Skips duplicate FTS on repeated questions.
- **Default Gemini 2.5 Flash-Lite** for `/explain` + `/analytic` (p50 ≈ 800ms first token on OpenRouter).
- **DeepSeek V3.1 only for `/block`** (worth the extra latency for structured output).
- Prefetch thread messages when thread clicked (no spinner on message render).

## Layout

### Chat tab structure

```
Default (no block open):
┌─ Chat Tab ─────────────────────────────────────────────────────┐
│ [History] [Context] [+New]                                     │
│                                                                │
│             ┌──────────────────────────────────┐               │
│             │  Message list (scroll, centered) │               │
│             │                                  │               │
│             │  user: /block China uniqueness   │               │
│             │  assistant: 📄 block-2026-04-24   │<── click card │
│             │             Tag: X Y Z           │   to open     │
│             │             Cite: Smith 24       │   split-view  │
│             │             [Open ▸]             │               │
│             │                                  │               │
│             ├──────────────────────────────────┤               │
│             │  /  Composer              [Send] │               │
│             └──────────────────────────────────┘               │
└────────────────────────────────────────────────────────────────┘

Block file open (split-view on right):
┌─ Chat Tab ─────────────────────────────────────────────────────┐
│ [History] [Context] [+New]                                     │
│ ┌──────────────────────┐ ┌────────────────────────────────────┐│
│ │  Message list        │ │ block-2026-04-24         [Copy][✕] ││
│ │                      │ │                                    ││
│ │  ...                 │ │  [H4 Tag]                          ││
│ │  📄 block-2026-04-24  │ │  [Cite 13pt bold / 11pt]           ││
│ │     [Open ▸] (active)│ │  [Body with u + hl]                ││
│ │                      │ │                                    ││
│ │  Composer      [Send]│ │                                    ││
│ └──────────────────────┘ └────────────────────────────────────┘│
└────────────────────────────────────────────────────────────────┘

History dropdown (from top-left button, floating overlay):
┌───────────────────────────┐
│ Threads          [Archive]│
│ + New thread              │
│ ─────                     │
│ • China DA work  ← active │
│ • Framework ideas         │
│ • Topicality research     │
└───────────────────────────┘

Context panel (from top-left button, floating overlay):
┌───────────────────────────┐
│ Context (universal)       │
│ + Import docx             │
│ ─────                     │
│ • 2024 Camp Notes.docx    │
│ • China Backfile.docx  [✕]│
└───────────────────────────┘
```

Split-view opens by clicking a block file card in the message list. Close by X, Esc, or clicking the same card again. Context + History are floating dropdowns dismissed by outside-click or Esc.

### Composer

- Single-line expanding textarea (auto-grows to 6 rows max)
- Slash-command autocomplete: typing `/` at line start shows dropdown with 3 options
- Enter to send; Shift+Enter for newline
- Loading indicator while streaming

## Removing old chat sidebar

Files to touch:
- `public/app.html` — remove chat/research sidebar markup from `#page-home`
- `public/app-main.js` — remove sidebar open/close handlers, research-specific input handling
- `server/routes/chat.js` — rewrite (keep route file, replace handlers with new thread/message API)
- any CSS rules scoped to `.chat-sidebar` / `.research-dock` / similar

## Error handling

- Upload fail → toast with reason; form stays open
- Streaming error → finalize assistant message with error note; keep partial content
- LLM timeout (>30s) → retry once automatically; second failure shows retry button
- Thread delete requires confirm dialog

## Testing strategy

- Unit: `chatStore` CRUD (threads, messages, context); retrieval query builder
- Unit: slash-command parser
- Integration: SSE stream proxy test (mocked LLM)
- Manual QA: paste docx, ask `/analytic`, verify docx content appears in retrieval trace
- Manual QA: `/block` opens split view with correct formatting (paste into Word → matches Verbatim spec)

## Open questions

None — all resolved.
