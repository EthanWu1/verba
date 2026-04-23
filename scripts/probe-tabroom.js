'use strict';
process.chdir(__dirname + '/..');
const axios = require('axios');

(async () => {
  const tid = process.argv[2] || '35805';
  const res = await axios.get(`https://www.tabroom.com/api/download_data.mhtml?tourn_id=${tid}`, { timeout: 60000 });
  const j = res.data;
  console.log('name:', j.name, 'id:', j.id);
  console.log('categories:');
  for (const c of (j.categories || [])) {
    console.log(`  cat abbr=${c.abbr} name=${c.name} events=${(c.events || []).length}`);
    for (const e of (c.events || [])) {
      console.log(`    ev id=${e.id} abbr=${e.abbr || '-'} name="${e.name}" type=${e.type}`);
    }
  }
})().catch(e => { console.error(e.message); process.exit(1); });
