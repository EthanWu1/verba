'use strict';

/**
 * Ingests all ZIPs in the project root into SQLite, then deletes them.
 * Usage: node server/scripts/ingestAllZips.js
 */

const fs = require('fs');
const path = require('path');
const { importZipToLibrary } = require('../services/docxImport');

const ROOT = path.resolve(__dirname, '..', '..');

const ZIPS = [
  'hspf25-weekly-2026-01-20.zip',
  'hspf25-weekly-2026-03-17.zip',
  'hspf25-weekly-2026-03-24.zip',
  'hspf25-weekly-2026-04-07.zip',
  'hspf25-weekly-2026-04-14.zip',
  'hspolicy24-all-2025-05-06.zip',
  'hsld25-all-2026-04-14.zip',
  'ndtceda25-all-2026-04-14.zip',
].filter(name => fs.existsSync(path.join(ROOT, name)));

async function main() {
  console.log(`[ingest] Found ${ZIPS.length} ZIPs to process`);

  for (const zipName of ZIPS) {
    const zipPath = zipName; // importZipToLibrary resolves relative to project root
    console.log(`\n[ingest] START: ${zipName}`);
    const t0 = Date.now();
    try {
      const result = await importZipToLibrary(zipPath);
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`[ingest] DONE: ${zipName} — ${result.newCards} new cards, ${result.analyticsCount} analytics, ${result.processedDocs} docs (${elapsed}s)`);

      fs.unlinkSync(path.join(ROOT, zipName));
      console.log(`[ingest] DELETED: ${zipName}`);
    } catch (err) {
      console.error(`[ingest] ERROR on ${zipName}: ${err.message}`);
    }
  }

  console.log('\n[ingest] All ZIPs processed.');
}

main();
