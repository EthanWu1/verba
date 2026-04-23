#!/usr/bin/env node
'use strict';

/**
 * Canonicalize library cards (v2).
 *
 * Stricter dedup than stored `canonicalGroupKey`:
 *   - Group key = normalized(shortCite) + '|' + first-100-chars of body_plain normalized
 *   - Any card with fewer than MIN_HL highlighted WORDS (default 5) is dropped outright
 *     (highlighted = word count inside ==…== spans in body_markdown)
 *
 * For each group with >1 variant:
 *   1. Score each variant by body length + highlight density
 *   2. Pick best tag across the whole group (short, generic, non-contextual)
 *   3. Mark winner isCanonical=1, assign best tag, set variantCount=group.size
 *   4. Drop losers (--mark soft, sets isCanonical=0; --delete hard, removes rows)
 *
 * Reversible: writes a timestamped DB backup before any mutation.
 *
 * Usage:
 *   node scripts/canonicalize-cards.js                    # dry run
 *   node scripts/canonicalize-cards.js --apply --mark
 *   node scripts/canonicalize-cards.js --apply --delete
 *   node scripts/canonicalize-cards.js --min-hl 5         # override highlight floor
 */

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', 'server', 'data', 'library.db');
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const MODE_DELETE = args.includes('--delete');
const MODE_MARK = args.includes('--mark');
const MIN_HL = (() => { const i = args.indexOf('--min-hl'); return i >= 0 ? Number(args[i + 1]) || 5 : 5; })();
const PROGRESS_EVERY = 10000;

if (APPLY && !MODE_DELETE && !MODE_MARK) {
  console.error('With --apply, pass either --mark (soft) or --delete (hard).');
  process.exit(1);
}
if (MODE_DELETE && MODE_MARK) {
  console.error('--delete and --mark are mutually exclusive.');
  process.exit(1);
}
if (!fs.existsSync(DB_PATH)) {
  console.error('DB not found at', DB_PATH);
  process.exit(1);
}

// --- Helpers ---

function normalizeCite(s) {
  return String(s || '').toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();
}
function bodyPrefix(body) {
  return String(body || '').toLowerCase().replace(/\s+/g, ' ').replace(/[^a-z0-9 ]/g, '').slice(0, 100).trim();
}
function groupKeyFor(row) {
  const sc = normalizeCite(row.shortCite);
  const bp = bodyPrefix(row.body_plain);
  if (!sc && !bp) return '';
  return sc + '||' + bp;
}
function highlightWordCount(bodyMarkdown) {
  if (!bodyMarkdown) return 0;
  const src = String(bodyMarkdown);
  let n = 0;
  for (const m of src.match(/==([\s\S]+?)==/g) || []) {
    const inner = m.slice(2, -2).replace(/<[^>]+>/g, '').trim();
    if (inner) n += inner.split(/\s+/).filter(Boolean).length;
  }
  for (const m of src.match(/<u\b[^>]*>([\s\S]+?)<\/u>/gi) || []) {
    const inner = m.replace(/^<u\b[^>]*>/i, '').replace(/<\/u>$/i, '').replace(/<[^>]+>/g, '').replace(/==+/g, '').trim();
    if (inner) n += inner.split(/\s+/).filter(Boolean).length;
  }
  return n;
}
function bodyScore(c) {
  const plainLen = (c.body_plain || '').length;
  const hi = highlightWordCount(c.body_markdown || '');
  return plainLen + hi * 10;
}
function tagScore(tag) {
  if (!tag) return -1000;
  const t = String(tag).trim();
  if (!t) return -1000;
  let score = 100 - t.length * 0.6;
  if (/\b(that|because|when|since|although|however|therefore|thus|moreover|the fact that)\b/i.test(t)) score -= 20;
  if (t.split(/[.,;:]/).length > 2) score -= 12;
  if (/\.{3}|…/.test(t)) score -= 10;
  const wc = t.split(/\s+/).length;
  if (wc > 12) score -= 10;
  if (wc < 2) score -= 5;
  if (/^(the|a|an)\s/i.test(t)) score -= 3;
  if (/[!?.]$/.test(t)) score += 2;
  return score;
}
function backupDb() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = DB_PATH + '.bak-canon-' + stamp;
  console.log('Copying DB →', backup);
  fs.copyFileSync(DB_PATH, backup);
  for (const suffix of ['-shm', '-wal']) {
    const src = DB_PATH + suffix;
    if (fs.existsSync(src)) fs.copyFileSync(src, backup + suffix);
  }
  console.log('Backup complete.');
  return backup;
}

// --- Main ---

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

console.log(APPLY ? `APPLY mode (${MODE_DELETE ? 'DELETE' : 'MARK'}), min-hl=${MIN_HL}` : `(dry run, min-hl=${MIN_HL} — pass --apply --mark|--delete to mutate)`);
if (APPLY) backupDb();

console.log('Streaming all cards…');
const iter = db.prepare('SELECT id, tag, shortCite, body_plain, body_markdown FROM cards').iterate();

// Map<groupKey, Array<{id, tag, plainLen, hlWords, bodyScore, tagScore, raw}>>
const groups = new Map();
let scanned = 0;
let lowHighlight = 0;
let noKey = 0;

for (const row of iter) {
  scanned += 1;
  if (scanned % PROGRESS_EVERY === 0) console.log(`  scanned ${scanned}…`);

  const hl = highlightWordCount(row.body_markdown);
  if (hl < MIN_HL) { lowHighlight += 1; continue; }

  const key = groupKeyFor(row);
  if (!key) { noKey += 1; continue; }

  const entry = {
    id: row.id,
    tag: row.tag || '',
    hl,
    bscore: bodyScore(row),
    tscore: tagScore(row.tag || ''),
  };

  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(entry);
}

console.log(`Scanned: ${scanned}. Dropped for low highlights (<${MIN_HL} words): ${lowHighlight}. Skipped for no key: ${noKey}. Groups formed: ${groups.size}.`);

// Determine winners / losers
let multiGroups = 0;
let totalLosers = 0;
let tagRewrites = 0;
const tagUpdates = []; // [{id, newTag}]
const loserIds = [];   // all cards to demote/delete (incl. low-highlight)

// First, collect low-highlight IDs as losers (they need to be dropped or demoted)
// We already skipped them above — we need their IDs for delete/demote. Re-fetch only their IDs in a second pass.

// Process groups
for (const [, arr] of groups) {
  if (arr.length === 1) continue;
  multiGroups += 1;

  arr.sort((a, b) => b.bscore - a.bscore);
  const winner = arr[0];
  const losers = arr.slice(1);
  totalLosers += losers.length;
  for (const l of losers) loserIds.push(l.id);

  const bestTagged = [...arr].sort((a, b) => b.tscore - a.tscore)[0];
  if (bestTagged.tag && bestTagged.tag !== winner.tag) {
    tagRewrites += 1;
    tagUpdates.push({ id: winner.id, newTag: bestTagged.tag });
  }
}

console.log(`Multi-variant groups: ${multiGroups}. Duplicate losers: ${totalLosers}. Tag rewrites: ${tagRewrites}.`);
console.log(`Grand total cards to drop (low-highlight + duplicates): ${lowHighlight + totalLosers}.`);

if (!APPLY) {
  console.log('\nDry run. Re-run with --apply --mark (soft) or --apply --delete (hard) to mutate.');
  db.close();
  process.exit(0);
}

// --- APPLY ---
console.log('Applying…');

// Gather low-highlight IDs (second pass, ID-only for memory)
console.log('Collecting low-highlight IDs…');
const lowHlIds = [];
const lowPass = db.prepare('SELECT id, body_markdown FROM cards').iterate();
for (const row of lowPass) {
  if (highlightWordCount(row.body_markdown) < MIN_HL) lowHlIds.push(row.id);
}
console.log(`Low-highlight IDs collected: ${lowHlIds.length}.`);

const updateWinner = db.prepare('UPDATE cards SET isCanonical = 1 WHERE id = ?');
const updateTag = db.prepare('UPDATE cards SET tag = ? WHERE id = ?');
const demote = db.prepare('UPDATE cards SET isCanonical = 0 WHERE id = ?');
const del = db.prepare('DELETE FROM cards WHERE id = ?');

const CHUNK = 500;
const runDemote = db.transaction((ids) => { for (const id of ids) demote.run(id); });
const runDelete = db.transaction((ids) => { for (const id of ids) del.run(id); });
const runTags   = db.transaction((ups) => { for (const u of ups) updateTag.run(u.newTag, u.id); });

// 1. Drop losers + low-highlight
const allDropIds = loserIds.concat(lowHlIds);
console.log(`Dropping ${allDropIds.length} cards in chunks of ${CHUNK}…`);
for (let i = 0; i < allDropIds.length; i += CHUNK) {
  const slice = allDropIds.slice(i, i + CHUNK);
  if (MODE_DELETE) runDelete(slice); else runDemote(slice);
  if ((i / CHUNK) % 20 === 0) console.log(`  progress ${i}/${allDropIds.length}`);
}

// 2. Apply tag updates + mark winners canonical
console.log(`Applying ${tagUpdates.length} tag rewrites…`);
if (tagUpdates.length) runTags(tagUpdates);

// Mark every surviving group's winner canonical (single-variant groups too)
console.log('Marking canonicals…');
let markedCanonical = 0;
const winners = [];
for (const [, arr] of groups) {
  if (arr.length === 0) continue;
  arr.sort((a, b) => b.bscore - a.bscore);
  winners.push(arr[0].id);
}
const runMark = db.transaction((ids) => { for (const id of ids) { updateWinner.run(id); markedCanonical += 1; } });
for (let i = 0; i < winners.length; i += CHUNK) runMark(winners.slice(i, i + CHUNK));
console.log(`Marked canonical: ${markedCanonical}.`);

console.log('---');
console.log('DONE');
console.log('  losers dropped:', loserIds.length);
console.log('  low-highlight cards dropped:', lowHlIds.length);
console.log('  tag rewrites:', tagUpdates.length);
console.log('  canonicals marked:', markedCanonical);

db.close();
