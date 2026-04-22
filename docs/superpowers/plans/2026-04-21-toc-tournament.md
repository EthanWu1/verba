# TOC Tournament Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Tournament page to Verba that browses TOC-UK circuit tournaments (LD/PF/Policy) scraped from tabroom.com, showing threat lists for upcoming events and final results + speaker awards + per-entry pairings for past events.

**Architecture:** New `tocCrawler.js` fetches tabroom's public `download_data.mhtml` JSON per tournament. `tocIndexer.js` orchestrates seeding + per-tournament re-fetch + season bid aggregation. `tocDb.js` holds all SQLite CRUD for the six `toc_*` tables. A new route file `routes/toc.js` exposes `/api/toc/*`. Frontend `public/toc.js` renders a grid → detail drill-down inside a new `data-page="tournament"` section in `app.html`.

**Tech Stack:** Node.js/Express, better-sqlite3, axios, existing `public/app.html` patterns, vanilla JS frontend matching Wiki Teams style.

---

## API Schema Notes (verified live against tabroom.com)

- `TOC-UK` circuit → `circuit_id=228` (confirmed by scraping `/index/circuits.mhtml`).
- `/api/download_data.mhtml?tourn_id=X` returns ~10 MB JSON, no auth.
- Top-level: `{ id, name, webname, start, end, city, state, country, categories[], schools[] }`.
- `categories[].events[].type === 'debate'`; `abbr in ['LD','PF','CX']` for our filter.
- Each event has `rounds[].sections[].ballots[]` with `{entry, side, judge_first, judge_last, scores: [{tag, value}]}`.
- `result_sets[].label` can be `'Bracket'`, `'Prelim Seeds'`, `'Speaker Awards'`, `'TOC Qualifying Bids'`, `'Final Places'`, etc.
- Final Places entries have `place: '1st' | 'Finals' | 'Semis' | 'Octas' | ...` and `rank: 1..N`.
- Speaker Awards `result_keys[]` include `{tag: 'Pts'}`, `{tag: 'Pts -1HL'}`, etc. — use `'Pts'` as canonical.
- A ballot's `side` is `1` (aff/pro) or `2` (neg/con). A `scores[]` entry with `tag: 'winloss'` has `value: 1` for W, `0` for L.
- A section with only 1 ballot = bye (no opponent).

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `server/services/tocCrawler.js` | Create | axios wrappers: `fetchCircuitTournIds()`, `fetchTournamentJson(id)`, 500ms rate limit |
| `server/services/tocParser.js` | Create | Pure parse helpers: `parseTournament(json)`, `parseBallots(event)`, `parseResults(event)`, `inferBidLevel(event)`, `seasonFor(date)`, `fnv1a(str)`, `teamKeyFor(entry, school)` |
| `server/services/tocDb.js` | Create | All SQLite CRUD for `toc_*` tables |
| `server/services/tocIndexer.js` | Create | Orchestrates: `seedTocIndex()`, `crawlTournament(id)`, `rebuildSeasonBids(season)` |
| `server/routes/toc.js` | Create | Express routes for `/api/toc/*` |
| `server/services/db.js` | Modify | Add 6 TOC tables in `_initSchema` |
| `server/index.js` | Modify | Register route + auto-seed on startup |
| `public/app.html` | Modify | Add Tournament nav item, `#page-tournament` section, CSS, script tag |
| `public/toc.js` | Create | Frontend grid + detail + entry-pairings drill-in |
| `public/wiki.js` | Modify | Handle `#teams?team=X` deep-link param |

---

## Task 1: DB Schema — TOC tables

**Files:**
- Modify: `server/services/db.js`

- [ ] **Step 1: Add TOC tables to `_initSchema`**

Open `server/services/db.js`. Inside `_initSchema(db)`, after the existing wiki schema block (last added in feat/wiki-teams branch), add:

```js
db.exec(`
  CREATE TABLE IF NOT EXISTS toc_tournaments (
    tourn_id     INTEGER PRIMARY KEY,
    name         TEXT NOT NULL,
    webname      TEXT,
    city         TEXT,
    state        TEXT,
    country      TEXT,
    startDate    TEXT NOT NULL,
    endDate      TEXT NOT NULL,
    season       TEXT NOT NULL,
    lastCrawled  TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_toc_tourns_season ON toc_tournaments(season, startDate);

  CREATE TABLE IF NOT EXISTS toc_tournament_events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    tournId      INTEGER NOT NULL REFERENCES toc_tournaments(tourn_id) ON DELETE CASCADE,
    eventId      INTEGER NOT NULL,
    abbr         TEXT NOT NULL,
    name         TEXT,
    bidLevel     TEXT,
    fullBids     INTEGER NOT NULL DEFAULT 0,
    partialBids  INTEGER NOT NULL DEFAULT 0,
    UNIQUE(tournId, eventId)
  );

  CREATE TABLE IF NOT EXISTS toc_entries (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    tournId      INTEGER NOT NULL REFERENCES toc_tournaments(tourn_id) ON DELETE CASCADE,
    eventAbbr    TEXT NOT NULL,
    entryId      INTEGER NOT NULL,
    teamKey      TEXT NOT NULL,
    schoolId     INTEGER,
    schoolName   TEXT,
    schoolCode   TEXT,
    displayName  TEXT,
    earnedBid    TEXT,
    UNIQUE(tournId, entryId)
  );
  CREATE INDEX IF NOT EXISTS idx_toc_entries_team  ON toc_entries(teamKey);
  CREATE INDEX IF NOT EXISTS idx_toc_entries_scope ON toc_entries(tournId, eventAbbr);

  CREATE TABLE IF NOT EXISTS toc_ballots (
    id               INTEGER PRIMARY KEY,
    tournId          INTEGER NOT NULL REFERENCES toc_tournaments(tourn_id) ON DELETE CASCADE,
    eventAbbr        TEXT NOT NULL,
    roundId          INTEGER NOT NULL,
    roundName        TEXT NOT NULL,
    roundType        TEXT NOT NULL,
    entryId          INTEGER NOT NULL,
    opponentEntryId  INTEGER,
    side             TEXT,
    judgeName        TEXT,
    result           TEXT,
    speakerPoints    REAL
  );
  CREATE INDEX IF NOT EXISTS idx_toc_ballots_entry ON toc_ballots(tournId, entryId, eventAbbr);
  CREATE INDEX IF NOT EXISTS idx_toc_ballots_round ON toc_ballots(tournId, roundId);

  CREATE TABLE IF NOT EXISTS toc_results (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    tournId        INTEGER NOT NULL REFERENCES toc_tournaments(tourn_id) ON DELETE CASCADE,
    eventAbbr      TEXT NOT NULL,
    entryId        INTEGER NOT NULL,
    place          TEXT,
    rank           INTEGER,
    speakerRank    INTEGER,
    speakerPoints  REAL,
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
`);
```

- [ ] **Step 2: Verify schema initializes**

Run: `node -e "require('./server/services/db').getDb(); console.log('ok')"`
Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git add server/services/db.js
git commit -m "feat(toc): add toc_tournaments/events/entries/ballots/results/season_bids tables"
```

---

## Task 2: tocParser.js — pure parsing helpers

**Files:**
- Create: `server/services/tocParser.js`
- Create: `test/tocParser.test.js`

- [ ] **Step 1: Write failing unit tests**

Create `test/tocParser.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { seasonFor, fnv1a, teamKeyFor, inferBidLevel, parseBallots } = require('../server/services/tocParser');

test('seasonFor August 2025 → 2025-26', () => {
  assert.strictEqual(seasonFor('2025-08-15'), '2025-26');
});

test('seasonFor February 2026 → 2025-26', () => {
  assert.strictEqual(seasonFor('2026-02-10'), '2025-26');
});

test('seasonFor June 2026 → 2025-26', () => {
  assert.strictEqual(seasonFor('2026-06-01'), '2025-26');
});

test('seasonFor July 2026 → 2026-27', () => {
  assert.strictEqual(seasonFor('2026-07-01'), '2026-27');
});

test('fnv1a is deterministic hex', () => {
  assert.strictEqual(fnv1a('hello'), fnv1a('hello'));
  assert.match(fnv1a('hello'), /^[0-9a-f]{1,8}$/);
  assert.notStrictEqual(fnv1a('hello'), fnv1a('world'));
});

test('teamKeyFor uses schoolId + sorted student ids', () => {
  const k = teamKeyFor({ students: ['3','1','2'] }, { id: 797828 });
  assert.strictEqual(k, '797828:1,2,3');
});

test('teamKeyFor falls back to hashed school name when schoolId missing', () => {
  const k = teamKeyFor({ students: ['5'] }, { id: null, name: 'Greenhill' });
  assert.match(k, /^h:[0-9a-f]+:5$/);
});

test('inferBidLevel maps full bid count → round name', () => {
  const make = (n) => ({ result_sets: [{ label: 'TOC Qualifying Bids',
    results: Array.from({ length: n }, () => ({ values: [{ value: 'Full' }] })) }] });
  assert.deepStrictEqual(inferBidLevel(make(16)), { bidLevel: 'Octas', fullBids: 16, partialBids: 0 });
  assert.deepStrictEqual(inferBidLevel(make(8)), { bidLevel: 'Quarters', fullBids: 8, partialBids: 0 });
  assert.deepStrictEqual(inferBidLevel(make(4)), { bidLevel: 'Semis', fullBids: 4, partialBids: 0 });
  assert.deepStrictEqual(inferBidLevel(make(2)), { bidLevel: 'Finals', fullBids: 2, partialBids: 0 });
  assert.deepStrictEqual(inferBidLevel(make(0)), { bidLevel: null, fullBids: 0, partialBids: 0 });
});

test('inferBidLevel returns zero when no bid result_set present', () => {
  assert.deepStrictEqual(inferBidLevel({ result_sets: [{ label: 'Final Places', results: [] }] }), { bidLevel: null, fullBids: 0, partialBids: 0 });
});

test('parseBallots extracts pairings with opponent + result', () => {
  const event = { rounds: [{
    id: 1, name: '1', type: 'prelim',
    sections: [{ id: 10, ballots: [
      { id: 100, entry: 5, side: 1, judge_first: 'A', judge_last: 'Smith', scores: [{ tag: 'winloss', value: 1 }, { tag: 'point', value: 28.5 }] },
      { id: 101, entry: 6, side: 2, judge_first: 'A', judge_last: 'Smith', scores: [{ tag: 'winloss', value: 0 }, { tag: 'point', value: 27.0 }] },
    ]}],
  }]};
  const rows = parseBallots(event);
  assert.strictEqual(rows.length, 2);
  const a = rows.find(r => r.entryId === 5);
  assert.strictEqual(a.opponentEntryId, 6);
  assert.strictEqual(a.side, 'aff');
  assert.strictEqual(a.result, 'W');
  assert.strictEqual(a.speakerPoints, 28.5);
  assert.strictEqual(a.judgeName, 'A Smith');
  assert.strictEqual(a.roundName, '1');
  assert.strictEqual(a.roundType, 'prelim');
});

test('parseBallots handles bye (one ballot in section)', () => {
  const event = { rounds: [{
    id: 2, name: '2', type: 'prelim',
    sections: [{ id: 20, ballots: [
      { id: 200, entry: 7, side: 1, judge_first: '', judge_last: '', scores: [{ tag: 'winloss', value: 1 }] },
    ]}],
  }]};
  const rows = parseBallots(event);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].opponentEntryId, null);
  assert.strictEqual(rows[0].result, 'W');
});
```

- [ ] **Step 2: Run to verify FAILS**

Run: `npm test -- --test-name-pattern='season|fnv1a|teamKeyFor|inferBidLevel|parseBallots'`
Expected: failures — module not found.

- [ ] **Step 3: Create `server/services/tocParser.js`**

```js
'use strict';

// FNV-1a 32-bit hex hash
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16);
}

// Season derivation: Jul+ = current-next; else prev-current
function seasonFor(isoDate) {
  const d = new Date(isoDate);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  if (m >= 7) return `${y}-${String(y + 1).slice(-2)}`;
  return `${y - 1}-${String(y).slice(-2)}`;
}

function teamKeyFor(entry, school) {
  const sid = school?.id != null ? String(school.id) : ('h:' + fnv1a(String(school?.name || '').toLowerCase()));
  const students = Array.isArray(entry.students) ? [...entry.students].map(String).sort() : [];
  return `${sid}:${students.join(',')}`;
}

const BID_MAP = { 64: 'Triples', 32: 'Doubles', 16: 'Octas', 8: 'Quarters', 4: 'Semis', 2: 'Finals' };

function inferBidLevel(event) {
  const rs = (event.result_sets || []).find(r => /bid/i.test(r.label || ''));
  if (!rs) return { bidLevel: null, fullBids: 0, partialBids: 0 };
  let full = 0, partial = 0;
  for (const result of (rs.results || [])) {
    const vals = result.values || [];
    if (vals.some(v => v.value === 'Full')) full++;
    else if (vals.some(v => v.value === 'Partial')) partial++;
  }
  return { bidLevel: BID_MAP[full] || null, fullBids: full, partialBids: partial };
}

// Map ballot.side → 'aff' | 'neg' | null
function _side(side) {
  if (side === 1 || side === '1') return 'aff';
  if (side === 2 || side === '2') return 'neg';
  return null;
}

function _result(scores) {
  const wl = (scores || []).find(s => s.tag === 'winloss');
  if (!wl) return null;
  return Number(wl.value) === 1 ? 'W' : (Number(wl.value) === 0 ? 'L' : null);
}

function _points(scores) {
  const p = (scores || []).find(s => s.tag === 'point');
  if (!p) return null;
  const n = Number(p.value);
  return Number.isFinite(n) ? n : null;
}

function parseBallots(event) {
  const rows = [];
  for (const round of (event.rounds || [])) {
    const roundId = Number(round.id);
    const roundName = String(round.name ?? '');
    const roundType = round.type || null;
    for (const section of (round.sections || [])) {
      const ballots = section.ballots || [];
      for (const b of ballots) {
        // Opponent = another ballot in same section with different entry
        const opp = ballots.find(o => o.entry !== b.entry);
        const judge = [b.judge_first, b.judge_last].filter(Boolean).join(' ').trim() || null;
        rows.push({
          id:               Number(b.id),
          roundId,
          roundName,
          roundType,
          entryId:          Number(b.entry),
          opponentEntryId:  opp ? Number(opp.entry) : null,
          side:             _side(b.side),
          judgeName:        judge,
          result:           _result(b.scores),
          speakerPoints:    _points(b.scores),
        });
      }
    }
  }
  return rows;
}

function parseResults(event) {
  const out = new Map(); // entryId → { place, rank, speakerRank, speakerPoints }

  // Final Places
  const fp = (event.result_sets || []).find(r => /final places/i.test(r.label || ''));
  if (fp) {
    for (const r of (fp.results || [])) {
      if (!r.entry) continue;
      const k = Number(r.entry);
      const row = out.get(k) || {};
      row.place = r.place || null;
      row.rank = Number.isFinite(Number(r.rank)) ? Number(r.rank) : null;
      out.set(k, row);
    }
  }

  // Speaker Awards — find 'Pts' column index (canonical), assign rank by input order
  const sa = (event.result_sets || []).find(r => /speaker awards/i.test(r.label || ''));
  if (sa) {
    const keys = sa.result_keys || [];
    const ptsIdx = keys.findIndex(k => (k.tag || '').toUpperCase() === 'PTS');
    const results = sa.results || [];
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (!r.entry) continue;
      const k = Number(r.entry);
      const row = out.get(k) || {};
      row.speakerRank = i + 1;
      if (ptsIdx >= 0) {
        const v = (r.values || [])[ptsIdx]?.value;
        const n = Number(v);
        row.speakerPoints = Number.isFinite(n) ? n : null;
      }
      out.set(k, row);
    }
  }

  return [...out.entries()].map(([entryId, row]) => ({ entryId, ...row }));
}

// Extract earnedBid per entry for the TOC Qualifying Bids result_set
function parseEarnedBids(event) {
  const bids = (event.result_sets || []).find(r => /bid/i.test(r.label || ''));
  const map = new Map(); // entryId → 'Full' | 'Partial'
  if (!bids) return map;
  for (const r of (bids.results || [])) {
    if (!r.entry) continue;
    const vals = r.values || [];
    if (vals.some(v => v.value === 'Full')) map.set(Number(r.entry), 'Full');
    else if (vals.some(v => v.value === 'Partial')) map.set(Number(r.entry), 'Partial');
  }
  return map;
}

module.exports = {
  fnv1a, seasonFor, teamKeyFor, inferBidLevel, parseBallots, parseResults, parseEarnedBids,
};
```

- [ ] **Step 4: Run tests to verify PASS**

Run: `npm test -- --test-name-pattern='season|fnv1a|teamKeyFor|inferBidLevel|parseBallots'`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add server/services/tocParser.js test/tocParser.test.js
git commit -m "feat(toc): add tocParser pure helpers (season, fnv1a, teamKey, bid, ballots, results)"
```

---

## Task 3: tocCrawler.js — tabroom fetcher

**Files:**
- Create: `server/services/tocCrawler.js`

- [ ] **Step 1: Create the crawler**

```js
'use strict';

const axios = require('axios');

const BASE = 'https://www.tabroom.com';
const DELAY_MS = 500;
const TIMEOUT_MS = 60000; // 10MB JSON can be slow

let _lastRequestAt = 0;

async function _throttle() {
  const elapsed = Date.now() - _lastRequestAt;
  if (elapsed < DELAY_MS) await new Promise(r => setTimeout(r, DELAY_MS - elapsed));
  _lastRequestAt = Date.now();
}

// Discover TOC-UK circuit_id from the circuits index page.
async function fetchTocCircuitId() {
  await _throttle();
  const res = await axios.get(`${BASE}/index/circuits.mhtml`, { timeout: TIMEOUT_MS });
  const html = String(res.data);
  const m = html.match(/TOC-UK[\s\S]*?circuit_id=(\d+)/);
  if (!m) throw new Error('tabroom: TOC-UK circuit not found');
  return Number(m[1]);
}

// Fetch all tourn_ids tagged with a circuit (HTML scrape).
async function fetchCircuitTournIds(circuitId) {
  await _throttle();
  const res = await axios.get(`${BASE}/index/circuit/index.mhtml?circuit_id=${circuitId}`, { timeout: TIMEOUT_MS });
  const html = String(res.data);
  const ids = new Set();
  for (const m of html.matchAll(/tourn_id=(\d+)/g)) ids.add(Number(m[1]));
  return [...ids];
}

async function fetchTournamentJson(tournId) {
  await _throttle();
  const res = await axios.get(`${BASE}/api/download_data.mhtml?tourn_id=${tournId}`, { timeout: TIMEOUT_MS });
  if (typeof res.data === 'object') return res.data;
  return JSON.parse(String(res.data));
}

module.exports = { fetchTocCircuitId, fetchCircuitTournIds, fetchTournamentJson };
```

- [ ] **Step 2: Smoke-test fetchTocCircuitId**

```
node -e "require('./server/services/tocCrawler').fetchTocCircuitId().then(id => console.log('TOC-UK =', id)).catch(e => { console.error(e.message); process.exit(1); })"
```
Expected: `TOC-UK = 228`.

- [ ] **Step 3: Smoke-test fetchCircuitTournIds**

```
node -e "require('./server/services/tocCrawler').fetchCircuitTournIds(228).then(ids => console.log('count:', ids.length, 'sample:', ids.slice(0, 5))).catch(e => { console.error(e.message); process.exit(1); })"
```
Expected: count ≥ 100, sample is array of integers.

- [ ] **Step 4: Smoke-test fetchTournamentJson**

```
node -e "require('./server/services/tocCrawler').fetchTournamentJson(36065).then(d => console.log('name:', d.name, 'cats:', d.categories.length, 'schools:', d.schools.length)).catch(e => { console.error(e.message); process.exit(1); })"
```
Expected: `name: Greenhill Fall Classic cats: 6 schools: 83`.

- [ ] **Step 5: Commit**

```bash
git add server/services/tocCrawler.js
git commit -m "feat(toc): add tocCrawler with rate-limited tabroom fetchers"
```

---

## Task 4: tocDb.js — database layer

**Files:**
- Create: `server/services/tocDb.js`

- [ ] **Step 1: Create the DB service**

```js
'use strict';

const { getDb } = require('./db');

// ── Tournaments ───────────────────────────────────────────────

function upsertTournament(t) {
  getDb().prepare(`
    INSERT INTO toc_tournaments (tourn_id, name, webname, city, state, country, startDate, endDate, season, lastCrawled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tourn_id) DO UPDATE SET
      name        = excluded.name,
      webname     = excluded.webname,
      city        = excluded.city,
      state       = excluded.state,
      country     = excluded.country,
      startDate   = excluded.startDate,
      endDate     = excluded.endDate,
      season      = excluded.season,
      lastCrawled = excluded.lastCrawled
  `).run(
    Number(t.tourn_id), t.name, t.webname || null,
    t.city || null, t.state || null, t.country || null,
    t.startDate, t.endDate, t.season,
    t.lastCrawled || new Date().toISOString()
  );
}

function getTournament(id) {
  return getDb().prepare(`SELECT * FROM toc_tournaments WHERE tourn_id = ?`).get(Number(id));
}

function listTournaments({ season, when }) {
  const db = getDb();
  const nowIso = new Date().toISOString().slice(0, 10);
  let sql = `SELECT * FROM toc_tournaments WHERE season = ?`;
  const args = [season];
  if (when === 'upcoming') { sql += ` AND endDate >= ?`; args.push(nowIso); }
  else if (when === 'past') { sql += ` AND endDate < ?`;  args.push(nowIso); }
  sql += ` ORDER BY startDate ASC`;
  return db.prepare(sql).all(...args);
}

function listSeasons() {
  return getDb().prepare(`
    SELECT season, COUNT(*) AS tournamentCount
    FROM toc_tournaments GROUP BY season ORDER BY season DESC
  `).all();
}

function countTournaments() {
  return getDb().prepare(`SELECT COUNT(*) AS n FROM toc_tournaments`).get().n;
}

function setTournamentCrawled(tournId) {
  getDb().prepare(`UPDATE toc_tournaments SET lastCrawled = ? WHERE tourn_id = ?`)
    .run(new Date().toISOString(), Number(tournId));
}

// ── Events ────────────────────────────────────────────────────

function upsertEvent(tournId, e) {
  getDb().prepare(`
    INSERT INTO toc_tournament_events (tournId, eventId, abbr, name, bidLevel, fullBids, partialBids)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tournId, eventId) DO UPDATE SET
      abbr        = excluded.abbr,
      name        = excluded.name,
      bidLevel    = excluded.bidLevel,
      fullBids    = excluded.fullBids,
      partialBids = excluded.partialBids
  `).run(Number(tournId), Number(e.eventId), e.abbr, e.name || null, e.bidLevel, e.fullBids, e.partialBids);
}

function listEvents(tournId) {
  return getDb().prepare(`SELECT * FROM toc_tournament_events WHERE tournId = ? ORDER BY abbr`).all(Number(tournId));
}

// ── Entries ───────────────────────────────────────────────────

function upsertEntry(tournId, entry) {
  getDb().prepare(`
    INSERT INTO toc_entries (tournId, eventAbbr, entryId, teamKey, schoolId, schoolName, schoolCode, displayName, earnedBid)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tournId, entryId) DO UPDATE SET
      eventAbbr   = excluded.eventAbbr,
      teamKey     = excluded.teamKey,
      schoolId    = excluded.schoolId,
      schoolName  = excluded.schoolName,
      schoolCode  = excluded.schoolCode,
      displayName = excluded.displayName,
      earnedBid   = excluded.earnedBid
  `).run(
    Number(tournId), entry.eventAbbr, Number(entry.entryId), entry.teamKey,
    entry.schoolId != null ? Number(entry.schoolId) : null,
    entry.schoolName || null, entry.schoolCode || null,
    entry.displayName || null, entry.earnedBid || null
  );
}

function clearEntriesForTournament(tournId) {
  getDb().prepare(`DELETE FROM toc_entries WHERE tournId = ?`).run(Number(tournId));
}

function getEntry(entryId) {
  return getDb().prepare(`SELECT * FROM toc_entries WHERE entryId = ? LIMIT 1`).get(Number(entryId));
}

function listEntriesForEvent(tournId, eventAbbr) {
  return getDb().prepare(`
    SELECT * FROM toc_entries WHERE tournId = ? AND eventAbbr = ?
    ORDER BY displayName
  `).all(Number(tournId), eventAbbr);
}

// ── Ballots ───────────────────────────────────────────────────

function insertBallot(b) {
  getDb().prepare(`
    INSERT OR REPLACE INTO toc_ballots
      (id, tournId, eventAbbr, roundId, roundName, roundType, entryId, opponentEntryId, side, judgeName, result, speakerPoints)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(b.id, b.tournId, b.eventAbbr, b.roundId, b.roundName, b.roundType,
         b.entryId, b.opponentEntryId, b.side, b.judgeName, b.result, b.speakerPoints);
}

function clearBallotsForTournament(tournId) {
  getDb().prepare(`DELETE FROM toc_ballots WHERE tournId = ?`).run(Number(tournId));
}

function getPairingsForEntry(entryId) {
  return getDb().prepare(`
    SELECT * FROM toc_ballots WHERE entryId = ?
    ORDER BY roundType DESC, CAST(roundName AS INTEGER), roundName
  `).all(Number(entryId));
}

// ── Results ───────────────────────────────────────────────────

function upsertResult(r) {
  getDb().prepare(`
    INSERT INTO toc_results (tournId, eventAbbr, entryId, place, rank, speakerRank, speakerPoints)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tournId, entryId, eventAbbr) DO UPDATE SET
      place         = COALESCE(excluded.place, place),
      rank          = COALESCE(excluded.rank, rank),
      speakerRank   = COALESCE(excluded.speakerRank, speakerRank),
      speakerPoints = COALESCE(excluded.speakerPoints, speakerPoints)
  `).run(r.tournId, r.eventAbbr, r.entryId, r.place || null,
         r.rank != null ? Number(r.rank) : null,
         r.speakerRank != null ? Number(r.speakerRank) : null,
         r.speakerPoints != null ? Number(r.speakerPoints) : null);
}

function clearResultsForTournament(tournId) {
  getDb().prepare(`DELETE FROM toc_results WHERE tournId = ?`).run(Number(tournId));
}

function listResults(tournId, eventAbbr) {
  return getDb().prepare(`
    SELECT r.*, e.displayName, e.schoolName, e.schoolCode, e.earnedBid
    FROM toc_results r
    JOIN toc_entries e ON e.tournId = r.tournId AND e.entryId = r.entryId AND e.eventAbbr = r.eventAbbr
    WHERE r.tournId = ? AND r.eventAbbr = ?
    ORDER BY r.rank ASC NULLS LAST, r.speakerRank ASC NULLS LAST
  `).all(Number(tournId), eventAbbr);
}

function listSpeakerAwards(tournId, eventAbbr, limit = 20) {
  return getDb().prepare(`
    SELECT r.*, e.displayName, e.schoolName, e.schoolCode
    FROM toc_results r
    JOIN toc_entries e ON e.tournId = r.tournId AND e.entryId = r.entryId AND e.eventAbbr = r.eventAbbr
    WHERE r.tournId = ? AND r.eventAbbr = ? AND r.speakerRank IS NOT NULL
    ORDER BY r.speakerRank ASC LIMIT ?
  `).all(Number(tournId), eventAbbr, Number(limit));
}

// ── Season bids ───────────────────────────────────────────────

function rebuildSeasonBids(season) {
  const db = getDb();
  const tx = db.transaction((s) => {
    db.prepare(`DELETE FROM toc_season_bids WHERE season = ?`).run(s);
    db.prepare(`
      INSERT INTO toc_season_bids (season, teamKey, eventAbbr, fullBids, partialBids, displayName, schoolCode)
      SELECT t.season, e.teamKey, e.eventAbbr,
             SUM(CASE WHEN e.earnedBid = 'Full'    THEN 1 ELSE 0 END),
             SUM(CASE WHEN e.earnedBid = 'Partial' THEN 1 ELSE 0 END),
             MAX(e.displayName), MAX(e.schoolCode)
      FROM toc_entries e
      JOIN toc_tournaments t ON t.tourn_id = e.tournId
      WHERE t.season = ?
      GROUP BY t.season, e.teamKey, e.eventAbbr
    `).run(s);
  });
  tx(season);
}

// Threat list = entries at tournament joined with season bid counts,
// plus best-effort wiki_teams match for deep-linking.
function listThreats(tournId, eventAbbr, season) {
  return getDb().prepare(`
    SELECT
      e.*,
      COALESCE(sb.fullBids, 0) AS seasonFullBids,
      COALESCE(sb.partialBids, 0) AS seasonPartialBids,
      (SELECT w.id FROM wiki_teams w
        WHERE LOWER(w.school) = LOWER(e.schoolName)
          AND LOWER(w.code)   = LOWER(SUBSTR(e.displayName, LENGTH(e.schoolName) + 2))
        LIMIT 1) AS wikiTeamId
    FROM toc_entries e
    LEFT JOIN toc_season_bids sb
      ON e.teamKey = sb.teamKey AND sb.eventAbbr = e.eventAbbr AND sb.season = ?
    WHERE e.tournId = ? AND e.eventAbbr = ?
    ORDER BY seasonFullBids DESC, seasonPartialBids DESC, e.displayName ASC
  `).all(season, Number(tournId), eventAbbr);
}

module.exports = {
  upsertTournament, getTournament, listTournaments, listSeasons, countTournaments, setTournamentCrawled,
  upsertEvent, listEvents,
  upsertEntry, clearEntriesForTournament, getEntry, listEntriesForEvent,
  insertBallot, clearBallotsForTournament, getPairingsForEntry,
  upsertResult, clearResultsForTournament, listResults, listSpeakerAwards,
  rebuildSeasonBids, listThreats,
};
```

- [ ] **Step 2: Smoke test**

```
node -e "const db = require('./server/services/tocDb'); db.upsertTournament({ tourn_id: 999, name: 'Test', startDate: '2025-10-01', endDate: '2025-10-03', season: '2025-26' }); console.log('count:', db.countTournaments()); console.log('get:', db.getTournament(999).name);"
```
Expected: `count: 1` / `get: Test`.

- [ ] **Step 3: Cleanup test row + commit**

```
node -e "require('./server/services/db').getDb().prepare('DELETE FROM toc_tournaments WHERE tourn_id = 999').run(); console.log('cleaned')"
git add server/services/tocDb.js
git commit -m "feat(toc): add tocDb CRUD + listThreats/listResults/rebuildSeasonBids"
```

---

## Task 5: tocIndexer.js — orchestration

**Files:**
- Create: `server/services/tocIndexer.js`

- [ ] **Step 1: Create the indexer**

```js
'use strict';

const crawler = require('./tocCrawler');
const db      = require('./tocDb');
const parser  = require('./tocParser');

const DEBATE_ABBRS = new Set(['LD', 'PF', 'CX']);

let _seeding = false;
const _inflight = new Map(); // tournId → Promise

async function seedTocIndex() {
  if (_seeding) return { skipped: true };
  _seeding = true;
  const stats = { tournaments: 0, entries: 0, skipped: 0, errors: 0 };
  try {
    const circuitId = await crawler.fetchTocCircuitId();
    const ids = await crawler.fetchCircuitTournIds(circuitId);
    for (const id of ids) {
      try {
        const indexed = await indexTournament(id);
        if (indexed) { stats.tournaments++; stats.entries += indexed.entries; }
        else stats.skipped++;
      } catch (err) {
        console.error(`[toc] tournament ${id} failed:`, err.message);
        stats.errors++;
      }
    }
    // Rebuild all seasons touched
    for (const { season } of db.listSeasons()) db.rebuildSeasonBids(season);
  } finally {
    _seeding = false;
  }
  return stats;
}

async function crawlTournament(tournId) {
  if (_inflight.has(tournId)) return _inflight.get(tournId);
  const p = (async () => {
    try { return await indexTournament(tournId); }
    finally { _inflight.delete(tournId); }
  })();
  _inflight.set(tournId, p);
  return p;
}

async function indexTournament(tournId) {
  const json = await crawler.fetchTournamentJson(tournId);

  // Filter: must contain at least one LD/PF/CX event
  const debateCats = (json.categories || []).filter(c => DEBATE_ABBRS.has((c.abbr || '').toUpperCase()));
  if (!debateCats.length) return null;

  const season = parser.seasonFor(json.start);
  db.upsertTournament({
    tourn_id:  Number(json.id),
    name:      json.name,
    webname:   json.webname,
    city:      json.city,
    state:     json.state,
    country:   json.country,
    startDate: String(json.start).slice(0, 10),
    endDate:   String(json.end).slice(0, 10),
    season,
  });

  // Event rows + bid info
  const entryEventMap = new Map(); // entryId → eventAbbr
  for (const cat of debateCats) {
    const abbr = cat.abbr.toUpperCase();
    for (const ev of (cat.events || [])) {
      if (ev.type !== 'debate') continue;
      const bid = parser.inferBidLevel(ev);
      db.upsertEvent(tournId, { eventId: Number(ev.id), abbr, name: ev.name, ...bid });
      // Map entries within this event — the `entries` live on schools, match by event id
      for (const school of (json.schools || [])) {
        for (const entry of (school.entries || [])) {
          if (Number(entry.event) === Number(ev.id) && !entry.dropped) {
            entryEventMap.set(Number(entry.id), { abbr, school });
          }
        }
      }
    }
  }

  // Insert entries with earnedBid
  const earnedByEvent = new Map();
  for (const cat of debateCats) {
    for (const ev of (cat.events || [])) {
      if (ev.type !== 'debate') continue;
      const map = parser.parseEarnedBids(ev);
      for (const [eid, val] of map) earnedByEvent.set(eid, val);
    }
  }

  db.clearEntriesForTournament(tournId);
  for (const school of (json.schools || [])) {
    for (const entry of (school.entries || [])) {
      const match = entryEventMap.get(Number(entry.id));
      if (!match) continue;
      const teamKey = parser.teamKeyFor(entry, school);
      db.upsertEntry(tournId, {
        eventAbbr:   match.abbr,
        entryId:     Number(entry.id),
        teamKey,
        schoolId:    school.id != null ? Number(school.id) : null,
        schoolName:  school.name,
        schoolCode:  school.code,
        displayName: entry.code || entry.name || '',
        earnedBid:   earnedByEvent.get(Number(entry.id)) || null,
      });
    }
  }

  // Ballots
  db.clearBallotsForTournament(tournId);
  for (const cat of debateCats) {
    const abbr = cat.abbr.toUpperCase();
    for (const ev of (cat.events || [])) {
      if (ev.type !== 'debate') continue;
      for (const ballot of parser.parseBallots(ev)) {
        db.insertBallot({ ...ballot, tournId: Number(tournId), eventAbbr: abbr });
      }
    }
  }

  // Results (Final Places + Speaker Awards)
  db.clearResultsForTournament(tournId);
  for (const cat of debateCats) {
    const abbr = cat.abbr.toUpperCase();
    for (const ev of (cat.events || [])) {
      if (ev.type !== 'debate') continue;
      for (const r of parser.parseResults(ev)) {
        db.upsertResult({ tournId: Number(tournId), eventAbbr: abbr, ...r });
      }
    }
  }

  db.setTournamentCrawled(tournId);
  db.rebuildSeasonBids(season);

  return { entries: entryEventMap.size };
}

module.exports = { seedTocIndex, crawlTournament };
```

- [ ] **Step 2: Smoke-test a single tournament**

```
node -e "require('dotenv').config(); const { crawlTournament } = require('./server/services/tocIndexer'); const db = require('./server/services/tocDb'); crawlTournament(36065).then(r => { console.log('result:', r); console.log('events:', db.listEvents(36065).length); console.log('entries LD:', db.listEntriesForEvent(36065, 'LD').length); console.log('results LD:', db.listResults(36065, 'LD').length); }).catch(e => { console.error(e.message); process.exit(1); })"
```
Expected: result with entries count > 50, events ≥ 2 (Greenhill has LD + CX), LD entries > 100, LD results rows present.

- [ ] **Step 3: Commit**

```bash
git add server/services/tocIndexer.js
git commit -m "feat(toc): add tocIndexer (seedTocIndex, crawlTournament, indexTournament)"
```

---

## Task 6: toc.js route

**Files:**
- Create: `server/routes/toc.js`
- Modify: `server/index.js`

- [ ] **Step 1: Create route file**

```js
'use strict';

const express = require('express');
const router = express.Router();
const db = require('../services/tocDb');
const indexer = require('../services/tocIndexer');
const requireUser = require('../middleware/requireUser');

const STALE_MS = 24 * 60 * 60 * 1000;

function _isStale(t) {
  if (!t.lastCrawled) return true;
  if (t.endDate && new Date(t.endDate).getTime() < Date.now() - 24 * 60 * 60 * 1000) return false;
  return Date.now() - new Date(t.lastCrawled).getTime() > STALE_MS;
}

router.get('/seasons', (req, res) => {
  return res.json({ seasons: db.listSeasons() });
});

router.get('/tournaments', (req, res) => {
  const season = String(req.query.season || '');
  const when   = String(req.query.when || 'upcoming');
  const rows = db.listTournaments({ season, when });
  const out = rows.map(t => ({ ...t, events: db.listEvents(t.tourn_id) }));
  return res.json({ tournaments: out });
});

router.get('/tournaments/:id', (req, res) => {
  const id = Number(req.params.id);
  const t = db.getTournament(id);
  if (!t) return res.status(404).json({ error: 'not_found' });
  if (_isStale(t)) {
    indexer.crawlTournament(id).catch(err => console.error('[toc] crawl error:', err.message));
  }
  return res.json({ tournament: t, events: db.listEvents(id) });
});

router.get('/tournaments/:id/threats/:event', (req, res) => {
  const id = Number(req.params.id);
  const t = db.getTournament(id);
  if (!t) return res.status(404).json({ error: 'not_found' });
  const rows = db.listThreats(id, req.params.event.toUpperCase(), t.season);
  return res.json({ threats: rows, season: t.season });
});

router.get('/tournaments/:id/results/:event', (req, res) => {
  const id = Number(req.params.id);
  const ev = req.params.event.toUpperCase();
  return res.json({
    results: db.listResults(id, ev),
    speakers: db.listSpeakerAwards(id, ev, 20),
  });
});

router.get('/entries/:entryId/pairings', (req, res) => {
  const entryId = Number(req.params.entryId);
  const entry = db.getEntry(entryId);
  if (!entry) return res.status(404).json({ error: 'not_found' });
  return res.json({ entry, pairings: db.getPairingsForEntry(entryId) });
});

router.get('/tournaments/:id/refresh', requireUser, async (req, res) => {
  try {
    await indexer.crawlTournament(Number(req.params.id));
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/reindex', requireUser, (req, res) => {
  res.json({ ok: true, message: 'Reindexing started' });
  indexer.seedTocIndex().catch(err => console.error('[toc] reindex error:', err.message));
});

module.exports = router;
```

- [ ] **Step 2: Register route in `server/index.js`**

In the requires block, after `historyRoutes`:
```js
const tocRoutes         = require('./routes/toc');
```

In the `app.use` block, after `/api/history`:
```js
app.use('/api/toc',           tocRoutes);
```

- [ ] **Step 3: Verify module loads**

```
node -e "require('dotenv').config(); require('./server/routes/toc'); console.log('ok')"
```
Expected: `ok`.

- [ ] **Step 4: Commit**

```bash
git add server/routes/toc.js server/index.js
git commit -m "feat(toc): add /api/toc/* routes"
```

---

## Task 7: Auto-seed on startup

**Files:**
- Modify: `server/index.js`

- [ ] **Step 1: Add seed block in `app.listen` callback**

Inside the existing `app.listen` callback (next to the wiki auto-seed block from the Wiki Teams branch), append:

```js
    // Auto-seed TOC tournament index if empty
    try {
      const { countTournaments } = require('./services/tocDb');
      const { seedTocIndex } = require('./services/tocIndexer');
      if (countTournaments() === 0) {
        console.log('[toc] No tournaments indexed — seeding...');
        seedTocIndex()
          .then(r => console.log(`[toc] Seeded ${r.tournaments} tournaments, ${r.entries} entries, ${r.skipped} skipped, ${r.errors} errors`))
          .catch(err => console.error('[toc] Seed failed:', err.message));
      }
    } catch (err) {
      console.error('[toc] Auto-seed init failed:', err.message);
    }
```

- [ ] **Step 2: Syntax check**

```
node --check ./server/index.js
```
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add server/index.js
git commit -m "feat(toc): auto-seed tournament index on startup when empty"
```

---

## Task 8: app.html — Tournament nav item, page section, CSS, script tag

**Files:**
- Modify: `public/app.html`

- [ ] **Step 1: Add nav item BEFORE Teams**

Find:
```html
<button class="nav-item" data-page="teams">
```
On the line immediately ABOVE (before) that button, insert:

```html
<button class="nav-item" data-page="tournament">
  <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>
  <span>Tournament</span>
</button>
```

- [ ] **Step 2: Add `#page-tournament` section**

Find `<section class="page" id="page-teams">`. Immediately BEFORE it, insert:

```html
<section class="page" id="page-tournament">
  <div class="toc-shell" id="toc-shell">
    <div class="toc-topbar">
      <div class="toc-topbar-left">
        <label class="toc-muted" for="toc-season">Season</label>
        <select id="toc-season" class="toc-select"></select>
      </div>
      <div class="toc-tabs">
        <button class="toc-tab active" data-toc-tab="upcoming">Upcoming</button>
        <button class="toc-tab" data-toc-tab="past">Past</button>
      </div>
      <div class="toc-topbar-right">
        <button class="toc-btn-sm" id="toc-reindex-btn">Re-index</button>
      </div>
    </div>

    <!-- Grid view -->
    <div class="toc-grid" id="toc-grid">
      <div class="toc-skeleton-grid" id="toc-skeleton">
        <div class="toc-skeleton-card"></div>
        <div class="toc-skeleton-card"></div>
        <div class="toc-skeleton-card"></div>
        <div class="toc-skeleton-card"></div>
        <div class="toc-skeleton-card"></div>
        <div class="toc-skeleton-card"></div>
      </div>
    </div>

    <!-- Detail view -->
    <div class="toc-detail hidden" id="toc-detail">
      <div class="toc-detail-head">
        <button class="toc-btn-sm" id="toc-back-btn">← Back</button>
        <div class="toc-detail-title" id="toc-detail-title"></div>
        <div class="toc-detail-meta" id="toc-detail-meta"></div>
      </div>
      <div class="toc-event-tabs" id="toc-event-tabs"></div>
      <div class="toc-detail-body" id="toc-detail-body"></div>
    </div>

    <!-- Entry pairings modal -->
    <div class="toc-modal hidden" id="toc-modal">
      <div class="toc-modal-card">
        <div class="toc-modal-head">
          <div class="toc-modal-title" id="toc-modal-title"></div>
          <button class="toc-btn-sm" id="toc-modal-close">×</button>
        </div>
        <div class="toc-modal-body" id="toc-modal-body"></div>
      </div>
    </div>
  </div>
</section>
```

- [ ] **Step 3: Add CSS**

Find the LAST `</style>` tag in `app.html`. Immediately BEFORE it, insert:

```css
/* ── Tournament page ─────────────────────────── */
.toc-shell { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
.toc-topbar {
  display: flex; align-items: center; gap: 16px;
  padding: 10px 16px; border-bottom: 1px solid var(--border, #e5e5e5);
  flex-shrink: 0;
}
.toc-topbar-left, .toc-topbar-right { display: flex; align-items: center; gap: 8px; }
.toc-topbar-right { margin-left: auto; }
.toc-muted { font: 11px var(--font-ui); color: var(--muted); }
.toc-select {
  font: 13px var(--font-ui); padding: 5px 8px;
  border: 1px solid var(--border, #e5e5e5); border-radius: 6px;
  background: var(--bg); color: var(--ink);
}
.toc-tabs { display: flex; gap: 4px; }
.toc-tab {
  font: 500 12px var(--font-ui); padding: 6px 14px; cursor: pointer;
  border: 1px solid var(--border, #e5e5e5); border-radius: 6px;
  background: var(--bg); color: var(--muted);
}
.toc-tab.active { color: var(--ink); background: #fff; box-shadow: var(--shadow-sm); }
.toc-btn-sm {
  font: 11px var(--font-ui); padding: 4px 10px; cursor: pointer;
  border: 1px solid var(--border, #e5e5e5); border-radius: 5px;
  background: var(--bg); color: var(--ink); white-space: nowrap;
}
.toc-btn-sm:hover { background: var(--hover-bg, #f5f5f5); }
.toc-grid {
  flex: 1; overflow-y: auto; padding: 16px;
  display: grid; gap: 12px;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  align-content: start;
}
.toc-card {
  border: 1px solid var(--border, #e5e5e5); border-radius: 8px;
  padding: 12px 14px; cursor: pointer;
  background: var(--bg); transition: box-shadow .18s ease, transform .18s ease;
  opacity: 0; animation: toc-fade-in .22s ease forwards;
}
.toc-card:hover { box-shadow: var(--shadow-md, 0 4px 12px rgba(0,0,0,.08)); transform: translateY(-1px); }
.toc-card-name { font: 600 13px var(--font-ui); color: var(--ink); margin-bottom: 4px; }
.toc-card-dates { font: 11px var(--font-mono); color: var(--muted); margin-bottom: 2px; }
.toc-card-loc { font: 11px var(--font-ui); color: var(--muted); margin-bottom: 8px; }
.toc-card-events { display: flex; flex-wrap: wrap; gap: 4px; }
.toc-badge-ld { background: #dbeafe; color: #1e40af; }
.toc-badge-pf { background: #dcfce7; color: #166534; }
.toc-badge-cx { background: #fee2e2; color: #991b1b; }
.toc-badge-ld, .toc-badge-pf, .toc-badge-cx {
  font: 500 10px/1 var(--font-mono); padding: 3px 6px; border-radius: 4px;
}
@keyframes toc-fade-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
/* Skeleton */
.toc-skeleton-grid { display: contents; }
.toc-skeleton-card {
  height: 96px; border-radius: 8px;
  background: linear-gradient(90deg, #f0f0f0 25%, #e8e8e8 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  animation: toc-shimmer 1.4s infinite;
}
@keyframes toc-shimmer { to { background-position: -200% 0; } }
/* Detail */
.toc-detail { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.toc-detail-head { padding: 14px 16px; border-bottom: 1px solid var(--border, #e5e5e5); display: flex; align-items: center; gap: 12px; }
.toc-detail-title { font: 600 15px var(--font-ui); color: var(--ink); }
.toc-detail-meta { font: 11px var(--font-ui); color: var(--muted); margin-left: auto; }
.toc-event-tabs {
  display: flex; gap: 4px; padding: 10px 16px 0;
  border-bottom: 1px solid var(--border, #e5e5e5);
}
.toc-event-tab {
  font: 500 12px var(--font-ui); padding: 6px 14px; cursor: pointer;
  border: 1px solid var(--border, #e5e5e5); border-bottom: none;
  border-radius: 6px 6px 0 0; background: var(--bg); color: var(--muted);
  margin-bottom: -1px;
}
.toc-event-tab.active { color: var(--ink); background: #fff; border-color: var(--border, #e5e5e5); }
.toc-detail-body { flex: 1; overflow-y: auto; padding: 14px 16px; }
.toc-table { width: 100%; border-collapse: collapse; font: 12px var(--font-ui); }
.toc-table th, .toc-table td { padding: 7px 10px; border-bottom: 1px solid var(--border, #e5e5e5); text-align: left; }
.toc-table th { font: 500 10px var(--font-ui); color: var(--muted); text-transform: uppercase; }
.toc-table tr { cursor: pointer; }
.toc-table tr:hover td { background: var(--hover-bg, #f5f5f5); }
.toc-link { color: #2563eb; text-decoration: none; }
.toc-link.disabled { color: #aaa; pointer-events: none; }
.toc-section-title { font: 600 13px var(--font-ui); color: var(--ink); margin: 18px 0 6px; }
/* Modal */
.toc-modal {
  position: fixed; inset: 0; background: rgba(0,0,0,.4);
  display: flex; align-items: center; justify-content: center; z-index: 500;
}
.toc-modal-card {
  background: var(--bg); border-radius: 10px;
  max-width: 720px; width: 92%; max-height: 80vh;
  display: flex; flex-direction: column; overflow: hidden;
  box-shadow: 0 10px 40px rgba(0,0,0,.25);
}
.toc-modal-head { padding: 12px 16px; border-bottom: 1px solid var(--border, #e5e5e5); display: flex; align-items: center; gap: 10px; }
.toc-modal-title { font: 600 14px var(--font-ui); color: var(--ink); flex: 1; }
.toc-modal-body { overflow-y: auto; padding: 10px 16px 16px; }
/* Mobile */
@media (max-width: 768px) {
  .toc-grid { grid-template-columns: 1fr; }
  .toc-topbar { flex-wrap: wrap; gap: 8px; }
  .toc-detail-meta { width: 100%; margin-left: 0; }
}
```

- [ ] **Step 4: Add script tag**

Immediately before the existing `<script src="/wiki.js"></script>` line, add:
```html
<script src="/toc.js"></script>
```

- [ ] **Step 5: Verify HTML integrity**

```
node -e "const fs=require('fs'); const s=fs.readFileSync('./public/app.html','utf8'); const sectionOpen=(s.match(/<section /g)||[]).length; const sectionClose=(s.match(/<\\/section>/g)||[]).length; console.log('sections:', sectionOpen, sectionClose); if (sectionOpen !== sectionClose) process.exit(1); const ids = [...s.matchAll(/id=\"([^\"]+)\"/g)].map(m=>m[1]); const dup = ids.filter((v,i)=>ids.indexOf(v)!==i); console.log('dup ids:', dup.length); if (dup.length) process.exit(1);"
```
Expected: section counts equal, `dup ids: 0`.

- [ ] **Step 6: Commit**

```bash
git add public/app.html
git commit -m "feat(toc): add Tournament nav item, page section, CSS, script tag"
```

---

## Task 9: public/toc.js — frontend logic

**Files:**
- Create: `public/toc.js`

- [ ] **Step 1: Create the file**

```js
/* public/toc.js — Tournament page */
'use strict';

(function () {
  let _season = null, _when = 'upcoming';
  let _currentTourn = null, _currentEvent = null;

  const $ = id => document.getElementById(id);

  window.initTocPage = async function () {
    await loadSeasons();
    bindStatic();
    await loadGrid();
  };

  function bindStatic() {
    $('toc-season').addEventListener('change', async e => {
      _season = e.target.value;
      await loadGrid();
    });
    document.querySelectorAll('.toc-tab').forEach(b => b.addEventListener('click', async () => {
      document.querySelectorAll('.toc-tab').forEach(x => x.classList.toggle('active', x === b));
      _when = b.dataset.tocTab;
      await loadGrid();
    }));
    $('toc-reindex-btn').addEventListener('click', async () => {
      $('toc-reindex-btn').textContent = 'Reindexing…';
      $('toc-reindex-btn').disabled = true;
      await fetch('/api/toc/reindex', { method: 'POST' });
      setTimeout(() => { $('toc-reindex-btn').textContent = 'Re-index'; $('toc-reindex-btn').disabled = false; loadGrid(); }, 1500);
    });
    $('toc-back-btn').addEventListener('click', showGrid);
    $('toc-modal-close').addEventListener('click', closeModal);
    $('toc-modal').addEventListener('click', e => { if (e.target === $('toc-modal')) closeModal(); });
  }

  async function loadSeasons() {
    const res = await fetch('/api/toc/seasons');
    const { seasons } = await res.json();
    const sel = $('toc-season');
    sel.innerHTML = '';
    seasons.forEach(s => {
      const o = document.createElement('option');
      o.value = s.season;
      o.textContent = `${s.season} (${s.tournamentCount})`;
      sel.appendChild(o);
    });
    _season = seasons[0]?.season || null;
    if (_season) sel.value = _season;
  }

  async function loadGrid() {
    showGrid();
    const grid = $('toc-grid');
    $('toc-skeleton').classList.remove('hidden');
    if (!_season) { grid.innerHTML = '<div class="toc-muted" style="padding:12px">No seasons indexed yet.</div>'; return; }
    try {
      const res = await fetch(`/api/toc/tournaments?season=${encodeURIComponent(_season)}&when=${_when}`);
      const { tournaments } = await res.json();
      renderGrid(tournaments);
    } catch {
      grid.innerHTML = '<div class="toc-muted" style="padding:12px">Failed to load.</div>';
    }
  }

  function renderGrid(tournaments) {
    const grid = $('toc-grid');
    grid.innerHTML = '';
    if (!tournaments.length) {
      grid.innerHTML = `<div class="toc-muted" style="padding:12px">No ${_when} tournaments for ${esc(_season)}.</div>`;
      return;
    }
    tournaments.forEach((t, i) => {
      const card = document.createElement('div');
      card.className = 'toc-card';
      card.style.animationDelay = `${i * 20}ms`;
      const events = (t.events || []).map(ev => `<span class="toc-badge-${ev.abbr.toLowerCase()}">${esc(ev.abbr)}${ev.bidLevel ? ' · ' + esc(ev.bidLevel) : ''}</span>`).join('');
      card.innerHTML = `
        <div class="toc-card-name">${esc(t.name)}</div>
        <div class="toc-card-dates">${esc(t.startDate)} → ${esc(t.endDate)}</div>
        <div class="toc-card-loc">${esc([t.city, t.state].filter(Boolean).join(', ')) || '&nbsp;'}</div>
        <div class="toc-card-events">${events}</div>`;
      card.addEventListener('click', () => openDetail(t));
      grid.appendChild(card);
    });
  }

  function showGrid() {
    $('toc-grid').classList.remove('hidden');
    $('toc-detail').classList.add('hidden');
  }

  async function openDetail(t) {
    _currentTourn = t;
    $('toc-grid').classList.add('hidden');
    $('toc-detail').classList.remove('hidden');
    $('toc-detail-title').textContent = t.name;
    $('toc-detail-meta').textContent = `${t.startDate} → ${t.endDate} · ${[t.city, t.state].filter(Boolean).join(', ')}`;

    const events = t.events || [];
    const tabsEl = $('toc-event-tabs');
    tabsEl.innerHTML = '';
    events.forEach((ev, i) => {
      const b = document.createElement('button');
      b.className = 'toc-event-tab' + (i === 0 ? ' active' : '');
      b.textContent = ev.bidLevel ? `${ev.abbr} · ${ev.bidLevel}` : ev.abbr;
      b.addEventListener('click', () => {
        tabsEl.querySelectorAll('.toc-event-tab').forEach(x => x.classList.toggle('active', x === b));
        loadEventBody(t, ev.abbr);
      });
      tabsEl.appendChild(b);
    });
    if (events.length) loadEventBody(t, events[0].abbr);
    else $('toc-detail-body').innerHTML = '<div class="toc-muted">No LD/PF/CX events indexed.</div>';
  }

  async function loadEventBody(t, abbr) {
    _currentEvent = abbr;
    const body = $('toc-detail-body');
    body.innerHTML = '<div class="toc-muted">Loading…</div>';
    const isPast = new Date(t.endDate) < new Date();
    if (isPast) {
      const res = await fetch(`/api/toc/tournaments/${t.tourn_id}/results/${abbr}`);
      const { results, speakers } = await res.json();
      body.innerHTML = renderResults(results, speakers, abbr);
      attachEntryClicks(body);
    } else {
      const res = await fetch(`/api/toc/tournaments/${t.tourn_id}/threats/${abbr}`);
      const { threats } = await res.json();
      body.innerHTML = renderThreats(threats, abbr);
      attachEntryClicks(body);
    }
  }

  function renderThreats(rows, abbr) {
    if (!rows.length) return '<div class="toc-muted">No entries in this event yet.</div>';
    const body = rows.map((r, i) => {
      const wikiAttr = r.wikiTeamId ? `href="#teams?team=${encodeURIComponent(r.wikiTeamId)}" class="toc-link"` : 'class="toc-link disabled"';
      return `<tr data-entry="${r.entryId}">
        <td>${i + 1}</td>
        <td><strong>${esc(r.displayName)}</strong></td>
        <td>${esc(r.schoolName || '')} ${r.schoolCode ? '<span class="toc-muted">(' + esc(r.schoolCode) + ')</span>' : ''}</td>
        <td>${r.seasonFullBids}${r.seasonPartialBids ? ' <span class="toc-muted">+' + r.seasonPartialBids + 'P</span>' : ''}</td>
        <td><a ${wikiAttr} onclick="event.stopPropagation()">↗</a></td>
      </tr>`;
    }).join('');
    return `<table class="toc-table"><thead><tr><th>#</th><th>Team</th><th>School</th><th>Season Bids (${esc(abbr)})</th><th>Wiki</th></tr></thead><tbody>${body}</tbody></table>`;
  }

  function renderResults(results, speakers, abbr) {
    if (!results.length && !speakers.length) return '<div class="toc-muted">No results yet.</div>';
    const resRows = results.map((r, i) => `<tr data-entry="${r.entryId}">
      <td>${esc(r.place || (i + 1))}</td>
      <td><strong>${esc(r.displayName || '')}</strong></td>
      <td>${esc(r.schoolName || '')}</td>
      <td>${r.earnedBid ? `<span class="toc-badge-${abbr.toLowerCase()}">${esc(r.earnedBid)}</span>` : '<span class="toc-muted">—</span>'}</td>
    </tr>`).join('');
    const spkRows = speakers.map(s => `<tr data-entry="${s.entryId}">
      <td>${s.speakerRank}</td>
      <td><strong>${esc(s.displayName || '')}</strong></td>
      <td>${esc(s.schoolName || '')}</td>
      <td>${s.speakerPoints != null ? s.speakerPoints.toFixed(2) : '—'}</td>
    </tr>`).join('');
    return `
      <div class="toc-section-title">Final Results</div>
      <table class="toc-table"><thead><tr><th>Place</th><th>Team</th><th>School</th><th>Bid</th></tr></thead><tbody>${resRows || '<tr><td colspan=4 class="toc-muted">No results.</td></tr>'}</tbody></table>
      <div class="toc-section-title">Speaker Awards</div>
      <table class="toc-table"><thead><tr><th>#</th><th>Speaker</th><th>Team</th><th>Points</th></tr></thead><tbody>${spkRows || '<tr><td colspan=4 class="toc-muted">No speaker awards.</td></tr>'}</tbody></table>`;
  }

  function attachEntryClicks(root) {
    root.querySelectorAll('tr[data-entry]').forEach(tr => {
      tr.addEventListener('click', () => openPairings(Number(tr.dataset.entry)));
    });
  }

  async function openPairings(entryId) {
    $('toc-modal-title').textContent = 'Loading…';
    $('toc-modal-body').innerHTML = '';
    $('toc-modal').classList.remove('hidden');
    const res = await fetch(`/api/toc/entries/${entryId}/pairings`);
    const { entry, pairings } = await res.json();
    $('toc-modal-title').textContent = `${entry.displayName || 'Entry'} — ${entry.eventAbbr}`;
    if (!pairings.length) {
      $('toc-modal-body').innerHTML = '<div class="toc-muted">No pairings recorded.</div>';
      return;
    }
    const rows = pairings.map(p => `<tr>
      <td>${esc(p.roundType === 'elim' ? p.roundName : 'R' + p.roundName)}</td>
      <td>${esc((p.side || '—').toUpperCase())}</td>
      <td>${p.opponentEntryId || '<span class="toc-muted">bye</span>'}</td>
      <td>${esc(p.judgeName || '—')}</td>
      <td><strong>${esc(p.result || '—')}</strong></td>
      <td>${p.speakerPoints != null ? p.speakerPoints.toFixed(1) : '—'}</td>
    </tr>`).join('');
    $('toc-modal-body').innerHTML = `<table class="toc-table"><thead><tr><th>Round</th><th>Side</th><th>Opp</th><th>Judge</th><th>Result</th><th>Pts</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  function closeModal() { $('toc-modal').classList.add('hidden'); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  document.addEventListener('DOMContentLoaded', () => {
    const page = document.getElementById('page-tournament');
    if (!page) return;
    const observer = new MutationObserver(() => {
      if (page.classList.contains('active') && !page.dataset.tocInit) {
        page.dataset.tocInit = '1';
        window.initTocPage();
      }
    });
    observer.observe(page, { attributes: true, attributeFilter: ['class'] });
  });
})();
```

- [ ] **Step 2: Syntax check**

```
node --check ./public/toc.js
```
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add public/toc.js
git commit -m "feat(toc): add toc.js frontend with grid, detail, threat list, results, speakers, entry pairings"
```

---

## Task 10: wiki.js — handle `#teams?team=X` deep-link

**Files:**
- Modify: `public/wiki.js`

- [ ] **Step 1: Parse hash on page activation**

Open `public/wiki.js`. Find the `initWikiPage` function. Change its body from:
```js
  window.initWikiPage = async function () {
    await loadTeams('');
    $('wiki-search').addEventListener('input', debounce(e => loadTeams(e.target.value), 150));
    ...
```

To prefix-load with hash parsing:
```js
  window.initWikiPage = async function () {
    await loadTeams('');
    $('wiki-search').addEventListener('input', debounce(e => loadTeams(e.target.value), 150));
    $('wiki-reindex-btn').addEventListener('click', reindex);
    $('wiki-refresh-btn').addEventListener('click', () => _activeTeamId && refreshTeam(_activeTeamId));
    $('wiki-refresh-detail-btn').addEventListener('click', () => _activeTeamId && refreshTeam(_activeTeamId));
    $('wiki-retry-btn').addEventListener('click', () => _activeTeamId && selectTeam(_activeTeamId));
    $('wiki-download-all-btn').addEventListener('click', downloadAll);
    $('wiki-export-arg-btn').addEventListener('click', downloadArg);
    $('wiki-copy-btn').addEventListener('click', copyArg);
    $('wiki-ask-btn').addEventListener('click', askArg);

    // Deep-link: #teams?team=X
    const m = String(location.hash || '').match(/team=([^&]+)/);
    if (m) {
      const teamId = decodeURIComponent(m[1]);
      selectTeam(teamId);
    }
  };
```

(Only the final block — the deep-link parse — is the new addition. Leave the rest of the function untouched. The existing function already has the event listener registration lines; just append the Deep-link block.)

- [ ] **Step 2: Syntax check**

```
node --check ./public/wiki.js
```
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add public/wiki.js
git commit -m "feat(toc): handle #teams?team=X deep-link from tournament threat list"
```

---

## Task 11: End-to-end verification

- [ ] **Step 1: Crawl one tournament + sanity check queries**

```
node -e "require('dotenv').config(); const { crawlTournament } = require('./server/services/tocIndexer'); const db = require('./server/services/tocDb'); (async () => { await crawlTournament(36065); const t = db.getTournament(36065); console.log('tournament:', t.name, 'season:', t.season); console.log('events:', db.listEvents(36065).map(e => e.abbr + ':' + e.bidLevel)); console.log('LD entries:', db.listEntriesForEvent(36065, 'LD').length); const results = db.listResults(36065, 'LD'); console.log('LD results count:', results.length, 'champion:', results[0]?.displayName); const speakers = db.listSpeakerAwards(36065, 'LD', 5); console.log('top 5 speakers:', speakers.map(s => s.speakerRank + '. ' + s.displayName)); const threats = db.listThreats(36065, 'LD', t.season); console.log('threats[0]:', JSON.stringify({ team: threats[0].displayName, bids: threats[0].seasonFullBids, wiki: threats[0].wikiTeamId })); const ent = db.listEntriesForEvent(36065, 'LD')[0]; console.log('pairings for first LD entry:', db.getPairingsForEntry(ent.entryId).length, 'ballots'); })().catch(e => { console.error(e.message); process.exit(1); })"
```
Expected: non-zero counts for events, entries, results, speakers, threats, pairings.

- [ ] **Step 2: Run parser unit tests**

```
npm test -- --test-name-pattern='season|fnv1a|teamKeyFor|inferBidLevel|parseBallots'
```
Expected: all pass.

- [ ] **Step 3: Final commit**

If any final artifacts emerged (they should not — each task commits its own work):
```bash
git status --short
```
Expected: clean.

---

## Summary of Deliverables

- 6 new SQLite tables (idempotent `IF NOT EXISTS`)
- 4 new server services: `tocParser`, `tocCrawler`, `tocDb`, `tocIndexer`
- 1 new route file: `routes/toc.js` with 8 endpoints
- 1 new frontend file: `public/toc.js`
- Minor edits: `server/index.js` (requires + route + auto-seed), `public/app.html` (nav + page + CSS + script), `public/wiki.js` (hash deep-link)
- Unit tests for pure parser helpers
- Reuses existing: `server/middleware/requireUser`, `better-sqlite3`, `axios`, style tokens
