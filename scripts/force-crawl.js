'use strict';
process.chdir(__dirname + '/..');
const fs = require('fs');
const path = require('path');
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/i);
    if (m) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

const indexer = require('../server/services/wikiIndexer');
const db = require('../server/services/wikiDb');

(async () => {
  const ids = process.argv.slice(2);
  if (!ids.length) {
    console.log('usage: force-crawl.js <teamId> [teamId...]');
    process.exit(1);
  }
  for (const id of ids) {
    try {
      await indexer.crawlTeamDetail(id);
      const args = db.getTeamArguments(id);
      console.log(`${id}: ${args.length} args`);
      for (const a of args.slice(0, 5)) console.log(`  - [${a.side}] ${a.name}`);
    } catch (e) {
      console.log(`${id} ERR:`, e.message);
    }
  }
})().catch(e => { console.error(e); process.exit(1); });
