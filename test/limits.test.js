'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { useTempDb } = require('./_helpers');

test('limits.hit increments counter and enforces cap', () => {
  const ctx = useTempDb();
  try {
    delete require.cache[require.resolve('../server/services/db')];
    delete require.cache[require.resolve('../server/services/limits')];
    delete require.cache[require.resolve('../server/services/auth')];
    const auth = require('../server/services/auth');
    const limits = require('../server/services/limits');
    const u = auth._insertUserSync({ email: 'lim@x.co', passwordHash: 'h' });

    assert.equal(limits.getCount(u.id, 'chat'), 0);
    for (let i = 0; i < 3; i++) limits.hit(u.id, 'chat');
    assert.equal(limits.getCount(u.id, 'chat'), 3);

    const before = limits.checkAndBudget(u.id, 'chat', 5);
    assert.equal(before.allowed, true);
    assert.equal(before.remaining, 2);

    limits.hit(u.id, 'chat'); limits.hit(u.id, 'chat');
    const after = limits.checkAndBudget(u.id, 'chat', 5);
    assert.equal(after.allowed, false);
    assert.equal(after.remaining, 0);
  } finally { ctx.cleanup(); }
});

test('enforceLimit returns 429 after cap', async () => {
  const ctx = useTempDb();
  delete require.cache[require.resolve('../server/middleware/enforceLimit')];
  delete require.cache[require.resolve('../server/middleware/requireUser')];
  const express = require('express');
  const cookieParser = require('cookie-parser');
  const auth = require('../server/services/auth');
  const requireUser = require('../server/middleware/requireUser');
  const enforceLimit = require('../server/middleware/enforceLimit');
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.post('/fake', requireUser, enforceLimit('chat', 2), (req, res) => res.json({ ok: true }));
  const srv = app.listen(0);
  const port = srv.address().port;
  try {
    const u = auth._insertUserSync({ email: 'en@l.co', passwordHash: 'h' });
    const sid = auth.createSession(u.id);
    const opts = { method: 'POST', headers: { Cookie: `verba.sid=${sid}` } };
    assert.equal((await fetch(`http://127.0.0.1:${port}/fake`, opts)).status, 200);
    assert.equal((await fetch(`http://127.0.0.1:${port}/fake`, opts)).status, 200);
    const over = await fetch(`http://127.0.0.1:${port}/fake`, opts);
    assert.equal(over.status, 429);
    const body = await over.json();
    assert.equal(body.error, 'free tier limit reached');
    assert.equal(body.kind, 'chat');
    assert.equal(body.limit, 2);
  } finally { srv.close(); ctx.cleanup(); }
});
