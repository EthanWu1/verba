const Database = require('better-sqlite3');
const db = new Database('server/data/library.db');
const total = db.prepare('SELECT COUNT(*) c FROM cards').get().c;
const canon = db.prepare("SELECT COUNT(*) c FROM cards WHERE isCanonical = 1").get().c;
const withGroup = db.prepare("SELECT COUNT(*) c FROM cards WHERE canonicalGroupKey IS NOT NULL AND canonicalGroupKey <> ''").get().c;
const groups = db.prepare("SELECT COUNT(DISTINCT canonicalGroupKey) c FROM cards WHERE canonicalGroupKey IS NOT NULL AND canonicalGroupKey <> ''").get().c;
const maxVar = db.prepare('SELECT MAX(variantCount) m FROM cards').get().m;
console.log({ total, canon, withGroup, groups, maxVar });

const dup = db.prepare(`
  SELECT shortCite, COUNT(*) c FROM cards
  WHERE shortCite IS NOT NULL AND shortCite <> ''
  GROUP BY LOWER(shortCite)
  HAVING c > 1
  ORDER BY c DESC
  LIMIT 10
`).all();
console.log('top duplicate shortCites:');
for (const d of dup) console.log(' ', d.c, '×', d.shortCite);
