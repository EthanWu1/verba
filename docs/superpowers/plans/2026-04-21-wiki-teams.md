# Wiki Teams Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Teams page to Verba that searches any debate team by school code, shows their compiled arguments scraped from the opencaselist.com API, and lets users download or inject arguments into the assistant.

**Architecture:** New `wikiCrawler.js` service authenticates against `api.opencaselist.com` using Tabroom credentials from `.env`, fetches team/argument data on-demand, and caches results in three new SQLite tables. A new `wiki.js` route exposes the data. A new `public/wiki.js` frontend renders a three-panel split UI (teams list → arguments list → argument detail) inside `app.html` as a `data-page="teams"` section.

**Tech Stack:** Node.js/Express, better-sqlite3, axios, existing docxBuilder.js, vanilla JS frontend matching existing app patterns.

---

## API Schema Notes (verified live against api.opencaselist.com)

- Login returns **201** (not 200) with `Set-Cookie: caselist_token=...` — treat 201 as success.
- Caselist identifier in URL paths = `name` field (e.g. `hsld25`, `hspolicy25`, `hspf25`, `ndtceda25`). There is no `slug` field in practice.
- School path segment = `name` field (no spaces, e.g. `HoustonMemorial`). `displayName` has spaces and is for UI only.
- Team path segment = `name` field (debater-initials code, e.g. `EtWu` for Ethan Wu, not a clean 2-letter code).
- Cite objects: `{ cite_id, round_id, title, cites }`. `cites` is the full argument text (markdown/HTML).
- Round objects: `{ round_id, team_id, side, tournament, round, opponent, judge, report, opensource, created_at, ... }`. `side` is `'A'` or `'N'` — single char.
- **Cites returned unsorted** — actually sorted alphabetically by `title` prefix (`1---`, `JF---`, `MA---`, `ND---`, `SO---` for tournament shorthand). For chronological order, join `cites` to `rounds` by `round_id` and sort by `rounds.created_at`.

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `server/services/wikiCrawler.js` | Create | opencaselist API client: auth, rate-limited fetching, team index, team detail |
| `server/services/wikiDb.js` | Create | All SQLite read/write for wiki tables (teams, arguments, round_reports) |
| `server/routes/wiki.js` | Create | Express routes for `/api/wiki/*` |
| `server/services/db.js` | Modify | Add wiki table schema + migration |
| `server/index.js` | Modify | Register wiki routes + init crawl session on startup |
| `public/wiki.js` | Create | Frontend: three-panel state, search, polling, Ask/Copy/Download |
| `public/app.html` | Modify | Add Teams nav item + `#page-teams` section + wiki.js script tag |

---

## Task 1: DB Schema — wiki tables

**Files:**
- Modify: `server/services/db.js`

- [ ] **Step 1: Add wiki tables to `_initSchema`**

Open `server/services/db.js`. Inside `_initSchema(db)`, after the existing `CREATE TABLE` block, add:

```js
db.exec(`
  CREATE TABLE IF NOT EXISTS wiki_teams (
    id          TEXT PRIMARY KEY,
    school      TEXT NOT NULL,
    code        TEXT NOT NULL,
    fullName    TEXT NOT NULL,
    event       TEXT,
    pageUrl     TEXT NOT NULL,
    lastCrawled TEXT,
    crawlStatus TEXT NOT NULL DEFAULT 'pending'
  );
  CREATE INDEX IF NOT EXISTS idx_wiki_teams_code   ON wiki_teams(code);
  CREATE INDEX IF NOT EXISTS idx_wiki_teams_school ON wiki_teams(school);

  CREATE VIRTUAL TABLE IF NOT EXISTS wiki_teams_fts USING fts5(
    fullName, school, code,
    content='wiki_teams', content_rowid='rowid'
  );

  CREATE TABLE IF NOT EXISTS wiki_arguments (
    id          TEXT PRIMARY KEY,
    teamId      TEXT NOT NULL REFERENCES wiki_teams(id),
    name        TEXT NOT NULL,
    side        TEXT NOT NULL,
    readCount   INTEGER NOT NULL DEFAULT 0,
    fullText    TEXT NOT NULL,
    lastUpdated TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_wiki_args_team ON wiki_arguments(teamId);

  CREATE VIRTUAL TABLE IF NOT EXISTS wiki_arguments_fts USING fts5(
    name, fullText,
    content='wiki_arguments', content_rowid='rowid'
  );

  CREATE TABLE IF NOT EXISTS wiki_round_reports (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    teamId     TEXT NOT NULL REFERENCES wiki_teams(id),
    argumentId TEXT REFERENCES wiki_arguments(id),
    tournament TEXT,
    round      TEXT,
    opponent   TEXT,
    side       TEXT
  );
`);
```

- [ ] **Step 2: Verify tables created on startup**

```bash
node -e "require('./server/services/db').getDb(); console.log('ok')"
```
Expected: `ok` with no errors.

- [ ] **Step 3: Commit**

```bash
git add server/services/db.js
git commit -m "feat(wiki): add wiki_teams, wiki_arguments, wiki_round_reports tables"
```

---

## Task 2: wikiCrawler.js — API client

**Files:**
- Create: `server/services/wikiCrawler.js`

- [ ] **Step 1: Create the crawler service**

```js
'use strict';

const axios = require('axios');

const BASE = 'https://api.opencaselist.com/v1';
const DELAY_MS = 200;

let _cookie = null;

async function _sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function _login() {
  // Login returns 201 on success — axios throws for non-2xx by default so
  // we accept any 2xx. Set-Cookie: caselist_token=... is the auth cookie.
  const res = await axios.post(`${BASE}/login`, {
    username: process.env.OPENCASELIST_USER,
    password: process.env.OPENCASELIST_PASS,
    remember: true,
  }, {
    validateStatus: s => s >= 200 && s < 300,
  });
  const setCookie = res.headers['set-cookie'];
  if (!setCookie) throw new Error('opencaselist login: no cookie returned');
  _cookie = setCookie.map(c => c.split(';')[0]).join('; ');
}

async function _get(path) {
  if (!_cookie) await _login();
  try {
    const res = await axios.get(`${BASE}${path}`, {
      headers: { Cookie: _cookie },
    });
    return res.data;
  } catch (err) {
    if (err.response?.status === 401) {
      _cookie = null;
      await _login();
      const res = await axios.get(`${BASE}${path}`, {
        headers: { Cookie: _cookie },
      });
      return res.data;
    }
    throw err;
  }
}

async function fetchCaselists() {
  return _get('/caselists');
}

async function fetchSchools(caselist) {
  await _sleep(DELAY_MS);
  return _get(`/caselists/${caselist}/schools`);
}

async function fetchTeams(caselist, school) {
  await _sleep(DELAY_MS);
  return _get(`/caselists/${caselist}/schools/${encodeURIComponent(school)}/teams`);
}

async function fetchRounds(caselist, school, team) {
  await _sleep(DELAY_MS);
  return _get(`/caselists/${caselist}/schools/${encodeURIComponent(school)}/teams/${encodeURIComponent(team)}/rounds`);
}

async function fetchCites(caselist, school, team) {
  await _sleep(DELAY_MS);
  return _get(`/caselists/${caselist}/schools/${encodeURIComponent(school)}/teams/${encodeURIComponent(team)}/cites`);
}

module.exports = { fetchCaselists, fetchSchools, fetchTeams, fetchRounds, fetchCites };
```

- [ ] **Step 2: Smoke-test login + fetchCaselists**

```bash
node -e "
require('dotenv').config();
const c = require('./server/services/wikiCrawler');
c.fetchCaselists().then(d => console.log(JSON.stringify(d).slice(0,200))).catch(console.error);
"
```
Expected: JSON array of caselist objects (id, slug, name, event, year).

- [ ] **Step 3: Smoke-test team cites**

Caselist identifier is the `name` field (e.g. `hsld25`). School and team path segments are `name` fields from the API (no spaces, initial-coded).

```bash
node -e "
require('dotenv').config();
const c = require('./server/services/wikiCrawler');
c.fetchCites('hsld25', 'HoustonMemorial', 'EtWu')
  .then(d => console.log('cite count:', d.length, '\\nfirst:', JSON.stringify(d[0]).slice(0,400)))
  .catch(console.error);
"
```
Expected: cite count > 0, first cite has `cite_id`, `round_id`, `title`, `cites` fields.

- [ ] **Step 4: Commit**

```bash
git add server/services/wikiCrawler.js
git commit -m "feat(wiki): add opencaselist API client with auth + rate limiting"
```

---

## Task 3: wikiDb.js — database layer

**Files:**
- Create: `server/services/wikiDb.js`

- [ ] **Step 1: Create the DB service**

```js
'use strict';

const { getDb } = require('./db');
const { randomUUID } = require('crypto');

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// ── Team index ───────────────────────────────────────────────

function upsertTeam({ school, code, fullName, event, pageUrl }) {
  const db = getDb();
  const id = slugify(`${school}-${code}`);
  db.prepare(`
    INSERT INTO wiki_teams (id, school, code, fullName, event, pageUrl)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      fullName = excluded.fullName,
      event    = excluded.event,
      pageUrl  = excluded.pageUrl
  `).run(id, school, code, fullName, event || null, pageUrl);
  return id;
}

function rebuildTeamsFts() {
  getDb().exec(`INSERT INTO wiki_teams_fts(wiki_teams_fts) VALUES('rebuild')`);
}

function searchTeams(q, limit = 100) {
  const db = getDb();
  if (!q) {
    return db.prepare(`SELECT * FROM wiki_teams ORDER BY fullName LIMIT ?`).all(limit);
  }
  return db.prepare(`
    SELECT t.* FROM wiki_teams t
    JOIN wiki_teams_fts f ON t.rowid = f.rowid
    WHERE wiki_teams_fts MATCH ?
    ORDER BY rank LIMIT ?
  `).all(q + '*', limit);
}

function getTeam(id) {
  return getDb().prepare(`SELECT * FROM wiki_teams WHERE id = ?`).get(id);
}

function setTeamCrawlStatus(id, status) {
  getDb().prepare(`UPDATE wiki_teams SET crawlStatus = ? WHERE id = ?`).run(status, id);
}

function setTeamCrawled(id) {
  getDb().prepare(`
    UPDATE wiki_teams SET crawlStatus = 'done', lastCrawled = ? WHERE id = ?
  `).run(new Date().toISOString(), id);
}

function isTeamStale(team) {
  if (!team.lastCrawled) return true;
  const age = Date.now() - new Date(team.lastCrawled).getTime();
  return age > 7 * 24 * 60 * 60 * 1000;
}

function countTeams() {
  return getDb().prepare(`SELECT COUNT(*) as n FROM wiki_teams`).get().n;
}

// ── Arguments ────────────────────────────────────────────────

function upsertArgument({ teamId, name, side, readCount, fullText }) {
  const db = getDb();
  const id = slugify(`${teamId}-${name}-${side}`);
  db.prepare(`
    INSERT INTO wiki_arguments (id, teamId, name, side, readCount, fullText, lastUpdated)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name        = excluded.name,
      readCount   = excluded.readCount,
      fullText    = excluded.fullText,
      lastUpdated = excluded.lastUpdated
  `).run(id, teamId, name, side, readCount, fullText, new Date().toISOString());
  return id;
}

function rebuildArgumentsFts() {
  getDb().exec(`INSERT INTO wiki_arguments_fts(wiki_arguments_fts) VALUES('rebuild')`);
}

function getTeamArguments(teamId) {
  return getDb().prepare(`
    SELECT * FROM wiki_arguments WHERE teamId = ? ORDER BY readCount DESC
  `).all(teamId);
}

function getArgument(id) {
  return getDb().prepare(`SELECT * FROM wiki_arguments WHERE id = ?`).get(id);
}

// ── Round reports ─────────────────────────────────────────────

function insertRoundReport({ teamId, argumentId, tournament, round, opponent, side }) {
  getDb().prepare(`
    INSERT INTO wiki_round_reports (teamId, argumentId, tournament, round, opponent, side)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(teamId, argumentId || null, tournament || null, round || null, opponent || null, side || null);
}

function clearRoundReports(teamId) {
  getDb().prepare(`DELETE FROM wiki_round_reports WHERE teamId = ?`).run(teamId);
}

module.exports = {
  upsertTeam, rebuildTeamsFts, searchTeams, getTeam,
  setTeamCrawlStatus, setTeamCrawled, isTeamStale, countTeams,
  upsertArgument, rebuildArgumentsFts, getTeamArguments, getArgument,
  insertRoundReport, clearRoundReports,
};
```

- [ ] **Step 2: Quick smoke test**

```bash
node -e "
require('dotenv').config();
const db = require('./server/services/wikiDb');
db.upsertTeam({ school: 'Memorial', code: 'EW', fullName: 'Memorial EW', event: 'ld', pageUrl: 'https://opencaselist.com/ld/Memorial/EW' });
db.rebuildTeamsFts();
console.log(db.searchTeams('Memorial'));
"
```
Expected: array with one team object `{ id: 'memorial-ew', school: 'Memorial', ... }`.

- [ ] **Step 3: Commit**

```bash
git add server/services/wikiDb.js
git commit -m "feat(wiki): add wikiDb service for team/argument CRUD"
```

---

## Task 4: wikiIndexer.js — team index + detail crawl orchestration

**Files:**
- Create: `server/services/wikiIndexer.js`

- [ ] **Step 1: Create the indexer**

```js
'use strict';

const crawler = require('./wikiCrawler');
const db      = require('./wikiDb');

let _indexing = false;

async function seedTeamIndex() {
  if (_indexing) return { skipped: true };
  _indexing = true;
  let inserted = 0;
  try {
    const caselists = await crawler.fetchCaselists();
    for (const cl of caselists) {
      if (cl.archived) continue;
      const schools = await crawler.fetchSchools(cl.name);
      for (const school of schools) {
        if (school.archived) continue;
        const teams = await crawler.fetchTeams(cl.name, school.name);
        for (const team of teams) {
          db.upsertTeam({
            school:   school.display_name || school.name,
            code:     team.display_name || team.name,
            fullName: `${school.display_name || school.name} ${team.display_name || team.name}`,
            event:    cl.event,
            // Stash caselist.name + school.name + team.name in pageUrl path for later
            pageUrl:  `https://opencaselist.com/${cl.name}/${encodeURIComponent(school.name)}/${encodeURIComponent(team.name)}`,
          });
          inserted++;
        }
      }
    }
    db.rebuildTeamsFts();
  } finally {
    _indexing = false;
  }
  return { inserted };
}

async function crawlTeamDetail(teamId) {
  const team = db.getTeam(teamId);
  if (!team) throw new Error(`Team not found: ${teamId}`);

  db.setTeamCrawlStatus(teamId, 'crawling');

  try {
    // pageUrl format: https://opencaselist.com/{caselist.name}/{school.name}/{team.name}
    const parts = new URL(team.pageUrl).pathname.split('/').filter(Boolean);
    const [caselist, school, code] = parts.map(decodeURIComponent);

    const [rounds, cites] = await Promise.all([
      crawler.fetchRounds(caselist, school, code),
      crawler.fetchCites(caselist, school, code),
    ]);

    // Build round index keyed by round_id for joining
    const roundById = new Map();
    (rounds || []).forEach(r => roundById.set(r.round_id, r));

    db.clearRoundReports(teamId);

    // Chronologically sort cites by joined round.created_at (fallback: round_id asc)
    const sortedCites = [...(cites || [])].sort((a, b) => {
      const rA = roundById.get(a.round_id);
      const rB = roundById.get(b.round_id);
      const tA = rA?.created_at ? Date.parse(rA.created_at) : a.round_id || 0;
      const tB = rB?.created_at ? Date.parse(rB.created_at) : b.round_id || 0;
      return tA - tB;
    });

    // Group cites by stripped title (dedupe tournament prefixes like "JF---", "MA---", "SO---").
    // Same stripped title = same argument read across multiple tournaments.
    // Group value holds the most recent fullText and the list of (round, originalTitle) reads.
    const groups = new Map(); // strippedName → { name, side, fullText, reads: [{round, originalTitle}] }
    for (const cite of sortedCites) {
      const name = _stripTournamentPrefix(cite.title || 'Untitled');
      const round = roundById.get(cite.round_id);
      const side = _inferSide(cite.title || '', round?.side);
      const key = `${side}::${name}`;

      let g = groups.get(key);
      if (!g) {
        g = { name, side, fullText: cite.cites || '', reads: [] };
        groups.set(key, g);
      } else {
        // keep most recent fullText (sortedCites is chronological asc)
        g.fullText = cite.cites || g.fullText;
      }
      g.reads.push({ round, originalTitle: cite.title });
    }

    for (const g of groups.values()) {
      const argId = db.upsertArgument({
        teamId,
        name:      g.name,
        side:      g.side,
        readCount: g.reads.length,
        fullText:  g.fullText,
      });
      for (const { round } of g.reads) {
        if (!round) continue;
        db.insertRoundReport({
          teamId,
          argumentId: argId,
          tournament: round.tournament,
          round:      round.round,
          opponent:   round.opponent,
          side:       round.side === 'A' ? 'aff' : (round.side === 'N' ? 'neg' : null),
        });
      }
    }

    db.rebuildArgumentsFts();
    db.setTeamCrawled(teamId);
  } catch (err) {
    db.setTeamCrawlStatus(teamId, 'error');
    throw err;
  }
}

// Side inference: prefer explicit title markers; fall back to the round.side ('A'/'N').
function _inferSide(title, roundSide) {
  const t = (title || '').toLowerCase();
  // Title markers: 1AC/2AC/AFF → aff; NC/1NC/2NR/CP/DA/K/T/PIK/Th → neg
  if (/(^|[^a-z])(aff|1ac|2ac)([^a-z]|$)/.test(t)) return 'aff';
  if (/(^|[^a-z])(neg|1nc|2nr|nc|cp|da|k|t|pik|th|phil)([^a-z]|$)/.test(t)) return 'neg';
  if (roundSide === 'A') return 'aff';
  if (roundSide === 'N') return 'neg';
  return 'aff';
}

// Cite titles on opencaselist are prefixed with a tournament shorthand
// (e.g. "JF---1AC---Dharma", "MA---1AC---Conflict", "SO---T---FW"). The
// shorthand is 1-3 uppercase letters or digits followed by "---". Strip
// it so the same argument read at multiple tournaments is grouped together.
function _stripTournamentPrefix(title) {
  return String(title || '').replace(/^[A-Z0-9]{1,4}---/, '').trim();
}

module.exports = { seedTeamIndex, crawlTeamDetail };
```

- [ ] **Step 2: Test seedTeamIndex subset (single school)**

```bash
node -e "
require('dotenv').config();
const { fetchTeams } = require('./server/services/wikiCrawler');
fetchTeams('hsld25', 'HoustonMemorial')
  .then(teams => console.log('teams:', teams.map(t => t.name)))
  .catch(console.error);
"
```
Expected: array including `EtWu` and other teams.

- [ ] **Step 3: Test crawlTeamDetail for HoustonMemorial/EtWu**

```bash
node -e "
require('dotenv').config();
const db = require('./server/services/wikiDb');
const { crawlTeamDetail } = require('./server/services/wikiIndexer');

db.upsertTeam({
  school: 'Houston Memorial',
  code:   'EtWu',
  fullName: 'Houston Memorial EtWu',
  event:  'ld',
  pageUrl: 'https://opencaselist.com/hsld25/HoustonMemorial/EtWu',
});
db.rebuildTeamsFts();

crawlTeamDetail('houston-memorial-etwu')
  .then(() => {
    const args = db.getTeamArguments('houston-memorial-etwu');
    console.log('grouped argument count:', args.length);
    args.slice(0, 10).forEach(a => console.log(' ', a.side.toUpperCase(), a.readCount + 'x', a.name));
  })
  .catch(console.error);
"
```
Expected: grouped argument count < 30 (dedupe across tournaments), each with name/side/readCount.

- [ ] **Step 4: Commit**

```bash
git add server/services/wikiIndexer.js
git commit -m "feat(wiki): add wikiIndexer for team seed + on-demand detail crawl"
```

---

## Task 5: wiki.js route

**Files:**
- Create: `server/routes/wiki.js`
- Modify: `server/index.js`

- [ ] **Step 1: Create route file**

```js
'use strict';

const express    = require('express');
const router     = express.Router();
const db         = require('../services/wikiDb');
const indexer    = require('../services/wikiIndexer');
const { getDb }  = require('../services/db');
const { buildDocx } = require('../services/docxBuilder');

// GET /api/wiki/teams?q=memorial&limit=100
router.get('/teams', (req, res) => {
  const q     = String(req.query.q || '');
  const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 100));
  return res.json({ teams: db.searchTeams(q, limit), total: db.countTeams() });
});

// GET /api/wiki/teams/:id  — returns team + arguments; triggers crawl if stale
router.get('/teams/:id', async (req, res) => {
  const team = db.getTeam(req.params.id);
  if (!team) return res.status(404).json({ error: 'not_found' });

  if (db.isTeamStale(team) && team.crawlStatus !== 'crawling') {
    // Fire-and-forget crawl; client polls via crawlStatus
    indexer.crawlTeamDetail(team.id).catch(err =>
      console.error('[wiki] crawl error:', err.message)
    );
  }

  const args = db.getTeamArguments(team.id);
  return res.json({ team, arguments: args });
});

// GET /api/wiki/teams/:id/refresh  — force re-crawl
router.get('/teams/:id/refresh', async (req, res) => {
  const team = db.getTeam(req.params.id);
  if (!team) return res.status(404).json({ error: 'not_found' });
  db.setTeamCrawlStatus(team.id, 'pending');
  getDb().prepare(`UPDATE wiki_teams SET lastCrawled = NULL WHERE id = ?`).run(team.id);
  indexer.crawlTeamDetail(team.id).catch(err =>
    console.error('[wiki] refresh error:', err.message)
  );
  return res.json({ ok: true });
});

// GET /api/wiki/arguments/:id
router.get('/arguments/:id', (req, res) => {
  const arg = db.getArgument(req.params.id);
  if (!arg) return res.status(404).json({ error: 'not_found' });
  return res.json({ argument: arg });
});

// GET /api/wiki/teams/:id/export  — download all arguments as .docx
router.get('/teams/:id/export', async (req, res) => {
  const team = db.getTeam(req.params.id);
  if (!team) return res.status(404).json({ error: 'not_found' });
  const args = db.getTeamArguments(team.id);
  // Build one synthetic card per argument, aff first then neg
  const sorted = [...args.filter(a => a.side === 'aff'), ...args.filter(a => a.side === 'neg')];
  const cards = sorted.map(a => ({
    tag:   `${a.name} (${a.side.toUpperCase()}) — ${a.readCount}×`,
    cite:  `${team.fullName} via opencaselist`,
    body_markdown: a.fullText,
  }));
  const { buildProjectDocx } = require('../services/docxBuilder');
  const buffer = await buildProjectDocx(team.fullName, cards);
  res.setHeader('Content-Disposition', `attachment; filename="${team.fullName}.docx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  return res.send(buffer);
});

// GET /api/wiki/arguments/:id/export
router.get('/arguments/:id/export', async (req, res) => {
  const arg = db.getArgument(req.params.id);
  if (!arg) return res.status(404).json({ error: 'not_found' });
  const card = {
    tag:           `${arg.name} (${arg.side.toUpperCase()}) — ${arg.readCount}×`,
    cite:          'via opencaselist',
    body_markdown: arg.fullText,
  };
  const buffer = await buildDocx(card);
  res.setHeader('Content-Disposition', `attachment; filename="${arg.name}.docx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  return res.send(buffer);
});

// POST /api/wiki/reindex  — re-crawl full team index
router.post('/reindex', async (req, res) => {
  res.json({ ok: true, message: 'Reindexing started' });
  indexer.seedTeamIndex().catch(err =>
    console.error('[wiki] reindex error:', err.message)
  );
});

module.exports = router;
```

- [ ] **Step 2: Register route in server/index.js**

In `server/index.js`, after the existing `require` block:

```js
const wikiRoutes = require('./routes/wiki');
```
And after the existing `app.use` block:
```js
app.use('/api/wiki', wikiRoutes);
```

- [ ] **Step 4: Verify routes respond**

Start the server (`npm run dev`) then:
```bash
curl -s "http://localhost:3000/api/wiki/teams?q=Memorial" | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).teams.length))"
```
Expected: `1` (Memorial EW seeded in Task 3).

- [ ] **Step 5: Commit**

```bash
git add server/routes/wiki.js server/index.js
git commit -m "feat(wiki): add /api/wiki/* routes"
```

---

## Task 6: Seed team index on startup

**Files:**
- Modify: `server/index.js`

- [ ] **Step 1: Auto-seed on startup if table is empty**

In `server/index.js`, inside the server `listen` callback (after the app starts), add:

```js
// Auto-seed wiki team index if empty
const { countTeams } = require('./services/wikiDb');
const { seedTeamIndex } = require('./services/wikiIndexer');
if (process.env.OPENCASELIST_USER && countTeams() === 0) {
  console.log('[wiki] No teams indexed — seeding from opencaselist...');
  seedTeamIndex()
    .then(r => console.log(`[wiki] Seeded ${r.inserted} teams`))
    .catch(err => console.error('[wiki] Seed failed:', err.message));
}
```

- [ ] **Step 2: Test startup seed**

Drop wiki tables to simulate fresh state, restart server, check logs:
```bash
node -e "
const db = require('./server/services/db').getDb();
db.exec('DELETE FROM wiki_teams');
console.log('cleared');
"
npm run dev
```
Expected log line: `[wiki] No teams indexed — seeding from opencaselist...` followed by `[wiki] Seeded N teams`.

- [ ] **Step 3: Commit**

```bash
git add server/index.js
git commit -m "feat(wiki): auto-seed team index on startup when empty"
```

---

## Task 7: app.html — Teams nav item + page section

**Files:**
- Modify: `public/app.html`

- [ ] **Step 1: Add Teams nav item to sidebar**

In `public/app.html`, find the library nav items block:
```html
<button class="nav-item nav-sub" data-page="library" data-lib-go="history">
```
After that button (and its closing tag), add:
```html
<button class="nav-item" data-page="teams">
  <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
  <span>Teams</span>
</button>
```

- [ ] **Step 2: Add `#page-teams` section**

Find `<section class="page" id="page-library">` in `app.html`. After the closing `</section>` of that block, add:

```html
<section class="page" id="page-teams">
  <div class="wiki-shell">
    <!-- Panel 1: Team search + list -->
    <div class="wiki-panel wiki-panel-teams" id="wiki-panel-teams">
      <div class="wiki-panel-head">
        <input id="wiki-search" class="wiki-search" type="search" placeholder="Search teams…" autocomplete="off">
      </div>
      <div class="wiki-team-list" id="wiki-team-list">
        <div class="wiki-skeleton-rows" id="wiki-skeleton">
          <div class="wiki-skeleton-row"></div>
          <div class="wiki-skeleton-row"></div>
          <div class="wiki-skeleton-row"></div>
          <div class="wiki-skeleton-row"></div>
          <div class="wiki-skeleton-row"></div>
        </div>
      </div>
      <div class="wiki-panel-foot">
        <span id="wiki-team-count" class="wiki-muted"></span>
        <button class="wiki-btn-sm" id="wiki-reindex-btn">Re-index All</button>
      </div>
    </div>

    <!-- Panel 2: Argument list -->
    <div class="wiki-panel wiki-panel-args hidden" id="wiki-panel-args">
      <div class="wiki-panel-head">
        <div class="wiki-team-title" id="wiki-team-title"></div>
        <div class="wiki-team-meta" id="wiki-team-meta"></div>
        <div class="wiki-arg-actions">
          <button class="wiki-btn-sm" id="wiki-download-all-btn">⬇ Download All</button>
          <button class="wiki-btn-sm" id="wiki-refresh-btn">↻ Refresh</button>
        </div>
      </div>
      <div class="wiki-arg-list" id="wiki-arg-list">
        <div class="wiki-crawl-status hidden" id="wiki-crawl-status">
          <div class="wiki-spinner"></div>
          <span class="wiki-crawl-msg" id="wiki-crawl-msg">Fetching cases…</span>
        </div>
        <div class="wiki-error hidden" id="wiki-arg-error">
          Failed to load — <button class="wiki-btn-link" id="wiki-retry-btn">Retry</button>
        </div>
      </div>
    </div>

    <!-- Panel 3: Argument detail -->
    <div class="wiki-panel wiki-panel-detail hidden" id="wiki-panel-detail">
      <div class="wiki-panel-head">
        <div class="wiki-arg-title" id="wiki-arg-title"></div>
        <div class="wiki-detail-actions">
          <button class="wiki-btn-sm wiki-ask-btn" id="wiki-ask-btn">Ask ↗</button>
          <button class="wiki-btn-sm" id="wiki-export-arg-btn">⬇ .docx</button>
          <button class="wiki-btn-sm" id="wiki-copy-btn">Copy</button>
          <button class="wiki-btn-sm" id="wiki-refresh-detail-btn">↻</button>
        </div>
      </div>
      <div class="wiki-detail-body" id="wiki-detail-body"></div>
    </div>
  </div>
</section>
```

- [ ] **Step 3: Add CSS for wiki panels**

In `app.html`, inside the `<style>` block, append:

```css
/* ── Wiki Teams page ────────────────────────── */
.wiki-shell {
  display: flex;
  height: 100%;
  overflow: hidden;
  gap: 0;
}
.wiki-panel {
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border, #e5e5e5);
  overflow: hidden;
}
.wiki-panel-teams { width: 200px; flex-shrink: 0; }
.wiki-panel-args  { width: 240px; flex-shrink: 0; }
.wiki-panel-detail { flex: 1; border-right: none; }

.wiki-panel-head {
  padding: 10px 12px 8px;
  border-bottom: 1px solid var(--border, #e5e5e5);
  flex-shrink: 0;
}
.wiki-panel-foot {
  padding: 8px 12px;
  border-top: 1px solid var(--border, #e5e5e5);
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.wiki-search {
  width: 100%;
  padding: 6px 10px;
  font: 13px var(--font-ui);
  border: 1px solid var(--border, #e5e5e5);
  border-radius: 6px;
  background: var(--bg);
  color: var(--ink);
  box-sizing: border-box;
}
.wiki-team-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}
.wiki-team-row {
  display: flex;
  align-items: center;
  padding: 7px 12px;
  cursor: pointer;
  font: 13px var(--font-ui);
  color: var(--ink);
  gap: 6px;
}
.wiki-team-row:hover { background: var(--hover-bg, #f5f5f5); }
.wiki-team-row.active {
  background: #fff;
  box-shadow: var(--shadow-sm);
  border-left: 3px solid var(--ink);
}
.wiki-badge {
  font: 500 9px/1 var(--font-mono);
  padding: 2px 4px;
  border-radius: 3px;
  background: var(--hover-bg, #f0f0f0);
  color: var(--muted);
  text-transform: uppercase;
  flex-shrink: 0;
}
.wiki-muted { font: 11px var(--font-ui); color: var(--muted); }
.wiki-btn-sm {
  font: 11px var(--font-ui);
  padding: 3px 8px;
  border: 1px solid var(--border, #e5e5e5);
  border-radius: 5px;
  background: var(--bg);
  color: var(--ink);
  cursor: pointer;
  white-space: nowrap;
}
.wiki-btn-sm:hover { background: var(--hover-bg, #f5f5f5); }
.wiki-btn-link { background: none; border: none; color: var(--ink); cursor: pointer; text-decoration: underline; font: inherit; padding: 0; }
.wiki-arg-actions, .wiki-detail-actions { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
.wiki-team-title { font: 600 13px var(--font-ui); color: var(--ink); }
.wiki-team-meta  { font: 11px var(--font-ui); color: var(--muted); margin-top: 2px; }
.wiki-arg-list { flex: 1; overflow-y: auto; padding: 4px 0; }
.wiki-arg-row {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  cursor: pointer;
  gap: 8px;
}
.wiki-arg-row:hover { background: var(--hover-bg, #f5f5f5); }
.wiki-arg-row.active { background: #fff; box-shadow: var(--shadow-sm); border-left: 3px solid var(--ink); }
.wiki-arg-name { font: 600 12px var(--font-ui); color: var(--ink); flex: 1; }
.wiki-side-aff { color: #2563eb; font: 500 9px/1 var(--font-mono); text-transform: uppercase; }
.wiki-side-neg { color: #dc2626; font: 500 9px/1 var(--font-mono); text-transform: uppercase; }
.wiki-read-count { font: 11px var(--font-mono); color: var(--muted); }
.wiki-arg-title { font: 600 14px var(--font-ui); color: var(--ink); }
.wiki-detail-body { flex: 1; overflow-y: auto; padding: 14px; font: 13px/1.6 var(--font-ui); color: var(--ink); white-space: pre-wrap; }
/* Crawl spinner */
.wiki-crawl-status { display: flex; align-items: center; gap: 10px; padding: 16px 12px; }
.wiki-spinner {
  width: 16px; height: 16px;
  border: 2px solid var(--border, #e5e5e5);
  border-top-color: var(--ink);
  border-radius: 50%;
  animation: wiki-spin 0.7s linear infinite;
  flex-shrink: 0;
}
@keyframes wiki-spin { to { transform: rotate(360deg); } }
.wiki-crawl-msg { animation: wiki-fade 1.6s ease infinite; font: 12px var(--font-ui); color: var(--muted); }
@keyframes wiki-fade { 0%,100% { opacity: 0.4; } 50% { opacity: 1; } }
/* Skeleton */
.wiki-skeleton-rows { padding: 8px 12px; display: flex; flex-direction: column; gap: 8px; }
.wiki-skeleton-row {
  height: 28px; border-radius: 5px;
  background: linear-gradient(90deg, #f0f0f0 25%, #e8e8e8 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  animation: wiki-shimmer 1.4s infinite;
}
@keyframes wiki-shimmer { to { background-position: -200% 0; } }
/* Staggered fade-in for arg rows */
.wiki-arg-row { opacity: 0; animation: wiki-row-in 0.25s ease forwards; }
@keyframes wiki-row-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
/* Panel 3 slide in */
.wiki-panel-detail {
  transform: translateX(100%);
  transition: transform 0.22s ease;
}
.wiki-panel-detail.visible { transform: translateX(0); }
/* Mobile */
@media (max-width: 768px) {
  .wiki-shell { flex-direction: column; }
  .wiki-panel-teams, .wiki-panel-args { width: 100%; border-right: none; border-bottom: 1px solid var(--border, #e5e5e5); max-height: 40vh; }
  .wiki-panel-detail { transform: none; max-height: 60vh; }
}
```

- [ ] **Step 4: Add wiki.js script tag**

At the bottom of `app.html`, before `</body>`, add:
```html
<script src="/wiki.js"></script>
```

- [ ] **Step 5: Verify page compiles**

Open app in browser, click Teams nav item — should show empty three-panel layout with skeleton rows.

- [ ] **Step 6: Commit**

```bash
git add public/app.html
git commit -m "feat(wiki): add Teams nav item and three-panel page layout"
```

---

## Task 8: public/wiki.js — frontend logic

**Files:**
- Create: `public/wiki.js`

- [ ] **Step 1: Create wiki.js**

```js
/* public/wiki.js — Wiki Teams page */
'use strict';

(function () {
  const CRAWL_MSGS = ['Fetching cases…', 'Parsing round reports…', 'Indexing arguments…'];
  let _msgIdx = 0, _msgTimer = null;
  let _activeTeamId = null, _activeArgId = null, _pollTimer = null;

  // ── DOM helpers ──────────────────────────────────────────────
  const $  = id => document.getElementById(id);
  const qs = s  => document.querySelector(s);

  // ── Init (called when Teams page becomes active) ─────────────
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
  };

  // ── Teams list ───────────────────────────────────────────────
  async function loadTeams(q) {
    const res = await fetch(`/api/wiki/teams?q=${encodeURIComponent(q)}&limit=200`);
    const { teams, total } = await res.json();
    $('wiki-skeleton').classList.add('hidden');
    $('wiki-team-count').textContent = `${total.toLocaleString()} teams`;
    renderTeams(teams);
  }

  function renderTeams(teams) {
    const list = $('wiki-team-list');
    list.innerHTML = '';
    teams.forEach(t => {
      const row = document.createElement('div');
      row.className = 'wiki-team-row' + (t.id === _activeTeamId ? ' active' : '');
      row.dataset.id = t.id;
      row.innerHTML = `<span style="flex:1;font-weight:600">${esc(t.fullName)}</span><span class="wiki-badge">${esc(t.event || '?')}</span>`;
      row.addEventListener('click', () => selectTeam(t.id));
      list.appendChild(row);
    });
  }

  // ── Select team ──────────────────────────────────────────────
  async function selectTeam(id) {
    _activeTeamId = id;
    _activeArgId = null;
    document.querySelectorAll('.wiki-team-row').forEach(r => r.classList.toggle('active', r.dataset.id === id));

    $('wiki-panel-args').classList.remove('hidden');
    $('wiki-panel-detail').classList.remove('visible');
    showArgLoading();

    await fetchAndRenderTeam(id);
    pollIfCrawling(id);
  }

  async function fetchAndRenderTeam(id) {
    try {
      const res = await fetch(`/api/wiki/teams/${encodeURIComponent(id)}`);
      const { team, arguments: args } = await res.json();

      $('wiki-team-title').textContent = team.fullName;
      $('wiki-team-meta').textContent = `${(team.event || '').toUpperCase()} · ${team.lastCrawled ? relTime(team.lastCrawled) : 'Not yet crawled'}`;

      if (team.crawlStatus === 'crawling') {
        showArgLoading();
        return;
      }
      if (team.crawlStatus === 'error') {
        showArgError();
        return;
      }
      renderArgs(args);
    } catch {
      showArgError();
    }
  }

  function renderArgs(args) {
    hideArgLoading();
    const list = $('wiki-arg-list');
    list.innerHTML = '';
    args.forEach((a, i) => {
      const row = document.createElement('div');
      row.className = 'wiki-arg-row';
      row.style.animationDelay = `${i * 30}ms`;
      row.dataset.id = a.id;
      row.innerHTML = `
        <span class="wiki-arg-name">${esc(a.name)}</span>
        <span class="wiki-side-${a.side}">${a.side.toUpperCase()}</span>
        <span class="wiki-read-count">${a.readCount}×</span>`;
      row.addEventListener('click', () => selectArg(a.id, a));
      list.appendChild(row);
    });
  }

  // ── Polling while crawling ───────────────────────────────────
  function pollIfCrawling(id) {
    clearInterval(_pollTimer);
    _pollTimer = setInterval(async () => {
      const res = await fetch(`/api/wiki/teams/${encodeURIComponent(id)}`);
      const { team, arguments: args } = await res.json();
      if (team.crawlStatus !== 'crawling') {
        clearInterval(_pollTimer);
        rotateCrawlMsg(false);
        renderArgs(args);
      } else {
        rotateCrawlMsg(true);
      }
    }, 2000);
  }

  function showArgLoading() {
    $('wiki-arg-list').innerHTML = '';
    $('wiki-crawl-status').classList.remove('hidden');
    $('wiki-arg-error').classList.add('hidden');
    rotateCrawlMsg(true);
  }
  function hideArgLoading() {
    $('wiki-crawl-status').classList.add('hidden');
    rotateCrawlMsg(false);
  }
  function showArgError() {
    hideArgLoading();
    $('wiki-arg-error').classList.remove('hidden');
  }
  function rotateCrawlMsg(active) {
    clearInterval(_msgTimer);
    if (!active) return;
    $('wiki-crawl-msg').textContent = CRAWL_MSGS[0];
    _msgTimer = setInterval(() => {
      _msgIdx = (_msgIdx + 1) % CRAWL_MSGS.length;
      $('wiki-crawl-msg').textContent = CRAWL_MSGS[_msgIdx];
    }, 1600);
  }

  // ── Select argument ──────────────────────────────────────────
  function selectArg(id, arg) {
    _activeArgId = id;
    document.querySelectorAll('.wiki-arg-row').forEach(r => r.classList.toggle('active', r.dataset.id === id));

    const detail = $('wiki-panel-detail');
    detail.classList.add('visible');

    $('wiki-arg-title').innerHTML = `${esc(arg.name)} <span class="wiki-side-${arg.side}">${arg.side.toUpperCase()}</span> <span class="wiki-read-count">${arg.readCount}×</span>`;
    $('wiki-detail-body').textContent = arg.fullText;
  }

  // ── Actions ──────────────────────────────────────────────────
  async function refreshTeam(id) {
    await fetch(`/api/wiki/teams/${encodeURIComponent(id)}/refresh`);
    showArgLoading();
    await fetchAndRenderTeam(id);
    pollIfCrawling(id);
  }

  async function reindex() {
    await fetch('/api/wiki/reindex', { method: 'POST' });
    await loadTeams($('wiki-search').value);
  }

  function downloadAll() {
    if (!_activeTeamId) return;
    window.location = `/api/wiki/teams/${encodeURIComponent(_activeTeamId)}/export`;
  }

  function downloadArg() {
    if (!_activeArgId) return;
    window.location = `/api/wiki/arguments/${encodeURIComponent(_activeArgId)}/export`;
  }

  async function copyArg() {
    if (!_activeArgId) return;
    const res = await fetch(`/api/wiki/arguments/${encodeURIComponent(_activeArgId)}`);
    const { argument } = await res.json();
    await navigator.clipboard.writeText(argument.fullText);
    showToast('Copied!');
  }

  function askArg() {
    if (!_activeArgId) return;
    fetch(`/api/wiki/arguments/${encodeURIComponent(_activeArgId)}`)
      .then(r => r.json())
      .then(({ argument }) => {
        const team = $('wiki-team-title').textContent;
        const ref = `[Reference: ${argument.name} — ${team} (${argument.side.toUpperCase()})]\n${argument.fullText}`;
        // Inject into assistant: set pending context and open panel
        if (window.openAssistantWithContext) {
          window.openAssistantWithContext(ref);
        } else {
          // Fallback: open assistant panel, pre-fill input
          const btn = document.getElementById('assistant-btn');
          if (btn) btn.click();
          setTimeout(() => {
            const input = document.getElementById('assistant-input');
            if (input) input.value = ref;
          }, 300);
        }
      });
  }

  // ── Utils ────────────────────────────────────────────────────
  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function relTime(iso) {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  function showToast(msg) {
    // Reuse existing toast if available, else simple fallback
    if (window.toast) { window.toast(msg); return; }
    const el = document.createElement('div');
    el.textContent = msg;
    el.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#111;color:#fff;padding:7px 16px;border-radius:6px;font:13px var(--font-ui);z-index:9999;pointer-events:none';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1500);
  }

  // ── Hook into page navigation ────────────────────────────────
  // app-main.js calls go(page) — we listen for Teams activation
  document.addEventListener('DOMContentLoaded', () => {
    const observer = new MutationObserver(() => {
      const page = document.getElementById('page-teams');
      if (page && page.classList.contains('active') && !page.dataset.wikiInit) {
        page.dataset.wikiInit = '1';
        window.initWikiPage();
      }
    });
    observer.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['class'] });
  });
})();
```

- [ ] **Step 2: Expose `openAssistantWithContext` in app-main.js**

In `public/app-main.js`, find the assistant panel open function (around line 1820). Add a global hook so wiki.js can open the assistant with pre-loaded context:

```js
// After the existing open() function inside initAssistantPanel:
window.openAssistantWithContext = function(contextText) {
  open(); // existing open function
  setTimeout(() => {
    const input = document.getElementById('assistant-input');
    if (input) {
      input.value = contextText;
      input.dispatchEvent(new Event('input'));
    }
  }, 250);
};
```

- [ ] **Step 3: Test end-to-end**

1. Start server: `npm run dev`
2. Open app, click Teams nav item
3. Verify skeleton loads then team list appears
4. Search "Memorial" — Memorial EW should appear
5. Click Memorial EW — panel 2 shows with spinner then arguments
6. Click an argument — panel 3 slides in with full text
7. Click Copy — toast "Copied!" appears, clipboard has text
8. Click Ask ↗ — assistant panel opens

- [ ] **Step 4: Commit**

```bash
git add public/wiki.js public/app-main.js
git commit -m "feat(wiki): add wiki.js frontend with three-panel UI and all interactions"
```

---

## Task 9: End-to-end verification

- [ ] **Step 1: Verify Memorial EW last argument**

```bash
node -e "
require('dotenv').config();
const db = require('./server/services/wikiDb');
const args = db.getTeamArguments('memorial-ew');
console.log('total args:', args.length);
console.log('last arg:', JSON.stringify(args[args.length - 1], null, 2));
"
```
Expected: last argument object with name, side, readCount, fullText.

- [ ] **Step 2: Verify .docx export**

```bash
curl -o /tmp/memorial-ew.docx "http://localhost:3000/api/wiki/teams/memorial-ew/export"
ls -lh /tmp/memorial-ew.docx
```
Expected: file exists, size > 1KB.

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat(wiki): complete Teams wiki page — search, three-panel UI, crawl, export, Ask integration"
```
