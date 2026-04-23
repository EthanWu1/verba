#!/usr/bin/env node
'use strict';

/**
 * Download all yearly OpenEv.zip bundles from the Backblaze CDN to imports/.
 * After download, run `node scripts/import-zip.js <path>` per zip to ingest.
 *
 * Usage:
 *   node scripts/download-openev.js                # download all years 2013-2025
 *   node scripts/download-openev.js --year 2024    # single year
 *   node scripts/download-openev.js --no-import    # download only, skip import step
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { spawnSync } = require('child_process');

const BASE = 'https://caselist-files.s3.us-east-005.backblazeb2.com/openev/';
const IMPORTS_DIR = path.join(__dirname, '..', 'imports');
const YEARS = [2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];

const args = process.argv.slice(2);
const NO_IMPORT = args.includes('--no-import');
const SINGLE_YEAR = (() => { const i = args.indexOf('--year'); return i >= 0 ? Number(args[i + 1]) : null; })();

function humanMB(b) { return (b / 1024 / 1024).toFixed(1) + ' MB'; }

async function download(year) {
  const url = BASE + year + 'OpenEv.zip';
  const dest = path.join(IMPORTS_DIR, `openev-${year}.zip`);
  if (fs.existsSync(dest)) {
    const have = fs.statSync(dest).size;
    console.log(`  skipping ${year} — already have ${humanMB(have)}`);
    return dest;
  }
  console.log(`  downloading ${year}…`);
  const t0 = Date.now();
  const res = await axios.get(url, { responseType: 'stream', timeout: 300000, validateStatus: () => true });
  if (res.status !== 200) { console.log(`  ${year}: status ${res.status}, skipped`); return null; }
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(dest);
    res.data.pipe(out);
    out.on('finish', resolve);
    out.on('error', reject);
    res.data.on('error', reject);
  });
  const bytes = fs.statSync(dest).size;
  console.log(`  ${year}: ${humanMB(bytes)} in ${((Date.now()-t0)/1000).toFixed(1)}s → ${dest}`);
  return dest;
}

function importZip(zipPath, { append }) {
  console.log(`  importing ${path.basename(zipPath)}${append ? ' (append)' : ''}…`);
  const t0 = Date.now();
  const argv = ['scripts/import-zip.js', zipPath, '500', '4'];
  if (append) argv.push('--append');
  const r = spawnSync('node', argv, { stdio: 'inherit', cwd: path.join(__dirname, '..') });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  if (r.status === 0) console.log(`  imported in ${elapsed}s`);
  else console.log(`  import failed (exit ${r.status}) after ${elapsed}s`);
}

(async () => {
  if (!fs.existsSync(IMPORTS_DIR)) fs.mkdirSync(IMPORTS_DIR, { recursive: true });

  const yearsToDo = SINGLE_YEAR ? [SINGLE_YEAR] : YEARS;
  console.log('Years to process:', yearsToDo.join(', '));
  console.log('Imports dir:', IMPORTS_DIR);

  const paths = [];
  for (const y of yearsToDo) {
    const p = await download(y);
    if (p) paths.push(p);
  }

  if (NO_IMPORT) { console.log('Skipping import step (--no-import).'); return; }

  console.log('\nStarting imports…');
  for (let i = 0; i < paths.length; i++) importZip(paths[i], { append: i > 0 });
  console.log('\nAll done.');
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
