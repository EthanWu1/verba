'use strict';
const axios = require('axios');

(async () => {
  const tid = process.argv[2] || '35805';
  const res = await axios.get(`https://www.tabroom.com/api/download_data.mhtml?tourn_id=${tid}`, { timeout: 60000 });
  const j = res.data;
  console.log('tournament:', j.name);
  let totalBallots = 0;
  let byEvent = {};
  for (const cat of (j.categories || [])) {
    for (const ev of (cat.events || [])) {
      if (ev.type !== 'debate') continue;
      let n = 0;
      let rounds = (ev.rounds || []).length;
      for (const r of (ev.rounds || [])) {
        for (const s of (r.sections || [])) {
          n += (s.ballots || []).length;
        }
      }
      byEvent[ev.name] = { rounds, ballots: n };
      totalBallots += n;
    }
  }
  console.log('events:', byEvent);
  console.log('totalBallots:', totalBallots);
  // Show a sample ballot
  for (const cat of (j.categories || [])) {
    for (const ev of (cat.events || [])) {
      if (ev.type !== 'debate') continue;
      const firstRound = (ev.rounds || [])[0];
      const firstSec = firstRound && firstRound.sections && firstRound.sections[0];
      const firstBallot = firstSec && firstSec.ballots && firstSec.ballots[0];
      if (firstBallot) {
        console.log('sample ballot keys:', Object.keys(firstBallot));
        console.log('sample ballot:', JSON.stringify(firstBallot).slice(0, 500));
        return;
      }
    }
  }
})().catch(e => { console.error(e.message); process.exit(1); });
