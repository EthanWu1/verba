# Tournament / Teams / Rankings Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Tournament, Teams, and Rankings pages with curated data, conditional view modes, full-screen rankings layout, and subtle motion polish — without touching card cutter, library, or auth flows.

**Architecture:** Frontend = vanilla JS modules (`public/toc.js`, `public/wiki.js`, `public/rankings.js`) talking to Express routes (`server/routes/*.js`). Data persisted in shared SQLite DB (`server/data/library.db`). New `server/services/threatScorer.js` computes hybrid bid+placement score. CSS additions live in `public/app.html` style block.

**Tech Stack:** Node 20 + Express, better-sqlite3, vanilla JS frontend (no framework), CSS in `app.html`.

**Spec reference:** `docs/superpowers/specs/2026-04-22-tournament-teams-rankings-overhaul-design.md`

---

## File Map

### New files
| Path | Responsibility |
|------|----------------|
| `server/services/threatScorer.js` | Hybrid bid+placement scoring; cap at 30 |
| `server/services/__tests__/threatScorer.test.js` | Unit tests |

### Modified files
| Path | What changes |
|------|--------------|
| `server/services/tocDb.js` | Add `listEnrichedThreats(tournId, event, season)`, `listElimRounds(tournId, event)` |
| `server/routes/toc.js` | Modify `/threats/:event` to use scorer; add `/tournaments/:id/bracket/:event`; add `?search` to `/tournaments` |
| `server/services/wikiDb.js` | Add `listTeamsByEvent({event, q, limit})` with dedupe by school+code |
| `server/routes/wiki.js` | Modify `/teams` to accept `event` + `q`; add `/teams/:id/full` returning team + debaters + args |
| `server/services/rankingsDb.js` | Add `sort` param to `leaderboard()` |
| `server/routes/rankings.js` | Pass through `sort`; ensure `q` works |
| `public/toc.js` | Conditional view tabs, bracket renderer, search input, no school col on threats |
| `public/wiki.js` | Event tabs, collapsible rows, dedupe, args block, search |
| `public/rankings.js` | Sidebar layout, sort dropdown, top-3 accents, search |
| `public/app.html` | CSS for: bracket grid, sidebar layout, top-3 accents, animations, collapsible rows |

---

## Phase A — Backend (1 commit)

### Task A1: Threat scorer service

**Files:**
- Create: `server/services/threatScorer.js`
- Test: `server/services/__tests__/threatScorer.test.js`

- [ ] **Step 1: Write the failing test**

Create `server/services/__tests__/threatScorer.test.js`:
```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { scoreEntries } = require('../threatScorer');

test('scoreEntries returns sorted desc by hybrid score, capped at 30', () => {
  const entries = Array.from({ length: 50 }, (_, i) => ({
    entryId: i + 1,
    teamKey: 'T' + i,
    seasonBids: 50 - i,
    recentPlacements: [{ place: i + 1, bidLevel: 'Octas' }],
  }));
  const out = scoreEntries(entries, '2025-2026');
  assert.equal(out.length, 30);
  assert.ok(out[0].score >= out[1].score);
  assert.equal(out[0].entryId, 1);
});

test('scoreEntries handles empty placements gracefully', () => {
  const entries = [
    { entryId: 1, teamKey: 'A', seasonBids: 5, recentPlacements: [] },
    { entryId: 2, teamKey: 'B', seasonBids: 2, recentPlacements: [] },
  ];
  const out = scoreEntries(entries, '2025-2026');
  assert.equal(out[0].entryId, 1);
  assert.equal(out[1].entryId, 2);
});

test('scoreEntries returns empty array for empty input', () => {
  assert.deepEqual(scoreEntries([], '2025-2026'), []);
});

test('scoreEntries respects optional cap parameter', () => {
  const entries = Array.from({ length: 50 }, (_, i) => ({
    entryId: i + 1, teamKey: 'T' + i, seasonBids: 50 - i, recentPlacements: [],
  }));
  assert.equal(scoreEntries(entries, '2025-2026', 10).length, 10);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/services/__tests__/threatScorer.test.js`
Expected: FAIL with `Cannot find module '../threatScorer'`

- [ ] **Step 3: Implement threatScorer**

Create `server/services/threatScorer.js`:
```js
'use strict';

const BID_LEVEL_WEIGHT = {
  Triples: 1.0, Doubles: 0.9, Octas: 0.75, Quarters: 0.6, Semis: 0.45, Finals: 0.3,
};

function placementScore(placements) {
  if (!Array.isArray(placements) || !placements.length) return 0;
  const top3 = [...placements]
    .sort((a, b) => (a.place || 99) - (b.place || 99))
    .slice(0, 3);
  let total = 0;
  for (const p of top3) {
    const lvlMult = BID_LEVEL_WEIGHT[p.bidLevel] || 0.2;
    const placeBonus = Math.max(0, 17 - (p.place || 16));
    total += placeBonus * lvlMult;
  }
  return total;
}

function normalizeMinMax(values) {
  if (!values.length) return () => 0;
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return () => 1;
  return v => (v - min) / (max - min);
}

function scoreEntries(entries, _season, cap = 30) {
  if (!entries || !entries.length) return [];
  const bids = entries.map(e => e.seasonBids || 0);
  const placements = entries.map(e => placementScore(e.recentPlacements));
  const normBids = normalizeMinMax(bids);
  const normPlace = normalizeMinMax(placements);
  return entries
    .map((e, i) => ({
      ...e,
      _placementScore: placements[i],
      score: 0.6 * normBids(bids[i]) + 0.4 * normPlace(placements[i]),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, cap);
}

module.exports = { scoreEntries, placementScore };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/services/__tests__/threatScorer.test.js`
Expected: PASS — 4 ok

- [ ] **Step 5: Commit**

```bash
git add server/services/threatScorer.js server/services/__tests__/threatScorer.test.js
git commit -m "feat(threats): add hybrid bid+placement scorer"
```

---

### Task A2: tocDb enrichments

**Files:**
- Modify: `server/services/tocDb.js`

- [ ] **Step 1: Locate existing `listThreats` function**

Run: `grep -n "function listThreats" server/services/tocDb.js`
Expected: prints line number (around 200).

- [ ] **Step 2: Add `listEnrichedThreats` after `listThreats`**

Open `server/services/tocDb.js`. After the `listThreats` function (before `module.exports`), append:
```js
function listEnrichedThreats(tournId, eventAbbr, season) {
  const threats = listThreats(Number(tournId), eventAbbr, season);
  const placements = getDb().prepare(`
    SELECT r.entryId, r.place, te.bidLevel, e.teamKey
    FROM toc_results r
    JOIN toc_entries e ON e.tournId = r.tournId AND e.entryId = r.entryId AND e.eventAbbr = r.eventAbbr
    JOIN toc_tournaments t ON t.tourn_id = r.tournId
    JOIN toc_tournament_events te ON te.tournId = r.tournId AND te.abbr = r.eventAbbr
    WHERE t.season = ? AND r.eventAbbr = ? AND e.teamKey IN (${threats.map(() => '?').join(',') || "''"})
      AND r.place IS NOT NULL
  `).all(season, eventAbbr, ...threats.map(t => t.teamKey));

  const byTeam = new Map();
  for (const p of placements) {
    if (!byTeam.has(p.teamKey)) byTeam.set(p.teamKey, []);
    byTeam.get(p.teamKey).push({ place: p.place, bidLevel: p.bidLevel });
  }
  return threats.map(t => ({
    ...t,
    recentPlacements: byTeam.get(t.teamKey) || [],
  }));
}

function listElimRounds(tournId, eventAbbr) {
  return getDb().prepare(`
    SELECT b.roundName, b.roundType, b.entryId, b.opponentEntryId, b.result, b.side,
           e.displayName, e.schoolName, e.schoolCode
    FROM toc_ballots b
    LEFT JOIN toc_entries e ON e.tournId = b.tournId AND e.entryId = b.entryId AND e.eventAbbr = b.eventAbbr
    WHERE b.tournId = ? AND b.eventAbbr = ? AND b.roundType = 'elim'
    ORDER BY b.roundName, b.entryId
  `).all(Number(tournId), eventAbbr);
}
```

- [ ] **Step 3: Export new functions**

Find `module.exports = {` near bottom of `server/services/tocDb.js`. Add `listEnrichedThreats` and `listElimRounds` to the exported object.

- [ ] **Step 4: Smoke test the queries**

Run on dev or server:
```bash
node -e "const d=require('./server/services/tocDb'); const t=d.listTournaments({season:'2025-2026',when:'past'})[0]; if(t){console.log('elim rows:', d.listElimRounds(t.tourn_id,'LD').length);}"
```
Expected: prints a number (may be 0 if no ballot data — that's the spec-noted risk).

- [ ] **Step 5: Commit**

```bash
git add server/services/tocDb.js
git commit -m "feat(toc): add listEnrichedThreats and listElimRounds queries"
```

---

### Task A3: TOC routes — bracket + scored threats + search

**Files:**
- Modify: `server/routes/toc.js`

- [ ] **Step 1: Replace existing `/threats/:event` handler**

In `server/routes/toc.js`, locate:
```js
router.get('/tournaments/:id/threats/:event', (req, res) => {
```

Replace the whole route handler with:
```js
router.get('/tournaments/:id/threats/:event', (req, res) => {
  const ev = _validateEvent(req, res); if (!ev) return;
  const id = Number(req.params.id);
  const t = db.getTournament(id);
  if (!t) return res.status(404).json({ error: 'not_found' });
  const enriched = db.listEnrichedThreats(id, ev, t.season);
  const { scoreEntries } = require('../services/threatScorer');
  const ranked = scoreEntries(enriched, t.season, 30);
  return res.json({ threats: ranked, season: t.season });
});
```

- [ ] **Step 2: Add bracket endpoint**

Append before `module.exports`:
```js
router.get('/tournaments/:id/bracket/:event', (req, res) => {
  const ev = _validateEvent(req, res); if (!ev) return;
  const id = Number(req.params.id);
  const rows = db.listElimRounds(id, ev);
  const byRound = new Map();
  for (const r of rows) {
    if (!byRound.has(r.roundName)) byRound.set(r.roundName, []);
    byRound.get(r.roundName).push(r);
  }
  const ROUND_ORDER = ['Triples', 'Doubles', 'Octas', 'Quarters', 'Semis', 'Finals'];
  const rounds = ROUND_ORDER
    .filter(name => byRound.has(name))
    .map(name => ({ name, ballots: byRound.get(name) }));
  return res.json({ rounds });
});
```

- [ ] **Step 3: Add search to `/tournaments`**

Locate `router.get('/tournaments', ...)`. Replace with:
```js
router.get('/tournaments', (req, res) => {
  const season = String(req.query.season || '');
  const when   = String(req.query.when || 'upcoming');
  const search = String(req.query.search || '').trim().toLowerCase();
  let rows = db.listTournaments({ season, when });
  if (search) {
    rows = rows.filter(t =>
      String(t.name || '').toLowerCase().includes(search) ||
      String(t.city || '').toLowerCase().includes(search) ||
      String(t.state || '').toLowerCase().includes(search)
    );
  }
  const out = rows.map(t => ({ ...t, events: db.listEvents(t.tourn_id) }));
  return res.json({ tournaments: out });
});
```

- [ ] **Step 4: Smoke test endpoints**

Run on server (after deploy) or via local node:
```bash
curl -s "http://localhost:3000/api/toc/tournaments?season=2025-2026&when=past&search=Bronx" | head -200
curl -s "http://localhost:3000/api/toc/tournaments/<ID>/bracket/LD"
```
Expected: JSON response, `bracket` shape `{rounds:[...]}`.

- [ ] **Step 5: Commit**

```bash
git add server/routes/toc.js
git commit -m "feat(toc): scored threats, bracket endpoint, tournament search"
```

---

### Task A4: Wiki routes — event filter + full team detail

**Files:**
- Modify: `server/services/wikiDb.js`
- Modify: `server/routes/wiki.js`

- [ ] **Step 1: Add `listTeamsByEvent` to wikiDb**

In `server/services/wikiDb.js`, before `module.exports`, append:
```js
function listTeamsByEvent({ event, q, limit = 200 }) {
  const params = [];
  let where = '1=1';
  if (event) { where += ' AND event = ?'; params.push(event); }
  if (q) {
    const term = `%${q.toLowerCase()}%`;
    where += ' AND (LOWER(school) LIKE ? OR LOWER(code) LIKE ? OR LOWER(fullName) LIKE ?)';
    params.push(term, term, term);
  }
  const sql = `
    SELECT id, school, code, fullName, event, pageUrl, lastCrawled
    FROM wiki_teams
    WHERE ${where}
    ORDER BY school COLLATE NOCASE, code COLLATE NOCASE
    LIMIT ?
  `;
  params.push(Number(limit));
  return getDb().prepare(sql).all(...params);
}
```

Add `listTeamsByEvent` to `module.exports`.

- [ ] **Step 2: Modify `/teams` route**

In `server/routes/wiki.js`, replace:
```js
router.get('/teams', (req, res) => {
```
…and the body, with:
```js
router.get('/teams', (req, res) => {
  const event = String(req.query.event || '').toUpperCase();
  const q = String(req.query.q || '').trim();
  const limit = Math.min(500, Number(req.query.limit) || 200);
  const validEvent = ['LD', 'PF', 'CX'].includes(event) ? event : '';
  const teams = wikiDb.listTeamsByEvent({ event: validEvent, q, limit });
  res.json({ teams });
});
```

- [ ] **Step 3: Add `/teams/:id/full` route**

After existing `/teams/:id` route, add:
```js
router.get('/teams/:id/full', (req, res) => {
  const id = Number(req.params.id);
  const team = wikiDb.getTeam(id);
  if (!team) return res.status(404).json({ error: 'not_found' });
  const args = wikiDb.getTeamArguments(id);
  res.json({ team, arguments: args });
});
```

- [ ] **Step 4: Smoke test**

```bash
curl -s "http://localhost:3000/api/wiki/teams?event=LD&q=plano&limit=10"
```
Expected: JSON with `teams: [...]`, each row has `school`, `code`, `event`.

- [ ] **Step 5: Commit**

```bash
git add server/services/wikiDb.js server/routes/wiki.js
git commit -m "feat(wiki): event-filtered team listing and full team detail endpoint"
```

---

### Task A5: Rankings sort + verify search

**Files:**
- Modify: `server/services/rankingsDb.js`
- Modify: `server/routes/rankings.js`

- [ ] **Step 1: Inspect existing `leaderboard` signature**

Run: `grep -n "function leaderboard" server/services/rankingsDb.js`
Expected: shows function with `{ season, event, page = 1, q = '' }` signature.

- [ ] **Step 2: Add `sort` param to `leaderboard`**

Edit `server/services/rankingsDb.js`. Modify the `leaderboard` function signature and ORDER BY clause:
```js
function leaderboard({ season, event, page = 1, q = '', sort = 'rating' }) {
  const offset = Math.max(0, (Number(page) - 1) * 50);
  let where = 'season = ? AND eventAbbr = ?';
  const params = [season, event];
  if (q) {
    const term = `%${String(q).toLowerCase()}%`;
    where += ' AND (LOWER(displayName) LIKE ? OR LOWER(schoolName) LIKE ? OR LOWER(schoolCode) LIKE ?)';
    params.push(term, term, term);
  }
  const orderClauses = {
    rating: 'rating DESC',
    wins: 'wins DESC, rating DESC',
    peak: 'peakRating DESC, rating DESC',
    rounds: 'roundCount DESC, rating DESC',
  };
  const orderBy = orderClauses[sort] || orderClauses.rating;
  const sql = `
    SELECT teamKey, displayName, schoolName, schoolCode, rating, wins, losses, roundCount, peakRating
    FROM toc_ratings
    WHERE ${where}
    ORDER BY ${orderBy}
    LIMIT 50 OFFSET ?
  `;
  params.push(offset);
  return getDb().prepare(sql).all(...params);
}
```

(Replace the existing function entirely. Preserve column list if existing differs — adapt to whatever columns the existing query SELECTed.)

- [ ] **Step 3: Pass `sort` through route**

In `server/routes/rankings.js`, modify `router.get('/', ...)`:
```js
router.get('/', (req, res) => {
  const season = String(req.query.season || '');
  const event  = String(req.query.event || 'LD').toUpperCase();
  const page   = Number(req.query.page) || 1;
  const q      = String(req.query.q || '');
  const sort   = String(req.query.sort || 'rating');
  const rows = rankingsDb.leaderboard({ season, event, page, q, sort });
  res.json({ rows, season, event, page, sort });
});
```

(Use the local `rankingsDb` import name as defined at top of the existing file.)

- [ ] **Step 4: Smoke test**

```bash
curl -s "http://localhost:3000/api/rankings?season=2025-2026&event=LD&sort=peak&q=plano" | head
```
Expected: JSON `{rows: [...], sort: "peak"}`.

- [ ] **Step 5: Commit**

```bash
git add server/services/rankingsDb.js server/routes/rankings.js
git commit -m "feat(rankings): support sort and verify search query path"
```

---

### Task A6: Push Phase A + deploy

- [ ] **Step 1: Push commits**

```bash
git push
```

- [ ] **Step 2: SSH deploy + smoke**

```bash
ssh ethan@5.78.181.236
cd ~/verba && git pull && pm2 restart verba
pm2 logs verba --lines 20 --nostream
```
Expected: app online, no startup errors.

- [ ] **Step 3: Smoke check live**

```bash
curl -s https://verba.top/api/toc/tournaments?season=2025-2026 | head -c 500
curl -s "https://verba.top/api/wiki/teams?event=LD&limit=5" | head -c 500
curl -s "https://verba.top/api/rankings?season=2025-2026&event=LD&sort=rating" | head -c 500
```
Expected: each returns valid JSON.

---

## Phase B — Tournaments rebuild (1 commit)

### Task B1: Tournament search input

**Files:**
- Modify: `public/app.html` (DOM around line 2391, search input)
- Modify: `public/toc.js` (state + listener)

- [ ] **Step 1: Add search input to topbar**

In `public/app.html`, locate `<div class="toc-topbar-left">`. Add a search input after the season select:
```html
<div class="toc-topbar-left">
  <label class="toc-muted" for="toc-season">Season</label>
  <select id="toc-season" class="toc-select"></select>
  <input id="toc-search" class="toc-search-input" type="search" placeholder="Search tournaments…" aria-label="Search tournaments">
</div>
```

Add CSS in the existing tournaments style block (near `.toc-select`):
```css
.toc-search-input {
  background: var(--panel); border: 1px solid var(--line); color: var(--ink);
  padding: 6px 10px; border-radius: 6px; font: 13px var(--font-ui);
  min-width: 200px; transition: border-color .15s, box-shadow .15s;
}
.toc-search-input:focus { outline: none; border-color: var(--lilac-3, #a78bfa); box-shadow: 0 0 0 3px rgba(167,139,250,.15); }
```

- [ ] **Step 2: Wire debounced search in toc.js**

In `public/toc.js`, in `bindStatic()`, add:
```js
let _searchTimer = null;
const searchEl = $('toc-search');
if (searchEl) {
  searchEl.addEventListener('input', () => {
    clearTimeout(_searchTimer);
    _searchTimer = setTimeout(() => loadGrid(), 300);
  });
}
```

In `loadGrid()`, modify the fetch URL to include `&search=`:
```js
const search = encodeURIComponent(($('toc-search')?.value || '').trim());
const res = await fetch(`/api/toc/tournaments?season=${encodeURIComponent(_season)}&when=${_when}&search=${search}`);
```

- [ ] **Step 3: Manual smoke**

After commit + deploy: load `/app` → Tournaments. Type in search input. Grid filters within 300ms.

- [ ] **Step 4: Commit**

```bash
git add public/app.html public/toc.js
git commit -m "feat(toc): debounced tournament search input"
```

---

### Task B2: Conditional view tabs (upcoming → threats only; past → results only)

**Files:**
- Modify: `public/toc.js`

- [ ] **Step 1: Replace `renderViewTabs` and `loadEventBody`**

In `public/toc.js`, find `renderViewTabs`. Replace it and `loadEventBody` with:
```js
function isPastTournament(t) {
  if (!t || !t.endDate) return false;
  return new Date(t.endDate) < new Date();
}

function renderViewTabs() {
  const past = isPastTournament(_currentTourn);
  if (past) {
    return `<div class="toc-view-tabs"><button class="toc-view-tab active" data-view="results">Results</button></div>`;
  }
  return `<div class="toc-view-tabs"><button class="toc-view-tab active" data-view="threats">Threats</button></div>`;
}

async function loadEventBody(t, abbr) {
  _currentEvent = abbr;
  const body = $('toc-detail-body');
  body.innerHTML = '<div class="toc-muted">Loading…</div>';
  const past = isPastTournament(t);
  _currentView = past ? 'results' : 'threats';
  if (_currentView === 'threats') {
    const res = await fetch(`/api/toc/tournaments/${t.tourn_id}/threats/${abbr}`);
    const { threats } = await res.json();
    body.innerHTML = renderViewTabs() + renderThreats(threats, abbr);
  } else {
    const [resultsRes, bracketRes] = await Promise.all([
      fetch(`/api/toc/tournaments/${t.tourn_id}/results/${abbr}`),
      fetch(`/api/toc/tournaments/${t.tourn_id}/bracket/${abbr}`),
    ]);
    const { results, speakers } = await resultsRes.json();
    const { rounds } = await bracketRes.json();
    body.innerHTML = renderViewTabs() + renderResults(results, speakers, abbr) + renderBracket(rounds);
  }
  attachEntryClicks(body);
}
```

- [ ] **Step 2: Add `renderBracket` helper**

In `public/toc.js`, after `renderResults`, add:
```js
function renderBracket(rounds) {
  if (!rounds || !rounds.length) return '';
  const cols = rounds.map(r => {
    const winners = (r.ballots || []).filter(b => b.result === 'W');
    const items = winners.map(w => `
      <div class="bracket-cell">
        <div class="bracket-name">${esc(w.displayName || '—')}</div>
        <div class="bracket-school">${esc(w.schoolCode || '')}</div>
      </div>
    `).join('');
    return `<div class="bracket-col">
      <div class="bracket-col-head">${esc(r.name)}</div>
      ${items || '<div class="toc-muted">—</div>'}
    </div>`;
  }).join('');
  return `<div class="toc-section-title">Bracket</div><div class="bracket-grid">${cols}</div>`;
}
```

- [ ] **Step 3: Add bracket CSS**

In `public/app.html` near `.toc-view-tabs` styles, add:
```css
.bracket-grid { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(140px, 1fr); gap: 12px; overflow-x: auto; padding: 4px 0 12px; }
.bracket-col { display: flex; flex-direction: column; gap: 6px; min-width: 140px; }
.bracket-col-head { font: 600 12px var(--font-display); color: var(--muted); text-transform: uppercase; letter-spacing: .5px; padding-bottom: 4px; border-bottom: 1px solid var(--line); }
.bracket-cell { background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 8px 10px; font: 500 12.5px var(--font-ui); transition: transform .15s, border-color .15s; }
.bracket-cell:hover { transform: translateX(2px); border-color: var(--lilac-3, #a78bfa); }
.bracket-name { color: var(--ink); }
.bracket-school { color: var(--muted); font-size: 11px; margin-top: 2px; }
```

- [ ] **Step 4: Manual smoke**

Open past tournament → see Results tab + Places + Bidders + Speakers + Bracket section. Open upcoming tournament → see only Threats tab. No tab toggling visible.

- [ ] **Step 5: Commit**

```bash
git add public/toc.js public/app.html
git commit -m "feat(toc): conditional view tabs (past=results+bracket, upcoming=threats)"
```

---

### Task B3: Push Phase B + deploy

- [ ] **Step 1: Push + deploy + smoke**

```bash
git push
ssh ethan@5.78.181.236 'cd ~/verba && git pull && pm2 restart verba'
```

Hard refresh browser. Verify:
- Search filters tournament grid live.
- Past tournament shows Results + Bracket sections only.
- Upcoming tournament shows Threats list only (max 30 rows).

---

## Phase C — Teams rebuild (1 commit)

### Task C1: Teams page DOM with event tabs + collapsible rows

**Files:**
- Modify: `public/app.html` (page-teams DOM block)
- Modify: `public/wiki.js` (full rewrite)

- [ ] **Step 1: Locate `page-teams` section**

Run: `grep -n 'id="page-teams"' public/app.html`
Expected: shows section start line.

- [ ] **Step 2: Replace page-teams body**

In `public/app.html`, replace the inner content of `<section class="page" id="page-teams">` with:
```html
<section class="page" id="page-teams">
  <div class="wk-shell">
    <div class="wk-topbar">
      <input id="wk-search" class="wk-search-input" type="search" placeholder="Search schools or debaters…" aria-label="Search teams">
      <div class="wk-event-tabs">
        <button class="wk-event-tab active" data-event="LD">LD</button>
        <button class="wk-event-tab" data-event="PF">PF</button>
        <button class="wk-event-tab" data-event="CX">CX</button>
      </div>
      <div class="wk-count" id="wk-count"></div>
    </div>
    <div class="wk-list" id="wk-list">
      <div class="wk-empty">Loading teams…</div>
    </div>
  </div>
</section>
```

- [ ] **Step 3: Add Teams page CSS**

In `public/app.html`, near the rankings/tournaments style blocks, add (replace any existing wiki page styles):
```css
.wk-shell { display: flex; flex-direction: column; height: 100%; padding: 16px 20px; gap: 16px; box-sizing: border-box; }
.wk-topbar { display: flex; align-items: center; gap: 12px; }
.wk-search-input { flex: 1; max-width: 360px; background: var(--panel); border: 1px solid var(--line); color: var(--ink); padding: 8px 12px; border-radius: 6px; font: 13.5px var(--font-ui); transition: border-color .15s, box-shadow .15s; }
.wk-search-input:focus { outline: none; border-color: var(--lilac-3, #a78bfa); box-shadow: 0 0 0 3px rgba(167,139,250,.15); }
.wk-event-tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--line); }
.wk-event-tab { background: none; border: 0; padding: 8px 14px; font: 500 13px var(--font-display); color: var(--muted); cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px; transition: color .15s, border-color .15s; }
.wk-event-tab:hover { color: var(--ink-2); }
.wk-event-tab.active { color: var(--ink); border-bottom-color: var(--lilac-3, #a78bfa); }
.wk-count { margin-left: auto; color: var(--muted); font: 12px var(--font-mono); }
.wk-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; }
.wk-empty { padding: 24px; color: var(--muted); font-size: 13px; }
.wk-row { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; transition: border-color .15s, transform .15s; }
.wk-row:hover { border-color: var(--lilac-3, #a78bfa); }
.wk-row-head { display: flex; align-items: center; gap: 12px; padding: 10px 14px; cursor: pointer; }
.wk-school { font: 600 14px var(--font-display); color: var(--ink); flex: 1; }
.wk-initials { display: inline-flex; align-items: center; justify-content: center; min-width: 32px; height: 24px; padding: 0 6px; background: var(--lilac-soft, #ede9fe); color: #4c1d95; border-radius: 4px; font: 700 11px var(--font-mono); letter-spacing: .5px; }
.wk-debaters { color: var(--muted); font: 12.5px var(--font-ui); }
.wk-chev { width: 16px; height: 16px; transition: transform .2s; opacity: .5; }
.wk-row.open .wk-chev { transform: rotate(90deg); }
.wk-row-body { max-height: 0; overflow: hidden; transition: max-height .25s ease; }
.wk-row.open .wk-row-body { max-height: 800px; }
.wk-row-body-inner { padding: 0 14px 14px; border-top: 1px dashed var(--line); margin-top: 4px; }
.wk-arg { padding: 8px 0; border-bottom: 1px dashed var(--line); }
.wk-arg:last-child { border-bottom: 0; }
.wk-arg-name { font: 600 13px var(--font-display); color: var(--ink); }
.wk-arg-side { font-size: 11px; color: var(--muted); margin-left: 6px; text-transform: uppercase; }
.wk-arg-snippet { color: var(--muted-2, #888); font: 12.5px var(--font-ui); margin-top: 4px; line-height: 1.4; }
.wk-link-out { color: var(--lilac-3, #a78bfa); text-decoration: none; font-size: 12.5px; margin-top: 8px; display: inline-block; }
.wk-link-out:hover { text-decoration: underline; }
```

- [ ] **Step 4: Replace `public/wiki.js` body**

Replace entire contents of `public/wiki.js` with:
```js
'use strict';
(function () {
  let _event = 'LD';
  let _searchTimer = null;

  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  function initials(name) {
    return String(name || '').split(/\s+/).filter(Boolean).slice(0, 3).map(w => w[0].toUpperCase()).join('') || '—';
  }

  function dedupe(rows) {
    const map = new Map();
    for (const r of rows) {
      const key = `${r.school}|${r.code}|${r.event}`;
      if (!map.has(key)) map.set(key, { ...r, debaters: [] });
      const cur = map.get(key);
      if (r.fullName && !cur.debaters.includes(r.fullName)) cur.debaters.push(r.fullName);
    }
    return [...map.values()];
  }

  async function load() {
    const list = $('wk-list');
    const count = $('wk-count');
    const q = encodeURIComponent(($('wk-search')?.value || '').trim());
    list.innerHTML = '<div class="wk-empty">Loading…</div>';
    try {
      const res = await fetch(`/api/wiki/teams?event=${_event}&q=${q}&limit=300`);
      const { teams } = await res.json();
      const rows = dedupe(teams || []);
      count.textContent = `${rows.length} team${rows.length === 1 ? '' : 's'}`;
      if (!rows.length) {
        list.innerHTML = '<div class="wk-empty">No teams match.</div>';
        return;
      }
      list.innerHTML = rows.map(r => `
        <div class="wk-row" data-id="${r.id}">
          <div class="wk-row-head">
            <span class="wk-initials">${esc(initials(r.school))}</span>
            <span class="wk-school">${esc(r.school || '—')} <span class="wk-debaters">${esc(r.code || '')}${r.debaters.length ? ' · ' + esc(r.debaters.join(', ')) : ''}</span></span>
            <svg class="wk-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
          </div>
          <div class="wk-row-body"><div class="wk-row-body-inner" data-loaded="0">Loading…</div></div>
        </div>
      `).join('');
      list.querySelectorAll('.wk-row').forEach(row => {
        row.querySelector('.wk-row-head').addEventListener('click', () => toggle(row));
      });
    } catch (e) {
      list.innerHTML = `<div class="wk-empty">Failed to load: ${esc(e.message)}</div>`;
    }
  }

  async function toggle(row) {
    const open = row.classList.toggle('open');
    if (!open) return;
    const inner = row.querySelector('.wk-row-body-inner');
    if (inner.dataset.loaded === '1') return;
    const id = row.dataset.id;
    try {
      const res = await fetch(`/api/wiki/teams/${id}/full`);
      const { team, arguments: args } = await res.json();
      inner.dataset.loaded = '1';
      inner.innerHTML = renderArgs(team, args);
    } catch (e) {
      inner.innerHTML = `<div class="wk-empty">Failed: ${esc(e.message)}</div>`;
    }
  }

  function renderArgs(team, args) {
    const link = team.pageUrl ? `<a class="wk-link-out" href="${esc(team.pageUrl)}" target="_blank" rel="noopener">Open wiki page ↗</a>` : '';
    if (!args || !args.length) {
      return `<div class="wk-empty" style="padding:8px 0">No arguments indexed for this team yet.</div>${link}`;
    }
    const items = args.map(a => `
      <div class="wk-arg">
        <div><span class="wk-arg-name">${esc(a.name || 'Untitled')}</span>${a.side ? `<span class="wk-arg-side">${esc(a.side)}</span>` : ''}</div>
        ${a.fullText ? `<div class="wk-arg-snippet">${esc(String(a.fullText).slice(0, 240))}${a.fullText.length > 240 ? '…' : ''}</div>` : ''}
      </div>
    `).join('');
    return items + link;
  }

  function bind() {
    document.querySelectorAll('.wk-event-tab').forEach(b => {
      b.addEventListener('click', () => {
        document.querySelectorAll('.wk-event-tab').forEach(x => x.classList.toggle('active', x === b));
        _event = b.dataset.event;
        load();
      });
    });
    const s = $('wk-search');
    if (s) s.addEventListener('input', () => {
      clearTimeout(_searchTimer);
      _searchTimer = setTimeout(load, 300);
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    const page = document.getElementById('page-teams');
    if (!page) return;
    const observer = new MutationObserver(() => {
      if (page.classList.contains('active') && !page.dataset.wikiInit) {
        page.dataset.wikiInit = '1';
        bind();
        load();
      }
    });
    observer.observe(page, { attributes: true, attributeFilter: ['class'] });
  });
})();
```

- [ ] **Step 5: Manual smoke**

After deploy: open Teams page. Verify:
- Event tabs LD/PF/CX work.
- Search filters list within 300ms.
- Click row → expands, shows args (or "No arguments indexed").
- Click again → collapses smoothly.
- No duplicate school rows.

- [ ] **Step 6: Commit**

```bash
git add public/wiki.js public/app.html
git commit -m "feat(teams): event tabs, collapsible rows, search, dedupe, args block"
```

---

### Task C2: Push Phase C + deploy

```bash
git push
ssh ethan@5.78.181.236 'cd ~/verba && git pull && pm2 restart verba'
```

---

## Phase D — Rankings + global polish (1 commit)

### Task D1: Rankings DOM rebuild (sidebar + table)

**Files:**
- Modify: `public/app.html` (page-rankings block)
- Modify: `public/rankings.js` (full rewrite)

- [ ] **Step 1: Replace page-rankings DOM**

In `public/app.html`, replace the inner of `<section class="page" id="page-rankings">` with:
```html
<section class="page" id="page-rankings">
  <div class="rk-shell">
    <aside class="rk-sidebar">
      <input id="rk-search" class="rk-search-input" type="search" placeholder="Search team or school…" aria-label="Search rankings">
      <div class="rk-control">
        <label>Event</label>
        <div class="rk-event-tabs">
          <button class="rk-event-tab active" data-event="LD">LD</button>
          <button class="rk-event-tab" data-event="PF">PF</button>
          <button class="rk-event-tab" data-event="CX">CX</button>
        </div>
      </div>
      <div class="rk-control">
        <label for="rk-season">Season</label>
        <select id="rk-season" class="rk-select"></select>
      </div>
      <div class="rk-control">
        <label for="rk-sort">Sort by</label>
        <select id="rk-sort" class="rk-select">
          <option value="rating">Rating</option>
          <option value="wins">Wins</option>
          <option value="peak">Peak rating</option>
          <option value="rounds">Rounds played</option>
        </select>
      </div>
      <div class="rk-meta" id="rk-meta"></div>
    </aside>
    <main class="rk-main">
      <table class="rk-table">
        <thead>
          <tr>
            <th class="rk-col-rank">#</th>
            <th>Team</th>
            <th class="rk-col-num">Rating</th>
            <th class="rk-col-num">W-L</th>
            <th class="rk-col-num">Peak</th>
          </tr>
        </thead>
        <tbody id="rk-rows"></tbody>
      </table>
    </main>
  </div>
</section>
```

- [ ] **Step 2: Add rankings CSS**

In `public/app.html`, replace any existing `.rk-*` rules with:
```css
.rk-shell { display: flex; height: 100%; overflow: hidden; }
.rk-sidebar { width: 260px; flex: 0 0 260px; border-right: 1px solid var(--line); padding: 16px; box-sizing: border-box; display: flex; flex-direction: column; gap: 14px; background: var(--panel); }
.rk-search-input { background: var(--bg); border: 1px solid var(--line); color: var(--ink); padding: 8px 10px; border-radius: 6px; font: 13px var(--font-ui); transition: border-color .15s, box-shadow .15s; }
.rk-search-input:focus { outline: none; border-color: var(--lilac-3, #a78bfa); box-shadow: 0 0 0 3px rgba(167,139,250,.15); }
.rk-control { display: flex; flex-direction: column; gap: 6px; }
.rk-control label { font: 600 11px var(--font-display); color: var(--muted); text-transform: uppercase; letter-spacing: .5px; }
.rk-select { background: var(--bg); border: 1px solid var(--line); color: var(--ink); padding: 6px 8px; border-radius: 6px; font: 13px var(--font-ui); }
.rk-event-tabs { display: flex; gap: 2px; }
.rk-event-tab { flex: 1; background: var(--bg); border: 1px solid var(--line); color: var(--muted); padding: 6px 0; font: 600 12px var(--font-display); cursor: pointer; transition: background .15s, color .15s, border-color .15s; }
.rk-event-tab:first-child { border-radius: 6px 0 0 6px; }
.rk-event-tab:last-child { border-radius: 0 6px 6px 0; }
.rk-event-tab.active { background: var(--lilac-soft, #ede9fe); color: #4c1d95; border-color: var(--lilac-3, #a78bfa); }
.rk-meta { margin-top: auto; font: 11px var(--font-mono); color: var(--muted); }
.rk-main { flex: 1; overflow: auto; padding: 16px 20px; }
.rk-table { width: 100%; border-collapse: collapse; font: 13px var(--font-ui); }
.rk-table thead th { text-align: left; padding: 10px 12px; font: 600 11.5px var(--font-display); color: var(--muted); text-transform: uppercase; letter-spacing: .5px; border-bottom: 1px solid var(--line); position: sticky; top: 0; background: var(--bg); z-index: 1; }
.rk-table tbody tr { border-bottom: 1px solid var(--line); transition: background .15s, transform .15s; }
.rk-table tbody tr:hover { background: var(--panel); transform: translateX(2px); }
.rk-table td { padding: 12px; vertical-align: middle; }
.rk-col-rank { width: 56px; }
.rk-col-num { width: 84px; text-align: right; }
.rk-rank-badge { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 50%; font: 700 12px var(--font-mono); background: var(--panel); color: var(--ink); }
.rk-team-line { display: flex; align-items: center; gap: 10px; }
.rk-team-initials { display: inline-flex; align-items: center; justify-content: center; min-width: 36px; height: 28px; padding: 0 8px; background: var(--lilac-soft, #ede9fe); color: #4c1d95; border-radius: 5px; font: 700 11px var(--font-mono); letter-spacing: .5px; }
.rk-team-text { display: flex; flex-direction: column; line-height: 1.3; }
.rk-school-name { font: 600 13.5px var(--font-display); color: var(--ink); }
.rk-debaters { font: 12px var(--font-ui); color: var(--muted); }
.rk-rating { font: 700 13px var(--font-mono); color: var(--ink); }

.rk-row-1 { box-shadow: inset 4px 0 0 #d4af37; background: linear-gradient(90deg, rgba(212,175,55,.06), transparent 30%); }
.rk-row-2 { box-shadow: inset 4px 0 0 #c0c0c0; background: linear-gradient(90deg, rgba(192,192,192,.06), transparent 30%); }
.rk-row-3 { box-shadow: inset 4px 0 0 #cd7f32; background: linear-gradient(90deg, rgba(205,127,50,.06), transparent 30%); }
.rk-row-1 .rk-rank-badge { background: #d4af37; color: #fff; }
.rk-row-2 .rk-rank-badge { background: #c0c0c0; color: #fff; }
.rk-row-3 .rk-rank-badge { background: #cd7f32; color: #fff; }
.rk-row-top10 { background: rgba(167,139,250,.04); }
```

- [ ] **Step 3: Replace `public/rankings.js` body**

Replace entire contents of `public/rankings.js` with:
```js
'use strict';
(function () {
  let _event = 'LD', _season = '', _sort = 'rating';
  let _searchTimer = null;

  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  function initials(name) {
    return String(name || '').split(/\s+/).filter(Boolean).slice(0, 3).map(w => w[0].toUpperCase()).join('') || '—';
  }

  async function loadSeasons() {
    try {
      const res = await fetch('/api/rankings/seasons');
      const { seasons } = await res.json();
      const sel = $('rk-season');
      sel.innerHTML = (seasons || []).map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
      _season = seasons?.[0] || '';
      if (_season) sel.value = _season;
    } catch {
      _season = '';
    }
  }

  async function load() {
    const tbody = $('rk-rows');
    const meta = $('rk-meta');
    const q = encodeURIComponent(($('rk-search')?.value || '').trim());
    tbody.innerHTML = '<tr><td colspan="5" style="padding:24px;color:var(--muted)">Loading…</td></tr>';
    try {
      const res = await fetch(`/api/rankings?season=${encodeURIComponent(_season)}&event=${_event}&sort=${_sort}&q=${q}`);
      const { rows } = await res.json();
      meta.textContent = `${rows.length} ranked · season ${_season}`;
      if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="5" style="padding:24px;color:var(--muted)">No ratings yet for this event.</td></tr>';
        return;
      }
      tbody.innerHTML = rows.map((r, i) => {
        const rank = i + 1;
        const cls = rank <= 3 ? `rk-row-${rank}` : (rank <= 10 ? 'rk-row-top10' : '');
        return `<tr class="${cls}">
          <td><span class="rk-rank-badge">${rank}</span></td>
          <td>
            <div class="rk-team-line">
              <span class="rk-team-initials">${esc(initials(r.schoolName || r.schoolCode))}</span>
              <span class="rk-team-text">
                <span class="rk-school-name">${esc(r.schoolName || r.schoolCode || '—')}</span>
                <span class="rk-debaters">${esc(r.displayName || r.teamKey || '')}</span>
              </span>
            </div>
          </td>
          <td class="rk-col-num"><span class="rk-rating">${Math.round(r.rating)}</span></td>
          <td class="rk-col-num">${r.wins || 0}-${r.losses || 0}</td>
          <td class="rk-col-num">${Math.round(r.peakRating || r.rating)}</td>
        </tr>`;
      }).join('');
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="5" style="padding:24px;color:var(--muted)">Failed: ${esc(e.message)}</td></tr>`;
    }
  }

  function bind() {
    document.querySelectorAll('.rk-event-tab').forEach(b => b.addEventListener('click', () => {
      document.querySelectorAll('.rk-event-tab').forEach(x => x.classList.toggle('active', x === b));
      _event = b.dataset.event;
      load();
    }));
    $('rk-season')?.addEventListener('change', e => { _season = e.target.value; load(); });
    $('rk-sort')?.addEventListener('change', e => { _sort = e.target.value; load(); });
    $('rk-search')?.addEventListener('input', () => {
      clearTimeout(_searchTimer);
      _searchTimer = setTimeout(load, 300);
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    const page = document.getElementById('page-rankings');
    if (!page) return;
    const observer = new MutationObserver(async () => {
      if (page.classList.contains('active') && !page.dataset.rkInit) {
        page.dataset.rkInit = '1';
        await loadSeasons();
        bind();
        load();
      }
    });
    observer.observe(page, { attributes: true, attributeFilter: ['class'] });
  });
})();
```

- [ ] **Step 4: Manual smoke**

After deploy: open Rankings page. Verify:
- Sidebar on left with search, event tabs, season, sort.
- Table fills rest of screen.
- Top 3 rows have gold/silver/bronze accents.
- Top 4-10 have subtle highlight tint.
- Search filters live.
- Sort dropdown re-orders.

- [ ] **Step 5: Commit**

```bash
git add public/rankings.js public/app.html
git commit -m "feat(rankings): full-screen sidebar layout, top-3 accents, sortable, searchable"
```

---

### Task D2: Global animation pass

**Files:**
- Modify: `public/app.html` (top of style block, near `:root` definitions)

- [ ] **Step 1: Add transition tokens + page transition**

In `public/app.html`, add inside the existing `<style>` block (anywhere before `</style>` closes the main app stylesheet):
```css
:root { --tx-fast: 150ms; --tx-med: 200ms; --tx-slow: 300ms; --easing: cubic-bezier(.4,0,.2,1); }
.page { transition: opacity var(--tx-fast) var(--easing); }
.page:not(.active) { opacity: 0; pointer-events: none; }
.page.active { opacity: 1; }
.toc-modal-card { transform: scale(.96); opacity: 0; transition: transform var(--tx-med) var(--easing), opacity var(--tx-med) var(--easing); }
.toc-modal:not(.hidden) .toc-modal-card { transform: scale(1); opacity: 1; }
.toc-card { transition: transform var(--tx-fast) var(--easing), box-shadow var(--tx-fast) var(--easing), border-color var(--tx-fast) var(--easing); }
.toc-card:hover { transform: translateY(-2px); box-shadow: 0 6px 16px rgba(0,0,0,.06); }
.nav-item { transition: background-color var(--tx-fast) var(--easing), color var(--tx-fast) var(--easing); }
button { transition: background-color var(--tx-fast) var(--easing), border-color var(--tx-fast) var(--easing), color var(--tx-fast) var(--easing); }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0ms !important; transition-duration: 0ms !important; }
}
```

- [ ] **Step 2: Manual smoke**

After deploy: switch tabs (Cutter ↔ Tournaments). Should see brief fade. Hover tournament card → lifts. Open tournament modal → scales in. No jank.

- [ ] **Step 3: Commit**

```bash
git add public/app.html
git commit -m "feat(ui): subtle global animation pass with reduced-motion fallback"
```

---

### Task D3: Push Phase D + deploy + final verification

```bash
git push
ssh ethan@5.78.181.236 'cd ~/verba && git pull && pm2 restart verba'
```

Hard refresh and run the spec section 7 smoke pass:
- Tournaments: open past + upcoming, conditional tabs correct, threats ≤ 30, bracket renders.
- Teams: search live, expand/collapse smooth, no duplicate schools, args appear.
- Rankings: search live, sort changes order, top-3 accents visible, full-screen layout.
- Card cutter, library, sign-in still work (regression).

---

## Self-review notes

- **Spec coverage:** All four phases (A-D) map to spec section 8. Threat scoring, conditional tabs, bracket, dedupe, full-screen rankings, animations all have tasks.
- **Type consistency:** `scoreEntries(entries, season, cap)` signature consistent across A1 + A3. `listEnrichedThreats(tournId, eventAbbr, season)` consistent A2 + A3. `leaderboard({ season, event, page, q, sort })` consistent A5.
- **Risks acknowledged:** bracket empty fallback (returns empty section), threat scorer empty input (returns []), wiki args missing (renders "No arguments indexed").
