'use strict';

const db = require('../services/db');

const BANNED = new Set(['da', 'cp', 'k', 'theory', 'counterplan', 'kritik', 'disadvantage']);

function main() {
  const database = db.getDb();
  const rows = database.prepare('SELECT id, argumentTags FROM cards').all();
  const update = database.prepare('UPDATE cards SET argumentTags = ? WHERE id = ?');

  let changed = 0;
  const tx = database.transaction(() => {
    for (const row of rows) {
      let tags;
      try { tags = JSON.parse(row.argumentTags || '[]'); }
      catch { tags = []; }
      if (!Array.isArray(tags)) continue;
      const filtered = tags.filter(t => !BANNED.has(String(t || '').toLowerCase().trim()));
      if (filtered.length !== tags.length) {
        update.run(JSON.stringify(filtered), row.id);
        changed++;
      }
    }
  });
  tx();
  console.log(`[clean] stripped banned tokens from ${changed} cards`);
}

main();
