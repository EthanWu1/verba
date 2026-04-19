'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { deriveAllLabels } = require('./labelDerivation');

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'library.db');

let _db = null;

function getDb() {
  if (_db) return _db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('synchronous = NORMAL');
  _initSchema(_db);
  _runMigrations(_db);
  return _db;
}

function _initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cards (
      id                 TEXT PRIMARY KEY,
      zipPath            TEXT NOT NULL,
      sourceEntry        TEXT NOT NULL,
      sourceFileName     TEXT NOT NULL,
      division           TEXT,
      school             TEXT,
      squad              TEXT,
      tag                TEXT,
      cite               TEXT,
      shortCite          TEXT,
      body_markdown      TEXT,
      body_plain         TEXT,
      warrantDensity     REAL,
      contentFingerprint TEXT NOT NULL,
      foundAt            TEXT,
      importedAt         TEXT,
      topicBucket        TEXT,
      argumentTypes      TEXT NOT NULL DEFAULT '["none"]',
      argumentTags       TEXT NOT NULL DEFAULT '[]',
      sourceKind         TEXT,
      isCanonical        INTEGER NOT NULL DEFAULT 0,
      canonicalGroupKey  TEXT,
      variantCount       INTEGER NOT NULL DEFAULT 1
    );

    CREATE INDEX IF NOT EXISTS idx_cards_fingerprint   ON cards(contentFingerprint);
    CREATE INDEX IF NOT EXISTS idx_cards_school        ON cards(school);
    CREATE INDEX IF NOT EXISTS idx_cards_shortCite     ON cards(shortCite);
    CREATE INDEX IF NOT EXISTS idx_cards_isCanonical   ON cards(isCanonical);

    CREATE TABLE IF NOT EXISTS analytics (
      id            TEXT PRIMARY KEY,
      zipPath       TEXT NOT NULL,
      sourceEntry   TEXT NOT NULL,
      title         TEXT,
      content_plain TEXT,
      wordCount     INTEGER,
      importedAt    TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_analytics_zip ON analytics(zipPath);

    CREATE TABLE IF NOT EXISTS ingestion_log (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      zipPath        TEXT NOT NULL,
      processedAt    TEXT NOT NULL,
      cardCount      INTEGER NOT NULL DEFAULT 0,
      analyticsCount INTEGER NOT NULL DEFAULT 0,
      docCount       INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      email         TEXT NOT NULL UNIQUE,
      passwordHash  TEXT,
      googleSub     TEXT UNIQUE,
      name          TEXT,
      tier          TEXT NOT NULL DEFAULT 'free',
      createdAt     TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      expiresAt TEXT NOT NULL,
      lastSeenAt TEXT,
      userAgent TEXT,
      ip TEXT,
      FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_userId ON sessions(userId);

    CREATE TABLE IF NOT EXISTS user_projects (
      id         TEXT PRIMARY KEY,
      userId     TEXT NOT NULL,
      name       TEXT NOT NULL,
      color      TEXT NOT NULL DEFAULT '#6B7280',
      cards      TEXT NOT NULL DEFAULT '[]',
      createdAt  TEXT NOT NULL,
      updatedAt  TEXT NOT NULL,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_user_projects_userId ON user_projects(userId);

    CREATE TABLE IF NOT EXISTS user_saved_cards (
      id         TEXT PRIMARY KEY,
      userId     TEXT NOT NULL,
      payload    TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      savedAt    TEXT NOT NULL,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_user_saved_cards_fp ON user_saved_cards(userId, fingerprint);

    CREATE TABLE IF NOT EXISTS user_history (
      id        TEXT PRIMARY KEY,
      userId    TEXT NOT NULL,
      entry     TEXT NOT NULL,
      at        TEXT NOT NULL,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_user_history_user_at ON user_history(userId, at DESC);

    CREATE TABLE IF NOT EXISTS usage_counters (
      userId   TEXT NOT NULL,
      kind     TEXT NOT NULL,
      day      TEXT NOT NULL,
      count    INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (userId, kind, day),
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS password_resets (
      tokenHash  TEXT PRIMARY KEY,
      userId     TEXT NOT NULL,
      expiresAt  TEXT NOT NULL,
      usedAt     TEXT,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // Idempotent column adds for older DB files.
  for (const col of [
    { name: 'lastSeenAt', type: 'TEXT' },
    { name: 'userAgent',  type: 'TEXT' },
    { name: 'ip',         type: 'TEXT' },
  ]) {
    try { db.exec(`ALTER TABLE sessions ADD COLUMN ${col.name} ${col.type}`); }
    catch (e) { /* column already exists */ }
  }
}

function _runMigrations(db) {
  // v2: Add argumentTags column if missing
  const cols = db.prepare("PRAGMA table_info(cards)").all().map(r => r.name);
  if (!cols.includes('argumentTags')) {
    db.exec("ALTER TABLE cards ADD COLUMN argumentTags TEXT NOT NULL DEFAULT '[]'");
  }
  // v3: Drop broken FTS5 content table if it exists
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' OR type='shadow'").all().map(r => r.name);
  if (tables.includes('analytics_fts')) {
    db.exec('DROP TABLE IF EXISTS analytics_fts');
  }
  // v4: Derived label columns for SQL-backed filtering/sorting
  const cols2 = db.prepare("PRAGMA table_info(cards)").all().map(r => r.name);
  const needBackfill = !cols2.includes('typeLabel');
  if (!cols2.includes('typeLabel'))       db.exec("ALTER TABLE cards ADD COLUMN typeLabel TEXT");
  if (!cols2.includes('topicLabel'))      db.exec("ALTER TABLE cards ADD COLUMN topicLabel TEXT");
  if (!cols2.includes('sourceLabel'))     db.exec("ALTER TABLE cards ADD COLUMN sourceLabel TEXT");
  if (!cols2.includes('scope'))           db.exec("ALTER TABLE cards ADD COLUMN scope TEXT");
  if (!cols2.includes('resolutionLabel')) db.exec("ALTER TABLE cards ADD COLUMN resolutionLabel TEXT");
  // v5: hasHighlight flag for prioritizing cut cards
  const needHighlightBackfill = !cols2.includes('hasHighlight');
  if (needHighlightBackfill) db.exec("ALTER TABLE cards ADD COLUMN hasHighlight INTEGER NOT NULL DEFAULT 0");
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_cards_typeLabel       ON cards(typeLabel);
    CREATE INDEX IF NOT EXISTS idx_cards_topicLabel      ON cards(topicLabel);
    CREATE INDEX IF NOT EXISTS idx_cards_sourceLabel     ON cards(sourceLabel);
    CREATE INDEX IF NOT EXISTS idx_cards_scope           ON cards(scope);
    CREATE INDEX IF NOT EXISTS idx_cards_resolutionLabel ON cards(resolutionLabel);
    CREATE INDEX IF NOT EXISTS idx_cards_importedAt      ON cards(importedAt);
    CREATE INDEX IF NOT EXISTS idx_cards_warrantDensity  ON cards(warrantDensity);
    CREATE INDEX IF NOT EXISTS idx_cards_hasHighlight    ON cards(hasHighlight);
  `);
  if (needBackfill) _backfillDerivedLabels(db);
  if (needHighlightBackfill) _backfillHasHighlight(db);
}

function _backfillHasHighlight(db) {
  console.log('[db] backfilling hasHighlight...');
  const t0 = Date.now();
  const info = db.prepare(`
    UPDATE cards SET hasHighlight =
      CASE WHEN body_markdown LIKE '%==%' OR body_markdown LIKE '%<u>%' OR body_markdown LIKE '%**%' THEN 1 ELSE 0 END
  `).run();
  console.log(`[db] hasHighlight set on ${info.changes} rows in ${Date.now() - t0}ms`);
}

function _backfillDerivedLabels(db) {
  console.log('[db] backfilling derived labels...');
  const rows = db.prepare('SELECT id, argumentTypes, argumentTags, sourceKind, division, zipPath, topicBucket FROM cards').all();
  const stmt = db.prepare('UPDATE cards SET typeLabel = ?, topicLabel = ?, sourceLabel = ?, scope = ?, resolutionLabel = ? WHERE id = ?');
  const tx = db.transaction(() => {
    for (const row of rows) {
      const labels = deriveAllLabels(row);
      stmt.run(labels.typeLabel, labels.topicLabel, labels.sourceLabel, labels.scope, labels.resolutionLabel, row.id);
    }
  });
  tx();
  console.log(`[db] backfilled ${rows.length} cards`);
}

function refreshDerivedLabels(ids = null) {
  const db = getDb();
  const rows = ids
    ? db.prepare(`SELECT id, argumentTypes, argumentTags, sourceKind, division, zipPath, topicBucket FROM cards WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids)
    : db.prepare('SELECT id, argumentTypes, argumentTags, sourceKind, division, zipPath, topicBucket FROM cards').all();
  const stmt = db.prepare('UPDATE cards SET typeLabel = ?, topicLabel = ?, sourceLabel = ?, scope = ?, resolutionLabel = ? WHERE id = ?');
  const tx = db.transaction(() => {
    for (const row of rows) {
      const labels = deriveAllLabels(row);
      stmt.run(labels.typeLabel, labels.topicLabel, labels.sourceLabel, labels.scope, labels.resolutionLabel, row.id);
    }
  });
  tx();
  return rows.length;
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

const INSERT_CARD = `
  INSERT OR REPLACE INTO cards
    (id, zipPath, sourceEntry, sourceFileName, division, school, squad,
     tag, cite, shortCite, body_markdown, body_plain, warrantDensity,
     contentFingerprint, foundAt, importedAt, topicBucket, argumentTypes, argumentTags,
     sourceKind, isCanonical, canonicalGroupKey, variantCount,
     typeLabel, topicLabel, sourceLabel, scope, resolutionLabel, hasHighlight)
  VALUES
    (@id, @zipPath, @sourceEntry, @sourceFileName, @division, @school, @squad,
     @tag, @cite, @shortCite, @body_markdown, @body_plain, @warrantDensity,
     @contentFingerprint, @foundAt, @importedAt, @topicBucket, @argumentTypes, @argumentTags,
     @sourceKind, @isCanonical, @canonicalGroupKey, @variantCount,
     @typeLabel, @topicLabel, @sourceLabel, @scope, @resolutionLabel, @hasHighlight)
`;

function upsertCards(cards) {
  const db = getDb();
  const stmt = db.prepare(INSERT_CARD);
  const insertMany = db.transaction(rows => {
    for (const card of rows) {
      const labels = deriveAllLabels(card);
      stmt.run({
        id: card.id || '',
        zipPath: card.zipPath || '',
        sourceEntry: card.sourceEntry || '',
        sourceFileName: card.sourceFileName || '',
        division: card.division || null,
        school: card.school || null,
        squad: card.squad || null,
        tag: card.tag || null,
        cite: card.cite || null,
        shortCite: card.shortCite || null,
        body_markdown: card.body_markdown || null,
        body_plain: card.body_plain || null,
        warrantDensity: card.warrantDensity ?? null,
        contentFingerprint: card.contentFingerprint || '',
        foundAt: card.foundAt || null,
        importedAt: card.importedAt || null,
        topicBucket: card.topicBucket || null,
        argumentTypes: Array.isArray(card.argumentTypes)
          ? JSON.stringify(card.argumentTypes)
          : (card.argumentTypes || '["none"]'),
        argumentTags: Array.isArray(card.argumentTags)
          ? JSON.stringify(card.argumentTags)
          : (card.argumentTags || '[]'),
        sourceKind: card.sourceKind || null,
        isCanonical: card.isCanonical ? 1 : 0,
        canonicalGroupKey: card.canonicalGroupKey || null,
        variantCount: card.variantCount || 1,
        typeLabel: labels.typeLabel,
        topicLabel: labels.topicLabel,
        sourceLabel: labels.sourceLabel,
        scope: labels.scope,
        resolutionLabel: labels.resolutionLabel,
        hasHighlight: /(==|<u>|\*\*)/.test(card.body_markdown || '') ? 1 : 0,
      });
    }
  });
  insertMany(cards);
}

/**
 * Re-elect canonical cards for the given group keys using SQL only.
 * Never loads cards into JS memory.
 * For each group: highest warrantDensity wins; ties broken by sourceEntry ASC.
 */
function recanonicalizeGroups(groupKeys) {
  if (!groupKeys || groupKeys.length === 0) return;
  const db = getDb();

  // Build a deduplicated list of non-empty keys
  const keys = [...new Set(groupKeys.filter(Boolean))];
  if (keys.length === 0) return;

  // SQLite doesn't support arrays natively — batch in chunks of 500
  const CHUNK = 450; // SQLite max variables = 999; CTE query uses chunk twice → 450*2 = 900 ≤ 999
  const runBatch = db.transaction(chunk => {
    const placeholders = chunk.map(() => '?').join(',');

    // 1. Reset canonical flags in affected groups
    db.prepare(`UPDATE cards SET isCanonical = 0 WHERE canonicalGroupKey IN (${placeholders})`).run(...chunk);

    // 2. Elect canonical per group (highest warrantDensity)
    db.prepare(`
      UPDATE cards SET isCanonical = 1
      WHERE id IN (
        SELECT id FROM cards
        WHERE canonicalGroupKey IN (${placeholders})
          AND canonicalGroupKey IS NOT NULL AND canonicalGroupKey != ''
        GROUP BY canonicalGroupKey
        HAVING warrantDensity = MAX(warrantDensity)
      )
    `).run(...chunk);

    // 3. Update variantCount: compute per-group counts in JS, then bulk update
    const counts = db.prepare(`
      SELECT canonicalGroupKey, COUNT(*) AS cnt
      FROM cards
      WHERE canonicalGroupKey IN (${placeholders})
        AND canonicalGroupKey IS NOT NULL AND canonicalGroupKey != ''
      GROUP BY canonicalGroupKey
    `).all(...chunk);

    const updateVariant = db.prepare(`UPDATE cards SET variantCount = ? WHERE canonicalGroupKey = ?`);
    for (const row of counts) {
      updateVariant.run(row.cnt, row.canonicalGroupKey);
    }
  });

  for (let i = 0; i < keys.length; i += CHUNK) {
    runBatch(keys.slice(i, i + CHUNK));
  }
}

function _parseCard(row) {
  if (!row) return null;
  return {
    ...row,
    argumentTypes: (() => {
      try { return JSON.parse(row.argumentTypes); } catch { return ['none']; }
    })(),
    argumentTags: (() => {
      try { return JSON.parse(row.argumentTags); } catch { return []; }
    })(),
    isCanonical: row.isCanonical === 1,
  };
}

function loadAllCards(limit = null) {
  const sql = limit
    ? 'SELECT * FROM cards ORDER BY warrantDensity DESC LIMIT ?'
    : 'SELECT * FROM cards';
  const rows = limit
    ? getDb().prepare(sql).all(limit)
    : getDb().prepare(sql).all();
  return rows.map(_parseCard);
}

function loadCardsPaged(limit, offset) {
  return getDb()
    .prepare('SELECT * FROM cards ORDER BY id ASC LIMIT ? OFFSET ?')
    .all(limit, offset)
    .map(_parseCard);
}

function countCards() {
  return getDb().prepare('SELECT COUNT(*) as cnt FROM cards').get().cnt;
}

function getExistingFingerprints() {
  const rows = getDb().prepare('SELECT contentFingerprint FROM cards').all();
  return new Set(rows.map(r => r.contentFingerprint));
}

// ---------------------------------------------------------------------------
// SQL-backed query + facets (pagination, filters)
// ---------------------------------------------------------------------------

function _buildWhere(filters) {
  const where = ['hasHighlight = 1'];
  const params = [];
  if (filters.scope === 'my')     { where.push('scope = ?'); params.push('my'); }
  if (filters.scope === 'public') { where.push('scope = ?'); params.push('public'); }
  if (filters.type) {
    where.push('LOWER(typeLabel) = ?');
    params.push(String(filters.type).toLowerCase());
  }
  if (filters.topic) {
    where.push('topicLabel = ?'); params.push(filters.topic);
  }
  if (filters.resolution) {
    where.push('resolutionLabel = ?'); params.push(filters.resolution);
  }
  if (filters.source) {
    where.push('sourceLabel = ?'); params.push(filters.source);
  }
  if (filters.canonical === 'true')  where.push('isCanonical = 1');
  if (filters.canonical === 'false') where.push('isCanonical = 0');
  if (filters.q) {
    const q = `%${String(filters.q).replace(/[%_]/g, '\\$&')}%`;
    where.push(`(tag LIKE ? ESCAPE '\\' OR shortCite LIKE ? ESCAPE '\\' OR cite LIKE ? ESCAPE '\\')`);
    params.push(q, q, q);
  }
  return { sql: `WHERE ${where.join(' AND ')}`, params };
}

function _orderBy(sort) {
  switch (sort) {
    case 'recent':   return 'ORDER BY hasHighlight DESC, importedAt DESC';
    case 'density':  return 'ORDER BY hasHighlight DESC, warrantDensity DESC';
    case 'variants': return 'ORDER BY hasHighlight DESC, variantCount DESC';
    case 'cite':     return 'ORDER BY hasHighlight DESC, COALESCE(shortCite, cite) ASC';
    case 'school':   return 'ORDER BY hasHighlight DESC, school ASC';
    case 'tag':      return 'ORDER BY hasHighlight DESC, tag ASC';
    default:         return 'ORDER BY hasHighlight DESC, isCanonical DESC, variantCount DESC, importedAt DESC';
  }
}

function queryCards({ filters = {}, sort = 'relevance', page = 1, limit = 40 }) {
  const db = getDb();
  const { sql: whereSql, params } = _buildWhere(filters);
  let orderSql = _orderBy(sort);
  const orderParams = [];
  if (filters.q) {
    const q = `%${String(filters.q).replace(/[%_]/g, '\\$&')}%`;
    const tagRank = `(CASE WHEN tag LIKE ? ESCAPE '\\' THEN 0 WHEN shortCite LIKE ? ESCAPE '\\' THEN 1 ELSE 2 END)`;
    orderSql = orderSql.replace('ORDER BY ', `ORDER BY ${tagRank}, `);
    orderParams.push(q, q);
  }
  const total = db.prepare(`SELECT COUNT(*) AS n FROM cards ${whereSql}`).get(...params).n;
  const rows = db.prepare(`SELECT * FROM cards ${whereSql} ${orderSql} LIMIT ? OFFSET ?`)
                 .all(...params, ...orderParams, limit, (page - 1) * limit);
  return { total, rows: rows.map(_parseCard) };
}

function queryCardsByIds(ids, filters = {}) {
  if (!ids || !ids.length) return [];
  const db = getDb();
  const { sql: whereSql, params } = _buildWhere(filters);
  const placeholders = ids.map(() => '?').join(',');
  const combined = whereSql
    ? `${whereSql} AND id IN (${placeholders})`
    : `WHERE id IN (${placeholders})`;
  return db.prepare(`SELECT * FROM cards ${combined}`)
           .all(...params, ...ids)
           .map(_parseCard);
}

function facetCounts(scope = null, limit = 20) {
  const db = getDb();
  const baseWhere = 'WHERE hasHighlight = 1' + (scope ? ' AND scope = ?' : '');
  const params = scope ? [scope] : [];
  function top(col, lim = limit) {
    return db.prepare(`
      SELECT ${col} AS label, COUNT(*) AS count FROM cards
      ${baseWhere} AND ${col} IS NOT NULL AND ${col} != ''
      GROUP BY ${col} ORDER BY count DESC, label ASC LIMIT ?
    `).all(...params, lim);
  }
  return {
    resolutions: top('resolutionLabel', 20),
    types:       top('typeLabel', 20),
    topics:      top('topicLabel', 20),
    sources:     top('sourceLabel', 10),
  };
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

function upsertAnalytic(analytic) {
  getDb().prepare(`
    INSERT OR REPLACE INTO analytics (id, zipPath, sourceEntry, title, content_plain, wordCount, importedAt)
    VALUES (@id, @zipPath, @sourceEntry, @title, @content_plain, @wordCount, @importedAt)
  `).run(analytic);
}

function searchAnalytics(query, limit = 50) {
  const db = getDb();
  if (!query || !query.trim()) {
    return db.prepare('SELECT id, zipPath, sourceEntry, title, wordCount, importedAt FROM analytics ORDER BY importedAt DESC LIMIT ?').all(limit);
  }
  const pattern = `%${query.replace(/[%_]/g, '\\$&')}%`;
  return db.prepare(`
    SELECT id, zipPath, sourceEntry, title, wordCount, importedAt,
           substr(content_plain, 1, 500) AS excerpt
    FROM analytics
    WHERE content_plain LIKE ? ESCAPE '\\'
       OR title LIKE ? ESCAPE '\\'
    ORDER BY importedAt DESC
    LIMIT ?
  `).all(pattern, pattern, limit);
}

// ---------------------------------------------------------------------------
// Ingestion log
// ---------------------------------------------------------------------------

function logIngestion(zipPath, cardCount, analyticsCount, docCount) {
  getDb().prepare(`
    INSERT INTO ingestion_log (zipPath, processedAt, cardCount, analyticsCount, docCount)
    VALUES (?, ?, ?, ?, ?)
  `).run(zipPath, new Date().toISOString(), cardCount, analyticsCount, docCount);
}

// ---------------------------------------------------------------------------
// Meta (key/value)
// ---------------------------------------------------------------------------

function loadMeta() {
  const rows = getDb().prepare('SELECT key, value FROM meta').all();
  const obj = {};
  for (const row of rows) {
    try { obj[row.key] = JSON.parse(row.value); } catch { obj[row.key] = row.value; }
  }
  return Object.assign({
    lastImport: null,
    importedZip: '',
    totalCards: 0,
    totalDocs: 0,
    citationGroups: 0,
    canonicalGroups: 0,
  }, obj);
}

function saveMeta(meta) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)
  `);
  const save = db.transaction(obj => {
    for (const [key, val] of Object.entries(obj)) {
      stmt.run(key, JSON.stringify(val));
    }
  });
  save(meta);
}

module.exports = {
  getDb,
  upsertCards,
  loadAllCards,
  loadCardsPaged,
  countCards,
  getExistingFingerprints,
  recanonicalizeGroups,
  refreshDerivedLabels,
  queryCards,
  queryCardsByIds,
  facetCounts,
  upsertAnalytic,
  searchAnalytics,
  logIngestion,
  loadMeta,
  saveMeta,
};
