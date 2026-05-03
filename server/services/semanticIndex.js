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

/**
 * Inspect the existing cards_vec virtual table and return its embedding
 * dimension, or null if the table doesn't exist / dim can't be parsed.
 *
 * sqlite-vec stores the dim in the table's CREATE statement, e.g.
 *   CREATE VIRTUAL TABLE cards_vec USING vec0(
 *     card_id INTEGER PRIMARY KEY, embedding float[1536])
 */
function _existingVecDim(db) {
  try {
    const row = db.prepare(
      `SELECT sql FROM sqlite_master WHERE type='table' AND name='cards_vec'`
    ).get();
    if (!row || !row.sql) return null;
    const m = row.sql.match(/float\[(\d+)\]/i);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

function ensureSchema() {
  const db = getDb();
  if (!_loadVecExt(db)) return false;

  // Auto-migrate when the embedding model changes dimensionality (e.g.
  // OpenAI 1536-dim → local MiniLM 384-dim). sqlite-vec virtual tables
  // are bound to their dim at creation; mismatched inserts throw, and a
  // mismatched MATCH query silently returns nothing. Drop + recreate
  // and clear the embed_meta so the indexer re-queues everything.
  const existing = _existingVecDim(db);
  const dimChanged = existing !== null && existing !== DIM;
  if (dimChanged) {
    console.warn(
      `[semanticIndex] Embedding dim changed: ${existing} → ${DIM}. ` +
      `Dropping cards_vec and embed metadata. Re-run ` +
      `\`node server/scripts/indexCardsVec.js --all\` to re-embed.`
    );
    // Drop the vec table now; the meta DELETE happens after the
    // CREATE TABLE IF NOT EXISTS block below (since the table may not
    // have existed on a fresh install).
    db.exec(`DROP TABLE IF EXISTS cards_vec;`);
  }

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

  // After the schema is in place, finish the dim-change migration by
  // wiping stale embed-metadata so the indexer re-queues every card.
  if (dimChanged) {
    db.exec(`DELETE FROM cards_embed_meta;`);
  }

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
