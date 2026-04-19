'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { useTempDb } = require('./_helpers');

test('db migration creates auth tables', () => {
  const ctx = useTempDb();
  try {
    delete require.cache[require.resolve('../server/services/db')];
    const { getDb } = require('../server/services/db');
    const db = getDb();
    const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
    for (const t of ['users', 'sessions', 'user_projects', 'user_saved_cards', 'user_history', 'usage_counters', 'password_resets']) {
      assert.ok(names.includes(t), `missing table: ${t}`);
    }
  } finally {
    ctx.cleanup();
  }
});
