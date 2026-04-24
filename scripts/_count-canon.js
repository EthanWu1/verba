const D = require('better-sqlite3');
const db = new D('c:/Users/ethan/OneDrive/Desktop/verba/server/data/library.db', { readonly: true });
const r = db.prepare("SELECT COUNT(*) AS n FROM cards WHERE isCanonical=1 AND body_markdown LIKE '%==%'").get();
const t = db.prepare("SELECT COUNT(*) AS n FROM cards WHERE isCanonical=1").get();
console.log('canonical total:', t.n);
console.log('canonical + highlighted:', r.n);
