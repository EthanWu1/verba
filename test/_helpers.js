'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

function useTempDb() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verba-test-'));
  const dbPath = path.join(tmp, 'test.db');
  process.env.DB_PATH = dbPath;
  return {
    dbPath,
    cleanup() {
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
    },
  };
}

module.exports = { useTempDb };
