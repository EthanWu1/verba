'use strict';

// Recomputes contentFingerprint and canonicalGroupKey for every card using
// a stricter normalization than the original sha1(lowercase + ws-collapsed).
// Original was byte-exact: a stray comma, a smart quote, an em-dash, a single
// extra word — anything — yielded a different fingerprint, so 20 near-identical
// copies of a card each became "canonical of a group of 1" and the
// isCanonical=1 filter stopped helping.
//
// New normalization:
//   NFKD → strip diacritics → smart quotes/dashes → ASCII →
//   lowercase → drop EVERY non-alphanumeric character → sha1.
//
// Defaults to dry-run. Use --commit to actually mutate the DB.
//
// Usage:
//   node server/scripts/migrateFingerprints.js               # dry-run
//   node server/scripts/migrateFingerprints.js --commit      # mutate
//   node server/scripts/migrateFingerprints.js --commit --no-recanon
//
// Sister script indexCardsVec.js should be re-run AFTER this so the vec
// table only carries embeddings for the (now smaller) canonical set.

require('dotenv').config({
  path: process.env.DOTENV_CONFIG_PATH
    || require('path').resolve(__dirname, '../../.env'),
});

const dbModule = require('../services/db');
const { loosenedFingerprint, loosenedShortCite, groupKey: newGroupKey } = require('../services/fingerprint');

const argv = process.argv.slice(2);
const COMMIT = argv.includes('--commit');
const SKIP_RECANON = argv.includes('--no-recanon');

async function main() {
  const db = dbModule.getDb();
  const total = db.prepare('SELECT COUNT(*) AS n FROM cards').get().n;
  const oldCanonical = db.prepare('SELECT COUNT(*) AS n FROM cards WHERE isCanonical = 1').get().n;
  const oldGroups = db.prepare(`
    SELECT COUNT(DISTINCT canonicalGroupKey) AS n
    FROM cards
    WHERE canonicalGroupKey IS NOT NULL AND canonicalGroupKey != ''
  `).get().n;

  console.log(`Total cards:         ${total}`);
  console.log(`Old canonical rows:  ${oldCanonical}`);
  console.log(`Old distinct groups: ${oldGroups}`);
  console.log(`Mode:                ${COMMIT ? 'COMMIT (will mutate)' : 'DRY-RUN'}`);

  // Stream rows in batches so we don't pull the full 24GB body_plain into RAM.
  const PAGE = Number(process.env.MIGRATE_PAGE) || 5000;
  const select = db.prepare(`
    SELECT id, body_plain, cite, shortCite, contentFingerprint, canonicalGroupKey
    FROM cards
    ORDER BY rowid ASC
    LIMIT ? OFFSET ?
  `);

  // Sample first → measure collapse before mutating.
  const sample = db.prepare(`
    SELECT id, body_plain, cite, shortCite
    FROM cards
    ORDER BY rowid ASC
    LIMIT 20000
  `).all();
  const sampleNewGroups = new Set();
  for (const r of sample) {
    const k = newGroupKey(r);
    if (k) sampleNewGroups.add(k);
  }
  const projectedRatio = sampleNewGroups.size / sample.length;
  const projectedNewGroups = Math.round(total * projectedRatio);
  console.log(`Sample (${sample.length} rows): ${sampleNewGroups.size} groups → projected total: ~${projectedNewGroups}`);
  console.log(`Projected canonical reduction: ${oldCanonical} → ~${projectedNewGroups} (${((1 - projectedNewGroups / Math.max(1, oldCanonical)) * 100).toFixed(1)}%)`);

  if (!COMMIT) {
    console.log('\nDry-run complete. Re-run with --commit to mutate.');
    return;
  }

  // Confirm the projection didn't just collapse everything to 1 group
  // (would mean my normalization is too aggressive — bail out).
  if (projectedNewGroups < total * 0.005) {
    console.error('\nABORT: projected groups <0.5% of rows — normalization is too aggressive.');
    process.exit(2);
  }

  console.log('\nUpdating fingerprints...');
  const update = db.prepare(`
    UPDATE cards SET contentFingerprint = ?, canonicalGroupKey = ? WHERE id = ?
  `);
  const tx = db.transaction(rows => {
    for (const r of rows) {
      const fp = loosenedFingerprint(r.body_plain);
      const sc = loosenedShortCite(r.cite || r.shortCite || '');
      const gk = sc && fp ? `${sc}::${fp}` : '';
      update.run(fp, gk, r.id);
    }
  });

  let processed = 0;
  let offset = 0;
  const startedAt = Date.now();
  while (processed < total) {
    const rows = select.all(PAGE, offset);
    if (!rows.length) break;
    tx(rows);
    processed += rows.length;
    offset += rows.length;
    const elapsed = (Date.now() - startedAt) / 1000;
    const rate = processed / Math.max(1, elapsed);
    process.stdout.write(`  ${processed}/${total} (${rate.toFixed(0)}/s, ${elapsed.toFixed(0)}s)\r`);
  }
  console.log(`\nFingerprint update done. ${processed} rows updated.`);

  if (SKIP_RECANON) {
    console.log('--no-recanon: skipping canonical re-election. Run db.recanonicalizeGroups manually.');
    return;
  }

  console.log('Re-electing canonicals (this scans all groups)...');
  // Pull the post-migration group key set in one pass — recanonicalizeGroups
  // batches in chunks of 450 so passing all keys at once is fine.
  const groupKeys = db.prepare(`
    SELECT DISTINCT canonicalGroupKey
    FROM cards
    WHERE canonicalGroupKey IS NOT NULL AND canonicalGroupKey != ''
  `).all().map(r => r.canonicalGroupKey);
  console.log(`  ${groupKeys.length} distinct groups → recanonicalizing`);
  dbModule.recanonicalizeGroups(groupKeys);

  const newCanonical = db.prepare('SELECT COUNT(*) AS n FROM cards WHERE isCanonical = 1').get().n;
  console.log(`\nDone. Canonical rows: ${oldCanonical} → ${newCanonical}`);
}

main().catch(err => { console.error(err); process.exit(1); });
