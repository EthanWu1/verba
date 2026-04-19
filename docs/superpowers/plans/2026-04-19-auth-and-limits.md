# Auth + Per-User Scoping + Free Tier Limits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add email/password + Google One Tap authentication with per-user data (projects, saved cards, history), free-tier rate limits on chat + card-cut endpoints, and password reset via email.

**Architecture:** httpOnly cookie session IDs stored in a `sessions` table, bcryptjs password hashes, Google Identity Services ID tokens verified server-side via `google-auth-library`. New per-user tables (`user_projects`, `user_saved_cards`, `user_history`, `usage_counters`, `password_resets`) live in the existing SQLite DB. Daily rate limits enforced by middleware reading `usage_counters`. Password reset uses a signed random token emailed via nodemailer.

**Tech Stack:** Node 18+, Express, better-sqlite3 (existing), bcryptjs, cookie-parser, google-auth-library, nodemailer, vanilla HTML/JS frontend, node `--test` runner.

**Scope (non-goals):** No migration of existing `server/data/projects.json` or client `localStorage` data. Library `cards` table stays shared corpus. No email verification on signup. No premium tier billing (column reserved only).

---

## File Structure

**Create:**
- `server/services/auth.js` — password hashing, session create/validate/delete, user CRUD.
- `server/services/emailSender.js` — nodemailer wrapper.
- `server/services/limits.js` — usage-counter read/write + limit check.
- `server/middleware/requireUser.js` — session cookie → `req.user`.
- `server/middleware/enforceLimit.js` — per-kind daily limit middleware factory.
- `server/routes/auth.js` — signup/login/logout/me/google/forgot/reset.
- `server/routes/mine.js` — per-user saved cards CRUD.
- `server/routes/history.js` — per-user history CRUD.
- `public/forgot.html` — request reset form.
- `public/reset.html` — set new password form (reads token from URL).
- `test/auth.test.js`
- `test/limits.test.js`
- `test/user-scoping.test.js`
- `test/_helpers.js` — shared test bootstrap (temp DB path).

**Modify:**
- `server/services/db.js` — env-overridable `DB_PATH`, new tables, migrations.
- `server/routes/projects.js` — move backing store from `projects.json` to `user_projects` table, require auth.
- `server/routes/chat.js` — attach `requireUser` + `enforceLimit('chat', 20)`.
- `server/routes/ai.js` — attach `requireUser` + `enforceLimit('cutCard', 10)` on `/cut-card`.
- `server/index.js` — cookie-parser, mount new routes, add `/forgot` + `/reset` HTML routes.
- `public/signin.html` — wire form + GIS button to API.
- `public/app-main.js` — bootstrap checks `/api/auth/me`, redirects to `/signin` on 401; swap `mine`/`history` from localStorage to API; surface 429 errors.
- `public/api.js` — auth methods, API-backed `mine` + `history`.
- `package.json` — add deps.
- `.env.example` — new keys.

---

## Task 1: DB schema — users, sessions, per-user data, limits

**Files:**
- Modify: `server/services/db.js`
- Create: `test/_helpers.js`
- Test: `test/auth.test.js` (first block only)

- [ ] **Step 1: Allow DB_PATH env override in db.js**

Replace the top of `server/services/db.js`:

```javascript
const DATA_DIR = path.resolve(__dirname, '..', 'data');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'library.db');
```

- [ ] **Step 2: Create test helper**

Write `test/_helpers.js`:

```javascript
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
```

- [ ] **Step 3: Write the failing test**

Write `test/auth.test.js`:

```javascript
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
```

- [ ] **Step 4: Run — expect FAIL**

Run: `node --test test/auth.test.js`
Expected: FAIL with "missing table: users".

- [ ] **Step 5: Add tables in `_initSchema` in `server/services/db.js`**

Append inside the `db.exec(\`...\`)` call in `_initSchema`:

```sql
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
  id         TEXT PRIMARY KEY,
  userId     TEXT NOT NULL,
  createdAt  TEXT NOT NULL,
  expiresAt  TEXT NOT NULL,
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
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
```

- [ ] **Step 6: Run — expect PASS**

Run: `node --test test/auth.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/services/db.js test/auth.test.js test/_helpers.js
git commit -m "feat(db): add auth + per-user + limits tables"
```

---

## Task 2: Auth service — hashing, sessions, user CRUD

**Files:**
- Create: `server/services/auth.js`
- Modify: `test/auth.test.js`

- [ ] **Step 1: Install dependencies**

Run: `npm install bcryptjs cookie-parser`
Expected: both added to `package.json` dependencies.

- [ ] **Step 2: Write failing tests — append to `test/auth.test.js`**

```javascript
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
```

- [ ] **Step 3: Run — expect FAIL**

Run: `node --test test/auth.test.js`
Expected: FAIL with "Cannot find module '../server/services/auth'".

- [ ] **Step 4: Implement `server/services/auth.js`**

```javascript
'use strict';
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { getDb } = require('./db');

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function _newId(prefix) {
  return prefix + '_' + crypto.randomBytes(12).toString('hex');
}

function _insertUserSync({ email, passwordHash = null, googleSub = null, name = null }) {
  const db = getDb();
  const id = _newId('u');
  const createdAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO users (id, email, passwordHash, googleSub, name, tier, createdAt)
    VALUES (?, ?, ?, ?, ?, 'free', ?)
  `).run(id, email.toLowerCase(), passwordHash, googleSub, name, createdAt);
  return { id, email: email.toLowerCase(), passwordHash, googleSub, name, tier: 'free', createdAt };
}

async function createUser({ email, password, name = null }) {
  if (!email || !password) throw new Error('email and password required');
  if (password.length < 8) throw new Error('password must be >= 8 chars');
  const passwordHash = await bcrypt.hash(password, 10);
  try {
    return _insertUserSync({ email, passwordHash, name });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) throw new Error('email already registered');
    throw err;
  }
}

function findUserByEmail(email) {
  return getDb().prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').toLowerCase()) || null;
}

function findUserById(id) {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id) || null;
}

function findUserByGoogleSub(sub) {
  return getDb().prepare('SELECT * FROM users WHERE googleSub = ?').get(sub) || null;
}

function linkGoogleSub(userId, sub) {
  getDb().prepare('UPDATE users SET googleSub = ? WHERE id = ?').run(sub, userId);
}

async function verifyPassword(user, password) {
  if (!user || !user.passwordHash) return false;
  return bcrypt.compare(password, user.passwordHash);
}

function createSession(userId) {
  const db = getDb();
  const id = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  db.prepare('INSERT INTO sessions (id, userId, createdAt, expiresAt) VALUES (?, ?, ?, ?)')
    .run(id, userId, new Date(now).toISOString(), new Date(now + SESSION_TTL_MS).toISOString());
  return id;
}

function validateSession(sessionId) {
  if (!sessionId) return null;
  const db = getDb();
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  if (!row) return null;
  if (new Date(row.expiresAt).getTime() < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    return null;
  }
  const user = findUserById(row.userId);
  if (!user) return null;
  return { session: row, user };
}

function deleteSession(sessionId) {
  if (!sessionId) return;
  getDb().prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

function updatePassword(userId, newPassword) {
  const hash = bcrypt.hashSync(newPassword, 10);
  getDb().prepare('UPDATE users SET passwordHash = ? WHERE id = ?').run(hash, userId);
}

module.exports = {
  createUser, findUserByEmail, findUserById, findUserByGoogleSub, linkGoogleSub,
  verifyPassword, createSession, validateSession, deleteSession, updatePassword,
  _insertUserSync,
};
```

- [ ] **Step 5: Run — expect PASS**

Run: `node --test test/auth.test.js`
Expected: all three tests PASS.

- [ ] **Step 6: Commit**

```bash
git add server/services/auth.js test/auth.test.js package.json package-lock.json
git commit -m "feat(auth): user + session service with bcrypt"
```

---

## Task 3: requireUser middleware

**Files:**
- Create: `server/middleware/requireUser.js`
- Modify: `server/index.js` (add cookie-parser)
- Test: `test/auth.test.js`

- [ ] **Step 1: Write failing test — append to `test/auth.test.js`**

```javascript
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
```

- [ ] **Step 2: Run — expect FAIL**

Run: `node --test test/auth.test.js`
Expected: FAIL "Cannot find module '../server/middleware/requireUser'".

- [ ] **Step 3: Implement middleware**

Write `server/middleware/requireUser.js`:

```javascript
'use strict';
const { validateSession } = require('../services/auth');

function requireUser(req, res, next) {
  const sid = req.cookies && req.cookies['verba.sid'];
  const ctx = validateSession(sid);
  if (!ctx) return res.status(401).json({ error: 'not authenticated' });
  req.user = ctx.user;
  req.sessionId = ctx.session.id;
  next();
}

module.exports = requireUser;
```

- [ ] **Step 4: Register cookie-parser in `server/index.js`**

After `const path = require('path');` add:

```javascript
const cookieParser = require('cookie-parser');
```

After `app.use(express.urlencoded({ extended: true }));` add:

```javascript
app.use(cookieParser());
```

- [ ] **Step 5: Run — expect PASS**

Run: `node --test test/auth.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/middleware/requireUser.js server/index.js test/auth.test.js
git commit -m "feat(auth): requireUser middleware + cookie parser"
```

---

## Task 4: POST /api/auth/signup

**Files:**
- Create: `server/routes/auth.js`
- Modify: `server/index.js`
- Test: `test/auth.test.js`

- [ ] **Step 1: Write failing test — append to `test/auth.test.js`**

```javascript
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
```

- [ ] **Step 2: Run — expect FAIL**

Run: `node --test test/auth.test.js`
Expected: FAIL "Cannot find module '../server/routes/auth'".

- [ ] **Step 3: Scaffold `server/routes/auth.js`**

```javascript
'use strict';
const express = require('express');
const router = express.Router();
const auth = require('../services/auth');

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: 30 * 24 * 60 * 60 * 1000,
};

function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, tier: u.tier };
}

router.post('/signup', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const name = req.body?.name ? String(req.body.name).trim() : null;
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  if (password.length < 8) return res.status(400).json({ error: 'password must be at least 8 characters' });
  try {
    const user = await auth.createUser({ email, password, name });
    const sid = auth.createSession(user.id);
    res.cookie('verba.sid', sid, COOKIE_OPTS);
    res.status(201).json({ user: publicUser(user) });
  } catch (err) {
    if (String(err.message).includes('already registered')) return res.status(409).json({ error: 'email already registered' });
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
```

- [ ] **Step 4: Mount in `server/index.js`**

Add near other route requires:

```javascript
const authRoutes = require('./routes/auth');
```

Mount alongside other `/api/...` routes:

```javascript
app.use('/api/auth', authRoutes);
```

- [ ] **Step 5: Run — expect PASS**

Run: `node --test test/auth.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/routes/auth.js server/index.js test/auth.test.js
git commit -m "feat(auth): POST /api/auth/signup"
```

---

## Task 5: POST /api/auth/login

**Files:**
- Modify: `server/routes/auth.js`
- Test: `test/auth.test.js`

- [ ] **Step 1: Write failing test — append**

```javascript
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
```

- [ ] **Step 2: Run — expect FAIL**

Run: `node --test test/auth.test.js`
Expected: FAIL 404 on /login.

- [ ] **Step 3: Add /login handler in `server/routes/auth.js`**

Insert before `module.exports`:

```javascript
router.post('/login', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  const user = auth.findUserByEmail(email);
  const ok = user ? await auth.verifyPassword(user, password) : false;
  if (!ok) return res.status(401).json({ error: 'invalid credentials' });
  const sid = auth.createSession(user.id);
  res.cookie('verba.sid', sid, COOKIE_OPTS);
  res.json({ user: publicUser(user) });
});
```

- [ ] **Step 4: Run — expect PASS**

Run: `node --test test/auth.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/routes/auth.js test/auth.test.js
git commit -m "feat(auth): POST /api/auth/login"
```

---

## Task 6: POST /api/auth/logout + GET /api/auth/me

**Files:**
- Modify: `server/routes/auth.js`
- Test: `test/auth.test.js`

- [ ] **Step 1: Write failing tests — append**

```javascript
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
```

- [ ] **Step 2: Run — expect FAIL**

Run: `node --test test/auth.test.js`
Expected: 404 on /me and /logout.

- [ ] **Step 3: Add handlers in `server/routes/auth.js`**

Add before `module.exports`:

```javascript
const requireUser = require('../middleware/requireUser');

router.get('/me', requireUser, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

router.post('/logout', (req, res) => {
  const sid = req.cookies && req.cookies['verba.sid'];
  if (sid) auth.deleteSession(sid);
  res.clearCookie('verba.sid', { path: '/' });
  res.json({ ok: true });
});
```

- [ ] **Step 4: Run — expect PASS**

Run: `node --test test/auth.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/routes/auth.js test/auth.test.js
git commit -m "feat(auth): GET /api/auth/me + POST /api/auth/logout"
```

---

## Task 7: Wire signin.html form to backend

**Files:**
- Modify: `public/signin.html`
- Modify: `public/api.js`

- [ ] **Step 1: Add auth methods to `public/api.js`**

Inside the `api` object, right before `// --- contentions ---`, insert:

```javascript
    // --- auth ---
    auth: {
      signup: (email, password, name) => jsonFetch('/api/auth/signup', { method: 'POST', body: JSON.stringify({ email, password, name }) }),
      login:  (email, password)       => jsonFetch('/api/auth/login',  { method: 'POST', body: JSON.stringify({ email, password }) }),
      logout: ()                      => jsonFetch('/api/auth/logout', { method: 'POST' }),
      me:     ()                      => jsonFetch('/api/auth/me'),
      google: (idToken)               => jsonFetch('/api/auth/google', { method: 'POST', body: JSON.stringify({ idToken }) }),
      forgot: (email)                 => jsonFetch('/api/auth/forgot', { method: 'POST', body: JSON.stringify({ email }) }),
      reset:  (token, password)       => jsonFetch('/api/auth/reset',  { method: 'POST', body: JSON.stringify({ token, password }) }),
    },
```

- [ ] **Step 2: Modify `public/signin.html`**

Replace the `<form onsubmit="event.preventDefault();location.href='app.html'">` line and its closing `</form>` with:

```html
<form id="auth-form">
```

Add `<p class="err" id="auth-err" style="display:none;color:#c33;font:500 12px/1.3 var(--font-display);margin-top:4px"></p>` just inside the form before the Name field.

Add `<script src="/api.js"></script>` just before the existing inline `<script>` tag.

Inside the existing inline `<script>` block at the end of the IIFE (after `setMode(initMode);`), append:

```javascript
  const form = document.getElementById('auth-form');
  const errEl = document.getElementById('auth-err');
  function showErr(msg) { errEl.textContent = msg; errEl.style.display = ''; }
  function clearErr() { errEl.style.display = 'none'; errEl.textContent = ''; }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErr();
    const mode = document.querySelector('.mode-tab.on')?.dataset?.mode || 'login';
    const email = form.querySelector('input[type="email"]').value.trim();
    const password = form.querySelector('input[type="password"]').value;
    const nameField = document.getElementById('name-field');
    const name = nameField && nameField.style.display !== 'none' ? nameField.querySelector('input').value.trim() : null;
    try {
      if (mode === 'signup') {
        await window.VerbaAPI.auth.signup(email, password, name);
      } else {
        await window.VerbaAPI.auth.login(email, password);
      }
      location.href = '/app';
    } catch (err) {
      showErr(err.message || 'Sign-in failed');
    }
  });
```

- [ ] **Step 3: Manual verification**

Run: `npm run dev`
Open `http://localhost:3000/signin`.
- Switch to Sign up tab, enter email/password, submit. Expected: redirects to `/app`.
- Open devtools → Application → Cookies. Expected: `verba.sid` cookie set, HttpOnly checked.
- Log out (when wired in Task 16), log back in with same credentials. Expected: redirects to `/app`.
- Try bad password. Expected: red error appears.

- [ ] **Step 4: Commit**

```bash
git add public/signin.html public/api.js
git commit -m "feat(auth): wire signin form to /api/auth endpoints"
```

---

## Task 8: Google Identity Services one-tap / button

**Files:**
- Modify: `server/routes/auth.js`
- Modify: `public/signin.html`
- Modify: `.env.example`

- [ ] **Step 1: Install google-auth-library**

Run: `npm install google-auth-library`
Expected: added to `package.json`.

- [ ] **Step 2: Add `GOOGLE_CLIENT_ID` to `.env.example`**

Append:

```
# Google OAuth — create OAuth 2.0 Client ID (Web) in Google Cloud Console.
# Authorized JavaScript origin: http://localhost:3000
# Authorized redirect URI: not needed for GIS ID-token flow.
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
```

- [ ] **Step 3: Write failing test — append to `test/auth.test.js`**

```javascript
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
```

- [ ] **Step 4: Run — expect FAIL**

Run: `node --test test/auth.test.js`
Expected: FAIL 404 on /google.

- [ ] **Step 5: Add /google handler in `server/routes/auth.js`**

Near the top, add:

```javascript
const { OAuth2Client } = require('google-auth-library');
```

Before `module.exports`:

```javascript
router.post('/google', async (req, res) => {
  const idToken = String(req.body?.idToken || '');
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!idToken) return res.status(400).json({ error: 'idToken required' });
  if (!clientId) return res.status(500).json({ error: 'GOOGLE_CLIENT_ID not configured' });
  try {
    const client = new OAuth2Client(clientId);
    const ticket = await client.verifyIdToken({ idToken, audience: clientId });
    const payload = ticket.getPayload();
    const sub = payload.sub;
    const email = String(payload.email || '').toLowerCase();
    const name = payload.name || null;
    if (!email) return res.status(400).json({ error: 'google token missing email' });

    let user = auth.findUserByGoogleSub(sub);
    if (!user) {
      const byEmail = auth.findUserByEmail(email);
      if (byEmail) { auth.linkGoogleSub(byEmail.id, sub); user = auth.findUserById(byEmail.id); }
      else         { user = auth._insertUserSync({ email, googleSub: sub, name }); }
    }
    const sid = auth.createSession(user.id);
    res.cookie('verba.sid', sid, COOKIE_OPTS);
    res.json({ user: publicUser(user) });
  } catch (err) {
    res.status(401).json({ error: 'google verification failed' });
  }
});
```

- [ ] **Step 6: Run — expect PASS**

Run: `node --test test/auth.test.js`
Expected: PASS.

- [ ] **Step 7: Expose `GOOGLE_CLIENT_ID` to frontend via /api/auth/config**

Before `module.exports` in `server/routes/auth.js`:

```javascript
router.get('/config', (_req, res) => {
  res.json({ googleClientId: process.env.GOOGLE_CLIENT_ID || null });
});
```

- [ ] **Step 8: Add GIS script + handler to `public/signin.html`**

In `<head>` before closing `</head>`:

```html
<script src="https://accounts.google.com/gsi/client" async defer></script>
```

Replace the `<button class="soc-btn" type="button">...Continue with Google...</button>` block with:

```html
<div id="gsi-button-wrap" class="soc-btn-wrap"></div>
```

At the end of the existing inline `<script>` IIFE, append:

```javascript
  async function initGoogle() {
    try {
      const cfg = await window.VerbaAPI.auth.me().catch(() => null);
      if (cfg && cfg.user) { location.href = '/app'; return; }
    } catch {}
    const cfgRes = await fetch('/api/auth/config').then(r => r.json()).catch(() => ({}));
    if (!cfgRes.googleClientId || !window.google || !window.google.accounts) { setTimeout(initGoogle, 300); return; }
    window.google.accounts.id.initialize({
      client_id: cfgRes.googleClientId,
      callback: async (resp) => {
        try {
          await window.VerbaAPI.auth.google(resp.credential);
          location.href = '/app';
        } catch (err) {
          showErr(err.message || 'Google sign-in failed');
        }
      },
    });
    window.google.accounts.id.renderButton(
      document.getElementById('gsi-button-wrap'),
      { theme: 'outline', size: 'large', text: 'continue_with', width: 360 }
    );
    window.google.accounts.id.prompt();
  }
  initGoogle();
```

- [ ] **Step 9: Manual verification**

Create Google Cloud OAuth Client ID (Web). Authorized JavaScript origin: `http://localhost:3000`. Paste into `.env` as `GOOGLE_CLIENT_ID=...`.
Run: `npm run dev`. Open `http://localhost:3000/signin`. Expected: Google button renders, One-Tap appears if cookie available. Click → redirects to `/app` with session cookie set.

- [ ] **Step 10: Commit**

```bash
git add server/routes/auth.js public/signin.html .env.example package.json package-lock.json test/auth.test.js
git commit -m "feat(auth): Google Identity Services one-tap login"
```

---

## Task 9: Per-user projects table (replace projects.json backing store)

**Files:**
- Modify: `server/routes/projects.js`
- Create: `test/user-scoping.test.js`

- [ ] **Step 1: Write failing test in `test/user-scoping.test.js`**

```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { useTempDb } = require('./_helpers');

async function bootAppWithProjects() {
  delete require.cache[require.resolve('../server/services/db')];
  delete require.cache[require.resolve('../server/services/auth')];
  delete require.cache[require.resolve('../server/middleware/requireUser')];
  delete require.cache[require.resolve('../server/routes/projects')];
  delete require.cache[require.resolve('../server/routes/auth')];
  const express = require('express');
  const cookieParser = require('cookie-parser');
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', require('../server/routes/auth'));
  app.use('/api/projects', require('../server/routes/projects'));
  return new Promise((resolve) => {
    const srv = app.listen(0, () => resolve({ srv, port: srv.address().port }));
  });
}

async function signupAndCookie(port, email) {
  const r = await fetch(`http://127.0.0.1:${port}/api/auth/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'hunter22hunter22' }),
  });
  return r.headers.get('set-cookie').split(';')[0];
}

test('projects require auth and are isolated per user', async () => {
  const ctx = useTempDb();
  const { srv, port } = await bootAppWithProjects();
  try {
    const anon = await fetch(`http://127.0.0.1:${port}/api/projects`);
    assert.equal(anon.status, 401);

    const cookieA = await signupAndCookie(port, 'a@s.co');
    const cookieB = await signupAndCookie(port, 'b@s.co');

    const created = await fetch(`http://127.0.0.1:${port}/api/projects`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookieA },
      body: JSON.stringify({ name: 'A Project' }),
    });
    assert.equal(created.status, 201);

    const listA = await (await fetch(`http://127.0.0.1:${port}/api/projects`, { headers: { Cookie: cookieA } })).json();
    const listB = await (await fetch(`http://127.0.0.1:${port}/api/projects`, { headers: { Cookie: cookieB } })).json();
    assert.equal(listA.items.length, 1);
    assert.equal(listB.items.length, 0);
  } finally { srv.close(); ctx.cleanup(); }
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `node --test test/user-scoping.test.js`
Expected: FAIL (no auth on projects route, or list not isolated).

- [ ] **Step 3: Rewrite `server/routes/projects.js` to use DB + auth**

Replace full contents:

```javascript
'use strict';

const express = require('express');
const router = express.Router();
const { randomUUID } = require('crypto');
const { getDb } = require('../services/db');
const requireUser = require('../middleware/requireUser');

router.use(requireUser);

function rowToProject(row) {
  if (!row) return null;
  let cards = [];
  try { cards = JSON.parse(row.cards); } catch {}
  return { id: row.id, name: row.name, color: row.color, cards, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

router.get('/', (req, res) => {
  const rows = getDb().prepare('SELECT * FROM user_projects WHERE userId = ? ORDER BY updatedAt DESC').all(req.user.id);
  res.json({ items: rows.map(rowToProject) });
});

router.post('/', (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name is required' });
  const color = String(req.body?.color || '#6B7280').slice(0, 9);
  const now = new Date().toISOString();
  const project = { id: randomUUID(), userId: req.user.id, name, color, cards: '[]', createdAt: now, updatedAt: now };
  getDb().prepare('INSERT INTO user_projects (id, userId, name, color, cards, createdAt, updatedAt) VALUES (@id, @userId, @name, @color, @cards, @createdAt, @updatedAt)').run(project);
  res.status(201).json({ project: rowToProject(project) });
});

function ownedProject(userId, id) {
  return getDb().prepare('SELECT * FROM user_projects WHERE id = ? AND userId = ?').get(id, userId);
}

router.patch('/:id', (req, res) => {
  const row = ownedProject(req.user.id, req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const name = req.body?.name != null ? String(req.body.name).trim() : row.name;
  const color = req.body?.color != null ? String(req.body.color).slice(0, 9) : row.color;
  const now = new Date().toISOString();
  getDb().prepare('UPDATE user_projects SET name = ?, color = ?, updatedAt = ? WHERE id = ?').run(name, color, now, row.id);
  res.json({ project: rowToProject({ ...row, name, color, updatedAt: now }) });
});

router.delete('/:id', (req, res) => {
  const info = getDb().prepare('DELETE FROM user_projects WHERE id = ? AND userId = ?').run(req.params.id, req.user.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

router.post('/:id/cards', (req, res) => {
  const row = ownedProject(req.user.id, req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const card = req.body?.card || {};
  if (!card.tag && !card.body_markdown && !card.body_plain) return res.status(400).json({ error: 'card requires tag or body' });
  const entry = { id: card.id || randomUUID(), ...card, addedAt: new Date().toISOString() };
  let cards = []; try { cards = JSON.parse(row.cards); } catch {}
  cards.unshift(entry);
  const now = new Date().toISOString();
  getDb().prepare('UPDATE user_projects SET cards = ?, updatedAt = ? WHERE id = ?').run(JSON.stringify(cards), now, row.id);
  res.status(201).json({ project: rowToProject({ ...row, cards: JSON.stringify(cards), updatedAt: now }), card: entry });
});

router.delete('/:id/cards/:cardId', (req, res) => {
  const row = ownedProject(req.user.id, req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  let cards = []; try { cards = JSON.parse(row.cards); } catch {}
  const before = cards.length;
  cards = cards.filter((c) => c.id !== req.params.cardId);
  if (cards.length === before) return res.status(404).json({ error: 'card not found' });
  const now = new Date().toISOString();
  getDb().prepare('UPDATE user_projects SET cards = ?, updatedAt = ? WHERE id = ?').run(JSON.stringify(cards), now, row.id);
  res.json({ project: rowToProject({ ...row, cards: JSON.stringify(cards), updatedAt: now }) });
});

module.exports = router;
```

- [ ] **Step 4: Run — expect PASS**

Run: `node --test test/user-scoping.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/routes/projects.js test/user-scoping.test.js
git commit -m "feat(projects): per-user DB-backed projects with auth"
```

---

## Task 10: Per-user saved cards (/api/mine)

**Files:**
- Create: `server/routes/mine.js`
- Modify: `server/index.js`
- Modify: `test/user-scoping.test.js`

- [ ] **Step 1: Write failing test — append to `test/user-scoping.test.js`**

```javascript
test('saved cards are per-user and dedup by fingerprint', async () => {
  const ctx = useTempDb();
  delete require.cache[require.resolve('../server/routes/mine')];
  const express = require('express');
  const cookieParser = require('cookie-parser');
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', require('../server/routes/auth'));
  app.use('/api/mine', require('../server/routes/mine'));
  const srv = app.listen(0);
  const port = srv.address().port;
  try {
    const cookieA = await signupAndCookie(port, 'ma@s.co');
    const cookieB = await signupAndCookie(port, 'mb@s.co');

    const card = { tag: 'T', cite: 'C', body_plain: 'hello world' };
    const r1 = await fetch(`http://127.0.0.1:${port}/api/mine`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookieA }, body: JSON.stringify({ card }) });
    assert.equal(r1.status, 201);
    const r2 = await fetch(`http://127.0.0.1:${port}/api/mine`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookieA }, body: JSON.stringify({ card }) });
    assert.equal(r2.status, 200);
    assert.equal((await r2.json()).duplicate, true);

    const listA = await (await fetch(`http://127.0.0.1:${port}/api/mine`, { headers: { Cookie: cookieA } })).json();
    const listB = await (await fetch(`http://127.0.0.1:${port}/api/mine`, { headers: { Cookie: cookieB } })).json();
    assert.equal(listA.items.length, 1);
    assert.equal(listB.items.length, 0);
  } finally { srv.close(); ctx.cleanup(); }
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `node --test test/user-scoping.test.js`
Expected: FAIL "Cannot find module '../server/routes/mine'".

- [ ] **Step 3: Implement `server/routes/mine.js`**

```javascript
'use strict';
const express = require('express');
const router = express.Router();
const { randomUUID } = require('crypto');
const { getDb } = require('../services/db');
const requireUser = require('../middleware/requireUser');

router.use(requireUser);

function fingerprint(c) {
  const t = String(c.tag || '').trim().toLowerCase();
  const ci = String(c.cite || c.shortCite || '').trim().toLowerCase();
  const b = String(c.body_plain || c.body_markdown || '').slice(0, 200).trim().toLowerCase();
  return t + '|' + ci + '|' + b;
}

router.get('/', (req, res) => {
  const rows = getDb().prepare('SELECT * FROM user_saved_cards WHERE userId = ? ORDER BY savedAt DESC').all(req.user.id);
  const items = rows.map(r => { try { return { id: r.id, ...JSON.parse(r.payload), savedAt: r.savedAt }; } catch { return null; } }).filter(Boolean);
  res.json({ items });
});

router.post('/', (req, res) => {
  const card = req.body?.card;
  if (!card || (!card.tag && !card.body_markdown && !card.body_plain)) return res.status(400).json({ error: 'card required' });
  const fp = fingerprint(card);
  const existing = getDb().prepare('SELECT * FROM user_saved_cards WHERE userId = ? AND fingerprint = ?').get(req.user.id, fp);
  if (existing) {
    let payload = {};
    try { payload = JSON.parse(existing.payload); } catch {}
    return res.status(200).json({ card: { id: existing.id, ...payload, savedAt: existing.savedAt }, duplicate: true });
  }
  const id = card.id || randomUUID();
  const savedAt = new Date().toISOString();
  getDb().prepare('INSERT INTO user_saved_cards (id, userId, payload, fingerprint, savedAt) VALUES (?, ?, ?, ?, ?)')
    .run(id, req.user.id, JSON.stringify(card), fp, savedAt);
  res.status(201).json({ card: { id, ...card, savedAt }, duplicate: false });
});

router.delete('/:id', (req, res) => {
  const info = getDb().prepare('DELETE FROM user_saved_cards WHERE id = ? AND userId = ?').run(req.params.id, req.user.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

module.exports = router;
```

- [ ] **Step 4: Mount in `server/index.js`**

Add requires:

```javascript
const mineRoutes = require('./routes/mine');
```

Mount:

```javascript
app.use('/api/mine', mineRoutes);
```

- [ ] **Step 5: Run — expect PASS**

Run: `node --test test/user-scoping.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/routes/mine.js server/index.js test/user-scoping.test.js
git commit -m "feat(mine): per-user saved cards route"
```

---

## Task 11: Per-user history (/api/history)

**Files:**
- Create: `server/routes/history.js`
- Modify: `server/index.js`
- Modify: `test/user-scoping.test.js`

- [ ] **Step 1: Write failing test — append**

```javascript
test('history is per-user, ordered desc, capped', async () => {
  const ctx = useTempDb();
  delete require.cache[require.resolve('../server/routes/history')];
  const express = require('express');
  const cookieParser = require('cookie-parser');
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', require('../server/routes/auth'));
  app.use('/api/history', require('../server/routes/history'));
  const srv = app.listen(0);
  const port = srv.address().port;
  try {
    const cookieA = await signupAndCookie(port, 'ha@s.co');
    for (let i = 0; i < 3; i++) {
      await fetch(`http://127.0.0.1:${port}/api/history`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookieA }, body: JSON.stringify({ entry: { label: 'e' + i } }) });
    }
    const list = await (await fetch(`http://127.0.0.1:${port}/api/history`, { headers: { Cookie: cookieA } })).json();
    assert.equal(list.items.length, 3);
    assert.equal(list.items[0].label, 'e2');
  } finally { srv.close(); ctx.cleanup(); }
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `node --test test/user-scoping.test.js`
Expected: FAIL module missing.

- [ ] **Step 3: Implement `server/routes/history.js`**

```javascript
'use strict';
const express = require('express');
const router = express.Router();
const { randomUUID } = require('crypto');
const { getDb } = require('../services/db');
const requireUser = require('../middleware/requireUser');

router.use(requireUser);

router.get('/', (req, res) => {
  const rows = getDb().prepare('SELECT * FROM user_history WHERE userId = ? ORDER BY at DESC LIMIT 400').all(req.user.id);
  const items = rows.map(r => { try { return { id: r.id, ...JSON.parse(r.entry), at: r.at }; } catch { return null; } }).filter(Boolean);
  res.json({ items });
});

router.post('/', (req, res) => {
  const entry = req.body?.entry || {};
  const id = randomUUID();
  const at = new Date().toISOString();
  getDb().prepare('INSERT INTO user_history (id, userId, entry, at) VALUES (?, ?, ?, ?)').run(id, req.user.id, JSON.stringify(entry), at);
  getDb().prepare(`
    DELETE FROM user_history WHERE userId = ? AND id NOT IN (
      SELECT id FROM user_history WHERE userId = ? ORDER BY at DESC LIMIT 400
    )
  `).run(req.user.id, req.user.id);
  res.status(201).json({ id, ...entry, at });
});

router.delete('/', (req, res) => {
  getDb().prepare('DELETE FROM user_history WHERE userId = ?').run(req.user.id);
  res.json({ ok: true });
});

module.exports = router;
```

- [ ] **Step 4: Mount in `server/index.js`**

```javascript
const historyRoutes = require('./routes/history');
app.use('/api/history', historyRoutes);
```

- [ ] **Step 5: Run — expect PASS**

Run: `node --test test/user-scoping.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/routes/history.js server/index.js test/user-scoping.test.js
git commit -m "feat(history): per-user history route"
```

---

## Task 12: Frontend — swap localStorage mine/history to API, gate /app on auth

**Files:**
- Modify: `public/api.js`
- Modify: `public/app-main.js`

- [ ] **Step 1: Replace `mine` and `history` in `public/api.js`**

Inside the `api` object, replace the existing `history:` and `mine:` sub-objects with:

```javascript
    history: {
      async get() { try { return (await jsonFetch('/api/history')).items || []; } catch { return []; } },
      async push(entry) { return jsonFetch('/api/history', { method: 'POST', body: JSON.stringify({ entry }) }); },
      async clear() { return jsonFetch('/api/history', { method: 'DELETE' }); },
    },

    mine: {
      async get() { try { return (await jsonFetch('/api/mine')).items || []; } catch { return []; } },
      async save(card) {
        const res = await jsonFetch('/api/mine', { method: 'POST', body: JSON.stringify({ card }) });
        return { card: res.card, duplicate: !!res.duplicate };
      },
      async remove(id) { return jsonFetch('/api/mine/' + encodeURIComponent(id), { method: 'DELETE' }); },
    },
```

- [ ] **Step 2: Add bootstrap guard to `public/app-main.js`**

At the very top of the IIFE, right after `const API = window.VerbaAPI;`, insert:

```javascript
  (async () => {
    try {
      const who = await API.auth.me();
      window.__verbaUser = who.user;
      const btn = document.getElementById('settings-btn');
      if (btn) btn.title = who.user.email;
    } catch {
      location.href = '/signin';
    }
  })();
```

- [ ] **Step 3: Add logout handler**

Find the `$('#settings-btn')?.addEventListener('click', ...)` line. Immediately after that block add:

```javascript
  document.getElementById('logout-btn')?.addEventListener('click', async () => {
    try { await API.auth.logout(); } catch {}
    location.href = '/signin';
  });
```

- [ ] **Step 4: Update every caller that reads `API.mine.get()`, `API.history.get()` etc.**

Grep `public/app-main.js` for `.mine.get()`, `.mine.save(`, `.mine.remove(`, `.history.get()`, `.history.push(`, `.history.clear(`. Each callsite that used a synchronous return value must `await` the call. For example change:

```javascript
const cards = API.mine.get();
```

to:

```javascript
const cards = await API.mine.get();
```

and make the enclosing function `async`.

- [ ] **Step 5: Manual verification**

Run: `npm run dev`. Sign out (or delete `verba.sid` cookie). Open `/app`. Expected: redirects to `/signin`. Sign in. Save a card. Refresh. Expected: saved card still present (DB-backed).

- [ ] **Step 6: Commit**

```bash
git add public/api.js public/app-main.js
git commit -m "feat(ui): API-backed mine/history + auth gate on /app"
```

---

## Task 13: Limits service — usage_counters read/write

**Files:**
- Create: `server/services/limits.js`
- Create: `test/limits.test.js`

- [ ] **Step 1: Write failing test in `test/limits.test.js`**

```javascript
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
```

- [ ] **Step 2: Run — expect FAIL**

Run: `node --test test/limits.test.js`
Expected: FAIL module missing.

- [ ] **Step 3: Implement `server/services/limits.js`**

```javascript
'use strict';
const { getDb } = require('./db');

function todayUtc() { return new Date().toISOString().slice(0, 10); }

function getCount(userId, kind, day = todayUtc()) {
  const row = getDb().prepare('SELECT count FROM usage_counters WHERE userId = ? AND kind = ? AND day = ?').get(userId, kind, day);
  return row ? row.count : 0;
}

function hit(userId, kind, day = todayUtc()) {
  const db = getDb();
  const existing = db.prepare('SELECT count FROM usage_counters WHERE userId = ? AND kind = ? AND day = ?').get(userId, kind, day);
  if (existing) {
    db.prepare('UPDATE usage_counters SET count = count + 1 WHERE userId = ? AND kind = ? AND day = ?').run(userId, kind, day);
    return existing.count + 1;
  }
  db.prepare('INSERT INTO usage_counters (userId, kind, day, count) VALUES (?, ?, ?, 1)').run(userId, kind, day);
  return 1;
}

function checkAndBudget(userId, kind, limit, user = null) {
  if (user && user.tier && user.tier !== 'free') return { allowed: true, remaining: Infinity, limit };
  const used = getCount(userId, kind);
  const remaining = Math.max(0, limit - used);
  return { allowed: used < limit, remaining, used, limit };
}

module.exports = { getCount, hit, checkAndBudget };
```

- [ ] **Step 4: Run — expect PASS**

Run: `node --test test/limits.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/services/limits.js test/limits.test.js
git commit -m "feat(limits): daily usage counter service"
```

---

## Task 14: enforceLimit middleware + wire chat + cut-card

**Files:**
- Create: `server/middleware/enforceLimit.js`
- Modify: `server/routes/chat.js`
- Modify: `server/routes/ai.js`
- Modify: `test/limits.test.js`

- [ ] **Step 1: Write failing integration test — append to `test/limits.test.js`**

```javascript
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
```

- [ ] **Step 2: Run — expect FAIL**

Run: `node --test test/limits.test.js`
Expected: FAIL module missing.

- [ ] **Step 3: Implement `server/middleware/enforceLimit.js`**

```javascript
'use strict';
const limits = require('../services/limits');

function enforceLimit(kind, limit) {
  return function (req, res, next) {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'not authenticated' });
    const verdict = limits.checkAndBudget(user.id, kind, limit, user);
    if (!verdict.allowed) {
      return res.status(429).json({
        error: 'free tier limit reached',
        kind,
        limit: verdict.limit,
        remaining: 0,
        resetAt: new Date(new Date().setUTCHours(24, 0, 0, 0)).toISOString(),
      });
    }
    res.on('finish', () => {
      if (res.statusCode >= 200 && res.statusCode < 400) {
        try { limits.hit(user.id, kind); } catch {}
      }
    });
    next();
  };
}

module.exports = enforceLimit;
```

- [ ] **Step 4: Run — expect PASS**

Run: `node --test test/limits.test.js`
Expected: PASS.

- [ ] **Step 5: Wire middleware on `/api/chat`**

Edit `server/routes/chat.js`. Near the top, after `const router = express.Router();` add:

```javascript
const requireUser = require('../middleware/requireUser');
const enforceLimit = require('../middleware/enforceLimit');
const CHAT_DAILY_LIMIT = Number(process.env.FREE_CHAT_DAILY || 20);
router.use(requireUser);
```

Change `router.post('/', async (req, res) => {` to:

```javascript
router.post('/', enforceLimit('chat', CHAT_DAILY_LIMIT), async (req, res) => {
```

- [ ] **Step 6: Wire middleware on `/api/cut-card`**

Edit `server/routes/ai.js`. Near top of file after `const router = express.Router();` add:

```javascript
const requireUser = require('../middleware/requireUser');
const enforceLimit = require('../middleware/enforceLimit');
const CUT_DAILY_LIMIT = Number(process.env.FREE_CUTCARD_DAILY || 10);
```

Change `router.post('/cut-card', async (req, res) => {` to:

```javascript
router.post('/cut-card', requireUser, enforceLimit('cutCard', CUT_DAILY_LIMIT), async (req, res) => {
```

- [ ] **Step 7: Add usage endpoint**

Append inside `server/routes/auth.js` before `module.exports`:

```javascript
const limitsSvc = require('../services/limits');
router.get('/usage', requireUser, (req, res) => {
  const chat = limitsSvc.getCount(req.user.id, 'chat');
  const cutCard = limitsSvc.getCount(req.user.id, 'cutCard');
  res.json({
    tier: req.user.tier,
    chat:   { used: chat,    limit: Number(process.env.FREE_CHAT_DAILY || 20) },
    cutCard:{ used: cutCard, limit: Number(process.env.FREE_CUTCARD_DAILY || 10) },
  });
});
```

- [ ] **Step 8: Add client method + 429 handler in `public/api.js`**

Inside the `auth:` sub-object, add: `usage: () => jsonFetch('/api/auth/usage'),`.

Replace the body of `jsonFetch`'s error branch (the `if (!res.ok) { ... }` block) with:

```javascript
    if (!res.ok) {
      const err = new Error((data && data.error) || res.statusText || ('HTTP ' + res.status));
      err.status = res.status;
      err.body = data;
      throw err;
    }
```

- [ ] **Step 9: Manual verification**

Run: `npm run dev`. Sign in. POST 11 card cuts (use editor). On the 11th expect 429. Run `GET /api/auth/usage` via devtools console `fetch('/api/auth/usage').then(r=>r.json()).then(console.log)`. Expected: `{ chat: {used:0, limit:20}, cutCard: {used:10, limit:10} }`.

- [ ] **Step 10: Commit**

```bash
git add server/middleware/enforceLimit.js server/routes/chat.js server/routes/ai.js server/routes/auth.js public/api.js test/limits.test.js
git commit -m "feat(limits): enforce daily free caps on chat + cut-card"
```

---

## Task 15: Frontend — surface 429 as upgrade modal

**Files:**
- Modify: `public/app-main.js`

- [ ] **Step 1: Add helper near the top of the IIFE**

After the `toast` definition insert:

```javascript
  function handleLimitError(err) {
    if (err && err.status === 429) {
      const b = err.body || {};
      toast(`Daily ${b.kind === 'cutCard' ? 'card-cut' : 'assistant-message'} limit (${b.limit}) reached. Resets at midnight UTC.`);
      return true;
    }
    return false;
  }
  window.__handleLimitError = handleLimitError;
```

- [ ] **Step 2: Wrap every `cutCard` and `chat` call site**

Grep `public/app-main.js` for `API.cutCard(` and `API.chatLibrary(` (or whichever chat helper exists). Wrap each in try/catch:

```javascript
try {
  const r = await API.cutCard(payload);
  // existing success handling
} catch (err) {
  if (!handleLimitError(err)) toast(err.message || 'Card cut failed');
}
```

Repeat pattern for chat endpoint.

- [ ] **Step 3: Manual verification**

Run: `npm run dev`. Sign in. Hit card-cut 10 times. On 11th expect toast: "Daily card-cut limit (10) reached. Resets at midnight UTC."

- [ ] **Step 4: Commit**

```bash
git add public/app-main.js
git commit -m "feat(ui): surface 429 tier-limit errors as toast"
```

---

## Task 16: Email sender + password reset request

**Files:**
- Create: `server/services/emailSender.js`
- Create: `public/forgot.html`
- Modify: `server/routes/auth.js`
- Modify: `server/index.js`
- Modify: `.env.example`
- Modify: `test/auth.test.js`

- [ ] **Step 1: Install nodemailer**

Run: `npm install nodemailer`
Expected: added to dependencies.

- [ ] **Step 2: Append env keys to `.env.example`**

```
# Password-reset email (Gmail SMTP with app password works for free)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=you@gmail.com
SMTP_PASS=app-password-16-chars
SMTP_FROM="Verba <you@gmail.com>"
PUBLIC_BASE_URL=http://localhost:3000
```

- [ ] **Step 3: Implement `server/services/emailSender.js`**

```javascript
'use strict';
const nodemailer = require('nodemailer');

let _transporter = null;
function transporter() {
  if (_transporter) return _transporter;
  _transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return _transporter;
}

async function sendPasswordReset(to, resetUrl) {
  if (process.env.SMTP_SKIP === '1') {
    console.log('[email:skip] password reset →', to, resetUrl);
    return { skipped: true };
  }
  return transporter().sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject: 'Reset your Verba password',
    text: `Click to reset your password (expires in 1 hour):\n${resetUrl}\n\nIf you did not request this, ignore this email.`,
    html: `<p>Click to reset your password (expires in 1 hour):</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>If you did not request this, ignore this email.</p>`,
  });
}

module.exports = { sendPasswordReset };
```

- [ ] **Step 4: Write failing test — append to `test/auth.test.js`**

```javascript
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
```

- [ ] **Step 5: Run — expect FAIL**

Run: `node --test test/auth.test.js`
Expected: FAIL 404 on /forgot.

- [ ] **Step 6: Add /forgot handler in `server/routes/auth.js`**

At top add:

```javascript
const crypto = require('crypto');
const { sendPasswordReset } = require('../services/emailSender');
const { getDb } = require('../services/db');
```

Before `module.exports`:

```javascript
router.post('/forgot', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ error: 'email required' });
  const user = auth.findUserByEmail(email);
  if (user) {
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    getDb().prepare('INSERT INTO password_resets (tokenHash, userId, expiresAt) VALUES (?, ?, ?)').run(tokenHash, user.id, expiresAt);
    const base = process.env.PUBLIC_BASE_URL || 'http://localhost:3000';
    const url = `${base}/reset?token=${encodeURIComponent(token)}`;
    try { await sendPasswordReset(email, url); } catch (e) { console.error('[email] send failed', e.message); }
  }
  res.json({ ok: true });
});
```

- [ ] **Step 7: Create `public/forgot.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Reset password · Verba</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
body{font:16px/1.5 system-ui,sans-serif;background:#0d0d10;color:#eee;display:grid;place-items:center;min-height:100vh;margin:0}
.box{background:#17171b;padding:32px;border-radius:12px;max-width:400px;width:100%;box-shadow:0 10px 40px rgba(0,0,0,.4)}
h1{margin:0 0 6px;font-size:22px}
p{color:#aaa;margin:0 0 18px;font-size:14px}
label{display:block;font-size:12px;color:#bbb;margin-bottom:6px;text-transform:uppercase;letter-spacing:.06em}
input{width:100%;padding:12px 14px;background:#0b0b0e;border:1px solid #2a2a33;color:#fff;border-radius:8px;font:inherit;box-sizing:border-box}
button{width:100%;padding:12px;background:#7c6aff;color:#fff;border:0;border-radius:8px;font-weight:600;margin-top:14px;cursor:pointer}
.msg{margin-top:14px;color:#7ecb7e;font-size:13px}
.err{margin-top:14px;color:#e36b6b;font-size:13px}
a{color:#9e8aff}
</style>
</head>
<body>
<form class="box" id="f">
  <h1>Reset your password</h1>
  <p>Enter your email and we'll send a reset link.</p>
  <label>Email</label>
  <input type="email" required id="email" placeholder="you@school.edu" />
  <button type="submit">Send reset link</button>
  <p id="msg" class="msg" style="display:none">Check your inbox for a reset link.</p>
  <p id="err" class="err" style="display:none"></p>
  <p style="margin-top:20px"><a href="/signin">Back to sign in</a></p>
</form>
<script src="/api.js"></script>
<script>
document.getElementById('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('email').value.trim();
  const msg = document.getElementById('msg'), err = document.getElementById('err');
  msg.style.display = err.style.display = 'none';
  try {
    await window.VerbaAPI.auth.forgot(email);
    msg.style.display = '';
  } catch (ex) {
    err.textContent = ex.message || 'Failed to send';
    err.style.display = '';
  }
});
</script>
</body>
</html>
```

- [ ] **Step 8: Add `/forgot` route in `server/index.js`**

Near the other `app.get('/signin',...)` lines add:

```javascript
app.get('/forgot', (_req, res) => res.sendFile(path.join(PUBLIC, 'forgot.html')));
app.get('/reset',  (_req, res) => res.sendFile(path.join(PUBLIC, 'reset.html')));
```

- [ ] **Step 9: Run — expect PASS**

Run: `node --test test/auth.test.js`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add server/services/emailSender.js server/routes/auth.js server/index.js public/forgot.html .env.example package.json package-lock.json test/auth.test.js
git commit -m "feat(auth): password reset request email"
```

---

## Task 17: POST /api/auth/reset + reset.html

**Files:**
- Modify: `server/routes/auth.js`
- Create: `public/reset.html`
- Modify: `test/auth.test.js`

- [ ] **Step 1: Write failing test — append**

```javascript
test('POST /api/auth/reset consumes token and updates password', async () => {
  const ctx = useTempDb();
  process.env.SMTP_SKIP = '1';
  process.env.PUBLIC_BASE_URL = 'http://localhost:3000';
  const { srv, port } = await bootApp();
  try {
    await fetch(`http://127.0.0.1:${port}/api/auth/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 's@r.co', password: 'hunter22hunter22' }) });

    const crypto = require('crypto');
    delete require.cache[require.resolve('../server/services/db')];
    const { getDb } = require('../server/services/db');
    const auth = require('../server/services/auth');
    const user = auth.findUserByEmail('s@r.co');
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    getDb().prepare('INSERT INTO password_resets (tokenHash, userId, expiresAt) VALUES (?, ?, ?)').run(tokenHash, user.id, expiresAt);

    const bad = await fetch(`http://127.0.0.1:${port}/api/auth/reset`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'wrong', password: 'newpass22newpass22' }) });
    assert.equal(bad.status, 400);

    const ok = await fetch(`http://127.0.0.1:${port}/api/auth/reset`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, password: 'newpass22newpass22' }) });
    assert.equal(ok.status, 200);

    const reuse = await fetch(`http://127.0.0.1:${port}/api/auth/reset`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, password: 'again22again22' }) });
    assert.equal(reuse.status, 400);

    const login = await fetch(`http://127.0.0.1:${port}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 's@r.co', password: 'newpass22newpass22' }) });
    assert.equal(login.status, 200);
  } finally { srv.close(); ctx.cleanup(); }
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `node --test test/auth.test.js`
Expected: FAIL 404 on /reset.

- [ ] **Step 3: Add /reset handler in `server/routes/auth.js`**

Before `module.exports`:

```javascript
router.post('/reset', (req, res) => {
  const token = String(req.body?.token || '');
  const password = String(req.body?.password || '');
  if (!token || password.length < 8) return res.status(400).json({ error: 'token and 8+ char password required' });
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const db = getDb();
  const row = db.prepare('SELECT * FROM password_resets WHERE tokenHash = ?').get(tokenHash);
  if (!row) return res.status(400).json({ error: 'invalid token' });
  if (row.usedAt) return res.status(400).json({ error: 'token already used' });
  if (new Date(row.expiresAt).getTime() < Date.now()) return res.status(400).json({ error: 'token expired' });
  auth.updatePassword(row.userId, password);
  db.prepare('UPDATE password_resets SET usedAt = ? WHERE tokenHash = ?').run(new Date().toISOString(), tokenHash);
  db.prepare('DELETE FROM sessions WHERE userId = ?').run(row.userId);
  res.json({ ok: true });
});
```

- [ ] **Step 4: Create `public/reset.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Set new password · Verba</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
body{font:16px/1.5 system-ui,sans-serif;background:#0d0d10;color:#eee;display:grid;place-items:center;min-height:100vh;margin:0}
.box{background:#17171b;padding:32px;border-radius:12px;max-width:400px;width:100%;box-shadow:0 10px 40px rgba(0,0,0,.4)}
h1{margin:0 0 6px;font-size:22px}
p{color:#aaa;margin:0 0 18px;font-size:14px}
label{display:block;font-size:12px;color:#bbb;margin-bottom:6px;text-transform:uppercase;letter-spacing:.06em}
input{width:100%;padding:12px 14px;background:#0b0b0e;border:1px solid #2a2a33;color:#fff;border-radius:8px;font:inherit;box-sizing:border-box;margin-bottom:12px}
button{width:100%;padding:12px;background:#7c6aff;color:#fff;border:0;border-radius:8px;font-weight:600;cursor:pointer}
.msg{margin-top:14px;color:#7ecb7e;font-size:13px}
.err{margin-top:14px;color:#e36b6b;font-size:13px}
a{color:#9e8aff}
</style>
</head>
<body>
<form class="box" id="f">
  <h1>Choose a new password</h1>
  <p>At least 8 characters.</p>
  <label>New password</label>
  <input type="password" required id="pw" minlength="8" placeholder="••••••••" />
  <button type="submit">Set password</button>
  <p id="msg" class="msg" style="display:none">Password updated. <a href="/signin">Sign in</a>.</p>
  <p id="err" class="err" style="display:none"></p>
</form>
<script src="/api.js"></script>
<script>
const token = new URLSearchParams(location.search).get('token') || '';
document.getElementById('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pw = document.getElementById('pw').value;
  const msg = document.getElementById('msg'), err = document.getElementById('err');
  msg.style.display = err.style.display = 'none';
  try {
    await window.VerbaAPI.auth.reset(token, pw);
    msg.style.display = '';
  } catch (ex) {
    err.textContent = ex.message || 'Reset failed';
    err.style.display = '';
  }
});
</script>
</body>
</html>
```

- [ ] **Step 5: Update "Forgot?" link in `public/signin.html`**

Find `<a class="forgot" ...>Forgot?</a>` and set `href="/forgot"`.

- [ ] **Step 6: Run — expect PASS**

Run: `node --test test/auth.test.js`
Expected: PASS.

- [ ] **Step 7: Manual verification**

Configure real SMTP in `.env`. Sign up with your email. Click Forgot → enter email → check inbox → click link → set new password → sign in with new password. Expected: works end to end.

- [ ] **Step 8: Commit**

```bash
git add server/routes/auth.js public/reset.html public/signin.html test/auth.test.js
git commit -m "feat(auth): password reset completion endpoint + page"
```

---

## Task 18: Full regression run + README env block

**Files:**
- Modify: `.env.example`
- Modify: (optional) `README.md` / any existing docs

- [ ] **Step 1: Run every test**

Run: `node --test test/`
Expected: all tests across `auth.test.js`, `limits.test.js`, `user-scoping.test.js` PASS.

- [ ] **Step 2: Final `.env.example` sanity**

Contents should include at minimum:

```
OPENROUTER_API_KEY=
PORT=3000
DB_PATH=
GOOGLE_CLIENT_ID=
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
PUBLIC_BASE_URL=http://localhost:3000
FREE_CHAT_DAILY=20
FREE_CUTCARD_DAILY=10
```

- [ ] **Step 3: Smoke the full flow**

Run: `npm run dev`. Steps:
1. Open `/signin` → sign up with email → redirects to `/app`.
2. Create a project, save a card, cut a card, chat once.
3. Log out (via settings icon / nav). Redirects to `/signin`.
4. Sign in with Google button → redirects to `/app`. Projects/saved-cards from email account are NOT visible (different user).
5. Hit card-cut 10 times → 11th shows toast "Daily card-cut limit reached".
6. Use Forgot flow with email account → receive email → click → set new password → sign in.

- [ ] **Step 4: Commit**

```bash
git add .env.example
git commit -m "docs(env): document auth + limit env keys"
```

---

## Self-Review Notes

- Spec coverage: email/password login+signup (Tasks 4–7), Google OAuth (Task 8), information persists per user (Tasks 9–12: projects, saved cards, history), daily free-tier limits on assistant messages (chat, Task 14) and card cuts (Task 14), no migration of existing data (Tasks 9–12 only write new rows, `projects.json` ignored), password reset (Tasks 16–17).
- No placeholders. Every step has complete code or an exact command.
- Type consistency: `verba.sid` cookie name, `req.user.id`, `users.tier` column, `kind` values `chat` and `cutCard`, `_insertUserSync` helper shared by tests + Google handler — all consistent across tasks.
- Not implemented (out of scope per user): migrating pre-existing `projects.json`, email verification on signup, paid-tier billing, rate-limit display UI beyond a toast.
