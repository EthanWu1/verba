# Tabroom Team-Code Link — Design Spec

**Status:** Verified feasible. Public unauthenticated access confirmed.

## Verified data source

**Endpoint:** `GET https://www.tabroom.com/api/download_data.mhtml?tourn_id=<ID>`

- Public, no login required, no API key. Returns JSON.
- Size: 0.5–12 MB per tournament. Active tournament (TOC 2026, 36156): 8.7 MB, 349 schools, 1042 entries with codes, all rounds + ballots populated.
- Pre-tournament (NSDA Nationals 37602, future): minimal — only the tourn metadata + creator's school. Entry data appears once schools register and host opens registration.
- Post-tournament: full results including round-by-round ballots, judges, scores, side, entry names.

**Schema discovered:**
```
{
  id, name, start, end, state, city, reg_start, reg_end, public,
  schools[{ id, code, name, entries[{ id, code, name, school, event,
                                       students[], dropped, active, hybrid }],
            students[{ nsda, first, last, grad_year }] }],
  categories[{ name, abbr, events[{ id, name, abbr, type,
                                     rounds[{ name, sections[{ ballots[{
                                       entry, entry_code, entry_name,
                                       judge, side, scores[] }] }] }],
                                     result_sets[] }] }],
  timeslots[]
}
```

## Feature

Users link 1–3 team codes to their Verba account. Verba shows their tournament results, upcoming registrations (when public), and round-by-round records.

## Storage

```sql
CREATE TABLE user_tabroom_links (
  id           TEXT PRIMARY KEY,
  userId       TEXT NOT NULL,
  teamCode     TEXT NOT NULL,           -- e.g. "Greenhill MA"
  schoolName   TEXT,                    -- disambiguator
  schoolCode   TEXT,                    -- e.g. "AA"
  verifiedAt   INTEGER,
  createdAt    INTEGER NOT NULL,
  UNIQUE(userId, teamCode, schoolName)
);

CREATE TABLE tabroom_tournament_cache (
  tournId      INTEGER PRIMARY KEY,
  name         TEXT NOT NULL,
  startDate    TEXT,
  endDate      TEXT,
  fetchedAt    INTEGER NOT NULL,
  rawJson      TEXT NOT NULL            -- gzipped JSON dump
);

CREATE TABLE tabroom_entry_index (    -- denormalized for fast lookup
  tournId      INTEGER NOT NULL,
  teamCode     TEXT NOT NULL,
  schoolName   TEXT NOT NULL,
  entryId      INTEGER NOT NULL,
  eventAbbr    TEXT NOT NULL,
  eventName    TEXT NOT NULL,
  studentNames TEXT NOT NULL,           -- JSON array
  dropped      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tournId, entryId)
);
CREATE INDEX idx_tabroom_idx_code ON tabroom_entry_index(teamCode, eventAbbr);
```

## Crawler

`server/services/tabroomCrawler.js`:

```
fetchTournament(tournId) → axios GET endpoint, gzip+store rawJson, parse, upsert entry index
indexUpcoming() → scrape /index/index.mhtml for tournId list, fetchTournament for each
refreshActive() → for tournaments with start ≤ now ≤ end+7d, refetch every 6h
```

Cron: nightly at 3am for upcoming list, every 6h for active tournaments. Parser is pure function over JSON shape above.

## Endpoints

```
POST /api/me/tabroom-link      { teamCode, schoolName? }
                                → fuzzy match against tabroom_entry_index
                                → return matches; user picks one to confirm
DELETE /api/me/tabroom-link/:id

GET /api/me/tabroom/upcoming   → tournaments where linked code appears in entry index
                                  AND startDate ≥ today
GET /api/me/tabroom/results    → past tournaments + per-round ballot extracts
                                  (decompressed from rawJson on demand)
GET /api/me/tabroom/round/:tournId/:eventAbbr/:roundId
                                → opponent, judge, side, score, win/loss
```

## UI

**Settings → Connect Tabroom**
- Single text input: "Enter your team code (e.g. Greenhill MA)"
- Below: dropdown "School" (autofilled from match results)
- Verify button → shows "Found 12 tournaments matching" → confirm

**New profile section: "My tournaments"**
- Tab: Upcoming | Past
- Upcoming: cards w/ tournament name, dates, registered events, partner names
- Past: list w/ rec, place, opponents per round (expandable)

## Constraints + caveats

- **Pre-tournament data is sparse.** Don't promise users they'll see registrations months out — they won't. Only ~2 weeks before start, typically.
- **Hybrid teams + late codes.** A user may compete under different codes per partner. Allow multiple links.
- **Tabroom rate limit.** Cache aggressively. Crawl with 1-second delay between requests. ~1k upcoming tournaments × 1s = 17 min nightly job.
- **TOS.** This endpoint is publicly served. No login, no scraping behind auth. Low risk but document the source in the app's About page.
- **Storage.** 8 MB × 1k tournaments = 8 GB raw. Gzip ≈ 1.5 GB. Add quarterly purge of tournaments older than 3 years.

## Open questions

None for spec. Implementation plan next if approved.
