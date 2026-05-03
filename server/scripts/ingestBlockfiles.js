#!/usr/bin/env node
/**
 * ingestBlockfiles.js
 *
 * Walks a curated manifest of Verbatim DOCX blockfiles and emits a JSONL
 * corpus of "blocks" (heading-anchored response units containing cards
 * + analytic prose, in original order). Output feeds analyzeBlockfiles.js,
 * which mines patterns that get baked into HARDCODED_CHAT_PATTERNS for the
 * chat prompt.
 *
 * Parallel to analyzeLibraryCards.js (corpus-stats helper for cardCutter).
 *
 * Usage:
 *   node server/scripts/ingestBlockfiles.js
 *     [--manifest=server/data/blockfile-manifest.json]
 *     [--out=server/data/blockfile-corpus.jsonl]
 *     [--limit=10]   # process only first N files (debug)
 *     [--category=k] # process only one category
 *     [--verbose]
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const JSZip = require('jszip');

const {
  extractParagraphs,
  parseCardsFromParagraphs,
  isAnalyticHeader,
  isHeading,
  looksLikeCite,
  looksLikeTag,
} = require('../services/docxImport');

// ── CLI ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (k, fallback) => {
  const m = args.find(a => a.startsWith(`--${k}=`));
  return m ? m.slice(k.length + 3) : fallback;
};
const has = k => args.includes(`--${k}`);

const MANIFEST  = flag('manifest', path.resolve(__dirname, '../data/blockfile-manifest.json'));
const OUT       = flag('out', path.resolve(__dirname, '../data/blockfile-corpus.jsonl'));
const LIMIT     = flag('limit', null);
const CATEGORY  = flag('category', null);
const VERBOSE   = has('verbose');

const MIN_BLOCK_CHARS = 80;   // skip empty/trivial blocks (just a heading)

// ── DOCX → paragraphs ────────────────────────────────────────────────────
async function readDocxParagraphs(filePath) {
  const buf = fs.readFileSync(filePath);
  const zip = await JSZip.loadAsync(buf);
  const docEntry = zip.file('word/document.xml');
  if (!docEntry) throw new Error(`word/document.xml missing in ${filePath}`);
  const xml = await docEntry.async('string');
  return extractParagraphs(xml);
}

// ── Block segmentation ───────────────────────────────────────────────────
//
// A "block" is a heading-anchored chunk of paragraphs. We walk the paragraph
// stream and split whenever we cross a heading-style paragraph (Heading1-3,
// "hat", "block", "pocket"). Within a block we collect:
//   - cards (parsed via parseCardsFromParagraphs over the block's paragraphs)
//   - analytic prose chunks (paragraphs introduced by an analytic header
//     marker like "AT - …", "1] NL", "OV —", etc., extending until the next
//     non-body paragraph)
//
// This is intentionally lossy on tag/cite vs analytic separation — the goal
// is pattern mining, not card reconstruction. The cardCutter pipeline is
// authoritative for cards; this just gives the analyzer the raw material it
// needs to identify recurring phrasings, structural templates, and move
// taxonomy across thousands of blocks.

function segmentParagraphsIntoBlocks(paragraphs) {
  const blocks = [];
  const headingPath = ['', '', '']; // h1, h2, h3
  let buffer = [];

  const flush = () => {
    if (buffer.length === 0) return;
    const trimmedPath = headingPath.filter(Boolean);
    const totalText = buffer.map(p => p.text).join(' ').trim();
    if (totalText.length >= MIN_BLOCK_CHARS) {
      blocks.push({ heading_path: [...trimmedPath], paragraphs: buffer });
    }
    buffer = [];
  };

  for (const p of paragraphs) {
    const style = String(p.style || '');
    const headingMatch = /^Heading([1-3])$/i.exec(style);
    if (headingMatch) {
      flush();
      const level = Number(headingMatch[1]);
      headingPath[level - 1] = p.text;
      // clear deeper levels
      for (let j = level; j < headingPath.length; j++) headingPath[j] = '';
      continue;
    }
    // 'hat' / 'block' / 'pocket' styles — treat as section breaks but keep
    // the heading text rolled into the path's deepest non-empty slot.
    if (['hat', 'block', 'pocket'].includes(style.toLowerCase())) {
      flush();
      const idx = headingPath.findIndex(s => !s);
      headingPath[idx === -1 ? headingPath.length - 1 : idx] = p.text;
      continue;
    }
    buffer.push(p);
  }
  flush();
  return blocks;
}

// Extract analytic chunks from a block's paragraphs.
// An analytic chunk = a paragraph whose first line matches isAnalyticHeader,
// plus subsequent body-ish paragraphs until we hit a tag, cite, or another
// analytic header. The marker is the trigger paragraph's leading token.
function extractAnalytics(paragraphs) {
  const out = [];
  let i = 0;
  while (i < paragraphs.length) {
    const p = paragraphs[i];
    const text = String(p.text || '').trim();
    if (!isAnalyticHeader(text)) { i++; continue; }

    // capture marker = the analytic header (everything up to the colon/dash)
    const markerMatch = text.match(/^([^—–\-:]{1,40})[—–\-:]/);
    const marker = (markerMatch ? markerMatch[1] : text.slice(0, 40)).trim();

    const body = [p.markdown || p.text];
    let j = i + 1;
    while (j < paragraphs.length) {
      const q = paragraphs[j];
      const qtext = String(q.text || '').trim();
      if (!qtext) { j++; continue; }
      if (isAnalyticHeader(qtext)) break;
      const next = paragraphs[j + 1];
      if (looksLikeTag(q, next)) break;
      if (looksLikeCite(q)) break;
      if (isHeading(q)) break;
      body.push(q.markdown || q.text);
      j++;
    }
    out.push({ marker, text: body.join('\n\n') });
    i = j;
  }
  return out;
}

// ── Per-file pipeline ────────────────────────────────────────────────────
async function ingestFile(filePath, category, fileIndex) {
  const paragraphs = await readDocxParagraphs(filePath);
  if (!paragraphs.length) {
    if (VERBOSE) console.log(`  [skip] no paragraphs: ${path.basename(filePath)}`);
    return [];
  }

  const blocks = segmentParagraphsIntoBlocks(paragraphs);
  const fileBasename = path.basename(filePath, '.docx');
  const fileHash = crypto.createHash('sha1').update(filePath).digest('hex').slice(0, 8);

  const records = [];
  for (let bi = 0; bi < blocks.length; bi++) {
    const block = blocks[bi];

    // Reuse the cardCutter parser. zipPath/entryPath are dummies — only used
    // for ID hashing, not for retrieval here.
    const cards = parseCardsFromParagraphs(block.paragraphs, filePath, filePath)
      .map(c => ({
        tag: c.tag,
        cite: c.cite,
        shortCite: c.shortCite,
        body_plain: c.body_plain,
        body_markdown: c.body_markdown,
        argumentTypes: c.argumentTypes,
        argumentTags: c.argumentTags,
      }));
    const analytics = extractAnalytics(block.paragraphs);
    // Always preserve the raw block prose. Some blockfiles (esp. theory
    // shells like Condo, NRT Bad) are free-form analytic paragraphs under
    // a heading with no AT:/1]/OV— marker — extractAnalytics misses those,
    // but the prose IS the block we want to mine.
    const bodyText = block.paragraphs.map(p => p.text).join('\n').trim();
    const bodyMarkdown = block.paragraphs.map(p => p.markdown || p.text).join('\n\n').trim();

    // Drop only if we have nothing usable.
    if (cards.length === 0 && analytics.length === 0 && bodyText.length < MIN_BLOCK_CHARS) continue;

    const blockId = crypto.createHash('sha1')
      .update(`${filePath}|${bi}|${block.heading_path.join('>')}`)
      .digest('hex')
      .slice(0, 16);

    records.push({
      block_id: blockId,
      file: fileBasename,
      file_hash: fileHash,
      category,
      heading_path: block.heading_path,
      n_cards: cards.length,
      n_analytics: analytics.length,
      n_chars: bodyText.length,
      cards,
      analytics,
      body_text: bodyText,
      body_markdown: bodyMarkdown,
    });
  }
  return records;
}

// ── Main ─────────────────────────────────────────────────────────────────
async function main() {
  if (!fs.existsSync(MANIFEST)) {
    console.error(`Manifest not found: ${MANIFEST}`);
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));

  // Flatten manifest into [{ path, category }]
  const queue = [];
  for (const [cat, paths] of Object.entries(manifest.categories || {})) {
    if (cat.startsWith('_')) continue;
    if (CATEGORY && cat !== CATEGORY) continue;
    for (const p of paths) queue.push({ path: p, category: cat });
  }
  const limit = LIMIT ? Number(LIMIT) : queue.length;
  const work = queue.slice(0, limit);

  console.log(`[ingest] manifest: ${MANIFEST}`);
  console.log(`[ingest] files: ${work.length} (of ${queue.length} total in manifest)`);
  console.log(`[ingest] output: ${OUT}`);

  // Ensure output dir exists
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const outStream = fs.createWriteStream(OUT, { flags: 'w' });

  let totalBlocks = 0, totalCards = 0, totalAnalytics = 0, fileFailures = 0;
  const perCategoryBlocks = {};

  for (let i = 0; i < work.length; i++) {
    const { path: filePath, category } = work[i];
    const basename = path.basename(filePath);
    try {
      const records = await ingestFile(filePath, category, i);
      for (const r of records) {
        outStream.write(JSON.stringify(r) + '\n');
        totalBlocks++;
        totalCards    += r.n_cards;
        totalAnalytics += r.n_analytics;
      }
      perCategoryBlocks[category] = (perCategoryBlocks[category] || 0) + records.length;
      console.log(`[ingest] ${i + 1}/${work.length} [${category}] ${basename} → ${records.length} blocks (${records.reduce((s, r) => s + r.n_cards, 0)} cards, ${records.reduce((s, r) => s + r.n_analytics, 0)} analytics)`);
    } catch (err) {
      fileFailures++;
      console.error(`[ingest] FAIL ${basename}: ${err.message}`);
    }
  }

  outStream.end();
  await new Promise(r => outStream.on('finish', r));

  console.log('\n[ingest] === SUMMARY ===');
  console.log(`  files processed : ${work.length - fileFailures} / ${work.length}`);
  console.log(`  total blocks    : ${totalBlocks}`);
  console.log(`  total cards     : ${totalCards}`);
  console.log(`  total analytics : ${totalAnalytics}`);
  console.log('  by category:');
  for (const [cat, n] of Object.entries(perCategoryBlocks)) {
    console.log(`    ${cat.padEnd(20)} ${n} blocks`);
  }
  console.log(`  output: ${OUT} (${fs.statSync(OUT).size} bytes)`);
}

main().catch(err => {
  console.error('[ingest] fatal:', err.stack || err.message);
  process.exit(1);
});
