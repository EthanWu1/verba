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

test('createUser + findUserByEmail + verifyPassword', async () => {
  const ctx = useTempDb();
  try {
    delete require.cache[require.resolve('../server/services/db')];
    delete require.cache[require.resolve('../server/services/auth')];
    const auth = require('../server/services/auth');
    const u = await auth.createUser({ email: 'a@b.co', password: 'hunter22hunter22', name: 'A' });
    assert.ok(u.id);
    assert.equal(u.email, 'a@b.co');
    const found = auth.findUserByEmail('a@b.co');
    assert.equal(found.id, u.id);
    assert.equal(await auth.verifyPassword(found, 'hunter22hunter22'), true);
    assert.equal(await auth.verifyPassword(found, 'wrong'), false);
  } finally { ctx.cleanup(); }
});

test('createSession + validateSession + deleteSession', () => {
  const ctx = useTempDb();
  try {
    delete require.cache[require.resolve('../server/services/db')];
    delete require.cache[require.resolve('../server/services/auth')];
    const auth = require('../server/services/auth');
    const u = auth._insertUserSync({ email: 'x@y.co', passwordHash: 'h', name: 'X' });
    const sid = auth.createSession(u.id);
    assert.equal(typeof sid, 'string');
    assert.ok(sid.length >= 32);
    const sess = auth.validateSession(sid);
    assert.equal(sess.user.id, u.id);
    auth.deleteSession(sid);
    assert.equal(auth.validateSession(sid), null);
  } finally { ctx.cleanup(); }
});

test('requireUser rejects missing cookie and accepts valid session', (t, done) => {
  const ctx = useTempDb();
  try {
    delete require.cache[require.resolve('../server/services/db')];
    delete require.cache[require.resolve('../server/services/auth')];
    delete require.cache[require.resolve('../server/middleware/requireUser')];
    const express = require('express');
    const cookieParser = require('cookie-parser');
    const auth = require('../server/services/auth');
    const requireUser = require('../server/middleware/requireUser');

    const app = express();
    app.use(cookieParser());
    app.get('/who', requireUser, (req, res) => res.json({ id: req.user.id }));

    const u = auth._insertUserSync({ email: 'r@q.co', passwordHash: 'h' });
    const sid = auth.createSession(u.id);

    const srv = app.listen(0, async () => {
      const port = srv.address().port;
      const noCookie = await fetch(`http://127.0.0.1:${port}/who`);
      assert.equal(noCookie.status, 401);
      const ok = await fetch(`http://127.0.0.1:${port}/who`, { headers: { Cookie: `verba.sid=${sid}` } });
      assert.equal(ok.status, 200);
      const body = await ok.json();
      assert.equal(body.id, u.id);
      srv.close(() => { ctx.cleanup(); done(); });
    });
  } catch (e) { ctx.cleanup(); done(e); }
});
