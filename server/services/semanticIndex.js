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
      card_id INTEGER PRIMARY KEY,
      embedding float[${DIM}]
    );
    CREATE TABLE IF NOT EXISTS cards_embed_meta (
      card_id   INTEGER PRIMARY KEY,
      textHash  TEXT NOT NULL,
      embedded  INTEGER NOT NULL DEFAULT 1,
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_cards_embed_hash ON cards_embed_meta(textHash);

    -- Auto-cleanup on cards mutations. cards has a TEXT primary key, so
    -- INSERT OR REPLACE in the importer does a DELETE+INSERT internally,
    -- which assigns a new rowid. Without these triggers, cards_vec /
    -- cards_embed_meta rows keyed by the prior rowid become stale garbage
    -- — KNN returns rowids the route can't hydrate, costing top-K slots
    -- and silently degrading semantic recall over time.
    CREATE TRIGGER IF NOT EXISTS cards_vec_after_delete
      AFTER DELETE ON cards
      BEGIN
        DELETE FROM cards_vec        WHERE card_id = OLD.rowid;
        DELETE FROM cards_embed_meta WHERE card_id = OLD.rowid;
      END;
  `);
  // No one-time sweep here — the NOT IN anti-join against 832k rows on a
  // cold cache made first-hit /semantic-search take 12+ seconds. The
  // trigger keeps things consistent going forward; past staleness shows
  // up as KNN rowids the route can't hydrate (filtered out, mild recall
  // hit, not correctness). Run scripts/indexCardsVec.js to do an explicit
  // sweep when desired — its repair pass is identical.
  return true;
}

function upsertEmbedding(cardId, textHash, embedding) {
  const db = getDb();
  if (!_loadVecExt(db)) return;
  const buf = Buffer.from(new Float32Array(embedding).buffer);
  const n = Number(cardId);
  if (!Number.isInteger(n)) return;
  const id = BigInt(n); // sqlite-vec vec0 requires BigInt binding for integer PK
  db.prepare(`DELETE FROM cards_vec WHERE card_id = ?`).run(id);
  db.prepare(`INSERT INTO cards_vec(card_id, embedding) VALUES (?, ?)`).run(id, buf);
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
      SELECT card_id, distance
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
