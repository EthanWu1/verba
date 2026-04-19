'use strict';

const db = require('./db');
const { upsertCards } = require('./vectorSearch');

function loadCards(limit = null) {
  return db.loadAllCards(limit);
}

function saveCards(cards) {
  db.upsertCards(cards);
  upsertCards(cards).catch(err => console.warn('[VECTOR] upsert failed:', err.message));
}

function loadMeta() {
  return db.loadMeta();
}

function saveMeta(meta) {
  db.saveMeta(meta);
}

module.exports = {
  loadCards,
  saveCards,
  loadMeta,
  saveMeta,
};
