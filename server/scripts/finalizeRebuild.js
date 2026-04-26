#!/usr/bin/env node
/**
 * server/scripts/finalizeRebuild.js
 *
 * Run AFTER you've swapped library.db.new → library.db and the app is back up.
 * The main rebuildDb.js skips body_plain on the cards table to fit a tight
 * disk; this script:
 *
 *   1) regenerates body_plain by stripping Verbatim marks from body_markdown
 *   2) rebuilds cards_fts so library full-text search works again
 *   3) re-analyzes the schema for the query planner
 *
 * Disk impact: cards table grows by ~4–5 GB (body_plain is repopulated). At
 * this point old library.db is gone, so you have plenty of headroom.
 *
 * Usage:
 *
 *   pm2 stop all
 *   node server/scripts/finalizeRebuild.js
 *   pm2 start all
 */

'use strict';

const path = require('path');
const fs   = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = path.resolve(__dirname, '..', 'data', 'library.db');
if (!fs.existsSync(DB_PATH)) { console.error('DB not found:', DB_PATH); process.exit(1); }

function log(msg) { console.log(`[${new Date().toISOString().slice(11,19)}] ${msg}`); }

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

const before = fs.statSync(DB_PATH).size;
log(`DB size before: ${(before / 1024 / 1024 / 1024).toFixed(2)} GB`);

// ── 1) Regenerate body_plain via SQL REPLACEs ─────────────────────────────
// Strip the four Verbatim mark tokens. Order matters: do the multi-char
// tokens first. This isn't a perfect markup stripper (e.g. doesn't strip the
// occasional <U>/<U>) but matches what cutValidator.stripFormatMarks does.
log('Regenerating body_plain from body_markdown...');
const updateStmt = db.prepare(`
  UPDATE cards
  SET body_plain = TRIM(
        REPLACE(
        REPLACE(
        REPLACE(
        REPLACE(
        REPLACE(
        REPLACE(
        REPLACE(
        REPLACE(body_markdown,
          '==', ''),
          '<u>', ''),
          '</u>', ''),
          '<U>', ''),
          '</U>', ''),
          '__', ''),
          '**', ''),
          char(0xB6), ' '))
  WHERE body_markdown IS NOT NULL
    AND body_markdown <> ''
`);

const t1 = Date.now();
const info = updateStmt.run();
log(`  updated ${info.changes.toLocaleString()} rows (${((Date.now() - t1) / 1000).toFixed(1)}s)`);

// ── 2) Rebuild cards_fts ─────────────────────────────────────────────────
log('Rebuilding cards_fts...');
const ftsExists = db.prepare(`SELECT 1 FROM sqlite_master WHERE name='cards_fts'`).get();
if (ftsExists) {
  const t2 = Date.now();
  db.exec(`INSERT INTO cards_fts(cards_fts) VALUES('rebuild')`);
  log(`  cards_fts rebuilt (${((Date.now() - t2) / 1000).toFixed(1)}s)`);
} else {
  log('  cards_fts not found — skip');
}

// ── 3) ANALYZE ───────────────────────────────────────────────────────────
log('ANALYZE...');
db.exec('ANALYZE');

// ── 4) Checkpoint WAL so file size reflects everything ────────────────────
db.pragma('wal_checkpoint(TRUNCATE)');

const after = fs.statSync(DB_PATH).size;
log('');
log(`DB size after:  ${(after / 1024 / 1024 / 1024).toFixed(2)} GB`);
log(`Δ: ${((after - before) / 1024 / 1024).toFixed(0)} MB`);

db.close();
log('Done. Restart the app: pm2 start all');
