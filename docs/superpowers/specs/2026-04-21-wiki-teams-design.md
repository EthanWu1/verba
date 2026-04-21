# Wiki — Teams Spec
_Date: 2026-04-21_

## Overview

New **Teams** page in Verba: search any debate team by school code (e.g. "Memorial EW"), browse their compiled arguments scraped from opencaselist.org, see how many times each argument was read (from round report appearances), download as .docx, or inject into the assistant for analysis.

This is subsystem 1 of 3 new nav pages (Tournament, Teams, Rankings).

---

## Navigation

Three new sidebar items added after Library:
- **Tournament** — tabroom.com scraping, threat lists, calendar (separate spec)
- **Teams** — this spec
- **Rankings** — auto-calculated circuit rankings (separate spec)

---

## Data Layer

### New SQLite Tables

```sql
CREATE TABLE IF NOT EXISTS wiki_teams (
  id           TEXT PRIMARY KEY,       -- e.g. "memorial-ew"
  school       TEXT NOT NULL,          -- "Memorial"
  code         TEXT NOT NULL,          -- "EW"
  fullName     TEXT NOT NULL,          -- "Memorial EW"
  event        TEXT,                   -- "ld" | "pf" | "policy"
  pageUrl      TEXT NOT NULL,          -- opencaselist page URL
  lastCrawled  TEXT,                   -- ISO timestamp, NULL = not yet fetched
  crawlStatus  TEXT DEFAULT 'pending'  -- 'pending' | 'crawling' | 'done' | 'error'
);

CREATE INDEX IF NOT EXISTS idx_wiki_teams_code ON wiki_teams(code);
CREATE INDEX IF NOT EXISTS idx_wiki_teams_school ON wiki_teams(school);

CREATE VIRTUAL TABLE IF NOT EXISTS wiki_teams_fts USING fts5(
  fullName, school, code, content='wiki_teams', content_rowid='rowid'
);

CREATE TABLE IF NOT EXISTS wiki_arguments (
  id           TEXT PRIMARY KEY,
  teamId       TEXT NOT NULL REFERENCES wiki_teams(id),
  name         TEXT NOT NULL,          -- derived name, e.g. "Util AC"
  side         TEXT NOT NULL,          -- "aff" | "neg"
  readCount    INTEGER NOT NULL DEFAULT 0, -- count of round reports referencing this arg
  fullText     TEXT NOT NULL,          -- full scraped card/case text
  lastUpdated  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wiki_args_team ON wiki_arguments(teamId);

CREATE VIRTUAL TABLE IF NOT EXISTS wiki_arguments_fts USING fts5(
  name, fullText, content='wiki_arguments', content_rowid='rowid'
);

CREATE TABLE IF NOT EXISTS wiki_round_reports (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  teamId       TEXT NOT NULL REFERENCES wiki_teams(id),
  argumentId   TEXT REFERENCES wiki_arguments(id),
  tournament   TEXT,
  round        TEXT,
  opponent     TEXT,
  side         TEXT   -- "aff" | "neg"
);
```

### FTS5 Sync

Both FTS5 virtual tables use `content=` (external content). After each insert/update to `wiki_teams` or `wiki_arguments`, the corresponding FTS table must be updated via `INSERT INTO wiki_teams_fts(wiki_teams_fts) VALUES('rebuild')` (full rebuild after crawl completes, not per-row, to avoid overhead).

### TTL & Freshness

- Team detail TTL = 7 days from `lastCrawled`
- On team select: if `lastCrawled` is NULL or expired → trigger crawl
- Refresh button: resets `lastCrawled` to NULL, triggers immediate re-crawl
- Team list (index) re-crawled on demand or via manual "Re-index" admin action

---

## Authentication

opencaselist.com is a React SPA backed by a REST API at `api.opencaselist.com`. All GET endpoints require a valid Tabroom session cookie (cookie-based auth via `POST /v1/login`).

- Credentials stored in `.env`: `OPENCASELIST_USER`, `OPENCASELIST_PASS`
- Server logs in on startup → stores session cookie in memory
- If any request returns 401 → re-authenticate automatically
- Bulk index crawl: 200ms delay between requests to avoid rate limiter
- **Never commit credentials to git** — `.env` is gitignored

### API Endpoints Used
```
POST /v1/login                                                        → session cookie
GET  /v1/caselists                                                    → list all caselists (ld, pf, policy + year)
GET  /v1/caselists/{caselist}/schools                                 → all schools in a caselist
GET  /v1/caselists/{caselist}/schools/{school}/teams                  → teams for a school
GET  /v1/caselists/{caselist}/schools/{school}/teams/{team}/rounds    → round reports
GET  /v1/caselists/{caselist}/schools/{school}/teams/{team}/cites     → arguments/cards
```

---

## Scraping Strategy

### Phase 1 — Team Index (seed)
- On first app start (or manual re-index): crawl opencaselist.org team list pages
- Parse school codes, team names, event, page URLs → insert into `wiki_teams`
- Includes all teams with any content (not just TOC circuit) — TFA State, etc.
- This is a lightweight pass: no case file content, just metadata

### Phase 2 — Team Detail (on-demand)
- Triggered when user selects a team with expired/missing `lastCrawled`
- Fetch team's wiki pages: case files (1AC, 1NC, blocks) + round reports
- Parse arguments → name = opencaselist page/section heading (e.g. "Util AC", "Cap K NC") → count round report appearances per argument
- Write to `wiki_arguments` + `wiki_round_reports`
- Set `crawlStatus = 'done'`, update `lastCrawled`

### Error Handling
- Network errors → `crawlStatus = 'error'`, show retry button in UI
- Partial scrapes → save what was fetched, mark as stale

---

## UI Layout

### Three-Panel Split (full height, within Teams page)

```
┌──────────────────────────────────────────────────────────────────┐
│ sidebar │  Panel 1 (180px)  │  Panel 2 (220px)  │  Panel 3 (flex) │
│  nav    │  Team Search/List │  Arguments List   │  Argument Detail │
└──────────────────────────────────────────────────────────────────┘
```

All panels use existing CSS variables: `--font-ui`, `--ink`, `--muted`, `--shadow-sm`, `--bg`, border radius, transition timing matching the rest of the app.

---

### Panel 1 — Team Search & List

- Search input at top: FTS5 search against `wiki_teams_fts` (school, code, name)
  - Filters list live on keypress (debounced 150ms)
- Scrollable team list below
- Each row: `{school} {code}` bold + event badge (LD / PF / POL) + muted
- Active team: highlighted background + left border accent (matches existing `.lib-tab.active` style)
- Footer: team count, "Re-index All" button (any logged-in user)

**Loading state:** skeleton rows (pulsing gray bars matching existing skeleton pattern) while index crawl runs on first load.

---

### Panel 2 — Argument List

- Shown after team selected
- Header: team full name, event, `lastCrawled` relative time (e.g. "2d ago"), **↻ Refresh** button
- Below header: **⬇ Download All (.docx)** button
- Argument rows, sorted by `readCount` descending:
  - Argument name (bold)
  - Side badge: `AFF` (blue) or `NEG` (red)
  - Read count: `14×` (muted)
  - Active argument: highlighted

**Loading state (crawling):**
- Spinner with animated progress message cycling through: "Fetching cases…", "Parsing round reports…", "Indexing arguments…"
- Animation: CSS fade-in/fade-out on message text (0.4s ease), spinner matches existing app spinner
- Once done: arguments fade in with staggered `animation-delay` per row (30ms apart)

**Error state:** "Failed to load — [Retry]" with muted error text.

---

### Panel 3 — Argument Detail

- Shown after argument selected
- Header: argument name + side badge + `{n}×` read count
- Action bar (top right):
  - **Ask ↗** — inject into assistant (see Integrations)
  - **⬇ .docx** — download this argument only
  - **Copy** — copy full argument text to clipboard (matches existing copy feedback: brief "Copied!" toast)
  - **↻ Refresh** — re-scrape this team
- Full argument text below: rendered as styled card body (tag / cite / body blocks matching existing `.card` component styles)
- Scrollable independently

**Animations:**
- Panel 3 slides in from right on first argument select: `transform: translateX(100%) → translateX(0)`, `transition: 0.22s ease`
- Content fades in after slide: `opacity 0 → 1`, `0.15s` delay
- Matches existing panel open animations (see `#assistant-panel` in `app-main.js`)

---

## Integrations

### Ask ↗ Button
- Opens assistant panel (same as clicking assistant button)
- Starts fresh chat session with argument injected as system-level reference:
  ```
  [Reference: {argument name} — {team} ({side})]
  {full argument text}
  ```
- Assistant panel pre-populated with context; user types their question

### ⬇ .docx Download
- Reuses existing `server/services/docxBuilder.js`
- Single argument: exports in Verbatim card format (tag / cite / body)
- "Download All": exports all arguments for selected team, grouped by side (Aff first, Neg second)

### Copy Button
- `navigator.clipboard.writeText(fullText)`
- Shows "Copied!" toast for 1.5s (matches existing clipboard feedback pattern in `app-main.js:946`)

---

## New Server Routes

```
GET  /api/wiki/teams              — list/search teams (q param for FTS)
GET  /api/wiki/teams/:id          — get team + trigger crawl if stale
GET  /api/wiki/teams/:id/refresh  — force re-crawl
GET  /api/wiki/arguments/:id      — get single argument
GET  /api/wiki/teams/:id/export   — download all arguments as .docx
GET  /api/wiki/arguments/:id/export — download single argument as .docx
POST /api/wiki/reindex            — re-crawl team index (any logged-in user)
```

New route file: `server/routes/wiki.js`

New service file: `server/services/wikiCrawler.js` — opencaselist API client. Handles:
- Session management (login, cookie storage, auto re-auth on 401)
- Team index fetch (all caselists → schools → teams)
- Team detail fetch (rounds + cites per team)
- Rate-limited request queue (200ms between requests)

Note: existing `scrapeUrl()` is for single-article card cutting and is NOT reused here.

---

## New Frontend Files

- `public/wiki.js` — Teams page logic (panel state, search, crawl polling)
- No new HTML file needed — Teams page rendered as a `data-page="teams"` section inside existing `app.html`, matching existing page pattern

---

## Style Constraints

- All new CSS uses existing custom properties only (`--font-ui`, `--font-mono`, `--ink`, `--muted`, `--bg`, `--shadow-sm`, `--shadow-md`, accent color)
- No new color values hardcoded
- Animations use same easing and duration patterns as existing transitions (`0.22s ease`, `0.15s ease`)
- Skeleton loaders match existing pattern if one exists, else: `background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%)` animated with `background-size: 200% 100%`
- Mobile: panels collapse to tabbed layout at `max-width: 768px` per `docs/mobile-contract.md`

---

## Out of Scope (this spec)

- Authentication/permissions on wiki data (public read for all users)
- User annotations or edits to scraped arguments
- Rankings integration (separate spec)
- Tournament integration (separate spec)
