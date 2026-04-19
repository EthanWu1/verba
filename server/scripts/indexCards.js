'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const db = require('../services/db');
const { upsertCards, isConfigured } = require('../services/vectorSearch');

const PAGE = 500;

async function main() {
  if (!isConfigured()) {
    console.error('Missing PINECONE_API_KEY, PINECONE_INDEX, or COHERE_API_KEY in .env');
    process.exit(1);
  }

  const total = db.countCards();
  console.log(`Indexing ${total} cards in pages of ${PAGE}...`);

  let offset = 0;
  let indexed = 0;

  while (offset < total) {
    const batch = db.loadCardsPaged(PAGE, offset);
    if (!batch.length) break;
    await upsertCards(batch);
    indexed += batch.length;
    console.log(`Progress: ${indexed}/${total}`);
    offset += PAGE;
  }

  console.log('Done.');
}

main().catch(err => { console.error(err); process.exit(1); });
