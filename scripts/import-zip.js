'use strict';

const {
  listDocxEntries,
  importDocxEntry,
  chooseCanonicals,
} = require('../server/services/docxImport');
const { saveCards, saveMeta, loadMeta } = require('../server/services/libraryStore');

async function main() {
  const args = process.argv.slice(2);
  const filtered = args.filter(a => a !== '--append');
  const zipPath = filtered[0];
  const batchSize = Number(filtered[1] || 500);
  const concurrency = Number(filtered[2] || 4);

  if (!zipPath) {
    throw new Error('Usage: node scripts/import-zip.js <zipPath> [batchSize] [concurrency] [--append]');
  }

  const entries = await listDocxEntries(zipPath);
  const existingMeta = loadMeta();
  const resumeCount = existingMeta?.importedZip === zipPath
    ? Number(existingMeta?.importProgress?.processedDocs || 0)
    : 0;
  let processedDocs = resumeCount;
  let totalCardsImported = 0;

  for (let start = resumeCount; start < entries.length; start += batchSize) {
    const batch = entries.slice(start, start + batchSize);
    let batchCards = [];

    for (let cursor = 0; cursor < batch.length; cursor += concurrency) {
      const group = batch.slice(cursor, cursor + concurrency);
      const results = await Promise.all(group.map(async entryPath => {
        try {
          return await importDocxEntry(zipPath, entryPath);
        } catch {
          return [];
        }
      }));

      results.forEach(cards => batchCards.push(...cards));
      processedDocs += group.length;
    }

    chooseCanonicals(batchCards);
    saveCards(batchCards);
    totalCardsImported += batchCards.length;

    saveMeta({
      ...loadMeta(),
      lastImport: new Date().toISOString(),
      importedZip: zipPath,
      totalDocs: processedDocs,
      importProgress: {
        processedDocs,
        totalDocs: entries.length,
        percent: Number(((processedDocs / entries.length) * 100).toFixed(2)),
      },
    });

    console.log(`[import] batch complete: ${processedDocs}/${entries.length} docs, +${batchCards.length} cards (total added: ${totalCardsImported})`);
    batchCards = null;
    if (global.gc) global.gc();
  }

  saveMeta({
    ...loadMeta(),
    lastImport: new Date().toISOString(),
    importedZip: zipPath,
    totalDocs: entries.length,
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
    cardsAdded: totalCardsImported,
  }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
