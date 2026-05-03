'use strict';

// Populates the local sqlite-vec table (cards_vec) used by the
// /api/library/semantic-search route. Without this, the route's semantic
// stage KNNs an empty table and only the FTS leg contributes.
//
// Each card's vec is keyed by cards.rowid (BigInt) — the route maps
// knn hits back via rowid. Resume-safe: rows whose textHash hasn't
// changed are skipped.
//
// Usage: node server/scripts/indexCardsVec.js [--all] [--limit N]
//   default: only canonical, highlighted cards with tag (matches route filter)
//   --all:   index every card
//   --limit: cap total rows processed (smoke test)

// DOTENV_CONFIG_PATH env var lets a worktree borrow the main repo's .env
// without copying secrets — falls back to the local project root.
require('dotenv').config({
  path: process.env.DOTENV_CONFIG_PATH
    || require('path').resolve(__dirname, '../../.env'),
});

const crypto = require('crypto');
const { getDb } = require('../services/db');
const {
  ensureSchema,
  upsertEmbedding,
  alreadyEmbedded,
  extensionStatus,
} = require('../services/semanticIndex');
const { embedTexts } = require('../services/embedder');

const argv = process.argv.slice(2);
const ALL_ROWS = argv.includes('--all');
const LIMIT_IDX = argv.indexOf('--limit');
const LIMIT = LIMIT_IDX >= 0 ? Number(argv[LIMIT_IDX + 1]) || 0 : 0;
const PAGE  = Number(process.env.INDEX_PAGE  || 256);
const BATCH = Number(process.env.EMBED_BATCH || 64);

function buildEmbedText(row) {
  return [row.tag, row.cite, row.body_plain]
    .filter(Boolean)
    .join(' ')
    .slice(0, 4000);
}

function textHash(text) {
  return crypto.createHash('sha1').update(text).digest('hex');
}

async function main() {
  // No API key required — embeddings run locally via @xenova/transformers.
  // The model auto-downloads to node_modules on first invocation.

  const db = getDb();
  if (!ensureSchema()) {
    console.error('sqlite-vec extension failed to load:', extensionStatus());
    process.exit(1);
  }

  const filter = ALL_ROWS
    ? ''
    : `WHERE isCanonical = 1
         AND hasHighlight = 1
         AND highlightWordCount >= 6
         AND tag IS NOT NULL
         AND TRIM(tag) != ''`;

  // ── Repair pass 1: orphan metadata (hash present, vector missing) ──
  // Without this, alreadyEmbedded() returns true for orphaned metadata
  // and the skip-loop never re-queues the row. The prior cards_vec rebuild
  // path (rebuildDb.js) and any interrupted upsert can both produce this.
  const orphans = db.prepare(`
    DELETE FROM cards_embed_meta
    WHERE card_id NOT IN (SELECT card_id FROM cards_vec)
  `).run();
  if (orphans.changes > 0) {
    console.log(`Repaired ${orphans.changes} orphaned metadata rows (had hash, no vector).`);
  }

  // ── Repair pass 2: stale vec rows (rowid no longer points at any card) ──
  // cards has a TEXT primary key; INSERT OR REPLACE on the same id does
  // a DELETE+INSERT internally, which can change the rowid. Old vec rows
  // keyed by the prior rowid become unreachable garbage that wastes
  // top-K slots and skews KNN results. Clean any vec rows whose card_id
  // is no longer a live cards.rowid. Same sweep for metadata.
  const staleVec  = db.prepare(`DELETE FROM cards_vec        WHERE card_id NOT IN (SELECT rowid FROM cards)`).run();
  const staleMeta = db.prepare(`DELETE FROM cards_embed_meta WHERE card_id NOT IN (SELECT rowid FROM cards)`).run();
  if (staleVec.changes > 0 || staleMeta.changes > 0) {
    console.log(`Repaired ${staleVec.changes} stale vec rows + ${staleMeta.changes} stale meta rows (rowid churn).`);
  }

  const total = db.prepare(`SELECT COUNT(*) AS n FROM cards ${filter}`).get().n;
  // After resume runs, count what's still UNDONE so we don't waste 4h
  // scanning through rows that are already embedded. Without this filter,
  // a resume on a 75% embedded library takes hours just to walk the done
  // prefix doing alreadyEmbedded() checks before reaching new work.
  const unfilter = filter
    ? `${filter} AND rowid NOT IN (SELECT card_id FROM cards_embed_meta)`
    : `WHERE rowid NOT IN (SELECT card_id FROM cards_embed_meta)`;
  const undone = db.prepare(`SELECT COUNT(*) AS n FROM cards ${unfilter}`).get().n;
  const cap = LIMIT > 0 ? Math.min(LIMIT, undone) : undone;
  console.log(`Indexing ${cap} undone of ${total} eligible cards (page=${PAGE}, batch=${BATCH})${ALL_ROWS ? ' [ALL]' : ' [canonical+highlighted]'}`);

  // Stream UNDONE rowids only — DB-level anti-join skips already-embedded
  // rows so the script doesn't repeat the alreadyEmbedded() check per row.
  // ORDER BY rowid keeps the run resumable across cap-driven cancellations.
  const selectPage = db.prepare(`
    SELECT rowid AS rowid, tag, cite, body_plain
    FROM cards
    ${unfilter}
    ORDER BY rowid ASC
    LIMIT ? OFFSET ?
  `);

  let offset = 0;
  let attempted = 0;
  let embedded = 0;
  let skipped = 0;
  let failed = 0;
  const failedRowIds = [];
  const startedAt = Date.now();

  while (attempted < cap) {
    const remaining = cap - attempted;
    const pageSize = Math.min(PAGE, remaining);
    const rows = selectPage.all(pageSize, offset);
    if (!rows.length) break;

    // Within a page, dispatch in BATCH-sized embedding requests.
    const pending = [];
    for (const row of rows) {
      const text = buildEmbedText(row);
      if (!text) { skipped++; continue; }
      const hash = textHash(text);
      if (alreadyEmbedded(row.rowid, hash)) { skipped++; continue; }
      pending.push({ rowid: row.rowid, text, hash });
    }

    for (let i = 0; i < pending.length; i += BATCH) {
      const slice = pending.slice(i, i + BATCH);
      let vectors;
      try {
        vectors = await embedTexts(slice.map(p => p.text));
      } catch (err) {
        console.error(`[ERR] embed batch failed at rowid=${slice[0].rowid}:`, err.message);
        failed += slice.length;
        for (const p of slice) failedRowIds.push(p.rowid);
        // Continue so a transient embedding error doesn't undo hours of
        // progress, but the final exit code reflects that some rows missed.
        continue;
      }
      slice.forEach((p, idx) => {
        const v = vectors[idx];
        if (!v) { failed++; failedRowIds.push(p.rowid); return; }
        upsertEmbedding(p.rowid, p.hash, v);
        embedded++;
      });
    }

    attempted += rows.length;
    offset += rows.length;
    const elapsed = (Date.now() - startedAt) / 1000;
    const rate = embedded / Math.max(1, elapsed);
    console.log(`  progress: ${attempted}/${cap} (embedded=${embedded}, skipped=${skipped}, ${rate.toFixed(1)}/s)`);
  }

  console.log(`Done. embedded=${embedded} skipped=${skipped} failed=${failed} attempted=${attempted}`);
  if (failed > 0) {
    // Persist the rowids so the next run can re-queue them via --retry-only,
    // and exit non-zero so cron / nohup don't claim success.
    const fs = require('fs');
    const path = require('path');
    const out = path.resolve(__dirname, '..', 'data', '.cache', 'failed-rowids.json');
    try {
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, JSON.stringify(failedRowIds));
      console.error(`[FAIL] ${failed} rows did not embed. Rowids written to ${out}`);
    } catch (err) {
      console.error(`[FAIL] ${failed} rows did not embed; could not persist rowid list: ${err.message}`);
    }
    process.exit(3);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
