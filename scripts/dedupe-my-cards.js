#!/usr/bin/env node
'use strict';

/**
 * Deduplicate a user's saved cards (user_saved_cards table).
 *
 * Clusters cards by (userId, author-year key) and picks the "best" card in
 * each cluster to keep. The winner inherits the cluster's best tag (may come
 * from a loser). Losers are deleted. Project references to losers are rewritten
 * to the winner.
 *
 * Reversible: writes a timestamped backup of the SQLite DB before any
 * mutation. Restore by copying the backup back over library.db.
 *
 * Usage:
 *   node scripts/dedupe-my-cards.js            # dry run, prints plan
 *   node scripts/dedupe-my-cards.js --apply    # actually mutate
 *   node scripts/dedupe-my-cards.js --apply --user <userId>
 */

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', 'server', 'data', 'library.db');
const args = new Set(process.argv.slice(2));
const APPLY = args.has('--apply');
const userFilter = (() => {
  const i = process.argv.indexOf('--user');
  return i > 0 ? process.argv[i + 1] : null;
})();

if (!fs.existsSync(DB_PATH)) {
  console.error('DB not found at', DB_PATH);
  process.exit(1);
}

// --- Author-year extractor (mirrors public/lib/clipboard.js) ---
const PREFIX_RE = /^((?:[A-Z][A-Za-z'‘’\-]+|and|&|et\s+al\.?)(?:\s+(?:[A-Z][A-Za-z'‘’\-]+|and|&|et\s+al\.?))*\s+['‘’]?\d{2,4})/;
function extractAuthorYearPrefix(cite) {
  if (!cite) return null;
  const m = String(cite).match(PREFIX_RE);
  return m ? m[1] : null;
}

function normalizeKey(prefix) {
  return String(prefix || '')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// --- Scoring helpers ---

function countHighlights(body) {
  if (!body) return 0;
  const s = String(body);
  const mEq = (s.match(/==[^=]+==/g) || []).length;
  const mMark = (s.match(/<mark\b/gi) || []).length;
  const mHl = (s.match(/class="[^"]*\bhl\b/gi) || []).length;
  return mEq + mMark + mHl;
}

function bodyScore(card) {
  const body = card.body_plain || card.body_markdown || '';
  const len = body.length;
  const hi = countHighlights(card.body_markdown || card.body_html || '');
  return len + hi * 50; // highlights weighted
}

function tagScore(tag) {
  if (!tag) return -1000;
  const t = String(tag).trim();
  if (!t) return -1000;
  // Prefer short, generic, single-clause tags.
  // Penalize length, clause markers, and trailing context.
  let score = 100 - t.length * 0.6;
  if (/\b(that|because|when|since|although|however|therefore|thus|moreover|the fact that)\b/i.test(t)) score -= 20;
  if (t.split(/[.,;:]/).length > 2) score -= 12; // multiple clauses
  if (/\.{3}|…/.test(t)) score -= 10;
  if (t.split(/\s+/).length > 12) score -= 10;
  if (/^(the|a|an)\s/i.test(t)) score -= 3;
  if (/[!?.]$/.test(t)) score += 2; // complete statements are ok
  return score;
}

// --- Main ---

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

function listUsers() {
  if (userFilter) return [{ id: userFilter }];
  return db.prepare('SELECT DISTINCT userId AS id FROM user_saved_cards').all();
}

function listCardsForUser(userId) {
  const rows = db.prepare('SELECT id, userId, payload, fingerprint, savedAt FROM user_saved_cards WHERE userId = ?').all(userId);
  return rows.map(r => {
    let p = {};
    try { p = JSON.parse(r.payload); } catch {}
    return {
      id: r.id,
      userId: r.userId,
      fingerprint: r.fingerprint,
      savedAt: r.savedAt,
      tag: p.tag || '',
      cite: p.cite || p.shortCite || '',
      body_plain: p.body_plain || '',
      body_markdown: p.body_markdown || '',
      body_html: p.body_html || '',
      raw: p,
    };
  });
}

function cluster(cards) {
  const byKey = new Map();
  const unkeyed = [];
  for (const c of cards) {
    const key = normalizeKey(extractAuthorYearPrefix(c.cite));
    if (!key) { unkeyed.push(c); continue; }
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(c);
  }
  return { clusters: byKey, unkeyed };
}

function pickWinner(cluster) {
  const scored = cluster.map(c => ({ card: c, score: bodyScore(c) }));
  scored.sort((a, b) => b.score - a.score);
  return scored[0].card;
}

function pickBestTag(cluster) {
  const tagged = cluster
    .map(c => ({ tag: c.tag, score: tagScore(c.tag) }))
    .filter(t => t.tag);
  if (tagged.length === 0) return '';
  tagged.sort((a, b) => b.score - a.score);
  return tagged[0].tag;
}

function rewriteProjectRefs(userId, oldToNew) {
  const projects = db.prepare('SELECT id, cards FROM user_projects WHERE userId = ?').all(userId);
  const updateStmt = db.prepare('UPDATE user_projects SET cards = ?, updatedAt = ? WHERE id = ?');
  const now = new Date().toISOString();
  let rewrites = 0;
  for (const p of projects) {
    let arr;
    try { arr = JSON.parse(p.cards || '[]'); } catch { arr = []; }
    if (!Array.isArray(arr) || arr.length === 0) continue;
    let changed = false;
    const nextArr = arr.map(entry => {
      // cards array may hold id strings OR {id, ...} objects
      const id = typeof entry === 'string' ? entry : entry?.id;
      if (id && oldToNew.has(id)) {
        changed = true;
        rewrites += 1;
        const newId = oldToNew.get(id);
        return typeof entry === 'string' ? newId : { ...entry, id: newId };
      }
      return entry;
    });
    // Dedupe by id within same project after rewrite
    const seen = new Set();
    const deduped = nextArr.filter(entry => {
      const id = typeof entry === 'string' ? entry : entry?.id;
      if (!id) return true;
      if (seen.has(id)) { changed = true; return false; }
      seen.add(id);
      return true;
    });
    if (changed && APPLY) updateStmt.run(JSON.stringify(deduped), now, p.id);
  }
  return rewrites;
}

function backupDb() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = DB_PATH + '.bak-dedupe-' + stamp;
  fs.copyFileSync(DB_PATH, backup);
  const shmSrc = DB_PATH + '-shm';
  const walSrc = DB_PATH + '-wal';
  if (fs.existsSync(shmSrc)) fs.copyFileSync(shmSrc, backup + '-shm');
  if (fs.existsSync(walSrc)) fs.copyFileSync(walSrc, backup + '-wal');
  return backup;
}

function run() {
  if (APPLY) {
    const backup = backupDb();
    console.log('BACKUP →', backup);
  } else {
    console.log('(dry run — pass --apply to mutate; DB untouched)');
  }

  const users = listUsers();
  console.log('users:', users.length);

  let globalKeptCards = 0;
  let globalDroppedCards = 0;
  let globalRewrittenTags = 0;
  let globalProjectRewrites = 0;

  for (const u of users) {
    const userId = u.id;
    const cards = listCardsForUser(userId);
    const { clusters, unkeyed } = cluster(cards);

    let keptForUser = unkeyed.length;
    let droppedForUser = 0;
    let tagRewritesForUser = 0;
    const oldToNew = new Map();
    const tagUpdates = [];
    const deletes = [];

    for (const [key, group] of clusters) {
      if (group.length === 1) { keptForUser += 1; continue; }

      const winner = pickWinner(group);
      const bestTag = pickBestTag(group);
      const losers = group.filter(c => c.id !== winner.id);

      keptForUser += 1;
      droppedForUser += losers.length;

      if (bestTag && bestTag !== winner.tag) {
        tagRewritesForUser += 1;
        tagUpdates.push({ id: winner.id, newTag: bestTag });
      }

      for (const l of losers) {
        oldToNew.set(l.id, winner.id);
        deletes.push(l.id);
      }

      console.log(`  [${userId.slice(0, 8)}] "${key}" kept=${winner.id.slice(0, 8)} drop=${losers.length} tag="${(bestTag || winner.tag).slice(0, 60)}"`);
    }

    if (APPLY) {
      const delStmt = db.prepare('DELETE FROM user_saved_cards WHERE id = ? AND userId = ?');
      const updStmt = db.prepare('UPDATE user_saved_cards SET payload = ? WHERE id = ?');
      const tx = db.transaction(() => {
        for (const { id, newTag } of tagUpdates) {
          const row = db.prepare('SELECT payload FROM user_saved_cards WHERE id = ?').get(id);
          if (!row) continue;
          let p; try { p = JSON.parse(row.payload); } catch { p = {}; }
          p.tag = newTag;
          updStmt.run(JSON.stringify(p), id);
        }
        for (const lid of deletes) delStmt.run(lid, userId);
      });
      tx();
    }

    const projectRewritesForUser = rewriteProjectRefs(userId, oldToNew);

    globalKeptCards += keptForUser;
    globalDroppedCards += droppedForUser;
    globalRewrittenTags += tagRewritesForUser;
    globalProjectRewrites += projectRewritesForUser;

    console.log(`user ${userId.slice(0, 8)}: kept ${keptForUser}, dropped ${droppedForUser}, tag rewrites ${tagRewritesForUser}, project refs rewritten ${projectRewritesForUser}`);
  }

  console.log('---');
  console.log('TOTAL kept cards:       ', globalKeptCards);
  console.log('TOTAL dropped cards:    ', globalDroppedCards);
  console.log('TOTAL tag rewrites:     ', globalRewrittenTags);
  console.log('TOTAL project rewrites: ', globalProjectRewrites);
  if (!APPLY) console.log('\nDry run. Re-run with --apply to mutate (a backup will be created).');
}

run();
db.close();
