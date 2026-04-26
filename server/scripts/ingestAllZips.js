'use strict';

/**
 * Ingests every .zip in <project-root>/backfiles/ into SQLite. Re-running is
 * safe: the importer upserts on (sourceEntry, contentFingerprint) so existing
 * rows get their cite/body_markdown updated WITHOUT clobbering enrichment
 * fields (typeLabel/topicLabel/etc.) — see upsertCards in services/db.js.
 *
 * Usage:
 *   node server/scripts/ingestAllZips.js
 *
 * Optional: pass a folder path to override the default:
 *   node server/scripts/ingestAllZips.js /path/to/zips
 */

const fs = require('fs');
const path = require('path');
const { importZipToLibrary } = require('../services/docxImport');

const ROOT = path.resolve(__dirname, '..', '..');
const FOLDER = process.argv[2] || path.join(ROOT, 'backfiles');

function collectZips(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectZips(full));
    else if (entry.isFile() && /\.zip$/i.test(entry.name)) out.push(full);
  }
  return out;
}

async function main() {
  const zips = collectZips(FOLDER);
  console.log(`[ingest] Folder: ${FOLDER}`);
  console.log(`[ingest] Found ${zips.length} .zip file(s)`);

  let totalNew = 0;
  let totalDocs = 0;
  const t0all = Date.now();

  for (const zipPath of zips) {
    const zipName = path.basename(zipPath);
    console.log(`\n[ingest] START: ${zipName}`);
    const t0 = Date.now();
    try {
      const result = await importZipToLibrary(zipPath);
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      totalNew  += result.newCards || 0;
      totalDocs += result.processedDocs || 0;
      console.log(`[ingest] DONE: ${zipName} — ${result.newCards} new/updated cards, ${result.processedDocs} docs (${elapsed}s)`);
    } catch (err) {
      console.error(`[ingest] ERROR on ${zipName}: ${err.message}`);
    }
  }

  const totalSec = ((Date.now() - t0all) / 1000).toFixed(1);
  console.log(`\n[ingest] All ZIPs processed. ${totalNew} cards across ${totalDocs} docs in ${totalSec}s.`);
}

main();
