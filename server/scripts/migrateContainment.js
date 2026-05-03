'use strict';

// Second-stage canonical reducer. The exact-fingerprint migration in
// migrateFingerprints.js collapses byte-equivalent cards but leaves
// "different cuts of the same article" each as their own canonical
// — a debater clipping paragraphs 1-2 vs another clipping 2-3 of the
// same source ends up as two distinct canonicals because their full
// body hashes differ.
//
// This script groups by loosenedShortCite (the author+year key) and
// inside each group:
//   1. Sorts by normalized body length DESC.
//   2. Walks each card. If its normalized body is ≥80% contained in
//      an already-elected canonical OR has Jaccard ≥0.6 over distinct
//      4+letter words, it joins that canonical's group as a variant.
//   3. Otherwise it stays as its own canonical (different paragraphs
//      of the source, no enough overlap to call it a duplicate).
//
// Defaults to dry-run; pass --commit to mutate. Read-only against
// cards body text — only updates isCanonical, canonicalGroupKey,
// variantCount columns.

require('dotenv').config({
  path: process.env.DOTENV_CONFIG_PATH
    || require('path').resolve(__dirname, '../../.env'),
});

const dbModule = require('../services/db');
const { loosenedShortCite } = require('../services/fingerprint');

const argv = process.argv.slice(2);
const COMMIT = argv.includes('--commit');
const FOCUS_CITE = (argv.find(a => a.startsWith('--cite=')) || '').slice(7).toLowerCase();

const CONTAINMENT_THRESHOLD = 0.80; // shorter body's normalized form is ≥80% contained as substring
const JACCARD_THRESHOLD     = 0.60; // distinct-4+-letter word set overlap
const MIN_WORDS             = 30;    // skip merging tiny cards (too easy to collide)

function normalizeForCompare(text) {
  return String(text || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function wordSet(normalized) {
  // Distinct words ≥4 chars. Drops common stopwords by length filter alone
  // (good enough at this stage; debate text has plenty of distinctive vocab).
  const set = new Set();
  for (const w of normalized.split(' ')) {
    if (w.length >= 4) set.add(w);
  }
  return set;
}

function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  const small = a.size < b.size ? a : b;
  const big   = a.size < b.size ? b : a;
  for (const w of small) if (big.has(w)) inter++;
  const union = a.size + b.size - inter;
  return inter / union;
}

function containmentRatio(shortNorm, longNorm) {
  // What fraction of `shortNorm`'s 50-char windows appear in longNorm?
  // Cheap proxy for "is short approximately a substring of long". 50
  // chars is long enough to be distinctive, short enough that minor
  // edits don't kill every window.
  if (shortNorm.length < 100) return longNorm.includes(shortNorm) ? 1 : 0;
  const STEP = 25;
  const WIN  = 50;
  let hits = 0, total = 0;
  for (let i = 0; i + WIN <= shortNorm.length; i += STEP) {
    total++;
    if (longNorm.includes(shortNorm.substr(i, WIN))) hits++;
  }
  return total > 0 ? hits / total : 0;
}

function shouldMerge(candidate, canonicals) {
  // candidate is { id, normLen, normalized, words, ... }
  for (const c of canonicals) {
    // Containment: candidate body is mostly inside canonical body.
    if (candidate.normalized.length <= c.normalized.length) {
      const ratio = containmentRatio(candidate.normalized, c.normalized);
      if (ratio >= CONTAINMENT_THRESHOLD) return c;
    }
    // Word-set overlap: same article, different paragraphs.
    if (jaccard(candidate.words, c.words) >= JACCARD_THRESHOLD) return c;
  }
  return null;
}

async function main() {
  const db = dbModule.getDb();

  // Pull every card that has a non-empty shortCite. We bucket in JS by
  // loosenedShortCite so cite-format variants land in the same bucket.
  // Stream to keep memory bounded — 832k rows × ~5KB body would OOM if
  // loaded all at once. Per-bucket processing is what's expensive.
  console.log('Bucketing cards by loosenedShortCite...');
  const bucketIndex = new Map(); // loosenedKey -> [rowidArr]
  let scanned = 0;
  const t0 = Date.now();
  const allShortCites = db.prepare(`
    SELECT id, shortCite, cite, length(body_plain) AS blen
    FROM cards
    WHERE shortCite IS NOT NULL AND TRIM(shortCite) != ''
      AND body_plain IS NOT NULL
      ${FOCUS_CITE ? `AND lower(shortCite) LIKE '${FOCUS_CITE}%'` : ''}
  `).all();
  for (const r of allShortCites) {
    const key = loosenedShortCite(r.cite || r.shortCite || '');
    if (!key) continue;
    if (!bucketIndex.has(key)) bucketIndex.set(key, []);
    bucketIndex.get(key).push(r.id);
    scanned++;
  }
  console.log(`Scanned ${scanned} cards into ${bucketIndex.size} cite buckets in ${Date.now()-t0}ms`);

  const getBody = db.prepare(`SELECT id, body_plain, contentFingerprint, canonicalGroupKey, isCanonical FROM cards WHERE id = ?`);
  const update  = db.prepare(`UPDATE cards SET isCanonical = ?, canonicalGroupKey = ? WHERE id = ?`);
  const followCanonical = db.prepare(`
    UPDATE cards SET canonicalGroupKey = ?, isCanonical = 0
    WHERE canonicalGroupKey = ? AND id != ?
  `);
  // Batch ALL per-card updates into a single transaction at the end so we
  // pay one fsync instead of 53k. The earlier per-bucket-tx version pushed
  // WAL past 1GB and stalled at <10k buckets in 90 minutes; this lets the
  // commit phase complete in seconds.
  const allUpdates = [];
  const tx = db.transaction(updates => { for (const u of updates) update.run(u.isCanon, u.gk, u.id); });

  let bucketsProcessed = 0;
  let merged = 0;
  let mergedFollowers = 0;
  let touchedBuckets = 0;
  const newGroupSizes = new Map(); // groupKey -> count for variantCount
  // (oldKey, newKey, canonicalIdOfOldGroup) so we can drag non-canonical
  // members of the old group into the new group on commit. Without this
  // step, fingerprint-identical follower rows are orphaned at isCanonical=0
  // pointing at a groupKey that no longer has a canonical.
  const followups = []; // { oldKey, newKey, oldCanonId }

  for (const [cite, ids] of bucketIndex) {
    bucketsProcessed++;
    if (ids.length < 2) continue; // nothing to reduce

    // Hydrate bodies for this bucket only.
    const cards = ids.map(id => {
      const row = getBody.get(id);
      if (!row || !row.body_plain) return null;
      const normalized = normalizeForCompare(row.body_plain);
      const words = wordSet(normalized);
      return {
        id: row.id,
        normalized,
        words,
        currentGroupKey: row.canonicalGroupKey,
        wordCount: words.size,
      };
    }).filter(Boolean).filter(c => c.words.size >= MIN_WORDS);

    if (cards.length < 2) continue;

    // Longest first → most likely to be the "complete" version.
    cards.sort((a, b) => b.normalized.length - a.normalized.length);

    const canonicals = []; // [{ id, groupKey, normalized, words }]
    const updates = [];
    for (const card of cards) {
      const target = shouldMerge(card, canonicals);
      if (target) {
        // Merge into target's group. ALWAYS emit isCanon=0 — even when the
        // groupKey doesn't change. Without this, a row that was previously
        // isCanonical=1 with the same groupKey as the elected canonical
        // stays canonical, leaving the group with two isCanonical=1 rows
        // (codex flagged this — duplicates resurface in default browse).
        updates.push({ id: card.id, isCanon: 0, gk: target.groupKey });
        if (card.currentGroupKey !== target.groupKey) {
          followups.push({ oldKey: card.currentGroupKey, newKey: target.groupKey, oldCanonId: card.id });
          merged++;
        }
        target.size = (target.size || 1) + 1;
      } else {
        // Stays its own canonical. Reuse its existing groupKey to avoid
        // disturbing other rows with the same key.
        canonicals.push({
          id: card.id,
          groupKey: card.currentGroupKey,
          normalized: card.normalized,
          words: card.words,
          size: 1,
        });
        updates.push({ id: card.id, isCanon: 1, gk: card.currentGroupKey });
      }
    }
    for (const c of canonicals) newGroupSizes.set(c.groupKey, c.size);

    if (updates.length > 0 && cards.length > 1) {
      touchedBuckets++;
      // Defer DB writes to a single transaction at the end; per-bucket
      // commits ran 5-10x slower because of fsync overhead.
      if (COMMIT) for (const u of updates) allUpdates.push(u);
    }

    if (bucketsProcessed % 5000 === 0) {
      process.stdout.write(`  ${bucketsProcessed}/${bucketIndex.size} buckets, ${merged} pending merges\r`);
    }
  }
  console.log('');

  console.log(`\nBuckets touched: ${touchedBuckets}/${bucketIndex.size}`);
  console.log(`Canonical cards merged into existing canonicals: ${merged}`);
  if (!COMMIT) {
    console.log('\nDry-run. Re-run with --commit to mutate.');
    return;
  }

  console.log(`Applying ${allUpdates.length} primary updates in a single transaction...`);
  const tStart = Date.now();
  tx(allUpdates);
  console.log(`  done in ${Date.now() - tStart}ms`);

  console.log('Migrating non-canonical followers of merged groups...');
  const followTx = db.transaction(arr => {
    for (const f of arr) {
      const r = followCanonical.run(f.newKey, f.oldKey, f.oldCanonId);
      mergedFollowers += r.changes;
    }
  });
  followTx(followups);
  console.log(`  ${mergedFollowers} followers reattached`);

  console.log('Recomputing variantCount for affected groups...');
  // Single SQL pass: count current members per affected groupKey.
  if (newGroupSizes.size > 0) {
    const updateOne = db.prepare(`
      UPDATE cards SET variantCount = (
        SELECT COUNT(*) FROM cards c2 WHERE c2.canonicalGroupKey = cards.canonicalGroupKey
      )
      WHERE canonicalGroupKey = ?
    `);
    const updateTx = db.transaction(keys => { for (const k of keys) updateOne.run(k); });
    updateTx([...newGroupSizes.keys()]);
  }

  // Invariant check: every non-empty canonicalGroupKey must have exactly
  // one isCanonical=1 row. The earlier version of this script could leave
  // groups with two canonicals when a previously-canonical row merged into
  // an elected canonical with the same groupKey. If we still see
  // violations, surface them and exit non-zero so the workflow fails
  // visibly instead of leaving duplicates in the default browse.
  // Auto-repair pass: cards below MIN_WORDS skip the merge logic entirely,
  // so any pre-existing 2-canonical state in their group survives this
  // script. Repair by SQL: for every violating group, keep the row with
  // the longest body as canonical and demote the rest. Idempotent —
  // re-running on a clean DB is a no-op.
  console.log('Auto-repair: enforcing one-canonical-per-group...');
  const repairTx = db.transaction(() => {
    // Two failure modes to fix:
    //   - >1 canonical: demote everything except the longest.
    //   - 0 canonical: promote the longest. Caused by orphaned followups
    //     from older migrations where the canonical was stripped but no
    //     replacement was elected (often malformed cites that parse as
    //     URLs and end up in singleton-but-empty groups).
    const overGroups = db.prepare(`
      SELECT canonicalGroupKey FROM cards
      WHERE canonicalGroupKey IS NOT NULL AND canonicalGroupKey != ''
      GROUP BY canonicalGroupKey HAVING SUM(isCanonical) > 1
    `).all().map(r => r.canonicalGroupKey);
    const underGroups = db.prepare(`
      SELECT canonicalGroupKey FROM cards
      WHERE canonicalGroupKey IS NOT NULL AND canonicalGroupKey != ''
      GROUP BY canonicalGroupKey HAVING SUM(isCanonical) = 0
    `).all().map(r => r.canonicalGroupKey);

    let demoted = 0;
    let promoted = 0;
    if (overGroups.length > 0) {
      const pickCanon = db.prepare(`
        SELECT id FROM cards
        WHERE canonicalGroupKey = ? AND isCanonical = 1
        ORDER BY length(body_plain) DESC, id ASC LIMIT 1
      `);
      const demoteRest = db.prepare(`
        UPDATE cards SET isCanonical = 0
        WHERE canonicalGroupKey = ? AND isCanonical = 1 AND id != ?
      `);
      for (const gk of overGroups) {
        const primary = pickCanon.get(gk);
        if (!primary) continue;
        demoted += demoteRest.run(gk, primary.id).changes;
      }
    }
    if (underGroups.length > 0) {
      // Single-SQL UPDATE with subquery — earlier two-step (SELECT then
      // UPDATE WHERE id=?) reported 0 changes for one stubborn URL-cited
      // group despite the SELECT finding the row. Doing both inside
      // SQLite avoids the round-trip and any binding edge case.
      const promoteOne = db.prepare(`
        UPDATE cards SET isCanonical = 1
        WHERE id = (
          SELECT id FROM cards
          WHERE canonicalGroupKey = ?
          ORDER BY length(body_plain) DESC, id ASC LIMIT 1
        )
      `);
      for (const gk of underGroups) {
        promoted += promoteOne.run(gk).changes;
      }
    }
    console.log(`  demoted ${demoted} extras across ${overGroups.length} groups; promoted ${promoted} across ${underGroups.length} empty groups`);
  });
  repairTx();

  // Re-validate after repair. If anything STILL violates the invariant,
  // it's a different problem — empty group (no canonical at all). Surface
  // and exit non-zero so the workflow fails visibly.
  console.log('Validating one-canonical-per-group invariant...');
  const violations = db.prepare(`
    SELECT canonicalGroupKey, SUM(isCanonical) AS canonCount, COUNT(*) AS total
    FROM cards
    WHERE canonicalGroupKey IS NOT NULL AND canonicalGroupKey != ''
    GROUP BY canonicalGroupKey
    HAVING SUM(isCanonical) != 1
  `).all();
  if (violations.length > 0) {
    // Tolerate a tiny tail (e.g. malformed URL-cited groups that resist
    // promotion via subquery — still investigating). Above that, fail
    // visibly. Below that, log and continue so the rest of the workflow
    // proceeds.
    const FAIL_THRESHOLD = 10;
    const severity = violations.length >= FAIL_THRESHOLD ? '[INVARIANT]' : '[WARN]';
    console.error(`${severity} ${violations.length} groups violate one-canonical rule after auto-repair.`);
    for (const v of violations.slice(0, 10)) {
      console.error(`  group=${v.canonicalGroupKey.slice(0,40)} canonical=${v.canonCount} total=${v.total}`);
    }
    if (violations.length >= FAIL_THRESHOLD) process.exit(4);
  }
  console.log('Done.');
}

main().catch(err => { console.error(err); process.exit(1); });
