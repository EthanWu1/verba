#!/usr/bin/env node
/**
 * server/scripts/rebuildDb.js
 *
 * One-shot DB rebuilder. Copies every real (non-shadow) table from
 *   server/data/library.db
 * into a fresh
 *   server/data/library.db.new
 * skipping the orphaned `analytics` table and all FTS5 / sqlite-vec shadow
 * tables (those are rebuildable from `cards`).
 *
 * Usage (with the app stopped):
 *
 *   pm2 stop all
 *   rm -rf ~/backups                         # free disk first
 *   ls -lh server/data/library.db            # confirm size
 *   node server/scripts/rebuildDb.js
 *
 * After it finishes:
 *
 *   sqlite3 server/data/library.db.new "SELECT COUNT(*) FROM cards;"   # sanity
 *   mv server/data/library.db     server/data/library.db.old
 *   mv server/data/library.db.new server/data/library.db
 *   pm2 start all
 *   node server/scripts/indexCards.js        # regenerate sqlite-vec embeddings
 *
 *   # only after a few hours of working app traffic:
 *   rm server/data/library.db.old
 */

'use strict';

const path = require('path');
const fs   = require('fs');
const Database = require('better-sqlite3');

const SRC_PATH = path.resolve(__dirname, '..', 'data', 'library.db');
const DST_PATH = path.resolve(__dirname, '..', 'data', 'library.db.new');

function bytesToGB(n) { return (n / 1024 / 1024 / 1024).toFixed(2); }
function bytesToMB(n) { return (n / 1024 / 1024).toFixed(1); }

function isShadow(name) {
  return /_(fts|vec)(_data|_idx|_docsize|_config|_content|_chunks|_rowids|_info|_vector_chunks\d*)$/i.test(name)
      || /^cards_vec(_|$)/.test(name)
      || /^.+_fts(_|$)/.test(name);
}

function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
}

function fatal(msg) { console.error('\nFATAL: ' + msg); process.exit(1); }

// ── SETUP ─────────────────────────────────────────────────────────────────
if (!fs.existsSync(SRC_PATH)) fatal('source DB not found: ' + SRC_PATH);
if (fs.existsSync(DST_PATH)) {
  fatal('destination already exists: ' + DST_PATH +
        '\n  remove it first: rm ' + DST_PATH);
}

const srcSize = fs.statSync(SRC_PATH).size;
log(`Source: ${SRC_PATH} (${bytesToGB(srcSize)} GB)`);
log(`Target: ${DST_PATH}`);

const src = new Database(SRC_PATH, { readonly: true, fileMustExist: true });
const dst = new Database(DST_PATH);

// Try to load sqlite-vec on the destination so the CREATE VIRTUAL TABLE for
// cards_vec doesn't error out. If the extension can't load, we still rebuild
// successfully — just without vec. The user re-runs the indexer afterwards.
let vecLoaded = false;
try {
  const sqliteVec = require('sqlite-vec');
  sqliteVec.load(dst);
  vecLoaded = true;
  log('sqlite-vec extension loaded on destination');
} catch (err) {
  log(`sqlite-vec NOT loaded (${err.message}) — vec virtual table will be skipped`);
}

dst.pragma('journal_mode = OFF');
dst.pragma('synchronous = OFF');
dst.pragma('temp_store = MEMORY');
dst.pragma('cache_size = -200000');   // 200 MB page cache

// ── SCHEMA ────────────────────────────────────────────────────────────────
// Order: regular tables → virtual tables (FTS5/vec) → indexes → triggers → views.
const schemaRows = src.prepare(`
  SELECT name, type, sql
  FROM sqlite_master
  WHERE sql IS NOT NULL
    AND name NOT LIKE 'sqlite_%'
    AND name != 'analytics'
  ORDER BY rowid
`).all();

const realTables = [];
const virtualTables = [];
const indexes = [];
const triggers = [];
const views = [];

for (const r of schemaRows) {
  if (isShadow(r.name)) continue;
  const sql = String(r.sql || '');
  if (r.type === 'table' && /CREATE\s+VIRTUAL\s+TABLE/i.test(sql)) virtualTables.push(r);
  else if (r.type === 'table')   realTables.push(r);
  else if (r.type === 'index')   indexes.push(r);
  else if (r.type === 'trigger') triggers.push(r);
  else if (r.type === 'view')    views.push(r);
}

log(`Schema: ${realTables.length} tables, ${virtualTables.length} virtual, ${indexes.length} indexes, ${triggers.length} triggers, ${views.length} views`);

// 1) Real tables first — no triggers attached yet so bulk INSERTs are fast.
log('Creating real tables...');
for (const t of realTables) {
  try { dst.exec(t.sql); }
  catch (err) { log(`  WARN: create ${t.name} failed — ${err.message}`); }
}

// ── DATA COPY ─────────────────────────────────────────────────────────────
const dataTables = src.prepare(`
  SELECT name FROM sqlite_master
  WHERE type='table'
    AND name NOT LIKE 'sqlite_%'
    AND name != 'analytics'
    AND sql NOT LIKE '%VIRTUAL%'
  ORDER BY
    CASE name WHEN 'cards' THEN 1 ELSE 2 END,
    name
`).all();

log(`Copying ${dataTables.length} table(s)...`);

for (const t of dataTables) {
  if (isShadow(t.name)) continue;

  const total = src.prepare(`SELECT COUNT(*) AS n FROM "${t.name}"`).get().n;
  if (total === 0) { log(`  ${t.name}: empty`); continue; }

  const cols = src.prepare(`PRAGMA table_info("${t.name}")`).all().map(c => c.name);
  if (!cols.length) { log(`  ${t.name}: no columns?`); continue; }
  const colList = cols.map(c => `"${c}"`).join(',');
  const placeholders = cols.map(() => '?').join(',');

  const selectStmt = src.prepare(`SELECT ${colList} FROM "${t.name}"`);
  const insertStmt = dst.prepare(`INSERT INTO "${t.name}"(${colList}) VALUES(${placeholders})`);

  const startedAt = Date.now();
  let copied = 0;
  let batch = [];
  const BATCH = 2000;
  const COMMIT_EVERY = 50000;

  // For the cards table, drop body_plain during copy — it's a redundant
  // strip-marks copy of body_markdown and is recomputed on demand by the app.
  // Skipping it saves ~4–5 GB on the destination, which is the difference
  // between the rebuild fitting in tight free disk and not.
  const isCards = t.name === 'cards';
  const insertBatch = dst.transaction((rows) => {
    for (const row of rows) {
      if (isCards && Object.prototype.hasOwnProperty.call(row, 'body_plain')) {
        row.body_plain = '';
      }
      insertStmt.run(cols.map(c => row[c]));
    }
  });

  dst.exec('BEGIN');
  for (const row of selectStmt.iterate()) {
    batch.push(row);
    if (batch.length >= BATCH) {
      insertBatch(batch);
      copied += batch.length;
      batch = [];
      if (copied % COMMIT_EVERY === 0) {
        dst.exec('COMMIT'); dst.exec('BEGIN');
        const pct = ((copied / total) * 100).toFixed(1);
        log(`  ${t.name}: ${copied}/${total} (${pct}%)`);
      }
    }
  }
  if (batch.length) { insertBatch(batch); copied += batch.length; }
  dst.exec('COMMIT');

  const dt = ((Date.now() - startedAt) / 1000).toFixed(1);
  log(`  ${t.name}: ${copied}/${total} done (${dt}s)`);
}

// ── VIRTUAL TABLES (FTS5 / vec) ───────────────────────────────────────────
log('Creating virtual tables...');
for (const v of virtualTables) {
  // Skip cards_vec if extension didn't load — would error at CREATE.
  if (!vecLoaded && /\busing\s+vec0\b/i.test(v.sql)) {
    log(`  skip ${v.name} (vec extension not available)`);
    continue;
  }
  try { dst.exec(v.sql); log(`  ${v.name} created`); }
  catch (err) { log(`  WARN: ${v.name} failed — ${err.message}`); }
}

// ── INDEXES + TRIGGERS + VIEWS ────────────────────────────────────────────
log('Creating indexes...');
for (const i of indexes) {
  try { dst.exec(i.sql); }
  catch (err) { log(`  WARN: index ${i.name} — ${err.message}`); }
}
log('Creating triggers...');
for (const t of triggers) {
  try { dst.exec(t.sql); }
  catch (err) { log(`  WARN: trigger ${t.name} — ${err.message}`); }
}
log('Creating views...');
for (const v of views) {
  try { dst.exec(v.sql); }
  catch (err) { log(`  WARN: view ${v.name} — ${err.message}`); }
}

// ── REBUILD FTS5 (small tables only — defer cards_fts) ────────────────────
// cards.body_plain was nulled during copy to fit disk; cards_fts indexes
// body_plain and would be empty if rebuilt now. Defer to the post-swap
// script (server/scripts/finalizeRebuild.js) which regenerates body_plain
// from body_markdown then rebuilds cards_fts.
log('Rebuilding small FTS5 indexes (cards_fts deferred to post-swap)...');
const ftsToRebuild = ['wiki_teams_fts', 'wiki_arguments_fts', 'chat_context_fts'];
for (const name of ftsToRebuild) {
  const exists = dst.prepare(`SELECT 1 FROM sqlite_master WHERE name=?`).get(name);
  if (!exists) continue;
  try {
    const t = Date.now();
    dst.exec(`INSERT INTO "${name}"("${name}") VALUES('rebuild')`);
    log(`  ${name} rebuilt (${((Date.now() - t) / 1000).toFixed(1)}s)`);
  } catch (err) {
    log(`  WARN: ${name} rebuild failed — ${err.message}`);
  }
}

// ── FINALIZE ──────────────────────────────────────────────────────────────
log('Re-enabling WAL + ANALYZE...');
dst.pragma('journal_mode = WAL');
dst.pragma('synchronous = NORMAL');
try { dst.exec('ANALYZE'); } catch (err) { log(`  ANALYZE: ${err.message}`); }

src.close();
dst.close();

const dstSize = fs.statSync(DST_PATH).size;
log('');
log('═══ DONE ═══');
log(`Source: ${bytesToGB(srcSize)} GB`);
log(`Target: ${bytesToGB(dstSize)} GB  (${bytesToMB(srcSize - dstSize)} MB reclaimed)`);
log('');
log('Next steps (with app stopped):');
log('  mv server/data/library.db     server/data/library.db.old');
log('  mv server/data/library.db.new server/data/library.db');
log('  pm2 start all');
if (!vecLoaded) {
  log('  node server/scripts/indexCards.js   # regenerate sqlite-vec embeddings');
}
log('After confirming the app works for a few hours:');
log('  rm server/data/library.db.old');
