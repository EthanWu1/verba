'use strict';
// Standalone replica of normalizeTag for smoke testing, kept in sync with server/services/docxImport.js.
let ENGLISH_WORDS = new Set();
try { ENGLISH_WORDS = new Set(require('an-array-of-english-words')); } catch (_) {}

const META_COMMENTARY_PATTERNS = [
  /\btheir\s+\w[\w\s]*?\s+is\s+(wrong|bad|false|incorrect|flawed|misleading|outdated)\b/gi,
  /\bthey\s+(misunderstood|misread|miscut|misuse|misconstrue|misrepresent|mis\w+)\b/gi,
  /\btheir\s+(author|ev(idence)?|card|cite|source|tag)\s+(says|is|doesn'?t|cuts?)\b/gi,
  /\bopponent'?s?\s+\w[\w\s]*?\s+(fails?|is wrong|misses?)\b/gi,
  /\b(no|non-?)\s*unique(ness)?\b/gi,
];

function normalizeTag(tag) {
  if (!tag) return tag;
  let result = String(tag);
  for (const p of META_COMMENTARY_PATTERNS) result = result.replace(p, '');
  result = result.replace(/[ \t]{2,}/g, ' ').trim();
  result = result.replace(/\s+([.,;:!?])/g, '$1');
  result = result.replace(/\s+--\s+/g, ' — ');
  result = result.replace(/^[\s\-—,;:]+|[\s\-—,;:]+$/g, '').trim();
  result = result.replace(/^\s*\d+\s*[.\])\-—:]+\s*/g, '');
  result = result.replace(/^\s*T\s*[:\-—]+\s*/i, '');
  result = result.replace(/^\s*[A-Za-z]\s*[.\])\-—:]\s+/, '');
  result = result.replace(/^\s*[*+]+\s*/g, '');
  result = result.replace(/\s+---\s*/g, '---');
  result = result.replace(/\s+—/g, '—');
  if (ENGLISH_WORDS && ENGLISH_WORDS.size) {
    result = result.replace(/(^|[^A-Za-z\u2019'’])([a-zA-Z])\s+([a-zA-Z]{2,})\b/g, (m, pre, letter, rest) => {
      const merged = (letter + rest).toLowerCase();
      if (ENGLISH_WORDS.has(merged) && !['a', 'i'].includes(letter.toLowerCase())) return pre + letter + rest;
      return m;
    });
    result = result.replace(/\b([a-zA-Z]{2,})\s+([a-zA-Z])(?=$|[^A-Za-z\u2019'’])/g, (m, body, letter) => {
      const merged = (body + letter).toLowerCase();
      if (ENGLISH_WORDS.has(merged) && !['a', 'i'].includes(letter.toLowerCase())) return body + letter;
      return m;
    });
  }
  result = result.replace(/[ \t]{2,}/g, ' ');
  result = result.replace(/^\s+/, '');
  if (result.length) result = result[0].toUpperCase() + result.slice(1);
  return result || tag;
}

const cases = [
  '1. China will rise',
  '2] Arms race',
  '3) plan good',
  '4--- heg',
  'A] Aff gets perms',
  'B: contention',
  'b) extinction',
  'T: Topicality VI',
  'T--- Spec good',
  '  extinction outweighs',
  'd omain',
  'a cat',
  'b elief system',
  'Apple pie',
  'i think therefore',
  "It’s an epistemic constraint",
  "It's an apple",
  "don't do it",
  '* bullet tag',
  '+ plus prefix',
  'heg good --- extinction',
  'impact ---turns',
  'nuke war —extinction',
  'l egal framework',
  'realisti c threat',
  'Con stitutional crisis',
];
for (const c of cases) console.log(JSON.stringify(c), '=>', JSON.stringify(normalizeTag(c)));
