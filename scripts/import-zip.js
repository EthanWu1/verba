'use strict';

const fs = require('fs');
const path = require('path');

const {
  listDocxEntries,
  importDocxEntry,
  chooseCanonicals,
} = require('../server/services/docxImport');
const { saveCards, saveMeta, loadMeta, loadCards } = require('../server/services/libraryStore');

async function main() {
  const zipPath = process.argv[2];
  const batchSize = Number(process.argv[3] || 500);
  const concurrency = Number(process.argv[4] || 4);

  if (!zipPath) {
    throw new Error('Usage: node scripts/import-zip.js <zipPath> [batchSize]');
  }

  const entries = listDocxEntries(zipPath);
  const existingMeta = loadMeta();
  const resumeCount = existingMeta?.importedZip === zipPath
    ? Number(existingMeta?.importProgress?.processedDocs || 0)
    : 0;
  const allCards = resumeCount > 0 ? loadCards() : [];
  let processedDocs = resumeCount;

  for (let start = resumeCount; start < entries.length; start += batchSize) {
    const batch = entries.slice(start, start + batchSize);

    for (let cursor = 0; cursor < batch.length; cursor += concurrency) {
      const group = batch.slice(cursor, cursor + concurrency);
      const results = await Promise.all(group.map(async entryPath => {
        try {
          return await importDocxEntry(zipPath, entryPath);
        } catch {
          return [];
        }
      }));

      results.forEach(cards => allCards.push(...cards));
      processedDocs += group.length;
    }

    const canonicalized = chooseCanonicals(allCards);
    saveCards(canonicalized);

    const citationGroups = new Set(canonicalized.map(card => card.shortCite || card.cite)).size;
    const canonicalGroups = canonicalized.filter(card => card.isCanonical).length;

    saveMeta({
      ...loadMeta(),
      lastImport: new Date().toISOString(),
      importedZip: zipPath,
      totalCards: canonicalized.length,
      totalDocs: processedDocs,
      citationGroups,
      canonicalGroups,
      importProgress: {
        processedDocs,
        totalDocs: entries.length,
        percent: Number(((processedDocs / entries.length) * 100).toFixed(2)),
      },
    });

    console.log(`[import] batch complete: ${processedDocs}/${entries.length} docs, ${canonicalized.length} cards`);
  }

  const finalCards = chooseCanonicals(allCards);
  saveCards(finalCards);

  const finalCitationGroups = new Set(finalCards.map(card => card.shortCite || card.cite)).size;
  const finalCanonicalGroups = finalCards.filter(card => card.isCanonical).length;

  saveMeta({
    ...loadMeta(),
    lastImport: new Date().toISOString(),
    importedZip: zipPath,
    totalCards: finalCards.length,
    totalDocs: entries.length,
    citationGroups: finalCitationGroups,
    canonicalGroups: finalCanonicalGroups,
    importProgress: {
      processedDocs: entries.length,
      totalDocs: entries.length,
      percent: 100,
    },
  });

  console.log('IMPORT_RESULT');
  console.log(JSON.stringify({
    zipPath,
    totalDocs: entries.length,
    totalCards: finalCards.length,
    citationGroups: finalCitationGroups,
    canonicalGroups: finalCanonicalGroups,
  }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
