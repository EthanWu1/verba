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

async function bootApp() {
  delete require.cache[require.resolve('../server/services/db')];
  delete require.cache[require.resolve('../server/services/auth')];
  delete require.cache[require.resolve('../server/middleware/requireUser')];
  delete require.cache[require.resolve('../server/routes/auth')];
  const express = require('express');
  const cookieParser = require('cookie-parser');
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', require('../server/routes/auth'));
  return new Promise((resolve) => {
    const srv = app.listen(0, () => resolve({ srv, port: srv.address().port }));
  });
}

test('POST /api/auth/signup creates user + sets cookie', async () => {
  const ctx = useTempDb();
  const { srv, port } = await bootApp();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'n@w.co', password: 'hunter22hunter22', name: 'N' }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.user.email, 'n@w.co');
    assert.match(res.headers.get('set-cookie') || '', /verba\.sid=/);
    assert.match(res.headers.get('set-cookie') || '', /HttpOnly/i);
  } finally { srv.close(); ctx.cleanup(); }
});

test('POST /api/auth/signup rejects duplicate email', async () => {
  const ctx = useTempDb();
  const { srv, port } = await bootApp();
  try {
    const payload = { email: 'd@u.co', password: 'hunter22hunter22' };
    const r1 = await fetch(`http://127.0.0.1:${port}/api/auth/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    assert.equal(r1.status, 201);
    const r2 = await fetch(`http://127.0.0.1:${port}/api/auth/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    assert.equal(r2.status, 409);
  } finally { srv.close(); ctx.cleanup(); }
});

test('POST /api/auth/login success + wrong password', async () => {
  const ctx = useTempDb();
  const { srv, port } = await bootApp();
  try {
    await fetch(`http://127.0.0.1:${port}/api/auth/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'l@i.co', password: 'hunter22hunter22' }) });
    const good = await fetch(`http://127.0.0.1:${port}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'l@i.co', password: 'hunter22hunter22' }) });
    assert.equal(good.status, 200);
    assert.match(good.headers.get('set-cookie') || '', /verba\.sid=/);
    const bad = await fetch(`http://127.0.0.1:${port}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'l@i.co', password: 'WRONG' }) });
    assert.equal(bad.status, 401);
  } finally { srv.close(); ctx.cleanup(); }
});

test('GET /api/auth/me returns user for valid cookie, 401 without', async () => {
  const ctx = useTempDb();
  const { srv, port } = await bootApp();
  try {
    const s = await fetch(`http://127.0.0.1:${port}/api/auth/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'm@e.co', password: 'hunter22hunter22' }) });
    const cookie = s.headers.get('set-cookie').split(';')[0];
    const who = await fetch(`http://127.0.0.1:${port}/api/auth/me`, { headers: { Cookie: cookie } });
    assert.equal(who.status, 200);
    assert.equal((await who.json()).user.email, 'm@e.co');
    const anon = await fetch(`http://127.0.0.1:${port}/api/auth/me`);
    assert.equal(anon.status, 401);
  } finally { srv.close(); ctx.cleanup(); }
});

test('POST /api/auth/logout clears session', async () => {
  const ctx = useTempDb();
  const { srv, port } = await bootApp();
  try {
    const s = await fetch(`http://127.0.0.1:${port}/api/auth/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'o@u.co', password: 'hunter22hunter22' }) });
    const cookie = s.headers.get('set-cookie').split(';')[0];
    const out = await fetch(`http://127.0.0.1:${port}/api/auth/logout`, { method: 'POST', headers: { Cookie: cookie } });
    assert.equal(out.status, 200);
    const who = await fetch(`http://127.0.0.1:${port}/api/auth/me`, { headers: { Cookie: cookie } });
    assert.equal(who.status, 401);
  } finally { srv.close(); ctx.cleanup(); }
});

test('POST /api/auth/google rejects invalid token', async () => {
  const ctx = useTempDb();
  process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
  const { srv, port } = await bootApp();
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/auth/google`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: 'not-a-real-token' }),
    });
    assert.equal(r.status, 401);
  } finally { srv.close(); ctx.cleanup(); }
});

test('POST /api/auth/forgot creates token even for unknown email (no enumeration)', async () => {
  const ctx = useTempDb();
  process.env.SMTP_SKIP = '1';
  process.env.PUBLIC_BASE_URL = 'http://localhost:3000';
  const { srv, port } = await bootApp();
  try {
    const sent = await fetch(`http://127.0.0.1:${port}/api/auth/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'f@r.co', password: 'hunter22hunter22' }) });
    assert.equal(sent.status, 201);
    const known = await fetch(`http://127.0.0.1:${port}/api/auth/forgot`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'f@r.co' }) });
    assert.equal(known.status, 200);
    assert.equal((await known.json()).ok, true);
    const unknown = await fetch(`http://127.0.0.1:${port}/api/auth/forgot`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'nobody@nope.co' }) });
    assert.equal(unknown.status, 200);
    assert.equal((await unknown.json()).ok, true);
  } finally { srv.close(); ctx.cleanup(); }
});
