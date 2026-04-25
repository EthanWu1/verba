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
  _db.pragma('foreign_keys = ON');
  _db.pragma('cache_size = -40000');     // 40MB page cache (negative = KB)
  _db.pragma('mmap_size = 67108864');    // 64MB memory-mapped I/O
  _db.pragma('temp_store = MEMORY');     // temp tables/indexes in RAM
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

  try { db.exec('ALTER TABLE users ADD COLUMN nameUpdatedAt TEXT'); }
  catch (e) { /* already exists */ }

  db.exec(`
    CREATE TABLE IF NOT EXISTS wiki_teams (
      id          TEXT PRIMARY KEY,
      school      TEXT NOT NULL,
      code        TEXT NOT NULL,
      fullName    TEXT NOT NULL,
      event       TEXT,
      pageUrl     TEXT NOT NULL,
      lastCrawled TEXT,
      crawlStatus TEXT NOT NULL DEFAULT 'pending'
    );
    CREATE INDEX IF NOT EXISTS idx_wiki_teams_code   ON wiki_teams(code);
    CREATE INDEX IF NOT EXISTS idx_wiki_teams_school ON wiki_teams(school);

    CREATE VIRTUAL TABLE IF NOT EXISTS wiki_teams_fts USING fts5(
      fullName, school, code,
      content='wiki_teams', content_rowid='rowid'
    );

    CREATE TABLE IF NOT EXISTS wiki_arguments (
      id          TEXT PRIMARY KEY,
      teamId      TEXT NOT NULL REFERENCES wiki_teams(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      side        TEXT NOT NULL,
      readCount   INTEGER NOT NULL DEFAULT 0,
      fullText    TEXT NOT NULL,
      lastUpdated TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_wiki_args_team ON wiki_arguments(teamId);

    CREATE VIRTUAL TABLE IF NOT EXISTS wiki_arguments_fts USING fts5(
      name, fullText,
      content='wiki_arguments', content_rowid='rowid'
    );

    CREATE TABLE IF NOT EXISTS wiki_round_reports (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      teamId     TEXT NOT NULL REFERENCES wiki_teams(id) ON DELETE CASCADE,
      argumentId TEXT REFERENCES wiki_arguments(id) ON DELETE CASCADE,
      tournament TEXT,
      round      TEXT,
      opponent   TEXT,
      side       TEXT
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS toc_tournaments (
      tourn_id     INTEGER PRIMARY KEY,
      name         TEXT NOT NULL,
      webname      TEXT,
      city         TEXT,
      state        TEXT,
      country      TEXT,
      startDate    TEXT NOT NULL,
      endDate      TEXT NOT NULL,
      season       TEXT NOT NULL,
      lastCrawled  TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_toc_tourns_season ON toc_tournaments(season, startDate);

    CREATE TABLE IF NOT EXISTS toc_tournament_events (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      tournId      INTEGER NOT NULL REFERENCES toc_tournaments(tourn_id) ON DELETE CASCADE,
      eventId      INTEGER NOT NULL,
      abbr         TEXT NOT NULL,
      name         TEXT,
      bidLevel     TEXT,
      fullBids     INTEGER NOT NULL DEFAULT 0,
      partialBids  INTEGER NOT NULL DEFAULT 0,
      UNIQUE(tournId, eventId)
    );

    CREATE TABLE IF NOT EXISTS toc_entries (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      tournId      INTEGER NOT NULL REFERENCES toc_tournaments(tourn_id) ON DELETE CASCADE,
      eventAbbr    TEXT NOT NULL,
      entryId      INTEGER NOT NULL,
      teamKey      TEXT NOT NULL,
      schoolId     INTEGER,
      schoolName   TEXT,
      schoolCode   TEXT,
      displayName  TEXT,
      earnedBid    TEXT,
      UNIQUE(tournId, entryId)
    );
    CREATE INDEX IF NOT EXISTS idx_toc_entries_team  ON toc_entries(teamKey);
    CREATE INDEX IF NOT EXISTS idx_toc_entries_scope ON toc_entries(tournId, eventAbbr);

    CREATE TABLE IF NOT EXISTS toc_ballots (
      id               INTEGER PRIMARY KEY,
      tournId          INTEGER NOT NULL REFERENCES toc_tournaments(tourn_id) ON DELETE CASCADE,
      eventAbbr        TEXT NOT NULL,
      roundId          INTEGER NOT NULL,
      roundName        TEXT NOT NULL,
      roundType        TEXT NOT NULL,
      entryId          INTEGER NOT NULL,
      opponentEntryId  INTEGER,
      side             TEXT,
      judgeName        TEXT,
      result           TEXT,
      speakerPoints    REAL
    );
    CREATE INDEX IF NOT EXISTS idx_toc_ballots_entry ON toc_ballots(tournId, entryId, eventAbbr);
    CREATE INDEX IF NOT EXISTS idx_toc_ballots_round ON toc_ballots(tournId, roundId);

    CREATE TABLE IF NOT EXISTS toc_results (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      tournId        INTEGER NOT NULL REFERENCES toc_tournaments(tourn_id) ON DELETE CASCADE,
      eventAbbr      TEXT NOT NULL,
      entryId        INTEGER NOT NULL,
      place          TEXT,
      rank           INTEGER,
      speakerRank    INTEGER,
      speakerPoints  REAL,
      UNIQUE(tournId, entryId, eventAbbr)
    );
    CREATE INDEX IF NOT EXISTS idx_toc_results_scope ON toc_results(tournId, eventAbbr);

    CREATE TABLE IF NOT EXISTS toc_season_bids (
      season       TEXT NOT NULL,
      teamKey      TEXT NOT NULL,
      eventAbbr    TEXT NOT NULL,
      fullBids     INTEGER NOT NULL DEFAULT 0,
      partialBids  INTEGER NOT NULL DEFAULT 0,
      displayName  TEXT,
      schoolCode   TEXT,
      PRIMARY KEY (season, teamKey, eventAbbr)
    );

    CREATE TABLE IF NOT EXISTS toc_ratings (
      season       TEXT NOT NULL,
      eventAbbr    TEXT NOT NULL,
      teamKey      TEXT NOT NULL,
      displayName  TEXT,
      schoolName   TEXT,
      schoolCode   TEXT,
      rating       REAL NOT NULL DEFAULT 1500,
      roundCount   INTEGER NOT NULL DEFAULT 0,
      wins         INTEGER NOT NULL DEFAULT 0,
      losses       INTEGER NOT NULL DEFAULT 0,
      peakRating   REAL NOT NULL DEFAULT 1500,
      lastUpdated  TEXT NOT NULL,
      PRIMARY KEY (season, eventAbbr, teamKey)
    );
    CREATE INDEX IF NOT EXISTS idx_toc_ratings_board ON toc_ratings(season, eventAbbr, rating DESC);

    CREATE TABLE IF NOT EXISTS toc_rating_history (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      season         TEXT NOT NULL,
      eventAbbr      TEXT NOT NULL,
      teamKey        TEXT NOT NULL,
      tournId        INTEGER NOT NULL,
      roundId        INTEGER NOT NULL,
      roundName      TEXT,
      roundType      TEXT,
      result         TEXT,
      ratingBefore   REAL NOT NULL,
      ratingAfter    REAL NOT NULL,
      change         REAL NOT NULL,
      opponentKey    TEXT,
      opponentRating REAL,
      occurredAt     TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_toc_rating_history_scope ON toc_rating_history(teamKey, eventAbbr, season, occurredAt);
    CREATE INDEX IF NOT EXISTS idx_toc_rating_history_tourn ON toc_rating_history(teamKey, tournId);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_threads (
      id         TEXT PRIMARY KEY,
      userId     TEXT NOT NULL,
      title      TEXT NOT NULL,
      archived   INTEGER NOT NULL DEFAULT 0,
      createdAt  INTEGER NOT NULL,
      updatedAt  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chat_threads_user
      ON chat_threads(userId, archived, updatedAt DESC);

    CREATE TABLE IF NOT EXISTS chat_messages (
      id         TEXT PRIMARY KEY,
      threadId   TEXT NOT NULL,
      role       TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
      content    TEXT NOT NULL,
      command    TEXT NULL,
      blockJson  TEXT NULL,
      createdAt  INTEGER NOT NULL,
      FOREIGN KEY (threadId) REFERENCES chat_threads(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_chat_messages_thread
      ON chat_messages(threadId, createdAt);

    CREATE TABLE IF NOT EXISTS chat_context (
      id          TEXT PRIMARY KEY,
      userId      TEXT NOT NULL,
      name        TEXT NOT NULL,
      kind        TEXT NOT NULL,
      wordCount   INTEGER NOT NULL,
      content     TEXT NOT NULL,
      createdAt   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chat_context_user
      ON chat_context(userId, createdAt DESC);

    CREATE VIRTUAL TABLE IF NOT EXISTS chat_context_fts USING fts5(
      content, name,
      content='chat_context', content_rowid='rowid'
    );
    CREATE TRIGGER IF NOT EXISTS chat_context_ai AFTER INSERT ON chat_context BEGIN
      INSERT INTO chat_context_fts(rowid, content, name) VALUES (new.rowid, new.content, new.name);
    END;
    CREATE TRIGGER IF NOT EXISTS chat_context_ad AFTER DELETE ON chat_context BEGIN
      INSERT INTO chat_context_fts(chat_context_fts, rowid, content, name) VALUES ('delete', old.rowid, old.content, old.name);
    END;
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS user_tabroom_links (
      id           TEXT PRIMARY KEY,
      userId       TEXT NOT NULL,
      teamCode     TEXT NOT NULL,
      schoolName   TEXT,
      schoolCode   TEXT,
      verifiedAt   INTEGER,
      createdAt    INTEGER NOT NULL,
      UNIQUE(userId, teamCode, schoolName)
    );
    CREATE INDEX IF NOT EXISTS idx_utl_user ON user_tabroom_links(userId);

    CREATE TABLE IF NOT EXISTS tabroom_tournament_cache (
      tournId      INTEGER PRIMARY KEY,
      name         TEXT NOT NULL,
      startDate    TEXT,
      endDate      TEXT,
      fetchedAt    INTEGER NOT NULL,
      rawJson      BLOB NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tabroom_entry_index (
      tournId      INTEGER NOT NULL,
      teamCode     TEXT NOT NULL,
      schoolName   TEXT NOT NULL,
      entryId      INTEGER NOT NULL,
      eventAbbr    TEXT NOT NULL,
      eventName    TEXT NOT NULL,
      studentNames TEXT NOT NULL,
      dropped      INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (tournId, entryId)
    );
    CREATE INDEX IF NOT EXISTS idx_tei_code ON tabroom_entry_index(teamCode, eventAbbr);
  `);
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
  // v6: highlightWordCount — number of words inside <u>...</u> or ==...== spans.
  const needWordCountBackfill = !cols2.includes('highlightWordCount');
  if (needWordCountBackfill) db.exec("ALTER TABLE cards ADD COLUMN highlightWordCount INTEGER NOT NULL DEFAULT 0");
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_cards_typeLabel       ON cards(typeLabel);
    CREATE INDEX IF NOT EXISTS idx_cards_topicLabel      ON cards(topicLabel);
    CREATE INDEX IF NOT EXISTS idx_cards_sourceLabel     ON cards(sourceLabel);
    CREATE INDEX IF NOT EXISTS idx_cards_scope           ON cards(scope);
    CREATE INDEX IF NOT EXISTS idx_cards_resolutionLabel ON cards(resolutionLabel);
    CREATE INDEX IF NOT EXISTS idx_cards_importedAt      ON cards(importedAt);
    CREATE INDEX IF NOT EXISTS idx_cards_warrantDensity  ON cards(warrantDensity);
    CREATE INDEX IF NOT EXISTS idx_cards_hasHighlight    ON cards(hasHighlight);
    CREATE INDEX IF NOT EXISTS idx_cards_highlightWordCount ON cards(highlightWordCount);

    -- Partial indexes on hasHighlight=1 rows for facet hot path (48k of 157k rows).
    -- facetCounts filters WHERE hasHighlight=1 AND col IS NOT NULL AND col != ''
    -- and groups by col — a covering partial index makes each group a single seek.
    CREATE INDEX IF NOT EXISTS idx_cards_hl_res    ON cards(resolutionLabel) WHERE hasHighlight = 1;
    CREATE INDEX IF NOT EXISTS idx_cards_hl_type   ON cards(typeLabel)       WHERE hasHighlight = 1;
    CREATE INDEX IF NOT EXISTS idx_cards_hl_topic  ON cards(topicLabel)      WHERE hasHighlight = 1;
    CREATE INDEX IF NOT EXISTS idx_cards_hl_source ON cards(sourceLabel)     WHERE hasHighlight = 1;
    CREATE INDEX IF NOT EXISTS idx_cards_hl_scope  ON cards(scope)           WHERE hasHighlight = 1;

    -- Covering indexes for analytics COUNT(DISTINCT ...) hot path.
    CREATE INDEX IF NOT EXISTS idx_cards_school_distinct     ON cards(school);
    CREATE INDEX IF NOT EXISTS idx_cards_resolution_distinct ON cards(resolutionLabel);

    -- Composite for default list sort: ORDER BY hasHighlight DESC, isCanonical DESC, variantCount DESC, importedAt DESC
    -- Without this, every unfiltered list scan sorts 157k rows (8s+).
    CREATE INDEX IF NOT EXISTS idx_cards_default_sort ON cards(hasHighlight DESC, isCanonical DESC, variantCount DESC, importedAt DESC);
  `);
  if (needBackfill) _backfillDerivedLabels(db);
  if (needHighlightBackfill) _backfillHasHighlight(db);
  if (needWordCountBackfill) _backfillHighlightWordCount(db);
  _setupCardsFts(db);
  _ensureAnalyzed(db);
}

function _ensureAnalyzed(db) {
  try {
    const statTblRows = db.prepare(
      "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='sqlite_stat1'"
    ).get();
    const hasStatTable = statTblRows && statTblRows.n > 0;
    const row = hasStatTable
      ? db.prepare("SELECT COUNT(*) AS n FROM sqlite_stat1").get()
      : { n: 0 };
    if (!row.n) {
      console.log('[db] ANALYZE (first run, may take a few seconds)...');
      const t = Date.now();
      db.exec('ANALYZE');
      console.log(`[db] ANALYZE done (${Date.now() - t}ms)`);
    }
  } catch (err) {
    console.warn('[db] ANALYZE skipped:', err.message);
  }
}

function _setupCardsFts(db) {
  const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='cards_fts'").get();
  if (!exists) {
    console.log('[db] creating cards_fts FTS5 index...');
    const t0 = Date.now();
    db.exec(`
      CREATE VIRTUAL TABLE cards_fts USING fts5(
        tag, shortCite, cite, body_plain,
        content='cards', content_rowid='rowid',
        tokenize='unicode61 remove_diacritics 2'
      );
      CREATE TRIGGER cards_fts_ai AFTER INSERT ON cards BEGIN
        INSERT INTO cards_fts(rowid, tag, shortCite, cite, body_plain)
        VALUES (new.rowid, new.tag, new.shortCite, new.cite, new.body_plain);
      END;
      CREATE TRIGGER cards_fts_ad AFTER DELETE ON cards BEGIN
        INSERT INTO cards_fts(cards_fts, rowid, tag, shortCite, cite, body_plain)
        VALUES ('delete', old.rowid, old.tag, old.shortCite, old.cite, old.body_plain);
      END;
      CREATE TRIGGER cards_fts_au AFTER UPDATE ON cards BEGIN
        INSERT INTO cards_fts(cards_fts, rowid, tag, shortCite, cite, body_plain)
        VALUES ('delete', old.rowid, old.tag, old.shortCite, old.cite, old.body_plain);
        INSERT INTO cards_fts(rowid, tag, shortCite, cite, body_plain)
        VALUES (new.rowid, new.tag, new.shortCite, new.cite, new.body_plain);
      END;
    `);
    db.exec(`INSERT INTO cards_fts(cards_fts) VALUES('rebuild')`);
    console.log(`[db] cards_fts built in ${Date.now() - t0}ms`);
    return;
  }
  // Repair: FTS exists but may be empty if the initial rebuild ran on an empty DB
  // and cards were bulk-imported before triggers fired correctly.
  try {
    const docCount = db.prepare("SELECT COUNT(*) as n FROM cards_fts_docsize").get().n;
    if (docCount === 0 && db.prepare("SELECT 1 FROM cards LIMIT 1").get()) {
      console.log('[db] FTS index empty, rebuilding from cards table...');
      const t0 = Date.now();
      db.exec(`INSERT INTO cards_fts(cards_fts) VALUES('rebuild')`);
      console.log(`[db] FTS rebuilt in ${Date.now() - t0}ms`);
    }
  } catch (e) {
    console.warn('[db] FTS health check skipped:', e.message);
  }
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

function _countHighlightWords(bodyMarkdown) {
  const src = String(bodyMarkdown || '');
  if (!src) return 0;
  const re = /<u>([\s\S]*?)<\/u>|==([\s\S]*?)==/g;
  let total = 0;
  let m;
  while ((m = re.exec(src)) !== null) {
    const inner = (m[1] || m[2] || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[*_=]/g, ' ')
      .replace(/\u00B6/g, ' ');
    const words = inner.split(/\s+/).filter(Boolean);
    total += words.length;
  }
  return total;
}

function _backfillHighlightWordCount(db) {
  console.log('[db] backfilling highlightWordCount...');
  const t0 = Date.now();
  const selectStmt = db.prepare('SELECT rowid, body_markdown FROM cards');
  const updateStmt = db.prepare('UPDATE cards SET highlightWordCount = ? WHERE rowid = ?');
  let processed = 0;
  const tx = db.transaction(() => {
    for (const row of selectStmt.iterate()) {
      updateStmt.run(_countHighlightWords(row.body_markdown), row.rowid);
      processed++;
    }
  });
  tx();
  console.log(`[db] highlightWordCount set on ${processed} rows in ${Date.now() - t0}ms`);
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
     typeLabel, topicLabel, sourceLabel, scope, resolutionLabel, hasHighlight, highlightWordCount)
  VALUES
    (@id, @zipPath, @sourceEntry, @sourceFileName, @division, @school, @squad,
     @tag, @cite, @shortCite, @body_markdown, @body_plain, @warrantDensity,
     @contentFingerprint, @foundAt, @importedAt, @topicBucket, @argumentTypes, @argumentTags,
     @sourceKind, @isCanonical, @canonicalGroupKey, @variantCount,
     @typeLabel, @topicLabel, @sourceLabel, @scope, @resolutionLabel, @hasHighlight, @highlightWordCount)
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
        highlightWordCount: _countHighlightWords(card.body_markdown || ''),
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

function _buildWhere(filters, { tablePrefix = '' } = {}) {
  const p = tablePrefix ? `${tablePrefix}.` : '';
  const where = [`${p}hasHighlight = 1`];
  const params = [];
  if (Number(filters.minHighlight) > 0) {
    where.push(`${p}highlightWordCount >= ?`);
    params.push(Number(filters.minHighlight));
  }
  if (filters.scope === 'my')     { where.push(`${p}scope = ?`); params.push('my'); }
  if (filters.scope === 'public') { where.push(`${p}scope = ?`); params.push('public'); }
  if (filters.type) {
    where.push(`LOWER(${p}typeLabel) = ?`);
    params.push(String(filters.type).toLowerCase());
  }
  if (filters.topic) {
    where.push(`${p}topicLabel = ?`); params.push(filters.topic);
  }
  if (filters.resolution) {
    where.push(`${p}resolutionLabel = ?`); params.push(filters.resolution);
  }
  if (filters.source) {
    where.push(`${p}sourceLabel = ?`); params.push(filters.source);
  }
  if (filters.canonical === 'true')  where.push(`${p}isCanonical = 1`);
  if (filters.canonical === 'false') where.push(`${p}isCanonical = 0`);
  return { sql: `WHERE ${where.join(' AND ')}`, params };
}

function _buildFtsMatch(q) {
  const tokens = String(q || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  const filtered = tokens.filter(t => t.length >= 2);
  if (!filtered.length) return null;
  return filtered.map(t => `"${t.replace(/"/g, '""')}"*`).join(' ');
}

const LIST_COLS = `id, zipPath, sourceEntry, sourceFileName, division, school, squad,
  tag, cite, shortCite, warrantDensity, foundAt, importedAt, topicBucket,
  argumentTypes, argumentTags, sourceKind, isCanonical, canonicalGroupKey,
  variantCount, typeLabel, topicLabel, sourceLabel, scope, resolutionLabel, hasHighlight, highlightWordCount`;

function _seedSortClause(seed, prefix = '') {
  const s = Math.max(1, Math.abs(Number(seed) || 1)) | 0;
  const col = prefix ? `${prefix}rowid` : 'rowid';
  return `ORDER BY ((${col} * ${s} + ${(s * 2654435761) >>> 0}) % 2147483647) ASC`;
}

function _orderBy(sort, seed) {
  switch (sort) {
    case 'recent':   return 'ORDER BY hasHighlight DESC, importedAt DESC';
    case 'density':  return 'ORDER BY hasHighlight DESC, warrantDensity DESC';
    case 'variants': return 'ORDER BY hasHighlight DESC, variantCount DESC';
    case 'cite':     return 'ORDER BY hasHighlight DESC, COALESCE(shortCite, cite) ASC';
    case 'school':   return 'ORDER BY hasHighlight DESC, school ASC';
    case 'tag':      return 'ORDER BY hasHighlight DESC, tag ASC';
    case 'random':   return _seedSortClause(seed);
    default:         return 'ORDER BY hasHighlight DESC, isCanonical DESC, variantCount DESC, importedAt DESC';
  }
}

function queryCards({ filters = {}, sort = 'relevance', page = 1, limit = 40, lite = false }) {
  const db = getDb();
  const cols = lite ? LIST_COLS : '*';
  const ftsMatch = filters.q ? _buildFtsMatch(filters.q) : null;

  if (ftsMatch) {
    const { sql: whereBase, params } = _buildWhere(filters, { tablePrefix: 'c' });
    const whereSql = `${whereBase} AND cards_fts MATCH ?`;
    const orderSql = _orderByWithRank(sort, filters.randomSeed);
    const prefixed = (lite ? LIST_COLS : '*')
      .split(',').map(s => s.trim())
      .map(s => s === '*' ? 'c.*' : `c.${s}`)
      .join(', ');
    const totalSql = `SELECT COUNT(*) AS n FROM cards c JOIN cards_fts ON cards_fts.rowid = c.rowid ${whereSql}`;
    const selSql = `SELECT ${prefixed} FROM cards c JOIN cards_fts ON cards_fts.rowid = c.rowid ${whereSql} ${orderSql} LIMIT ? OFFSET ?`;
    const total = db.prepare(totalSql).get(...params, ftsMatch).n;
    const rows = db.prepare(selSql).all(...params, ftsMatch, limit, (page - 1) * limit);
    return { total, rows: rows.map(_parseCard) };
  }

  const { sql: whereSql, params } = _buildWhere(filters);
  const orderSql = _orderBy(sort, filters.randomSeed);
  const total = db.prepare(`SELECT COUNT(*) AS n FROM cards ${whereSql}`).get(...params).n;
  const rows = db.prepare(`SELECT ${cols} FROM cards ${whereSql} ${orderSql} LIMIT ? OFFSET ?`)
                 .all(...params, limit, (page - 1) * limit);
  return { total, rows: rows.map(_parseCard) };
}

function _orderByWithRank(sort, seed) {
  switch (sort) {
    case 'recent':   return 'ORDER BY c.hasHighlight DESC, c.importedAt DESC';
    case 'density':  return 'ORDER BY c.hasHighlight DESC, c.warrantDensity DESC';
    case 'variants': return 'ORDER BY c.hasHighlight DESC, c.variantCount DESC';
    case 'cite':     return 'ORDER BY c.hasHighlight DESC, COALESCE(c.shortCite, c.cite) ASC';
    case 'school':   return 'ORDER BY c.hasHighlight DESC, c.school ASC';
    case 'tag':      return 'ORDER BY c.hasHighlight DESC, c.tag ASC';
    case 'random':   return _seedSortClause(seed, 'c.');
    default:         return 'ORDER BY c.hasHighlight DESC, c.isCanonical DESC, bm25(cards_fts) ASC';
  }
}

function getCardById(id) {
  if (!id) return null;
  const row = getDb().prepare('SELECT * FROM cards WHERE id = ?').get(String(id));
  return _parseCard(row);
}

function queryCardsByIds(ids, filters = {}, opts = {}) {
  if (!ids || !ids.length) return [];
  const db = getDb();
  // Hard cap — prevents OOM when semantic ranker returns too many ids.
  const MAX_IDS = Math.max(1, Math.min(500, Number(opts.maxIds) || 500));
  const idList = ids.slice(0, MAX_IDS);
  const { sql: whereSql, params } = _buildWhere(filters);
  const placeholders = idList.map(() => '?').join(',');
  const combined = whereSql
    ? `${whereSql} AND id IN (${placeholders})`
    : `WHERE id IN (${placeholders})`;
  const cols = opts.lite ? LIST_COLS : '*';
  return db.prepare(`SELECT ${cols} FROM cards ${combined}`)
           .all(...params, ...idList)
           .map(_parseCard);
}

function facetCounts(scope = null, limit = 20) {
  const db = getDb();
  // One round-trip via UNION ALL — each subquery still hits a partial index
  // (idx_cards_hl_*) but we save 3 prepare/execute round-trips. Each subquery
  // is wrapped in `SELECT * FROM (... LIMIT N)` because LIMIT isn't allowed
  // on individual UNION ALL members in SQLite.
  const scopeClause = scope ? ' AND scope = ?' : '';
  const sub = (col, lim) => `
    SELECT * FROM (
      SELECT '${col}' AS kind, ${col} AS label, COUNT(*) AS count
      FROM cards
      WHERE hasHighlight = 1${scopeClause}
        AND ${col} IS NOT NULL AND ${col} != ''
      GROUP BY ${col} ORDER BY count DESC, label ASC LIMIT ${Number(lim) | 0}
    )
  `;
  const params = [];
  if (scope) params.push(scope, scope, scope, scope);
  const sql = [
    sub('resolutionLabel', limit),
    sub('typeLabel',       limit),
    sub('topicLabel',      limit),
    sub('sourceLabel',     10),
  ].join(' UNION ALL ');
  const rows = db.prepare(sql).all(...params);
  const out = { resolutions: [], types: [], topics: [], sources: [] };
  for (const r of rows) {
    const entry = { label: r.label, count: r.count };
    if      (r.kind === 'resolutionLabel') out.resolutions.push(entry);
    else if (r.kind === 'typeLabel')       out.types.push(entry);
    else if (r.kind === 'topicLabel')      out.topics.push(entry);
    else if (r.kind === 'sourceLabel')     out.sources.push(entry);
  }
  return out;
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

// Cache the parsed meta object at module scope. Reads parse JSON for every
// key (~6 keys) and run on hot paths (every getLibraryCards call).
let _metaCache = null;
function loadMeta() {
  if (_metaCache) return _metaCache;
  const rows = getDb().prepare('SELECT key, value FROM meta').all();
  const obj = {};
  for (const row of rows) {
    try { obj[row.key] = JSON.parse(row.value); } catch { obj[row.key] = row.value; }
  }
  _metaCache = Object.assign({
    lastImport: null,
    importedZip: '',
    totalCards: 0,
    totalDocs: 0,
    citationGroups: 0,
    canonicalGroups: 0,
  }, obj);
  return _metaCache;
}

function saveMeta(meta) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)
  `);
  const save = db.transaction(obj => {
    for (const [key, val] of Object.entries(obj)) {
      if (val === undefined) continue;
      const json = JSON.stringify(val);
      if (json === undefined) continue;
      stmt.run(key, json);
    }
  });
  save(meta);
  _metaCache = null; // invalidate on write
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
  getCardById,
  facetCounts,
  upsertAnalytic,
  searchAnalytics,
  logIngestion,
  loadMeta,
  saveMeta,
};
