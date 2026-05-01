'use strict';

// Read-only sanity check for the fingerprint migration. Computes the
// projected post-migration canonical count for the subset that actually
// shows up in the library UI (canonical + highlighted + non-empty tag +
// minHighlight 6) — that's the number the user will see, not the raw
// distinct-group count.

require('dotenv').config({
  path: process.env.DOTENV_CONFIG_PATH
    || require('path').resolve(__dirname, '../../.env'),
});

const crypto = require('crypto');
const dbModule = require('../services/db');

function loosenedFingerprint(text) {
  const normalized = String(text || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[‐-―]/g, '-')
    .replace(/[…]/g, '...')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  return crypto.createHash('sha1').update(normalized).digest('hex');
}

function loosenedShortCite(cite) {
  const value = String(cite || '').replace(/[‘’]/g, "'").trim();
  const m = value.match(/([A-Z][A-Za-z.\-]+)\s*(?:'|\s)(\d{2})\b/)
         || value.match(/([A-Z][A-Za-z.\-]+)\s+(\d{2}|\d{4})\b/);
  if (m) {
    const yy = m[2].length === 4 ? m[2].slice(-2) : m[2];
    return `${m[1].toLowerCase()} ${yy}`;
  }
  return value.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 80);
}

const db = dbModule.getDb();

const totalAll = db.prepare('SELECT COUNT(*) AS n FROM cards').get().n;
const visibleNow = db.prepare(`
  SELECT COUNT(*) AS n FROM cards
  WHERE isCanonical = 1
    AND hasHighlight = 1
    AND highlightWordCount >= 6
    AND tag IS NOT NULL AND TRIM(tag) != ''
`).get().n;
const eligibleAll = db.prepare(`
  SELECT COUNT(*) AS n FROM cards
  WHERE hasHighlight = 1
    AND highlightWordCount >= 6
    AND tag IS NOT NULL AND TRIM(tag) != ''
    AND cite IS NOT NULL AND TRIM(cite) != ''
`).get().n;

console.log(`Total cards in DB:                 ${totalAll}`);
console.log(`Currently visible (canonical+HL):  ${visibleNow}`);
console.log(`Eligible (HL+tag+cite, all rows):  ${eligibleAll}`);

// Count distinct groups under the NEW fingerprint, restricted to eligible rows.
console.log(`\nStreaming distinct group count over eligible rows...`);
const select = db.prepare(`
  SELECT body_plain, cite, shortCite
  FROM cards
  WHERE hasHighlight = 1
    AND highlightWordCount >= 6
    AND tag IS NOT NULL AND TRIM(tag) != ''
    AND cite IS NOT NULL AND TRIM(cite) != ''
  ORDER BY rowid ASC
  LIMIT ? OFFSET ?
`);

const PAGE = 5000;
let offset = 0;
let processed = 0;
const groups = new Set();
const startedAt = Date.now();
while (processed < eligibleAll) {
  const rows = select.all(PAGE, offset);
  if (!rows.length) break;
  for (const r of rows) {
    const fp = loosenedFingerprint(r.body_plain);
    const sc = loosenedShortCite(r.cite || r.shortCite || '');
    const key = sc && fp ? `${sc}::${fp}` : '';
    if (key) groups.add(key);
  }
  processed += rows.length;
  offset += rows.length;
  if (processed % 50000 === 0 || processed === eligibleAll) {
    const elapsed = (Date.now() - startedAt) / 1000;
    process.stdout.write(`  ${processed}/${eligibleAll} (${groups.size} unique so far, ${(processed / Math.max(1, elapsed)).toFixed(0)}/s)\r`);
  }
}
console.log(`\n\nProjected POST-MIGRATION canonical+visible: ${groups.size}`);
console.log(`Currently visible:                          ${visibleNow}`);
console.log(`Delta:                                      ${groups.size - visibleNow > 0 ? '+' : ''}${groups.size - visibleNow}`);
console.log(`Avg copies per unique evidence:             ${(eligibleAll / Math.max(1, groups.size)).toFixed(2)}`);

// Also count what body-only (no cite) would do, for comparison.
console.log(`\n--- Alt: body-only fingerprint (drop cite from key) ---`);
offset = 0;
processed = 0;
const bodyGroups = new Set();
while (processed < eligibleAll) {
  const rows = select.all(PAGE, offset);
  if (!rows.length) break;
  for (const r of rows) {
    const fp = loosenedFingerprint(r.body_plain);
    if (fp) bodyGroups.add(fp);
  }
  processed += rows.length;
  offset += rows.length;
}
console.log(`Body-only unique:                          ${bodyGroups.size}`);
console.log(`Avg copies per unique body:                ${(eligibleAll / Math.max(1, bodyGroups.size)).toFixed(2)}`);
