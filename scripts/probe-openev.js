'use strict';
/**
 * Probe OpenCaseList openev/ directory for all available bulk zips.
 * Login → list caselists → HEAD each predicted bundle URL → tally size.
 * NO downloads; summary only.
 */
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Load .env
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/i);
    if (m) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

(async () => {
  const u = process.env.OPENCASELIST_USER;
  const p = process.env.OPENCASELIST_PASS;
  if (!u || !p) { console.error('Missing OPENCASELIST_USER/PASS in .env'); process.exit(1); }

  const loginRes = await axios.post('https://api.opencaselist.com/v1/login',
    { username: u, password: p, remember: true }, { timeout: 60000 });
  const cookie = (loginRes.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  const hdr = { headers: { Cookie: cookie }, timeout: 60000, validateStatus: () => true };

  const lists = (await axios.get('https://api.opencaselist.com/v1/caselists', hdr)).data;
  console.log('Total caselists:', Array.isArray(lists) ? lists.length : 'unknown');
  if (!Array.isArray(lists)) { console.log(JSON.stringify(lists).slice(0, 500)); return; }

  // Try openev directory index
  const idxPage = await axios.get('https://opencaselist.com/openev/', { headers: { Cookie: cookie }, timeout: 60000, validateStatus: () => true });
  const zipLinks = new Set();
  if (typeof idxPage.data === 'string') {
    for (const m of idxPage.data.matchAll(/href="([^"]+\.zip)"/gi)) zipLinks.add(m[1]);
  }
  console.log('openev/ index links found:', zipLinks.size);

  // If no directory index, enumerate by caselist name + recent "all-<date>" attempts for past N years
  // Known pattern: <caselistName>-all-YYYY-MM-DD.zip or <caselistName>-final.zip
  // We'll trust directory listing if present, else HEAD predictions.
  let bundles = [];
  if (zipLinks.size > 0) {
    for (const rel of zipLinks) {
      const url = 'https://opencaselist.com/openev/' + rel.replace(/^\/+/, '');
      bundles.push({ url, name: rel });
    }
  } else {
    console.log('(no directory listing — will HEAD predicted URLs)');
    for (const cl of lists) {
      const name = cl.name || cl.caselist || cl.slug;
      if (!name) continue;
      for (const suffix of ['-final.zip', '-all.zip']) {
        const url = `https://opencaselist.com/openev/${name}${suffix}`;
        bundles.push({ url, name: name + suffix });
      }
    }
  }

  console.log('Bundles to check:', bundles.length);
  let totalBytes = 0;
  let hits = 0;
  const results = [];
  for (const b of bundles) {
    const res = await axios.head(b.url, { headers: { Cookie: cookie }, timeout: 30000, validateStatus: () => true, maxRedirects: 5 });
    const len = Number(res.headers['content-length'] || 0);
    if (res.status === 200 && len > 0) {
      hits += 1;
      totalBytes += len;
      results.push({ url: b.url, name: b.name, bytes: len });
    }
  }
  results.sort((a, b) => b.bytes - a.bytes);

  const MB = 1024 * 1024;
  const GB = 1024 * MB;
  console.log('\nReachable bundles:', hits);
  console.log('Total size:', (totalBytes / GB).toFixed(2), 'GB');
  console.log('\nTop 30 by size:');
  for (const r of results.slice(0, 30)) {
    console.log(' ', (r.bytes / MB).toFixed(1).padStart(7), 'MB  ', r.name);
  }
  if (results.length > 30) console.log('  …and', results.length - 30, 'more');

  // Card-count rough estimate based on existing DB: hspolicy24-all-2025-05-06.zip has 66637 cards, and a typical "all" zip ~500MB (unverified).
  // Rough factor: ~130 cards per MB (very approximate).
  const approxCards = Math.round((totalBytes / MB) * 130);
  console.log('\nRough card count estimate (at ~130 cards/MB):', approxCards.toLocaleString());
})().catch(e => { console.error('Probe failed:', e.message); process.exit(1); });
