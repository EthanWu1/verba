'use strict';

// Single source of truth for the dedupe keys used by both the live importer
// (docxImport.js) and the offline migration (scripts/migrateFingerprints.js).
//
// Before this module existed the importer used a byte-exact sha1
// (lowercase + whitespace-collapsed) while the migration used a much
// looser NFKD-normalized form. Net effect on prod: the migration collapsed
// 20-way duplicate clusters down to 1 group, and then the very next docx
// import recreated the spread because its fingerprints didn't match the
// migrated rows. Always import this; do not re-derive these inline.

const crypto = require('crypto');

/**
 * Body fingerprint. Aggressive normalization so cosmetic differences
 * (smart quotes, em-dashes, stray punctuation, NFC vs NFD) collapse to one
 * key. Two cards with truly different bodies still differ in alphanumerics
 * — that's the survivable signal.
 */
function loosenedFingerprint(text) {
  const normalized = String(text || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')   // strip diacritics
    .replace(/[‘’‚‛]/g, "'")          // smart single quotes
    .replace(/[“”„‟]/g, '"')          // smart double quotes
    .replace(/[‐-―]/g, '-')                     // hyphens & dashes
    .replace(/[…]/g, '...')                          // ellipsis
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');                           // drop everything else
  return crypto.createHash('sha1').update(normalized).digest('hex');
}

/**
 * Author + 2-digit year for grouping. The original `normalizeShortCite`
 * worked when the cite matched a known regex shape but fell back to the
 * raw cite text — so different schools' formatting of the same author
 * (e.g. "Smith, John, 2024" vs "Smith 2024") landed in different groups.
 * This version is permissive in the regex and aggressive in the fallback.
 */
function loosenedShortCite(cite) {
  const value = String(cite || '').replace(/[‘’]/g, "'").trim();
  // Extract surname (first capitalized word) and a year token (2 or 4 digits)
  // INDEPENDENTLY so commas / middle initials / titles between them don't
  // matter. "Smith, John, 2024" → ("Smith", "24") same as "Smith 2024".
  const surnameMatch = value.match(/\b([A-Z][a-z][A-Za-z.\-]*)\b/);
  const yearMatch    = value.match(/'(\d{2})\b/) || value.match(/\b(\d{4})\b/) || value.match(/\b(\d{2})\b/);
  if (surnameMatch && yearMatch) {
    const yy = yearMatch[1].length === 4 ? yearMatch[1].slice(-2) : yearMatch[1];
    return `${surnameMatch[1].toLowerCase()} ${yy}`;
  }
  // No surname+year shape — collapse the cite to its alphanum prefix so
  // tiny formatting variants still cluster. 80 chars is plenty for an
  // author chunk; longer cites are usually decorations.
  return value
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

/**
 * Combined dedupe key. Empty string when either component is empty so the
 * caller can choose to fall back / skip.
 */
function groupKey({ body_plain, cite, shortCite }) {
  const fp = loosenedFingerprint(body_plain);
  const sc = loosenedShortCite(cite || shortCite || '');
  return sc && fp ? `${sc}::${fp}` : '';
}

module.exports = { loosenedFingerprint, loosenedShortCite, groupKey };
