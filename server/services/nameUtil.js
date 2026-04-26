'use strict';

// Strip common school-type suffixes so "Memorial High School" → "Memorial",
// "The Quarry Lane School" → "The Quarry Lane".
function stripSchoolSuffix(schoolName) {
  return String(schoolName || '')
    .replace(/\s*\((?:Public|Charter|Magnet)\)\s*$/i, '')
    .replace(/\s+(?:High\s+School|HS|Senior\s+High|Junior\s+High|Middle\s+School|School|Academy|Prep|Preparatory|Magnet|Charter)\s*$/i, '')
    .trim();
}

// Normalize a tabroom/TOC entry displayName so it always reads
// "<SchoolBase> <CODE>".
//
// Handles:
//   "Millard North Kyson Bloomingdale" + "Millard North"            -> "Millard North KB"
//   "Memori EW"                        + "Memorial High School"     -> "Memorial EW"   (truncated prefix)
//   "Anna Dong"                        + "Memorial High School"     -> "Memorial AD"   (bare person name)
//   "Peninsula SU"                     + "Peninsula High School"    -> "Peninsula SU"  (already short)
//   "Lexington SD"                     + "Lexington HS"             -> "Lexington SD"  (already short)
function shortenDisplayName(displayName, schoolName) {
  const name = String(displayName || '').trim();
  if (!name) return name;
  const school = String(schoolName || '').trim();
  if (!school) return name;

  const schoolBase = stripSchoolSuffix(school) || school;

  // Case A: displayName starts with the full school name. Extract whatever
  // follows; if it's >=2 words, fold to initials. If it's already a short code
  // like "SU", keep it but anchor to the canonical schoolBase.
  const schoolLow = school.toLowerCase();
  if (name.toLowerCase().startsWith(schoolLow)) {
    const rest = name.slice(school.length).trim();
    if (!rest) return schoolBase;
    const words = rest.split(/\s+/);
    if (words.length >= 2) {
      const initials = words.map(w => (w[0] || '').toUpperCase()).join('');
      if (/^[A-Z]{2,6}$/.test(initials)) return `${schoolBase} ${initials}`;
    }
    return `${schoolBase} ${rest}`;
  }

  // Case B: displayName is a bare "First Last" (or up to 4 capitalized words)
  // with no school prefix at all. Convert to "<SchoolBase> <Initials>".
  if (/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}$/.test(name)) {
    const initials = name.split(/\s+/).map(w => w[0].toUpperCase()).join('').slice(0, 4);
    return `${schoolBase} ${initials}`;
  }

  // Case C: displayName ends with a 1–4 letter uppercase code but the prefix
  // is a truncated school ("Memori EW", "Strake J MS"). Replace the prefix
  // with the canonical schoolBase.
  const codeMatch = name.match(/^(.+\S)\s+([A-Z]{1,4})\s*$/);
  if (codeMatch) {
    return `${schoolBase} ${codeMatch[2]}`;
  }

  return name;
}

function withShortenedName(row) {
  if (!row || typeof row !== 'object') return row;
  return { ...row, displayName: shortenDisplayName(row.displayName, row.schoolName) };
}

module.exports = { shortenDisplayName, withShortenedName, stripSchoolSuffix };
