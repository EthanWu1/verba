#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const patterns = [/^hspolicy\d+.*\.zip$/i, /^hspf\d+.*\.zip$/i, /^hsld\d+.*\.zip$/i, /^ndt\d+.*\.zip$/i, /^ndca\d+.*\.zip$/i];

function isCaselistZip(name) { return patterns.some(r => r.test(name)); }

const zips = fs.readdirSync(ROOT).filter(isCaselistZip).sort();
console.log(`Found ${zips.length} caselist zips`);

for (let i = 0; i < zips.length; i++) {
  const zip = zips[i];
  const full = path.join(ROOT, zip);
  console.log(`[${i+1}/${zips.length}] importing ${zip}`);
  const t0 = Date.now();
  const r = spawnSync('node', ['--max-old-space-size=8192', 'scripts/import-zip.js', full, '500', '4', '--append'], { stdio: 'inherit', cwd: ROOT });
  const dt = ((Date.now()-t0)/1000).toFixed(1);
  if (r.status === 0) console.log(`  ok in ${dt}s`);
  else console.log(`  failed exit ${r.status} after ${dt}s`);
}
console.log('ALL DONE');
