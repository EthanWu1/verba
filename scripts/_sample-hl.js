const Database = require('better-sqlite3');
const db = new Database('server/data/library.db');

function countEq(md) { return (String(md||'').match(/==([\s\S]+?)==/g) || []).length; }
function countU(md)  { return (String(md||'').match(/<u\b/gi) || []).length; }
function countHl(md) { return (String(md||'').match(/class="[^"]*\bhl\b/gi) || []).length; }
function countMark(md){return (String(md||'').match(/<mark\b/gi) || []).length; }

let total=0, hasEq=0, hasU=0, hasHl=0, hasMark=0, noneAll=0;
const sample=[];
const iter = db.prepare('SELECT id, shortCite, body_markdown FROM cards LIMIT 20000').iterate();
for (const r of iter) {
  total++;
  const eq=countEq(r.body_markdown), u=countU(r.body_markdown), hl=countHl(r.body_markdown), mk=countMark(r.body_markdown);
  if (eq) hasEq++;
  if (u) hasU++;
  if (hl) hasHl++;
  if (mk) hasMark++;
  if (!eq && !u && !hl && !mk) noneAll++;
  if (sample.length < 3 && r.body_markdown) sample.push({ id:r.id, cite:r.shortCite, snippet:(r.body_markdown||'').slice(0,400) });
}
console.log({ total, hasEq, hasU, hasHl, hasMark, noneAll });
console.log('\n--- samples ---');
for (const s of sample) { console.log(`\n[${s.cite}]`); console.log(s.snippet); }
