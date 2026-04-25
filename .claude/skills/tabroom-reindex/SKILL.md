---
name: tabroom-reindex
description: Re-crawl every TOC-circuit + locally-known tournament from tabroom and recompute season ratings once at the end. Use when ratings are stale, tournaments are missing, or after an indexer fix (e.g. V-prefix canonicalization). Skips per-tournament recompute to avoid WAL churn on the 2GB box.
disable-model-invocation: true
---

# Bulk re-index TOC tournaments + recompute ratings

Pulls the TOC circuit list, unions with every tournament already in `toc_tournaments`, re-crawls each via `indexer.indexTournament(id, { skipRecompute: true })`, then runs ONE `recomputeRatings` at the end. Ends with a WAL checkpoint to release disk.

## Pre-flight

```bash
df -h ~                               # Need >= 2GB free for WAL
ls -lh ~/verba/server/data/library.db*
sqlite3 ~/verba/server/data/library.db "SELECT eventAbbr, MAX(occurredAt), COUNT(*) FROM toc_rating_history WHERE season='2025-26' GROUP BY eventAbbr;"
```

If disk is < 2GB free, run cleanup first:
```bash
rm ~/backups/library-*.db 2>/dev/null   # only if you don't need them
sqlite3 ~/verba/server/data/library.db "PRAGMA wal_checkpoint(TRUNCATE);"
```

## Run

```bash
cd ~/verba && git pull && pm2 stop verba && \
node -e '
(async () => {
  const Database = require("better-sqlite3");
  const indexer  = require("./server/services/tocIndexer");
  const rankings = require("./server/services/rankingsEngine");
  const crawler  = require("./server/services/tocCrawler");
  const db = new Database("./server/data/library.db");

  let circuitIds = [];
  try { circuitIds = await crawler.fetchCircuitTournIds(await crawler.fetchTocCircuitId()); }
  catch (e) { console.error("Circuit fetch failed:", e.message); }

  const known = db.prepare("SELECT tourn_id FROM toc_tournaments").all().map(r => r.tourn_id);
  const all = [...new Set([...circuitIds, ...known])];
  console.log("Re-crawling", all.length);
  db.close();

  let ok = 0, skipped = 0, fail = 0;
  for (const id of all) {
    try {
      const r = await indexer.indexTournament(id, { skipRecompute: true });
      if (r) ok++; else skipped++;
      if ((ok + skipped) % 20 === 0) console.log("  progress", ok+skipped, "/", all.length);
    } catch (e) { fail++; console.error("  failed", id, "-", e.message); }
  }
  console.log("Done:", ok, "indexed,", skipped, "skipped,", fail, "failed");
  console.log("Final recompute ...");
  rankings.recomputeRatings("2025-26");
  console.log("Done.");
  const db2 = new Database("./server/data/library.db");
  db2.pragma("wal_checkpoint(TRUNCATE)");
  db2.close();
})();
' && pm2 start verba
```

## Re-index a single tournament

```bash
TID=35840   # e.g. Heart of Texas
cd ~/verba && pm2 stop verba && \
node -e "(async()=>{const i=require('./server/services/tocIndexer');const r=require('./server/services/rankingsEngine');console.log(await i.indexTournament($TID,{skipRecompute:true}));r.recomputeRatings('2025-26');console.log('ok');})()" && \
pm2 start verba
```

## Verify after run

```bash
sqlite3 ~/verba/server/data/library.db <<'SQL'
SELECT eventAbbr, MAX(occurredAt) AS most_recent, COUNT(*) AS history_rows
FROM toc_rating_history WHERE season='2025-26' GROUP BY eventAbbr;
SELECT COUNT(*) AS visible_tournaments
FROM toc_tournaments t WHERE t.season='2025-26'
  AND t.name NOT LIKE '%International Initiative TOC Test%'
  AND (
    EXISTS (SELECT 1 FROM toc_tournament_events te WHERE te.tournId=t.tourn_id AND te.bidLevel IS NOT NULL)
    OR (t.name LIKE '%Tournament of Champions%' AND t.name NOT LIKE '%Middle School%')
  );
SQL
df -h ~
```

All three events should show today's date as `most_recent`. Visible count should be ~104–105.

## Common failures

- **`disk full`** → checkpoint the WAL (above), delete `~/backups/*.db`, retry.
- **`indexer.indexTournament is not a function`** → `git pull`; the `indexTournament` export only exists from commit `9e19957` onward.
- **Tournament returns `null`** → its events don't canonicalize. Check the abbr/name format with: `node -e "(async()=>{console.log((await require('./server/services/tocCrawler').fetchTournamentJson($TID)).categories.map(c=>({abbr:c.abbr,name:c.name})));})()"`. Likely needs a regex extension in `tocIndexer._canonicalAbbrFromText`.
