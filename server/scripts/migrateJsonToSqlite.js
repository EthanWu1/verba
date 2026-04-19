'use strict';

/**
 * One-time migration: reads existing library-cards.json and library-meta.json
 * and upserts them into the SQLite database.
 *
 * Usage: node server/scripts/migrateJsonToSqlite.js
 */

const fs = require('fs');
const path = require('path');
const db = require('../services/db');
const { inferArgumentTags, normalizeTag } = require('../services/docxImport');

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const CARDS_PATH = path.join(DATA_DIR, 'library-cards.json');
const META_PATH = path.join(DATA_DIR, 'library-meta.json');

function run() {
  if (!fs.existsSync(CARDS_PATH)) {
    console.log('No library-cards.json found — nothing to migrate.');
    return;
  }

  console.log('Reading library-cards.json...');
  const cards = JSON.parse(fs.readFileSync(CARDS_PATH, 'utf8'));
  console.log(`Found ${cards.length} cards.`);

  // Backfill argumentTypes, argumentTags, and clean tags
  const migrated = cards.map(card => {
    const sourceText = `${card.tag || ''} ${card.cite || ''} ${card.body_plain || ''}`;
    return {
      ...card,
      tag: normalizeTag(card.tag),
      argumentTypes: Array.isArray(card.argumentTypes) && card.argumentTypes.length
        ? card.argumentTypes
        : card.argumentType
          ? [card.argumentType]
          : ['none'],
      argumentTags: Array.isArray(card.argumentTags) && card.argumentTags.length
        ? card.argumentTags
        : inferArgumentTags(card.tag, card.body_plain),
    };
  });

  console.log('Upserting cards into SQLite...');
  db.upsertCards(migrated);
  console.log(`Migrated ${migrated.length} cards.`);

  if (fs.existsSync(META_PATH)) {
    const meta = JSON.parse(fs.readFileSync(META_PATH, 'utf8'));
    db.saveMeta(meta);
    console.log('Migrated meta.');
  }

  console.log('Done. SQLite DB at server/data/library.db');
  console.log('You may archive library-cards.json and library-meta.json once verified.');
}

run();
