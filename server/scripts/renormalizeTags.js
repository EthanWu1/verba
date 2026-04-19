'use strict';
// Re-runs normalizeTag() over every card's tag field in the library.
// Usage: node server/scripts/renormalizeTags.js [--dry]
// Reads only (id, tag) and writes only tag — avoids loading full card rows
// and avoids triggering vector re-upsert.

const db = require('../services/db');
const { normalizeTag } = require('../services/docxImport');

const DRY = process.argv.includes('--dry');

function main() {
  const sqlite = db.getDb();
  const rows = sqlite.prepare('SELECT id, tag FROM cards').all();
  const updates = [];
  const preview = [];
  for (const r of rows) {
    const before = r.tag;
    if (!before) continue;
    const after = normalizeTag(before);
    if (after !== before) {
      updates.push({ id: r.id, tag: after });
      if (preview.length < 20) preview.push({ id: r.id, before, after });
    }
  }
  console.log(`Scanned ${rows.length} cards. ${updates.length} tags would change.`);
  for (const p of preview) {
    console.log(`  [${p.id}]`);
    console.log(`    - ${JSON.stringify(p.before)}`);
    console.log(`    + ${JSON.stringify(p.after)}`);
  }
  if (DRY) {
    console.log('\n(dry run — no writes)');
    return;
  }
  if (!updates.length) return;
  const stmt = sqlite.prepare('UPDATE cards SET tag = ? WHERE id = ?');
  const tx = sqlite.transaction((items) => {
    for (const u of items) stmt.run(u.tag, u.id);
  });
  tx(updates);
  console.log(`\nWrote ${updates.length} tag updates.`);
}

main();
