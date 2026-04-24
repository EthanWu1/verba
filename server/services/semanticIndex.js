'use strict';

const { getDb } = require('./db');
const { DIM } = require('./embedder');

let _loaded = false;
let _loadFailed = false;
function _loadVecExt(db) {
  if (_loaded) return true;
  if (_loadFailed) return false;
  try {
    const sqliteVec = require('sqlite-vec');
    sqliteVec.load(db);
    _loaded = true;
    return true;
  } catch (err) {
    _loadFailed = true;
    console.warn('[semanticIndex] sqlite-vec unavailable:', err.message);
    return false;
  }
}

function ensureSchema() {
  const db = getDb();
  if (!_loadVecExt(db)) return false;
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS cards_vec USING vec0(
      embedding float[${DIM}]
    );
    CREATE TABLE IF NOT EXISTS cards_embed_meta (
      card_id   INTEGER PRIMARY KEY,
      textHash  TEXT NOT NULL,
      embedded  INTEGER NOT NULL DEFAULT 1,
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_cards_embed_hash ON cards_embed_meta(textHash);
  `);
  return true;
}

function upsertEmbedding(cardId, textHash, embedding) {
  const db = getDb();
  if (!_loadVecExt(db)) return;
  const buf = Buffer.from(new Float32Array(embedding).buffer);
  db.prepare(`INSERT OR REPLACE INTO cards_vec(rowid, embedding) VALUES (?, ?)`).run(cardId, buf);
  db.prepare(`
    INSERT INTO cards_embed_meta(card_id, textHash, embedded, updatedAt)
    VALUES (?, ?, 1, datetime('now'))
    ON CONFLICT(card_id) DO UPDATE SET
      textHash  = excluded.textHash,
      embedded  = 1,
      updatedAt = excluded.updatedAt
  `).run(cardId, textHash);
}

function knn(queryEmbedding, k = 25) {
  const db = getDb();
  if (!_loadVecExt(db)) return [];
  const buf = Buffer.from(new Float32Array(queryEmbedding).buffer);
  try {
    return db.prepare(`
      SELECT rowid AS card_id, distance
      FROM cards_vec
      WHERE embedding MATCH ?
      ORDER BY distance ASC
      LIMIT ?
    `).all(buf, k);
  } catch (err) {
    console.warn('[semanticIndex] knn failed:', err.message);
    return [];
  }
}

function alreadyEmbedded(cardId, textHash) {
  const db = getDb();
  const row = db.prepare(`SELECT textHash FROM cards_embed_meta WHERE card_id = ?`).get(cardId);
  return row && row.textHash === textHash;
}

function extensionStatus() {
  return { loaded: _loaded, loadFailed: _loadFailed };
}

module.exports = { ensureSchema, upsertEmbedding, knn, alreadyEmbedded, extensionStatus };
