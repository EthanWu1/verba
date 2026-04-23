#!/usr/bin/env node
'use strict';

// Offline batch embedding job. Run manually:
//   node scripts/embed-library.js             (incremental, skip already-embedded unchanged)
//   node scripts/embed-library.js --force     (re-embed everything)
//   node scripts/embed-library.js --limit=500 (cap rows processed)

process.chdir(__dirname + '/..');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/i);
    if (m) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

const { getDb } = require('../server/services/db');
const { ensureSchema, upsertEmbedding, alreadyEmbedded } = require('../server/services/semanticIndex');
const { embedTexts } = require('../server/services/embedder');

const FORCE = process.argv.includes('--force');
const LIMIT_ARG = process.argv.find(a => a.startsWith('--limit='));
const LIMIT = LIMIT_ARG ? Number(LIMIT_ARG.split('=')[1]) : 0;

function extractHighlights(bodyMarkdown) {
  if (!bodyMarkdown) return '';
  // Pull every ==highlighted== span, joined. If none, return empty.
  const spans = [];
  const re = /==([^=]+)==/g;
  let m;
  while ((m = re.exec(bodyMarkdown)) !== null) spans.push(m[1].trim());
  return spans.join(' ').replace(/\s+/g, ' ').trim();
}

function hashText(t) {
  return crypto.createHash('sha256').update(t).digest('hex').slice(0, 24);
}

async function main() {
  ensureSchema();
  const db = getDb();

  // Only cards with non-empty highlights. Skip raw imports that never got cut.
  let rows = db.prepare(`
    SELECT rowid AS rowid, id, body_markdown
    FROM cards
    WHERE body_markdown IS NOT NULL
      AND body_markdown LIKE '%==%'
  `).all();

  if (LIMIT > 0) rows = rows.slice(0, LIMIT);

  // Extract highlights; dedupe by highlight hash (skip duplicate highlight strings across cards)
  const seenHash = new Set();
  const queue = [];
  for (const r of rows) {
    const hl = extractHighlights(r.body_markdown);
    if (hl.length < 20) continue;       // skip near-empty highlights
    const h = hashText(hl);
    if (seenHash.has(h)) continue;      // skip exact highlight duplicate (same text → same embedding)
    seenHash.add(h);
    if (!FORCE && alreadyEmbedded(r.rowid, h)) continue;
    queue.push({ rowid: r.rowid, id: r.id, text: hl, hash: h });
  }

  console.log(`[embed] ${rows.length} highlighted cards · ${queue.length} need embedding (force=${FORCE})`);

  const BATCH = 64;
  let done = 0;
  let t0 = Date.now();
  for (let i = 0; i < queue.length; i += BATCH) {
    const chunk = queue.slice(i, i + BATCH);
    try {
      const vecs = await embedTexts(chunk.map(c => c.text));
      const tx = db.transaction(() => {
        for (let j = 0; j < chunk.length; j++) {
          if (!vecs[j]) continue;
          upsertEmbedding(chunk[j].rowid, chunk[j].hash, vecs[j]);
        }
      });
      tx();
      done += chunk.length;
      const elapsed = (Date.now() - t0) / 1000;
      const rate = done / elapsed;
      const eta = (queue.length - done) / Math.max(rate, 0.01);
      console.log(`[embed] ${done}/${queue.length}  rate=${rate.toFixed(1)}/s  eta=${Math.round(eta)}s`);
    } catch (err) {
      console.error(`[embed] batch ${i} failed:`, err.message);
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  console.log(`[embed] done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch(err => { console.error(err); process.exit(1); });
