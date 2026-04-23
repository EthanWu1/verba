# Semantic Search Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take the already-scaffolded semantic search infrastructure live on production — install sqlite-vec, embed 156K cards (filtered to highlighted + deduped), wire the existing library search box to a hybrid FTS → semantic re-rank flow, and prove <100ms perceived latency. Zero downtime during embed.

**Architecture:** Production verba Node server already has the code (commit `ad24c1c` forward). Missing pieces are runtime dependency install (`sqlite-vec` native binary), the one-time embed batch job (outputs live alongside app DB), client wiring to call the new endpoint. Hybrid strategy: run cheap FTS first, show those instantly, then replace with semantic results when available (fetched in parallel).

**Tech Stack:** Node 20, Express, better-sqlite3, sqlite-vec, OpenRouter embeddings API (`voyage/voyage-3-lite`, 768-dim), vanilla JS frontend.

**Server:** Hetzner box `ethan@5.78.181.236`. DB at `~/verba/server/data/library.db` (~8 GB). Deployed via pm2 process `verba`.

**Prior scaffolding (already in repo, not yet deployed):**
- `server/services/embedder.js` — batch embedding client.
- `server/services/semanticIndex.js` — sqlite-vec vec0 table + KNN.
- `scripts/embed-library.js` — batch job (filters `body_markdown LIKE '%==%'`, dedupes by SHA256 of highlighted text).
- `server/routes/library.js` — `/api/library/semantic-search?q=X&k=25` with LRU cache.
- `package.json` — `sqlite-vec ^0.1.5`.
- `scripts/README-embeddings.md` — runbook.

---

## File Map

### New files in this plan
| Path | Responsibility |
|------|----------------|
| `scripts/semantic-smoke.sh` | Curl-based smoke test for the live endpoint, run before rollout + as regression check. |

### Modified files in this plan
| Path | What changes |
|------|--------------|
| `server/services/semanticIndex.js` | Graceful fallback when `sqlite-vec` extension fails to load (return empty KNN instead of throwing), so a broken ext never 500s search. |
| `server/routes/library.js` | Already wired; add `diagnostics: true` branch to return cache stats + whether vec ext loaded (for observability). |
| `public/api.js` | Add `semanticSearch(q, k)` helper calling the existing route. |
| `public/app-main.js` | Modify library search input handler to (a) fire FTS as today, (b) fire semantic in parallel, (c) swap/merge results when semantic returns. Keep FTS as instant baseline; semantic is upgrade. |

---

## Pre-flight facts (copy these into context before each task)

- Server commit baseline: `9ef16f6` (or later) already has semantic-search code. Confirm with `git log --oneline -1`.
- Embedding model: `voyage/voyage-3-lite`. Output dim **must** be 768 to match `cards_vec` schema.
- Embed cost: free tier on OpenRouter covers ~200K rows/day; Verba should stay well under.
- Estimated embed time for 156K cards, with highlight-only filter (~60K qualifying) and dedupe (~30K unique): **~30 min** at batch 64.
- RAM footprint of loaded vec table: ~90 MB (30K × 768 × 4 bytes), fits in 2 GB VPS.
- Query latency target: **p95 < 100 ms** including embedding call.

---

## Phase 1 — Staging & Dependency Install

### Task 1: Snapshot the live DB before touching it

**Files:** none (server-side ops only)

- [ ] **Step 1: SSH and check free disk + DB size**

```bash
ssh ethan@5.78.181.236 'df -h /home; du -h ~/verba/server/data/library.db'
```
Expected: free space > 10 GB; `library.db` ~8 GB.

- [ ] **Step 2: Copy DB to timestamped backup**

```bash
ssh ethan@5.78.181.236 'mkdir -p ~/backups && cp ~/verba/server/data/library.db ~/backups/library-pre-vec-$(date +%Y%m%d-%H%M).db && ls -lah ~/backups/ | tail -3'
```
Expected: new backup file ~8 GB listed.

- [ ] **Step 3: Verify restore path exists**

Document the single command that restores the DB if anything goes wrong:
```
# Emergency restore:
pm2 stop verba
cp ~/backups/library-pre-vec-<TIMESTAMP>.db ~/verba/server/data/library.db
rm -f ~/verba/server/data/library.db-wal ~/verba/server/data/library.db-shm
pm2 start verba
```
No code change. Proceed when confident the command above would bring production back.

---

### Task 2: Install the `sqlite-vec` native binary on the server

**Files:**
- No source changes. `package.json` already has the dep.

- [ ] **Step 1: Pull latest code**

```bash
ssh ethan@5.78.181.236 'cd ~/verba && git pull'
```
Expected: `Already up to date.` OR a fast-forward to the newest commit.

- [ ] **Step 2: Install dependencies**

```bash
ssh ethan@5.78.181.236 'cd ~/verba && npm install 2>&1 | tail -20'
```
Expected: `sqlite-vec` appears in output. `added N packages` at the end. No `node-gyp` failures.

If the output shows a build error, STOP and investigate before restarting pm2.

- [ ] **Step 3: Verify the native .so/.dll is present**

```bash
ssh ethan@5.78.181.236 'ls -lah ~/verba/node_modules/sqlite-vec/ | head'
```
Expected: includes a `vec0.so` (or platform-appropriate shared library) under a `build/` or `lib/` subdir.

- [ ] **Step 4: Smoke load the extension in isolation (app still running)**

```bash
ssh ethan@5.78.181.236 'cd ~/verba && node -e "const D=require(\"better-sqlite3\");const V=require(\"sqlite-vec\");const db=new D(\":memory:\");V.load(db);console.log(db.prepare(\"select vec_version() as v\").get());"'
```
Expected prints: `{ v: '...' }` with a version string.

If this fails with `undefined symbol` or `cannot load`, the native binary is mismatched for the OS libc. STOP, do not proceed.

- [ ] **Step 5: Commit no code change, just note in a followup**

No commit. Move on.

---

### Task 3: Harden `semanticIndex.js` so a broken extension never 500s search

**Files:**
- Modify: `server/services/semanticIndex.js`

- [ ] **Step 1: Open file, find `_loadVecExt`**

Current code throws when load fails. We want to set a flag and let the query layer return empty.

- [ ] **Step 2: Replace the module's load + query layer with fail-safe version**

Replace the top of `server/services/semanticIndex.js` with:
```js
'use strict';

const path = require('path');
const { getDb } = require('./db');
const { DIM } = require('./embedder');

let _loaded = false;
let _loadFailed = false;
function _loadVecExt(db) {
  if (_loaded || _loadFailed) return !_loadFailed;
  try {
    const sqliteVec = require('sqlite-vec');
    sqliteVec.load(db);
    _loaded = true;
    return true;
  } catch (err) {
    _loadFailed = true;
    console.warn('[semanticIndex] sqlite-vec unavailable:', err.message);
    return false;
  }
}
```

Then rewrite `knn` to early-return on failure:
```js
function knn(queryEmbedding, k = 25) {
  const db = getDb();
  if (!_loadVecExt(db)) return [];
  const buf = Buffer.from(new Float32Array(queryEmbedding).buffer);
  try {
    return db.prepare(`
      SELECT card_id, distance
      FROM cards_vec
      WHERE embedding MATCH ?
      ORDER BY distance ASC
      LIMIT ?
    `).all(buf, k);
  } catch (err) {
    console.warn('[semanticIndex] knn failed:', err.message);
    return [];
  }
}
```

Keep `ensureSchema`, `upsertEmbedding`, and `alreadyEmbedded` as-is, but let `ensureSchema` bail silently if the extension isn't available:
```js
function ensureSchema() {
  const db = getDb();
  if (!_loadVecExt(db)) return false;
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS cards_vec USING vec0(
      card_id INTEGER PRIMARY KEY,
      embedding float[${DIM}]
    );
    CREATE TABLE IF NOT EXISTS cards_embed_meta (
      card_id   INTEGER PRIMARY KEY,
      textHash  TEXT NOT NULL,
      embedded  INTEGER NOT NULL DEFAULT 1,
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_cards_embed_hash ON cards_embed_meta(textHash);
  `);
  return true;
}
```

Add one exported helper for observability:
```js
function extensionStatus() {
  return { loaded: _loaded, loadFailed: _loadFailed };
}
module.exports = { ensureSchema, upsertEmbedding, knn, alreadyEmbedded, extensionStatus };
```

- [ ] **Step 3: Start the Node process locally once to validate the file parses**

```bash
node -e "require('./server/services/semanticIndex'); console.log('ok')"
```
Expected: prints `ok`. (It will also print `[semanticIndex] sqlite-vec unavailable: ...` on Windows where the native binary may not exist; that is fine — the file loading didn't throw.)

- [ ] **Step 4: Commit**

```bash
git add server/services/semanticIndex.js
git commit -m "feat(semantic): fail-safe vec extension load (empty knn when unavailable)"
```

---

### Task 4: Add an observability flag to `/api/library/semantic-search`

**Files:**
- Modify: `server/routes/library.js`

- [ ] **Step 1: Locate the route in `server/routes/library.js`**

Run: `grep -n "/semantic-search" server/routes/library.js`
Expected: one line number.

- [ ] **Step 2: Insert diagnostic branch**

Change the route handler to check for `?diag=1` and return a health payload instead of results:
```js
router.get('/semantic-search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  const diag = req.query.diag === '1';
  const k = Math.min(100, Number(req.query.k) || 25);

  if (diag) {
    const { extensionStatus } = require('../services/semanticIndex');
    return res.json({
      ok: true,
      extension: extensionStatus(),
      cacheSize: _qCache.size,
    });
  }

  if (q.length < 3) return res.json({ results: [] });

  try {
    const { embedOne } = require('../services/embedder');
    const { knn } = require('../services/semanticIndex');
    const { getDb } = require('../services/db');

    let vec = _cacheGet(q);
    if (!vec) {
      vec = await embedOne(q);
      if (vec) _cachePut(q, vec);
    }
    if (!vec) return res.json({ results: [] });

    const hits = knn(vec, k);
    if (!hits.length) return res.json({ results: [] });

    const db = getDb();
    const placeholders = hits.map(() => '?').join(',');
    const rows = db.prepare(`
      SELECT rowid, id, tag, cite, shortCite, body_plain
      FROM cards WHERE rowid IN (${placeholders})
    `).all(...hits.map(h => h.card_id));
    const byRowid = new Map(rows.map(r => [r.rowid, r]));
    const results = hits.map(h => {
      const r = byRowid.get(h.card_id);
      return r ? { ...r, score: 1 - h.distance } : null;
    }).filter(Boolean);
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 3: Commit**

```bash
git add server/routes/library.js
git commit -m "feat(semantic): ?diag=1 returns extension status + cache size"
```

---

### Task 5: Deploy Phase 1 (hardening) to production

**Files:** none

- [ ] **Step 1: Push**

```bash
git push
```
Expected: `main -> main`.

- [ ] **Step 2: Pull + restart pm2**

```bash
ssh ethan@5.78.181.236 'cd ~/verba && git pull && pm2 restart verba'
```
Expected: pm2 shows `online`, restart counter ticks up.

- [ ] **Step 3: Check the diagnostic endpoint**

```bash
ssh ethan@5.78.181.236 'curl -s "http://127.0.0.1:3000/api/library/semantic-search?diag=1"'
```
Expected:
```json
{"ok":true,"extension":{"loaded":true,"loadFailed":false},"cacheSize":0}
```

If `loaded: false, loadFailed: true`, STOP. The native binary isn't loading on this host. Run the emergency restore from Task 1 Step 3 only if the server is broken; otherwise just don't proceed — regular search continues working.

- [ ] **Step 4: Sanity-check live site still loads**

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://verba.top/app
```
Expected: `200`.

---

## Phase 2 — Embedding Job

### Task 6: Dry-run the embed script at limit=200

**Files:** none (script already exists on server after `git pull`)

- [ ] **Step 1: Run a tiny batch to validate the API key + dimension**

```bash
ssh ethan@5.78.181.236 'cd ~/verba && node scripts/embed-library.js --limit=200 2>&1 | tail -15'
```
Expected output includes:
```
[embed] N highlighted cards · M need embedding (force=false)
[embed] 200/200  rate=...  eta=0s
[embed] done in ...s
```

If it throws `OPENROUTER_API_KEY not set`, the `.env` isn't being read — inspect `.env` and re-run.

If it throws a 400 from OpenRouter citing `invalid dimension`, the model returned wrong dims. Check `EMBED_MODEL` and `EMBED_DIM` env vars match.

- [ ] **Step 2: Verify vec table got 200 rows**

```bash
ssh ethan@5.78.181.236 'sqlite3 ~/verba/server/data/library.db "SELECT COUNT(*) FROM cards_vec"'
```
Expected: `200` (may be slightly less if the dedupe collapsed near-identical highlights).

- [ ] **Step 3: Do a real semantic query end-to-end**

```bash
ssh ethan@5.78.181.236 'curl -s "http://127.0.0.1:3000/api/library/semantic-search?q=nuclear+war+impact&k=3" | head -c 400'
```
Expected: JSON with `results: [...]`, each with `score` close to 1, `tag`, `cite`, `body_plain`.

If `results: []`, the 200 seeded cards didn't match the query semantically — try a more common query like `economy`.

---

### Task 7: Full embed run (background, production-safe)

**Files:** none

- [ ] **Step 1: Kick off the full job under `nohup`**

```bash
ssh ethan@5.78.181.236 'cd ~/verba && nohup node scripts/embed-library.js > /tmp/embed.log 2>&1 & echo "embed pid=$!"'
```
Expected: prints a pid.

- [ ] **Step 2: Monitor progress every few minutes**

```bash
ssh ethan@5.78.181.236 'tail -5 /tmp/embed.log'
```
Expected: rate ~100–200 embeddings/s, ETA dropping. If rate drops to <10/s sustained, OpenRouter is rate-limiting — the script keeps retrying; no action needed.

During the run:
- Live app stays up (better-sqlite3 WAL-mode handles concurrent reads and single-writer).
- Queries to `/api/library/semantic-search` start returning progressively more results as embeddings land.

- [ ] **Step 3: Confirm completion**

When `tail -5 /tmp/embed.log` shows `[embed] done in ...s`:
```bash
ssh ethan@5.78.181.236 'sqlite3 ~/verba/server/data/library.db "SELECT COUNT(*) FROM cards_vec; SELECT COUNT(*) FROM cards_embed_meta"'
```
Expected: both counts roughly equal, in the 20K–40K range (depends on highlight coverage + dedupe).

- [ ] **Step 4: Re-check disk usage**

```bash
ssh ethan@5.78.181.236 'ls -lah ~/verba/server/data/library.db*; df -h /home'
```
Expected: library.db grew by ~100–200 MB. At least 10 GB still free.

- [ ] **Step 5: Verify latency**

```bash
ssh ethan@5.78.181.236 'for q in "nuclear" "economic growth" "moral framework" "extinction impact" "plan text"; do time curl -s -o /dev/null "http://127.0.0.1:3000/api/library/semantic-search?q=$(printf %s "$q" | sed s/\ /%20/g)&k=10"; done'
```
Expected: each `real` time under 150 ms (cold) / 20 ms (warm cache). If any exceeds 300 ms consistently, investigate before wiring UI.

---

## Phase 3 — UI Wiring (Hybrid Search)

### Task 8: Add a `semanticSearch` helper to the API client

**Files:**
- Modify: `public/api.js`

- [ ] **Step 1: Find the existing `librarySearch` method in `public/api.js`**

Run: `grep -n "librarySearch" public/api.js`
Expected: one definition around the `library` section of the `api` object literal.

- [ ] **Step 2: Add the semantic helper right after `librarySearch`**

```js
    librarySemantic: (q, k = 25) =>
      jsonFetch(`/api/library/semantic-search?q=${encodeURIComponent(q)}&k=${k}`),
```

Keep the trailing comma style consistent with neighboring entries.

- [ ] **Step 3: Commit**

```bash
git add public/api.js
git commit -m "feat(api): add librarySemantic helper"
```

---

### Task 9: Hybrid search in the library UI

**Files:**
- Modify: `public/app-main.js`

- [ ] **Step 1: Find the current library search input handler**

Run: `grep -n "librarySearch\|library-search\|libSearchTimer" public/app-main.js`
Expected: a debounced input handler that calls `VerbaAPI.librarySearch(q)` and renders `data.cards`.

- [ ] **Step 2: Wrap the handler with parallel FTS + semantic**

Replace the inside of the debounced handler with this pattern (adapt names to match existing locals — `q`, the rendering function, etc.):
```js
const q = (input.value || '').trim();
if (q.length < 3) { renderLibraryResults([]); return; }

// Fire both queries in parallel.
const ftsPromise = window.VerbaAPI.librarySearch(q).catch(() => ({ cards: [] }));
const semPromise = window.VerbaAPI.librarySemantic(q, 25).catch(() => ({ results: [] }));

// Show FTS instantly for perceived latency.
ftsPromise.then(r => { if (!_overridden) renderLibraryResults(r.cards || []); });

// When semantic comes back, merge + re-render.
Promise.all([ftsPromise, semPromise]).then(([fts, sem]) => {
  _overridden = true;
  const ftsCards = fts.cards || [];
  const semResults = sem.results || [];
  // Dedupe by id, semantic first, then FTS rows that weren't already included.
  const seen = new Set(semResults.map(r => r.id).filter(Boolean));
  const merged = [
    ...semResults,
    ...ftsCards.filter(c => !seen.has(c.id)),
  ];
  renderLibraryResults(merged);
});
```

Add `let _overridden = false;` at the start of the handler so the FTS paint doesn't override the semantic one if semantic is faster.

- [ ] **Step 3: Commit**

```bash
git add public/app-main.js
git commit -m "feat(library): hybrid FTS + semantic search with instant FTS paint"
```

---

### Task 10: Write `scripts/semantic-smoke.sh`

**Files:**
- Create: `scripts/semantic-smoke.sh`

- [ ] **Step 1: Create the file with this exact content**

```bash
#!/usr/bin/env bash
set -euo pipefail

HOST="${SEMANTIC_SMOKE_HOST:-http://127.0.0.1:3000}"

echo "== diag =="
curl -s -w "\nstatus=%{http_code}\n" "$HOST/api/library/semantic-search?diag=1"

echo
echo "== queries =="
for q in "nuclear war" "economic growth" "moral obligation" "deterrence"; do
  echo "--- $q ---"
  curl -s -w "time=%{time_total}s status=%{http_code}\n" \
    "$HOST/api/library/semantic-search?q=$(printf %s "$q" | sed 's/ /%20/g')&k=5" \
    | head -c 400
  echo
done
```

- [ ] **Step 2: Make executable, commit**

```bash
chmod +x scripts/semantic-smoke.sh
git add scripts/semantic-smoke.sh
git commit -m "chore(semantic): smoke script"
```

---

### Task 11: Deploy Phase 3 and measure

**Files:** none

- [ ] **Step 1: Push**

```bash
git push
```

- [ ] **Step 2: Deploy**

```bash
ssh ethan@5.78.181.236 'cd ~/verba && git pull && pm2 restart verba'
```

- [ ] **Step 3: Run the smoke script live**

```bash
ssh ethan@5.78.181.236 'bash ~/verba/scripts/semantic-smoke.sh'
```
Expected per-query `time=` under 0.15 s and `status=200`.

- [ ] **Step 4: Open the site, try 5 queries, confirm**

At `https://verba.top/app`, open Library, type queries like:
1. `nuclear war` — results should include cards citing deterrence even when "nuclear war" isn't the exact keyword.
2. `economic impact` — should surface economy / recession / growth cards.
3. `moral framework` — should include ethics / utilitarian cards.
4. `short-term timeframe` — should surface timeframe / speed cards.
5. A nonsense string like `qwerty zzz` — should return 0 or near-0 scores (sanity).

Watch browser DevTools Network tab — the `semantic-search` request should complete within ~100 ms once the query embedding is cached.

- [ ] **Step 5: Tag the rollout**

```bash
git tag semantic-rollout-v1
git push --tags
```

---

## Phase 4 — Rollback & Ops

### Task 12: Document the rollback

**Files:**
- Modify: `scripts/README-embeddings.md` (append section)

- [ ] **Step 1: Append to `scripts/README-embeddings.md`**

```markdown

## Rollback

If semantic search misbehaves (wrong results, 500s, server instability):

1. **Kill the UI hybrid path** (surgical): revert `public/app-main.js` hybrid block — FTS-only path returns immediately.
   ```bash
   git revert <semantic-rollout-v1 commit touching app-main.js>
   git push
   ssh ethan@5.78.181.236 'cd ~/verba && git pull && pm2 restart verba'
   ```

2. **Kill the endpoint** (more aggressive): in `server/routes/library.js`, short-circuit `/semantic-search` to always return `[]`. Still leaves the vec data on disk for later.

3. **Nuke the extension + data** (last resort):
   ```bash
   pm2 stop verba
   cp ~/backups/library-pre-vec-<TIMESTAMP>.db ~/verba/server/data/library.db
   rm -f ~/verba/server/data/library.db-wal ~/verba/server/data/library.db-shm
   pm2 start verba
   ```

The fail-safe `semanticIndex.js` load path means even a broken `sqlite-vec` install won't 500 regular queries — KNN just returns empty and hybrid collapses to FTS.
```

- [ ] **Step 2: Commit**

```bash
git add scripts/README-embeddings.md
git commit -m "docs(semantic): rollback runbook"
git push
```

---

## Self-Review Notes

1. **Spec coverage**
   - Deploy dependency: Task 2.
   - Run embed job: Tasks 6 + 7.
   - Wire UI with hybrid semantic re-rank on top of FTS: Tasks 8 + 9.
   - Verify <100 ms: Task 7 Step 5 + Task 11 Step 4.
   - Rollback strategy: Tasks 1 + 12, plus fail-safe in Task 3.
   - Production must not go down during embed: Task 7 is nohup, separate process, better-sqlite3 WAL-mode allows concurrent reads; Task 3 guarantees even a bad install fails closed.

2. **Placeholders**: none.

3. **Type consistency**: `extensionStatus()` defined in Task 3, used in Task 4 and rollback doc. Cache identifiers (`_qCache`, `_cacheGet`, `_cachePut`) already exist from prior scaffold — referenced but not re-defined here, which is correct.
