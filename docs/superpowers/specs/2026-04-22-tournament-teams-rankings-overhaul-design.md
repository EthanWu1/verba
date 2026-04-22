# Tournament / Teams / Rankings UI Overhaul — Design Spec

**Date:** 2026-04-22
**Status:** Draft for review
**Scope:** Major UX rebuild of three secondary pages (`page-tournament`, `page-teams`, `page-rankings`) plus shared polish layer (animations, modals).

---

## 1. Goals

1. Replace placeholder/buggy interfaces with focused, navigable views.
2. Curate the threat list so it surfaces only competitively relevant entries.
3. Remove redundancy (duplicate school names, season bids in wrong contexts, irrelevant columns).
4. Apply consistent subtle motion polish across the app.
5. Keep changes surgical — do not regress existing card-cutter or library flows.

## 2. Non-goals

- Auth changes, billing changes, card cutter changes.
- Full SVG bracket rendering (using simple CSS-grid bracket instead).
- Per-debater profile pages beyond what wiki entry pages already provide.
- Mobile redesign beyond preserving existing `@media (max-width:768px)` parity.

## 3. Cross-cutting decisions (from brainstorming)

| Decision | Choice |
|----------|--------|
| Threat ranking algorithm | Hybrid: 60% season bid weight + 40% best-3 recent placements |
| Bracket viz | Simple CSS-grid text bracket (Doubles → … → Finals columns) |
| Teams page event filter | Top tabs (LD / PF / CX) |
| Animation intensity | Subtle (150–200 ms transitions) |

## 4. Page-level designs

### 4.1 Tournaments page

**Grid view** (default landing):
- Searchable list. Top bar: season select + Upcoming/Past toggle (existing) + new debounced search input (300ms).
- Card grid stays. Sort by start date asc (upcoming) / desc (past).
- Click card → detail view.

**Detail view** rules:
- Tournament determined past vs upcoming once on open via `endDate < now()`.
- Event tabs (LD / PF / CX) unchanged.
- View-mode subtabs **conditional on time**:
  - **Upcoming:** show only `Threats` tab. No Results tab.
  - **Past:** show only `Results` tab (with sub-sections: Final Places, Bidders, Speaker Awards, Bracket). No Threats tab.
- "← Back" returns to grid (existing).

**Results sub-sections (past tournaments):**
1. **Final Places** — top 16 by `place` / `rank`. Cols: Place | Team | Bid badge.
2. **Bidders** — anyone with `earnedBid` non-null. Cols: Team | Bid badge (Full / Partial / etc.).
3. **Speaker Awards** — top 20 by `speakerRank`. Cols: # | Speaker | Points.
4. **Bracket** — CSS-grid columns (Doubles → Octas → Quarters → Semis → Finals) with winners highlighted. Built from `toc_ballots` filtered to `roundType='elim'`. Empty rounds collapse out.

**Threats sub-section (upcoming tournaments):**
- Curated list, max 30 rows.
- Hybrid score per entry:
  - `score = 0.6 * normalize(seasonBids) + 0.4 * normalize(bestPlacementScore)`
  - `normalize` = min-max within tournament field
  - `bestPlacementScore = sum(top-3 placements at TOC-level past tournaments this season, weighted by tournament bidLevel multiplier)`
- Cutoff: top min(30, ceil(field_size * 0.10)) by score.
- Cols: # | Team | Season Bids | Wiki link.
- No school column.

### 4.2 Teams page (Wiki teams)

**Layout:**
- Top: search input (debounced 300ms) + event tabs (LD / PF / CX, default LD).
- Body: collapsible team list grouped by school.

**Each row (collapsed):**
- Team identifier — full school name (e.g. "Plano West") + initials badge ("PW") + debater names (codes if no wiki names).
- Season bid count badge.
- Click → expands.

**Each row (expanded):**
- Debater names list (with grad year if known).
- Wiki content blocks: positions / args run, top neg files, AC list, links to wiki page.
- Closing animation: 200ms height transition.

**Deduplication:**
- Group entries by `(schoolName, schoolCode)` and event. Collapse multiple `wiki_teams` rows with same key.

**Search:** matches school name, debater code, debater real name, position keyword. Case-insensitive substring.

### 4.3 Rankings page

**Layout:**
- Full-viewport: left sidebar (260px wide) + main content fills rest.
- Sidebar: search input + event filter (LD / PF / CX) + season select + sort dropdown.
- Main: ranked table.

**Table cols:**
- Rank #
- Team — primary line: full school name; secondary line: school initials badge + debater names
- Rating (rounded int)
- W-L
- Trend sparkline (last 5 ratings if data; else dash)

**Visual treatment:**
- Top 3 rows: gold/silver/bronze accent stripe on left edge.
- Top 10: subtle highlight tint.
- Hover: row lift + soft shadow.

**Search:** filters table by school / debater. Live, no submit.

**Accuracy:**
- Use existing `recomputeRatings(season)` from `rankingsEngine.js`.
- Run automatically on first page load if no rows in `toc_ratings` for current season.
- Show "Last computed: <timestamp>" in sidebar.

### 4.4 Global polish

**Animations (200ms ease-out unless noted):**
- Page transitions: 150ms cross-fade between `.page` elements.
- Modal: scale-in 95% → 100% + fade.
- Tab switch: underline slide.
- Row expand (teams): height auto-transition.
- Card hover (tournaments grid): translateY(-2px) + shadow.

**No flashier transitions** — keep distraction-free per user pref.

## 5. Data + API additions

### 5.1 New endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/toc/tournaments?search=q` | Server-side search (existing endpoint, add `?search` filter) |
| GET | `/api/toc/tournaments/:id/bracket/:event` | Returns elim rounds grouped: `{ rounds: [{ name: "Octas", matches: [...] }] }` |
| GET | `/api/toc/tournaments/:id/threats/:event` | Modify existing — apply hybrid scoring + 30-cap |
| GET | `/api/wiki/teams?event=LD&q=text` | Search + filter teams |
| GET | `/api/wiki/teams/:id` | Detail (positions, debaters, args) |
| GET | `/api/rankings?event=LD&season=2025-2026&q=text&sort=rating` | Sortable ranking list |

### 5.2 Schema additions

None. Existing tables sufficient:
- `toc_tournaments`, `toc_entries`, `toc_results`, `toc_ballots`, `toc_ratings`, `wiki_teams`, `wiki_team_positions` (assumed; verify in tocDb / wikiDb).

### 5.3 Threat scoring service

New file `server/services/threatScorer.js`:
```js
function scoreEntries(entries, season) {
  // entries: [{ entryId, teamKey, seasonBids, recentPlacements: [{place, bidLevel, ...}] }]
  // returns sorted [{ ...entry, score }]
}
```
Pulls `recentPlacements` from `toc_results` joined to `toc_tournaments` filtered by season.

## 6. File structure

| File | Action | Notes |
|------|--------|-------|
| `public/toc.js` | Heavy edit | Conditional view tabs (upcoming → threats only; past → results only); bracket renderer; search input |
| `public/wiki.js` | Heavy edit | Event tabs, collapsible rows, search, dedupe, args block |
| `public/rankings.js` | Heavy edit | Sidebar layout, top-3 accents, sortable, search |
| `public/app.html` | CSS additions + DOM tweaks | New CSS classes for animations, sidebar, bracket, top-3 accents |
| `server/routes/toc.js` | Add bracket endpoint, modify threats | |
| `server/routes/wiki.js` | Add search + detail endpoints | |
| `server/routes/rankings.js` | Add sortable + search endpoints | |
| `server/services/threatScorer.js` | New | Hybrid scoring function |
| `server/services/tocDb.js` | Add `listBracket(tournId, event)` + threats v2 | |
| `server/services/wikiDb.js` | Add search + detail queries | |
| `server/services/rankingsDb.js` | Add filtered/sorted query | |

## 7. Testing approach

- **Manual smoke per page** after each phase ships:
  1. Tournaments: open past + upcoming tournaments, verify correct subtabs, verify bracket renders, verify threat list ≤ 30.
  2. Teams: search filters live, expand/collapse smooth, no duplicate schools, args visible.
  3. Rankings: search live, sort changes order, top-3 accents visible, full-screen layout.
- **Backend smoke:** curl new endpoints, verify JSON shape and counts.
- **Regression:** card cutter (URL → argument → cut), library, sign-in still work.

## 8. Phasing (4 PRs)

| Phase | Scope |
|-------|-------|
| **A** | Backend: threatScorer service, modified threats endpoint, bracket endpoint, search endpoints (wiki/rankings/toc), rankings query updates. |
| **B** | Tournaments rebuild: conditional subtabs, bracket UI, search, polish. |
| **C** | Teams rebuild: collapsible rows, event tabs, dedupe, args block, search. |
| **D** | Rankings rebuild: full-screen sidebar layout, top-3 accents, sort, search; global animation pass. |

Each phase = one git commit, deployable independently.

## 9. Risks

- Bracket data may be incomplete in `toc_ballots` for many tournaments → fall back to "Bracket not available" notice.
- Threat scoring may produce empty list early in season → fall back to bid-only sort with cap 30.
- Recompute Elo on demand may take >5 sec for big seasons → run only when missing, cache result.
- Wiki content fields may not exist on `wiki_teams` schema → must verify before promising args block. If missing, scope is reduced to debater list + link out.

## 10. Open questions (resolved at impl time, not blocking spec approval)

- Does `wiki_teams` store positions / args inline, or only links to external wiki pages? → check `wikiDb.js` schema before Phase C.
- Are bracket round names stored consistently? → audit `toc_ballots.roundName` distinct values during Phase A.
