'use strict';

// Normalize a tabroom entry displayName.
// "Millard North Kyson Bloomingdale"  -> "Millard North KB"
// "Peninsula SU"                      -> "Peninsula SU"  (already short)
function shortenDisplayName(displayName, schoolName) {
  const name = String(displayName || '').trim();
  if (!name) return name;
  const school = String(schoolName || '').trim();
  if (!school) return name;

  // Only normalize when displayName begins with the full school name,
  // otherwise tabroom already gave us a short code.
  const schoolLow = school.toLowerCase();
  if (!name.toLowerCase().startsWith(schoolLow)) return name;

  const rest = name.slice(school.length).trim();
  if (!rest) return name;
  const words = rest.split(/\s+/);
  if (words.length < 2) return name; // "Peninsula SU" (rest="SU") — already short
  const initials = words.map(w => (w[0] || '').toUpperCase()).join('');
  if (!/^[A-Z]{2,6}$/.test(initials)) return name; // bail on odd data
  return `${school} ${initials}`;
}

function withShortenedName(row) {
  if (!row || typeof row !== 'object') return row;
  return { ...row, displayName: shortenDisplayName(row.displayName, row.schoolName) };
}

module.exports = { shortenDisplayName, withShortenedName };
