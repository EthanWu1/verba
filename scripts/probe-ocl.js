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
const axios = require('axios');

(async () => {
  const login = await axios.post('https://api.opencaselist.com/v1/login', {
    username: process.env.OPENCASELIST_USER,
    password: process.env.OPENCASELIST_PASS,
    remember: true,
  }, { timeout: 60000 });
  const cookie = (login.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  const hdr = { headers: { Cookie: cookie }, timeout: 60000, validateStatus: () => true };

  // Known team with args: 0-Yamily/JeWe1 at hsld25
  const tests = [
    ['hsld25', '0-Yamily', 'JeWe1'],
    ['hsld25', 'ADL', 'SeCh'],
    ['hspolicy25', 'AliefTaylor', 'MePe'],
  ];

  for (const [cl, sch, tm] of tests) {
    const base = `https://api.opencaselist.com/v1/caselists/${cl}/schools/${encodeURIComponent(sch)}/teams/${encodeURIComponent(tm)}`;
    const rounds = await axios.get(base + '/rounds', hdr);
    const cites  = await axios.get(base + '/cites', hdr);
    console.log(`${cl}/${sch}/${tm}: rounds=${Array.isArray(rounds.data)?rounds.data.length:rounds.status} cites=${Array.isArray(cites.data)?cites.data.length:cites.status}`);
    if (Array.isArray(rounds.data) && rounds.data.length) {
      console.log('  round[0] keys:', Object.keys(rounds.data[0]));
      console.log('  sample:', JSON.stringify(rounds.data[0]).slice(0, 600));
    }
    if (Array.isArray(cites.data) && cites.data.length) {
      console.log('  cite[0] keys:', Object.keys(cites.data[0]));
      console.log('  sample:', JSON.stringify(cites.data[0]).slice(0, 600));
    }
  }
})().catch(e => { console.error('FATAL:', e.response?.status, e.message); process.exit(1); });
