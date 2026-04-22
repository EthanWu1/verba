# Rankings — Spec
_Date: 2026-04-21_

## Overview

New **Rankings** page in Verba: Elo-based rankings of LD / PF / CX debaters computed from TOC tournament data (already indexed by the Tournament subsystem). Per-season reset. Clean leaderboard + enriched per-debater profile with rating graph, tournaments, bids, common arguments (via Wiki integration).

Subsystem 3 of 3. Depends on Tournament subsystem tables (`toc_tournaments`, `toc_tournament_events`, `toc_entries`, `toc_ballots`, `toc_results`, `toc_season_bids`).

---

## Navigation

Rankings is the last nav item:
```
Cutter | My Cards | Evidence | History | Tournament | Teams | Rankings
```

---

## Ranking Unit

Each `toc_entries.teamKey` is a "ranked unit". Structure:
- **LD** (solo): `teamKey = {schoolId}:{studentId}` → effectively a single student.
- **PF / CX** (pairs): `teamKey = {schoolId}:{sortedStudentIds}` → a pair roster. If partners rotate mid-season, a new `teamKey` appears (separate entity).

No separate schema distinction needed; `teamKey` unifies both.

---

## Data Layer

### New SQLite Tables

```sql
CREATE TABLE IF NOT EXISTS toc_ratings (
  season       TEXT NOT NULL,
  eventAbbr    TEXT NOT NULL,                -- "LD" | "PF" | "CX"
  teamKey      TEXT NOT NULL,
  displayName  TEXT,
  schoolName   TEXT,
  schoolCode   TEXT,
  rating       REAL NOT NULL DEFAULT 1500,
  roundCount   INTEGER NOT NULL DEFAULT 0,
  wins         INTEGER NOT NULL DEFAULT 0,
  losses       INTEGER NOT NULL DEFAULT 0,
  peakRating   REAL NOT NULL DEFAULT 1500,
  lastUpdated  TEXT NOT NULL,
  PRIMARY KEY (season, eventAbbr, teamKey)
);
CREATE INDEX IF NOT EXISTS idx_toc_ratings_board ON toc_ratings(season, eventAbbr, rating DESC);

CREATE TABLE IF NOT EXISTS toc_rating_history (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  season         TEXT NOT NULL,
  eventAbbr      TEXT NOT NULL,
  teamKey        TEXT NOT NULL,
  tournId        INTEGER NOT NULL,
  roundId        INTEGER NOT NULL,
  roundName      TEXT,
  roundType      TEXT,                        -- 'prelim' | 'elim'
  result         TEXT,                        -- 'W' | 'L'
  ratingBefore   REAL NOT NULL,
  ratingAfter    REAL NOT NULL,
  change         REAL NOT NULL,
  opponentKey    TEXT,
  opponentRating REAL,
  occurredAt     TEXT NOT NULL                -- tournament.startDate (ISO)
);
CREATE INDEX IF NOT EXISTS idx_toc_rating_history_scope ON toc_rating_history(teamKey, eventAbbr, season, occurredAt);
CREATE INDEX IF NOT EXISTS idx_toc_rating_history_tourn ON toc_rating_history(teamKey, tournId);
```

---

## Elo Computation

### Parameters

Starting rating: **1500** (convention from chess).

### K-factor by round type

```
roundType = prelim                  → K_base = 20   (both sides update)
elim round depth (by section count):
  Triples  / 64+ section bracket    → K_base = 35   (winner-only)
  Doubles  / 32                     → K_base = 45
  Octas    / 16                     → K_base = 60
  Quarters / 8                      → K_base = 75
  Semis    / 4                      → K_base = 90
  Finals   / 2                      → K_base = 120
```

Elim round depth is derived by mapping `roundName` to a known label (e.g. `"Finals"`, `"Semis"`, `"Octas"`). If the round name is a number or unknown, use the number of unique entries paired in that round to infer depth (64→Triples, 32→Doubles, 16→Octas, 8→Quarters, 4→Semis, 2→Finals).

### Elim asymmetry

Elim losses do NOT decrease the loser's rating. Only the winner gains. Loser's `ratingBefore` == `ratingAfter`, `change = 0`, `result = 'L'`. A history row is still written for the loser (for graph continuity).

This breaks Elo's zero-sum property on elims; overall ratings trend upward modestly. Acceptable tradeoff per design — encourages attending elim-prone big tournaments without risk.

### K-multiplier by tournament bid level

Bid level is read from `toc_tournament_events.bidLevel` (populated by Tournament subsystem). Bigger bid count → more prestigious / competitive → higher multiplier:

```
Triples  (64 bids)  → K_mult = 1.00
Doubles  (32 bids)  → K_mult = 0.90
Octas    (16 bids)  → K_mult = 0.75
Quarters ( 8 bids)  → K_mult = 0.60
Semis    ( 4 bids)  → K_mult = 0.45
Finals   ( 2 bids)  → K_mult = 0.30
(no bid offered)    → K_mult = 0.20
```

### Round aggregation

Multiple ballots in a single elim section (3-judge panel) aggregate by majority rule to a single `W` / `L` per entry per round. Prelim rounds are single-judge already.

Group `toc_ballots` by `(tournId, eventAbbr, roundId, entryId)`:
- If no ballot with `result` ∈ {'W', 'L'}: skip the round for that entry (incomplete data).
- Else: majority wins. Tie is unreachable in practice (panels are odd), but if it happens skip the round for both entries.

### Pair matching per round

For each `(tournId, eventAbbr, roundId, sectionId)` with exactly 2 entries: one match. Byes (1 entry) produce no match. Sections with 3+ entries (data anomaly) are skipped.

### Formula

For a given match between entries `A` and `B` (ratings `R_A`, `R_B`) in an event at a tournament with bid level `L`:

```
K = K_base(roundType, depth) × K_mult(L)
expected_A = 1 / (1 + 10^((R_B - R_A) / 400))
expected_B = 1 - expected_A
score_A = 1 if A wins else 0
delta_A = K × (score_A - expected_A)
delta_B = K × ((1 - score_A) - expected_B)   // symmetric; = -delta_A on prelim
```

**Prelim:** apply `delta_A` to `R_A`, `delta_B` to `R_B`.
**Elim:** apply `delta_A` to `R_A` only if A won (score_A == 1); `delta_B` to `R_B` only if B won. Loser unchanged (`change = 0`).

### Processing order

1. Determine all seasons touched by the data:
   ```sql
   SELECT DISTINCT season FROM toc_tournaments ORDER BY season;
   ```
2. For each season, gather all rounds in chronological order:
   ```sql
   SELECT b.*, t.startDate, te.bidLevel
   FROM toc_ballots b
   JOIN toc_tournaments t ON t.tourn_id = b.tournId
   JOIN toc_tournament_events te ON te.tournId = b.tournId AND te.abbr = b.eventAbbr
   WHERE t.season = ? AND b.eventAbbr IN ('LD','PF','CX')
   ORDER BY t.startDate ASC,
            CASE b.roundType WHEN 'prelim' THEN 0 ELSE 1 END ASC,
            CASE WHEN b.roundName GLOB '[0-9]*' THEN CAST(b.roundName AS INTEGER) ELSE 99 END ASC,
            b.roundName ASC;
   ```
3. Replay chronologically, maintaining an in-memory `Map<teamKey, rating>` keyed by `(eventAbbr, teamKey)`.
4. Resolve each round's pair, apply formula, upsert `toc_ratings`, insert `toc_rating_history`.

### Recompute strategy

- `rankingsEngine.recomputeRatings(season)`:
  - `DELETE FROM toc_ratings WHERE season = ?`
  - `DELETE FROM toc_rating_history WHERE season = ?`
  - Run full chronological replay for that season.
  - Wrap in a single `db.transaction(...)` for atomicity + speed.
- Idempotent. Safe to call any time.

### Auto-trigger

At the END of `tocIndexer.indexTournament(tournId)`, immediately after `db.rebuildSeasonBids(season)`:
```js
const rankings = require('./rankingsEngine');
rankings.recomputeRatings(season);
```
Also at the END of `tocIndexer.seedTocIndex()`, after the existing season-bids rebuild loop, loop seasons and call `recomputeRatings` for each.

No manual "Recalculate" button exposed to users. If a user wants fresh ratings, they trigger a re-crawl of any tournament in that season (which cascades into a rankings recompute).

---

## Server Routes

```
GET  /api/rankings/seasons                           — { seasons: [...] } with tournamentCount
GET  /api/rankings?season=&event=&page=&q=           — paginated leaderboard
GET  /api/rankings/:teamKey?season=&event=           — profile aggregate
GET  /api/rankings/:teamKey/history?season=&event=   — full history rows for chart
```

No auth required (public read). URL-encode `teamKey` in paths (contains `:` and `,`).

### GET /api/rankings — leaderboard
Query params: `season` (required), `event` (required, one of LD/PF/CX), `page` (default 1), `q` (optional — substring match against `displayName` or `schoolName`).

Response:
```json
{
  "season": "2025-26",
  "event": "LD",
  "page": 1,
  "pageSize": 50,
  "totalCount": 312,
  "rows": [
    { "rank": 1, "teamKey": "...", "displayName": "Harker SD", "schoolName": "Harker School", "schoolCode": "SD", "rating": 1847.2 },
    ...
  ]
}
```

Ranking is `ROW_NUMBER() OVER (ORDER BY rating DESC)` filtered to `roundCount >= 10`.

### GET /api/rankings/:teamKey — profile aggregate

Response:
```json
{
  "teamKey": "797828:1208499",
  "season": "2025-26",
  "event": "LD",
  "rating": { "current": 1847.2, "peak": 1893, "rank": 12, "outOf": 312 },
  "record": { "wins": 24, "losses": 8, "winPct": 0.75 },
  "bids": { "full": 3, "partial": 1 },
  "school": { "name": "Harker School", "code": "SD" },
  "displayName": "Harker SD",
  "tournaments": [
    { "tournId": 36065, "name": "Greenhill Fall Classic", "startDate": "2025-09-18",
      "wins": 6, "losses": 2, "earnedBid": "Full", "place": "Octas" },
    ...
  ],
  "topArguments": [
    { "name": "Util AC", "side": "aff", "readCount": 14, "argumentId": "..." },
    ...
  ],
  "wikiTeamId": "harker-school-sd"
}
```

Top arguments: join to `wiki_teams` using the same code-in-displayName heuristic from Tournament subsystem (`SELECT w.id FROM wiki_teams w WHERE LOWER(w.school) = LOWER(?) AND (' ' || LOWER(?) || ' ') LIKE '% ' || LOWER(w.code) || ' %' LIMIT 1`). If matched, query `wiki_arguments WHERE teamId = ? ORDER BY readCount DESC LIMIT 5`.

### GET /api/rankings/:teamKey/history
Returns all `toc_rating_history` rows ordered by `occurredAt ASC` for the season/event combination. Used for the Elo line chart.

---

## UI

### Nav
New `<button class="nav-item" data-page="rankings">` with a chart-like SVG icon, inserted after the Teams nav item.

### Rankings Page (`#page-rankings`)

Top bar:
- **Season dropdown** (populated from `/api/rankings/seasons`, default current)
- **Event tabs:** `LD` | `PF` | `CX`
- **Search input** (filters `displayName` or `schoolName`, debounced 200ms)

Leaderboard table:
| # | Team | School | Rating |
|---|------|--------|--------|
| 1 | Harker SD | Harker School (SD) | **1847** |

- Row click → profile view (slides in)
- Pagination: 50/page, controls at bottom: `← Prev` `Page 1 of 7` `Next →` + total count
- Skeleton rows during load (same pattern as Wiki/Tournament skeletons)

### Profile View (replaces table, back button to return)

**Layout:** flex column, 1000px max-width, centered, `--font-ui`.

**Header:**
```html
<button class="rk-back">← Back</button>
<h2>{displayName}</h2>
<div class="rk-sub">{schoolName} · {event} · {season}</div>
```

**Stat Cards** (4-column grid, `grid-template-columns: repeat(auto-fit, minmax(180px, 1fr))`, `gap:12px`):
- **RATING** — current (big), `Peak {peak}` small underneath
- **RECORD** — `W-L` (big), win % small
- **BIDS** — `{full}F` (big), `+{partial}P` small
- **RANK** — `#{rank}` (big), `of {outOf} {event}` small

Each card uses `--shadow-sm`, rounded 8px, 14px padding.

**Rating Chart:**
- Inline SVG, 100% width × 180px height
- X-axis: rounds, left→right chronological
- Y-axis: rating (auto-fit min/max ± 50)
- Polyline in accent color (2px stroke)
- Light gridlines (`stroke: var(--border, #e5e5e5)`)
- Hover: tooltip showing round + rating + tournament name

**Tournaments Table:**
| Tournament | Record | Bid | Place | |
|-----------|--------|-----|-------|----|
| Greenhill Fall Classic | 6-2 | Full | Octas | ↗ |

- Row click → opens Tournament detail page
- `↗` icon takes user to the existing Tournament page with that tourn_id

**Top Arguments Table** (only shown if wiki-matched):
| Argument | Side | Reads |
|----------|------|-------|
| Util AC | AFF | 14× |

- Row click → opens Teams page with `#teams?team={wikiTeamId}&arg={argumentId}` (needs minor Teams-page support for `arg` param, but out of scope if only anchor to team is needed)
- Section header: `Top Arguments (via opencaselist wiki)`
- Section footer: `[↗ Open Wiki Page]` button → `#teams?team={wikiTeamId}`

**No match state:** if no `wikiTeamId`, omit the Top Arguments section entirely (don't show empty placeholder).

### Styles

- Reuse existing tokens: `--font-ui`, `--font-mono`, `--ink`, `--muted`, `--bg`, `--shadow-sm`, `--shadow-md`, `--hover-bg`, `--border`
- Rating cell on leaderboard: `font: 600 13px var(--font-mono)` — aligned
- Profile big-stat numbers: `font: 600 24px var(--font-ui); color: var(--ink)`
- Sub-label: `font: 10px var(--font-ui); color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px`
- Event badge classes: reuse `.toc-badge-ld`, `.toc-badge-pf`, `.toc-badge-cx` already defined
- Mobile: `@media (max-width: 768px)` — stat cards stack 2-wide, tables go full-width, chart height reduced to 140px

---

## Files

**New:**
- `server/services/rankingsEngine.js` — Elo computation, history writer, chronological replay
- `server/services/rankingsDb.js` — read queries (leaderboard, profile aggregate, history)
- `server/routes/rankings.js` — 4 GET endpoints
- `public/rankings.js` — frontend (leaderboard + profile view + inline SVG chart)

**Modified:**
- `server/services/db.js` — 2 new tables in `_initSchema` (after TOC tables)
- `server/services/tocIndexer.js` — append `rankings.recomputeRatings(season)` at end of `indexTournament`; season loop at end of `seedTocIndex`
- `server/index.js` — register rankings route
- `public/app.html` — Rankings nav item + `#page-rankings` section + CSS + script tag

---

## Testing

Unit tests for `rankingsEngine`:
- `applyElo` pure function with known inputs (expected-score math, K, mult)
- Elim asymmetry (loser unchanged)
- Multi-ballot majority aggregation
- Chronological ordering stability
- New-entry initialization to 1500

Integration smoke test:
- Run `recomputeRatings('2025-26')` on fully-seeded DB
- Assert `toc_ratings` row count > 0
- Assert a known strong team has rating > 1600
- Assert history row count matches ~2× ballots count

---

## Out of Scope

- Cross-season aggregate rankings / career Elo
- Bid-by-category breakdowns (bids earned at Octas tournaments vs Finals tournaments)
- Head-to-head matchup history
- Judge-adjusted expected scores (MPJ bias correction)
- Side-specific Elo (aff Elo vs neg Elo)
- Rating floor/ceiling
- Publishing API for external consumers
