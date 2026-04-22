# TOC Tournament — Spec
_Date: 2026-04-21_

## Overview

New **Tournament** page in Verba: browse TOC circuit tournaments (LD / PF / Policy only) scraped from tabroom.com, view threat lists for upcoming events, see past results. Subsystem 2 of 3 (after Wiki Teams; Rankings follows).

---

## Navigation

Tournament inserted BEFORE Teams in the sidebar:

```
Cutter | My Cards | Evidence | History | Tournament | Teams | Rankings
```

---

## Data Source

Tabroom public JSON endpoint:
- `GET /index/circuits.mhtml` — list all circuits (HTML). Scrape once to confirm `TOC-UK` → `circuit_id=228`.
- `GET /index/circuit/index.mhtml?circuit_id=228` — HTML list of all TOC tournaments (~178 across all years). Regex-extract `tourn_id=N` links.
- `GET /api/download_data.mhtml?tourn_id=X` — public JSON for each tournament. Content-Type: `application/json`.

No authentication required. Rate limit: **500ms between requests** to be polite.

### JSON Schema (relevant fields)
```
{
  id, name, webname, start, end, city, state, country,
  categories: [
    { id, abbr, name, settings, events: [
      { id, abbr, name, type,
        rounds: [
          { id, name, type (prelim|elim), start_time, sections: [
            { id, letter, flight, room, ballots: [
              { id, entry, entry_code, entry_name, side (1|2),
                judge, judge_first, judge_last,
                scores: [{ tag (winloss|point), value, speaker? }] }
            ] }
          ] }
        ],
        result_sets: [
          { label, result_keys: [{ tag }], results: [
            { entry, place?, rank?, round?, percentile?, values: [{ result_key, value, priority }] }
          ] }
        ]
      }
    ] }
  ],
  schools: [
    { id, name, code, students: [...], entries: [
      { id, name, code, event, students: [student_id, ...], dropped }
    ] }
  ]
}
```

**Per-ballot extraction:**
- For each `round.sections[].ballots[b]`: opponent = the other ballot's `entry` in same section (NULL if bye/only one).
- `side`: map `1 → 'aff'`, `2 → 'neg'`, else NULL. For PF use `'pro'/'con'` mapping instead? — Keep `aff`/`neg` for uniformity; UI relabels per event.
- `result`: lookup `scores[].tag === 'winloss'`, value 1 → 'W', 0 → 'L'.
- `speakerPoints`: first `scores[].tag === 'point'` value (REAL), or NULL if none.
- `roundType`: `round.type` is `'prelim'` or `'elim'`.
- `roundName`: `round.name` (number for prelims, label for elims like "Finals").

**Final Places + Speaker Awards extraction:**
- `result_sets[].label === 'Final Places'`: each `result` has `entry`, `place` ("1st", "Finals", etc.), `rank`. Insert into `toc_results`.
- `result_sets[].label === 'Speaker Awards'`: iterate results sorted by values[priority=N for canonical tag]. Assign speakerRank by index; pull one canonical speaker-points value (first `result_keys[i].tag === 'Pts'`). Merge into `toc_results` via UPDATE on `(tournId, entryId, eventAbbr)`.

### Bid Level Inference

For each LD/PF/CX event, find `result_sets[].label` matching `/bid/i` (e.g. `"TOC Qualifying Bids"`). Count entries with a value of `"Full"`:

| Full bids | Bid level |
|-----------|-----------|
| 64        | Triples   |
| 32        | Doubles   |
| 16        | Octas     |
| 8         | Quarters  |
| 4         | Semis     |
| 2         | Finals    |
| (else)    | NULL      |

Verified against Greenhill Fall Classic 2025 (LD=16 Full → Octas, CX=16 Full → Octas, PF not offered).

---

## Data Layer

### New SQLite Tables

```sql
CREATE TABLE IF NOT EXISTS toc_tournaments (
  tourn_id     INTEGER PRIMARY KEY,
  name         TEXT NOT NULL,
  webname      TEXT,
  city         TEXT,
  state        TEXT,
  country      TEXT,
  startDate    TEXT NOT NULL,
  endDate      TEXT NOT NULL,
  season       TEXT NOT NULL,          -- e.g. "2025-26"
  lastCrawled  TEXT
);
CREATE INDEX IF NOT EXISTS idx_toc_tourns_season ON toc_tournaments(season, startDate);

CREATE TABLE IF NOT EXISTS toc_tournament_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  tournId      INTEGER NOT NULL REFERENCES toc_tournaments(tourn_id) ON DELETE CASCADE,
  eventId      INTEGER NOT NULL,
  abbr         TEXT NOT NULL,          -- "LD" | "PF" | "CX"
  name         TEXT,
  bidLevel     TEXT,                   -- "Octas" | "Quarters" | "Semis" | "Finals" | NULL
  fullBids     INTEGER NOT NULL DEFAULT 0,
  partialBids  INTEGER NOT NULL DEFAULT 0,
  UNIQUE(tournId, eventId)
);

CREATE TABLE IF NOT EXISTS toc_entries (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  tournId      INTEGER NOT NULL REFERENCES toc_tournaments(tourn_id) ON DELETE CASCADE,
  eventAbbr    TEXT NOT NULL,          -- "LD" | "PF" | "CX"
  entryId      INTEGER NOT NULL,
  teamKey      TEXT NOT NULL,
  schoolId     INTEGER,
  schoolName   TEXT,
  schoolCode   TEXT,
  displayName  TEXT,                   -- entry.code e.g. "Glenbrook North SY"
  earnedBid    TEXT,                   -- 'Full' | 'Partial' | NULL
  UNIQUE(tournId, entryId)
);
CREATE INDEX IF NOT EXISTS idx_toc_entries_team  ON toc_entries(teamKey);
CREATE INDEX IF NOT EXISTS idx_toc_entries_scope ON toc_entries(tournId, eventAbbr);

CREATE TABLE IF NOT EXISTS toc_ballots (
  id               INTEGER PRIMARY KEY,        -- tabroom ballot.id
  tournId          INTEGER NOT NULL REFERENCES toc_tournaments(tourn_id) ON DELETE CASCADE,
  eventAbbr        TEXT NOT NULL,
  roundId          INTEGER NOT NULL,           -- tabroom round.id
  roundName        TEXT NOT NULL,              -- "1", "2", "Finals", "Semis" etc.
  roundType        TEXT NOT NULL,              -- 'prelim' | 'elim'
  entryId          INTEGER NOT NULL,
  opponentEntryId  INTEGER,                    -- the other entry in the same section (NULL for bye)
  side             TEXT,                       -- 'aff' | 'neg' | NULL
  judgeName        TEXT,
  result           TEXT,                       -- 'W' | 'L' | 'bye' | NULL
  speakerPoints    REAL
);
CREATE INDEX IF NOT EXISTS idx_toc_ballots_entry ON toc_ballots(tournId, entryId, eventAbbr);
CREATE INDEX IF NOT EXISTS idx_toc_ballots_round ON toc_ballots(tournId, roundId);

CREATE TABLE IF NOT EXISTS toc_results (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  tournId        INTEGER NOT NULL REFERENCES toc_tournaments(tourn_id) ON DELETE CASCADE,
  eventAbbr      TEXT NOT NULL,
  entryId        INTEGER NOT NULL,
  place          TEXT,                         -- "1st" | "Finals" | "Semis" | "Octas" | NULL
  rank           INTEGER,                      -- final placement rank (1 = champion)
  speakerRank    INTEGER,                      -- NULL if not in speaker top N
  speakerPoints  REAL,                         -- canonical adjusted points used for the speaker ranking
  UNIQUE(tournId, entryId, eventAbbr)
);
CREATE INDEX IF NOT EXISTS idx_toc_results_scope ON toc_results(tournId, eventAbbr);

CREATE TABLE IF NOT EXISTS toc_season_bids (
  season       TEXT NOT NULL,
  teamKey      TEXT NOT NULL,
  eventAbbr    TEXT NOT NULL,
  fullBids     INTEGER NOT NULL DEFAULT 0,
  partialBids  INTEGER NOT NULL DEFAULT 0,
  displayName  TEXT,
  schoolCode   TEXT,
  PRIMARY KEY (season, teamKey, eventAbbr)
);
```

### Season Derivation
From `tournaments.startDate`:
- Month ≥ 7 (July onward) → season = `YYYY-(YY+1)` (e.g. Aug 2025 → "2025-26")
- Month < 7 → season = `(YYYY-1)-YY` (e.g. Feb 2026 → "2025-26")

### Team Identity (cross-tournament)
```js
// schoolNameHash = FNV-1a 32-bit hex of lowercased school name (stable, short)
teamKey = `${schoolId || ('h:' + fnv1a(schoolName.toLowerCase()))}:${studentIds.sort().join(',')}`
```
Same roster at different tournaments = same key. Student substitution → new key (accepted tradeoff; matches tabroom's view of team identity).

---

## Scraping Strategy

### Phase 1 — Tournament Index (seed)
- Scrape `/index/circuits.mhtml` → regex `TOC-UK` → extract `circuit_id` (current value: `228`, but confirm at runtime).
- Scrape `/index/circuit/index.mhtml?circuit_id=228` → regex extract all `tourn_id=\d+` links.
- For each `tourn_id`: fetch JSON, filter to LD/PF/CX-bearing tournaments, upsert `toc_tournaments` + `toc_tournament_events` + `toc_entries`.
- **Skip** tournaments where no category has `abbr in ['LD','PF','CX']`.

### Phase 2 — Season Bid Aggregation
After any tournament insert/update, recompute `toc_season_bids`:
```sql
DELETE FROM toc_season_bids WHERE season = ?;
INSERT INTO toc_season_bids (season, teamKey, eventAbbr, fullBids, partialBids, displayName, schoolCode)
  SELECT t.season, e.teamKey, e.eventAbbr,
         SUM(CASE WHEN e.earnedBid = 'Full' THEN 1 ELSE 0 END),
         SUM(CASE WHEN e.earnedBid = 'Partial' THEN 1 ELSE 0 END),
         MAX(e.displayName), MAX(e.schoolCode)
  FROM toc_entries e
  JOIN toc_tournaments t ON t.tourn_id = e.tournId
  WHERE t.season = ?
  GROUP BY t.season, e.teamKey, e.eventAbbr;
```

### Freshness (TTL)
- `GET /api/toc/tournaments/:id`: if `lastCrawled > 24h` AND tournament `endDate >= today`, trigger background re-fetch.
- Past tournaments (end < today) never auto-refresh; manual `Refresh` button only.

### Error Handling
- Individual tournament 404/parse fail → log + mark with `lastCrawled` = current time to avoid retry loop; skip.
- Full seed failure → log per-tournament, continue.

---

## Server Routes

```
GET  /api/toc/seasons                     — list { season, tournamentCount }
GET  /api/toc/tournaments?season=2025-26&when=upcoming|past   — grid data
GET  /api/toc/tournaments/:id             — detail + events + trigger stale refresh
GET  /api/toc/tournaments/:id/threats/:event — threat list rows (event = LD|PF|CX)
GET  /api/toc/tournaments/:id/results/:event — final places + speaker awards (past tournaments)
GET  /api/toc/entries/:entryId/pairings      — per-entry round history (W/L, side, opponent, judge, points)
GET  /api/toc/tournaments/:id/refresh     — force re-fetch (requires session cookie via server/middleware/requireUser)
POST /api/toc/reindex                     — full re-seed (requires session cookie via server/middleware/requireUser)
```

New route file: `server/routes/toc.js`.
New service files: `server/services/tocCrawler.js`, `server/services/tocDb.js`, `server/services/tocIndexer.js`.

---

## UI

### Tournament Page (`#page-tournament`)

- Top bar:
  - Season selector dropdown (populated from `/api/toc/seasons`, default = current season)
  - Two tabs: **Upcoming** (endDate >= today) / **Past** (endDate < today)
- Tournament grid: cards, 3-column desktop / 1-column mobile
- Each card:
  - Name (bold), date range, city + state
  - Event badges: one per LD/PF/CX offered, colored (LD=blue, PF=green, CX=red), with bid level (e.g. `LD · Octas`)
  - Hover: slight elevation + cursor pointer
- Click card → Tournament Detail view (replaces grid, back button in top bar)

### Tournament Detail

- Back button
- Header: tournament name, dates, city, circuit badges
- Event sub-tabs (only those offered): `LD` | `PF` | `CX`
- Upcoming: **Threat List** table
  - Columns: `#` (row number) | `Team` (displayName) | `School` (schoolName + code) | `Season Bids` (fullBids) | `Wiki` (↗ link or grayed-out)
  - Sorted by fullBids DESC, then partialBids DESC, then alphabetical
- Past: **Final Results** table
  - Columns: `Place` | `Team` | `School` | `Bid` (Full/Partial or —) | `Record`
  - Sorted by `toc_results.rank` ASC
  - Sub-section below: **Speaker Awards** — top 20 by `toc_results.speakerRank`
    - Columns: `Speaker #` | `Name` | `Team` | `Points`
- **Entry Detail** (click any row in threat list / final results / speaker awards → modal or drill-in panel)
  - Header: displayName + school + event
  - Table of pairings: columns `Round` | `Side` | `Opponent` | `Judge` | `Result` | `Points`
  - Matches tabroom's per-entry pairings view
  - Data from `GET /api/toc/entries/:entryId/pairings`

### Loading / Error / Empty
- Loading: skeleton rows matching Wiki skeleton pattern + rotating crawl message ("Fetching tournament data…", "Parsing events…", "Computing bids…")
- Error: "Failed to load — Retry" button
- Empty season: "No tournaments indexed yet for 2025-26. Re-index?" button (auth required)

### Styles
- Reuse `--font-ui`, `--font-mono`, `--ink`, `--muted`, `--bg`, `--shadow-sm`, `--hover-bg`
- Event badge classes: `.toc-badge-ld`, `.toc-badge-pf`, `.toc-badge-cx`
- Card grid: CSS grid, `grid-template-columns: repeat(auto-fill, minmax(280px, 1fr))`
- Mobile: `@media (max-width:768px)` → single column, event badges stack

---

## Integration with Teams (Wiki) Page

- Threat list Wiki link → `#teams?team={teamId}` anchor
- Resolution happens in the `/api/toc/tournaments/:id/threats/:event` handler (it joins `toc_entries` against `wiki_teams` and returns `wikiTeamId` per row).
- `teamId` resolution rule:
  - Match `toc_entries.schoolName` against `wiki_teams.school` (exact, case-insensitive)
  - AND match initials derived from `displayName` (e.g. "Glenbrook North SY" → "SY") against `wiki_teams.code`
  - If match: include `wikiTeamId` in threat list row
  - If no match: `wikiTeamId = null`, show grayed-out "↗" link
- Minor change to `public/wiki.js`: on DOMContentLoaded, parse `location.hash` — if `#teams?team=X`, auto-select that team after `initWikiPage` resolves.

---

## Startup

`server/index.js` inside `app.listen` callback (alongside existing Wiki auto-seed):
```js
try {
  const { countTournaments } = require('./services/tocDb');
  const { seedTocIndex } = require('./services/tocIndexer');
  if (countTournaments() === 0) {
    console.log('[toc] No tournaments indexed — seeding...');
    seedTocIndex()
      .then(r => console.log(`[toc] Seeded ${r.tournaments} tournaments, ${r.entries} entries`))
      .catch(err => console.error('[toc] Seed failed:', err.message));
  }
} catch (err) {
  console.error('[toc] Auto-seed init failed:', err.message);
}
```

---

## Rate Limit / Abuse

- 500ms between tabroom requests.
- `_seeding` flag prevents concurrent seed crawls.
- On-demand per-tournament fetch guarded by `lastCrawled > 24h` check + in-flight `Map<tournId, Promise>` to debounce concurrent requests.

---

## Out of Scope (this spec)

- Rankings calculation (separate spec — will reuse these tables)
- Manual team-to-wiki mapping UI (auto-match only)
- Real-time pairings / live round data
- Notifications / reminders for upcoming tournaments
- Cross-season bid history views
