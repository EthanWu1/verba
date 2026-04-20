# Settings + Pricing + Sidebar Revamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the tiny settings modal with a Claude-style tabbed settings experience (General / Account / Billing), add a user-menu dropdown above the avatar, add a fullscreen pricing page + mock payment flow, add sidebar collapse, all themed to the existing lilac/calibri Verba look.

**Architecture:**
- Keep the existing single-page `public/app.html` + `public/app-main.js` structure. All new UI lives inside that page as inline HTML/CSS and a new JS controller section.
- Backend: add a `/api/auth/profile` PATCH (name, 24h cooldown), `/api/auth/sessions` GET + DELETE (list/revoke), and a `/api/auth/sessions/all` DELETE (log out everywhere). Extend `sessions` schema with `userAgent`, `ip`, `lastSeenAt`.
- Pricing page is a full-screen overlay inside `app.html` (`#pricing-overlay`), not a separate route — keeps SPA feel, matches Claude's behavior. Plans mirror the two cards from `landing.html` `#pricing` section.

**Tech Stack:** Express + better-sqlite3 backend, vanilla JS/HTML/CSS frontend, existing `--lilac`, `--ink`, `--panel`, `--line`, `--font-display`, `--font-ui` CSS vars.

---

## File Structure

**Modify:**
- `server/services/db.js` — add columns to `sessions` table (idempotent ALTER)
- `server/services/auth.js` — session-create now records UA/IP/lastSeenAt; add `updateUserName`, `listSessions`, `deleteAllSessionsForUser`, `touchSession`
- `server/middleware/requireUser.js` — call `touchSession` on every authed request
- `server/routes/auth.js` — add PATCH `/profile`, GET `/sessions`, DELETE `/sessions/:id`, DELETE `/sessions` (all)
- `public/api.js` — add `auth.updateProfile`, `auth.listSessions`, `auth.revokeSession`, `auth.revokeAllSessions`
- `public/app.html` — user-menu dropdown, new settings modal (tabs), pricing overlay, payment overlay, keyboard-shortcuts modal, sidebar-collapse toggle + CSS
- `public/app-main.js` — wire new modals/controllers, remove old small settings-modal listener

**Create:** none. Everything inlines into existing files to match the project pattern.

---

## Task 1: Extend sessions table with UA/IP/lastSeenAt

**Files:**
- Modify: `server/services/db.js` (CREATE TABLE sessions block + migration tail)

- [ ] **Step 1: Read current sessions block**

Run: `grep -n -A 8 "CREATE TABLE IF NOT EXISTS sessions" server/services/db.js`
Expected: shows id, userId, createdAt, expiresAt columns.

- [ ] **Step 2: Update the CREATE TABLE statement**

In `server/services/db.js`, find the `CREATE TABLE IF NOT EXISTS sessions (` block and replace it with:

```sql
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  expiresAt TEXT NOT NULL,
  lastSeenAt TEXT,
  userAgent TEXT,
  ip TEXT,
  FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE
)
```

- [ ] **Step 3: Add idempotent ALTER statements for existing DBs**

After the `CREATE INDEX IF NOT EXISTS idx_sessions_userId` line, append:

```javascript
// Idempotent column adds for older DB files.
for (const col of [
  { name: 'lastSeenAt', type: 'TEXT' },
  { name: 'userAgent',  type: 'TEXT' },
  { name: 'ip',         type: 'TEXT' },
]) {
  try { db.exec(`ALTER TABLE sessions ADD COLUMN ${col.name} ${col.type}`); }
  catch (e) { /* column already exists */ }
}
```

- [ ] **Step 4: Start the server to verify migration runs**

Run: `node server/index.js` (Ctrl-C after ~3s).
Expected: no errors on boot. If the DB is new, `PRAGMA table_info(sessions)` shows 7 columns.

- [ ] **Step 5: Commit**

```bash
git add server/services/db.js
git commit -m "feat(auth): extend sessions table with userAgent/ip/lastSeenAt"
```

---

## Task 2: Auth service — profile update, session list, revoke, touch

**Files:**
- Modify: `server/services/auth.js`

- [ ] **Step 1: Update `createSession` to record UA/IP**

Replace the existing `createSession` function with:

```javascript
function createSession(userId, meta = {}) {
  const id = _newId('sess');
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  getDb().prepare(
    'INSERT INTO sessions (id, userId, createdAt, expiresAt, lastSeenAt, userAgent, ip) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, userId, now, expiresAt, now, meta.userAgent || null, meta.ip || null);
  return id;
}
```

- [ ] **Step 2: Add `touchSession`**

Below `deleteSession`, add:

```javascript
function touchSession(sessionId) {
  if (!sessionId) return;
  try {
    getDb().prepare('UPDATE sessions SET lastSeenAt = ? WHERE id = ?')
      .run(new Date().toISOString(), sessionId);
  } catch {}
}
```

- [ ] **Step 3: Add `listSessions`**

```javascript
function listSessions(userId) {
  return getDb().prepare(
    'SELECT id, createdAt, lastSeenAt, userAgent, ip FROM sessions WHERE userId = ? ORDER BY lastSeenAt DESC, createdAt DESC'
  ).all(userId);
}
```

- [ ] **Step 4: Add `deleteAllSessionsForUser`**

```javascript
function deleteAllSessionsForUser(userId) {
  getDb().prepare('DELETE FROM sessions WHERE userId = ?').run(userId);
}
```

- [ ] **Step 5: Add `updateUserName` with 24h cooldown**

```javascript
function updateUserName(userId, name) {
  const cleaned = String(name || '').trim();
  if (!cleaned) throw new Error('name required');
  if (cleaned.length > 60) throw new Error('name too long');
  const u = findUserById(userId);
  if (!u) throw new Error('user not found');
  const last = u.nameUpdatedAt ? new Date(u.nameUpdatedAt).getTime() : 0;
  const waitMs = 24 * 60 * 60 * 1000;
  if (last && Date.now() - last < waitMs) {
    const err = new Error('name was changed recently');
    err.code = 'NAME_COOLDOWN';
    err.nextAllowedAt = new Date(last + waitMs).toISOString();
    throw err;
  }
  const now = new Date().toISOString();
  getDb().prepare('UPDATE users SET name = ?, nameUpdatedAt = ? WHERE id = ?')
    .run(cleaned, now, userId);
  return findUserById(userId);
}
```

- [ ] **Step 6: Add the `nameUpdatedAt` column migration**

In `server/services/db.js`, below the sessions ALTER block, add:

```javascript
try { db.exec('ALTER TABLE users ADD COLUMN nameUpdatedAt TEXT'); }
catch (e) { /* already exists */ }
```

- [ ] **Step 7: Export new functions**

Update the `module.exports` block to include: `touchSession, listSessions, deleteAllSessionsForUser, updateUserName`.

- [ ] **Step 8: Commit**

```bash
git add server/services/auth.js server/services/db.js
git commit -m "feat(auth): add profile update + session listing/revoke helpers"
```

---

## Task 3: Wire UA/IP into session creation + touch on every request

**Files:**
- Modify: `server/routes/auth.js`
- Modify: `server/middleware/requireUser.js`

- [ ] **Step 1: Helper to capture request meta in `auth.js` route**

At the top of `server/routes/auth.js`, below `const COOKIE_OPTS`, add:

```javascript
function sessionMeta(req) {
  return {
    userAgent: String(req.headers['user-agent'] || '').slice(0, 300),
    ip: (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim() || null,
  };
}
```

- [ ] **Step 2: Pass meta to all three `createSession` call sites**

Change every `auth.createSession(user.id)` in `server/routes/auth.js` (signup, login, google) to `auth.createSession(user.id, sessionMeta(req))`.

- [ ] **Step 3: Touch session on every authed request**

Replace `server/middleware/requireUser.js` with:

```javascript
'use strict';
const { validateSession, touchSession } = require('../services/auth');

function requireUser(req, res, next) {
  const sid = req.cookies && req.cookies['verba.sid'];
  const ctx = validateSession(sid);
  if (!ctx) return res.status(401).json({ error: 'not authenticated' });
  req.user = ctx.user;
  req.sessionId = ctx.session.id;
  touchSession(ctx.session.id);
  next();
}

module.exports = requireUser;
```

- [ ] **Step 4: Commit**

```bash
git add server/routes/auth.js server/middleware/requireUser.js
git commit -m "feat(auth): capture UA/IP on session create, touch on each request"
```

---

## Task 4: Auth routes — PATCH /profile, sessions list/revoke

**Files:**
- Modify: `server/routes/auth.js`

- [ ] **Step 1: Add PATCH /profile**

Just above `module.exports = router;`, add:

```javascript
router.patch('/profile', requireUser, (req, res) => {
  const patch = req.body || {};
  try {
    if (typeof patch.name === 'string') {
      const updated = auth.updateUserName(req.user.id, patch.name);
      return res.json({ user: publicUser(updated) });
    }
    res.status(400).json({ error: 'no valid fields' });
  } catch (err) {
    if (err.code === 'NAME_COOLDOWN') {
      return res.status(429).json({ error: err.message, nextAllowedAt: err.nextAllowedAt });
    }
    res.status(400).json({ error: err.message });
  }
});
```

- [ ] **Step 2: Add GET /sessions**

```javascript
router.get('/sessions', requireUser, (req, res) => {
  const rows = auth.listSessions(req.user.id).map(s => ({
    id: s.id,
    current: s.id === req.sessionId,
    createdAt: s.createdAt,
    lastSeenAt: s.lastSeenAt,
    userAgent: s.userAgent,
    ip: s.ip,
  }));
  res.json({ sessions: rows });
});
```

- [ ] **Step 3: Add DELETE /sessions/:id (single)**

```javascript
router.delete('/sessions/:id', requireUser, (req, res) => {
  const targetId = String(req.params.id || '');
  const mine = auth.listSessions(req.user.id).some(s => s.id === targetId);
  if (!mine) return res.status(404).json({ error: 'not found' });
  auth.deleteSession(targetId);
  if (targetId === req.sessionId) res.clearCookie('verba.sid', { path: '/' });
  res.json({ ok: true });
});
```

- [ ] **Step 4: Add DELETE /sessions (all)**

```javascript
router.delete('/sessions', requireUser, (req, res) => {
  auth.deleteAllSessionsForUser(req.user.id);
  res.clearCookie('verba.sid', { path: '/' });
  res.json({ ok: true });
});
```

- [ ] **Step 5: Smoke test from shell**

Start the server, sign in via browser, then from a different terminal:

```bash
curl -b cookies.txt http://localhost:3000/api/auth/sessions
```

Expected: JSON with an array of sessions; the current session has `"current": true`.

- [ ] **Step 6: Commit**

```bash
git add server/routes/auth.js
git commit -m "feat(auth): PATCH /profile + session list/revoke endpoints"
```

---

## Task 5: Frontend API client methods

**Files:**
- Modify: `public/api.js`

- [ ] **Step 1: Extend the `auth` object**

In `public/api.js`, inside `auth: { ... }`, after the `reset:` line, add:

```javascript
      updateProfile:    (patch)    => jsonFetch('/api/auth/profile', { method: 'PATCH', body: JSON.stringify(patch) }),
      listSessions:     ()         => jsonFetch('/api/auth/sessions'),
      revokeSession:    (id)       => jsonFetch('/api/auth/sessions/' + encodeURIComponent(id), { method: 'DELETE' }),
      revokeAllSessions:()         => jsonFetch('/api/auth/sessions', { method: 'DELETE' }),
```

- [ ] **Step 2: Commit**

```bash
git add public/api.js
git commit -m "feat(api): auth profile + sessions client methods"
```

---

## Task 6: Replace settings cog with a user-menu dropdown

The current sidebar has `#settings-btn` (a cog) next to the nameplate and `#settings-modal` is opened on click. New behavior: clicking anywhere on the nameplate row opens a dropdown anchored above it.

**Files:**
- Modify: `public/app.html` (HTML + CSS for `.user-menu`)
- Modify: `public/app-main.js` (handlers; remove old settings-modal listener)

- [ ] **Step 1: Replace the `.side-account` block in app.html**

Find `<div class="side-account">` (contains `#side-avatar`, `#side-name`, `#side-email`, `#settings-btn`) and replace the entire block with:

```html
<div class="side-account" id="side-account-row" role="button" tabindex="0" aria-haspopup="menu">
  <div class="avatar" id="side-avatar">··</div>
  <div style="min-width:0;flex:1;overflow:hidden">
    <div class="name" id="side-name" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">—</div>
    <div class="email" id="side-email" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">—</div>
  </div>
  <svg class="acct-caret" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 9l6 6 6-6"/></svg>
</div>

<div class="user-menu" id="user-menu" role="menu" aria-hidden="true">
  <div class="user-menu-email" id="user-menu-email">—</div>
  <button class="user-menu-item" data-act="settings" role="menuitem">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" width="15" height="15"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.6 1.65 1.65 0 0010 3.09V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9c.26.26.43.62.45 1V10a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
    <span>Settings</span>
    <kbd class="user-menu-kbd">⌘,</kbd>
  </button>
  <div class="user-menu-sep"></div>
  <button class="user-menu-item" data-act="upgrade" role="menuitem">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" width="15" height="15"><path d="M12 3l9 9h-5v9h-8v-9H3z"/></svg>
    <span>Upgrade plan</span>
  </button>
  <button class="user-menu-item" data-act="shortcuts" role="menuitem">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" width="15" height="15"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10"/></svg>
    <span>Keyboard shortcuts</span>
    <kbd class="user-menu-kbd">⌘/</kbd>
  </button>
  <div class="user-menu-sep"></div>
  <button class="user-menu-item danger" data-act="logout" role="menuitem">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" width="15" height="15"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/></svg>
    <span>Log out</span>
  </button>
</div>
```

- [ ] **Step 2: Add CSS for `.user-menu` near the other sidebar styles**

In the `<style>` block of `app.html`, below the `.side-account .acct-settings` rule, add:

```css
.side-account{cursor:pointer;user-select:none}
.side-account:hover{background:var(--panel)}
.acct-caret{color:var(--muted);flex:0 0 auto;margin-left:6px;transition:transform .14s}
.side-account[aria-expanded="true"] .acct-caret{transform:rotate(180deg);color:var(--ink)}

.user-menu{
  position:fixed;z-index:260;min-width:228px;
  background:#fff;border:1px solid var(--line);border-radius:10px;
  box-shadow:0 14px 32px -8px rgba(16,24,40,.18),0 2px 6px rgba(16,24,40,.06);
  padding:6px;display:none;opacity:0;transform:translateY(6px);
  transition:opacity .14s ease,transform .14s ease;
}
.user-menu.open{display:block;opacity:1;transform:translateY(0)}
.user-menu-email{
  padding:8px 10px 6px;font:500 12.5px/1.3 var(--font-display);
  color:var(--ink-2);border-bottom:1px solid var(--line-soft);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:240px;
}
.user-menu-item{
  width:100%;display:flex;align-items:center;gap:10px;
  padding:8px 10px;border-radius:6px;
  font:500 13px/1 var(--font-display);color:var(--ink-2);
  background:transparent;border:0;text-align:left;cursor:pointer;
}
.user-menu-item:hover{background:var(--panel);color:var(--ink)}
.user-menu-item .user-menu-kbd{
  margin-left:auto;font:500 10.5px/1 var(--font-mono);
  color:var(--muted);background:var(--panel);border:1px solid var(--line);
  border-radius:4px;padding:2px 5px;
}
.user-menu-item.danger{color:#B42318}
.user-menu-item.danger:hover{background:#FEF2F2;color:#912018}
.user-menu-sep{height:1px;background:var(--line-soft);margin:4px 2px}
```

- [ ] **Step 3: Remove the old settings-modal listener, add user-menu controller**

In `public/app-main.js`, find the line `$('#settings-btn')?.addEventListener('click', () => $('#settings-modal')?.classList.add('open'));` and replace it (plus the immediately-following `#logout-btn` handler) with the block below. The logout handler moves into the dropdown's `data-act="logout"` branch.

```javascript
(function initUserMenu() {
  const row = document.getElementById('side-account-row');
  const menu = document.getElementById('user-menu');
  if (!row || !menu) return;

  function positionMenu() {
    const r = row.getBoundingClientRect();
    menu.style.left = r.left + 'px';
    menu.style.bottom = (window.innerHeight - r.top + 6) + 'px';
    menu.style.width = r.width + 'px';
  }
  function openMenu() {
    const u = window.__verbaUser || {};
    const emEl = document.getElementById('user-menu-email');
    if (emEl) emEl.textContent = u.email || '';
    positionMenu();
    menu.classList.add('open');
    menu.setAttribute('aria-hidden', 'false');
    row.setAttribute('aria-expanded', 'true');
  }
  function closeMenu() {
    menu.classList.remove('open');
    menu.setAttribute('aria-hidden', 'true');
    row.setAttribute('aria-expanded', 'false');
  }
  row.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.classList.contains('open') ? closeMenu() : openMenu();
  });
  document.addEventListener('click', (e) => {
    if (!menu.contains(e.target) && e.target !== row) closeMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenu();
  });
  window.addEventListener('resize', () => { if (menu.classList.contains('open')) positionMenu(); });

  menu.addEventListener('click', async (e) => {
    const btn = e.target.closest('.user-menu-item');
    if (!btn) return;
    closeMenu();
    const act = btn.dataset.act;
    if (act === 'settings')   window.__verba.openSettings('general');
    if (act === 'upgrade')    window.__verba.openPricing();
    if (act === 'shortcuts')  window.__verba.openShortcuts();
    if (act === 'logout') {
      try { await API.auth.logout(); } catch {}
      location.href = '/signin';
    }
  });

  // ⌘, opens settings; ⌘/ opens shortcuts.
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === ',') { e.preventDefault(); window.__verba.openSettings('general'); }
    if ((e.metaKey || e.ctrlKey) && e.key === '/') { e.preventDefault(); window.__verba.openShortcuts(); }
  });
})();
```

- [ ] **Step 4: Declare the `window.__verba` namespace near the top of the IIFE**

Right after `window.__verbaUser = who.user;` is first assigned, add:

```javascript
window.__verba = window.__verba || {};
```

(Handlers registered in later tasks attach `openSettings`, `openPricing`, `openShortcuts`, `openPayment` to this namespace.)

- [ ] **Step 5: Manual test**

Start server, open `/app`. Click the nameplate: dropdown appears above, shows email. Clicking outside closes it. `Escape` closes it.

- [ ] **Step 6: Commit**

```bash
git add public/app.html public/app-main.js
git commit -m "feat(ui): replace settings cog with sidebar user menu"
```

---

## Task 7: Delete the old small settings modal

**Files:**
- Modify: `public/app.html`

- [ ] **Step 1: Remove the `<!-- SETTINGS MODAL -->` block**

Delete the entire block starting at `<!-- SETTINGS MODAL (trigger lives beside nameplate as #settings-btn) -->` through the `</div>` that closes `id="settings-modal"`. The logout button inside it is already dead (listener removed in Task 6).

- [ ] **Step 2: Verify no references remain**

Run: `grep -n "settings-modal\|settings-btn\|settings-close\|settings-done" public/app.html public/app-main.js`
Expected: no matches.

- [ ] **Step 3: Commit**

```bash
git add public/app.html
git commit -m "chore(ui): remove legacy mini settings modal"
```

---

## Task 8: New fullscreen tabbed Settings modal — shell + General tab

**Files:**
- Modify: `public/app.html` (HTML + CSS)
- Modify: `public/app-main.js` (controller)

- [ ] **Step 1: Add the modal markup to app.html**

Just before `</body>`, add:

```html
<!-- SETTINGS (fullscreen tabbed) -->
<div class="settings-backdrop" id="settings-v2" aria-hidden="true">
  <div class="settings-shell" role="dialog" aria-label="Settings">
    <div class="settings-head">
      <h3>Settings</h3>
      <button class="settings-close" id="settings-v2-close" aria-label="Close">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    </div>
    <div class="settings-body">
      <nav class="settings-tabs" role="tablist">
        <button class="stab active" data-tab="general" role="tab">General</button>
        <button class="stab" data-tab="account" role="tab">Account</button>
        <button class="stab" data-tab="billing" role="tab">Billing</button>
      </nav>
      <div class="settings-panes">
        <!-- GENERAL -->
        <section class="spane on" data-pane="general">
          <h4 class="spane-h">Profile</h4>
          <div class="sfield">
            <label class="sfield-l">Full name <span class="sfield-hint" id="name-cooldown-hint"></span></label>
            <div class="sfield-row">
              <input class="sfield-input" id="profile-name" maxlength="60" />
              <button class="sfield-save" id="profile-name-save" disabled>Save</button>
            </div>
            <div class="sfield-err" id="profile-name-err" style="display:none"></div>
          </div>
          <div class="sfield">
            <label class="sfield-l">Email</label>
            <div class="sfield-static" id="profile-email">—</div>
          </div>

          <h4 class="spane-h mt">Appearance</h4>
          <div class="sfield">
            <label class="sfield-l">Body font</label>
            <div class="font-cards" id="font-cards">
              <button class="font-card on" data-val="calibri"><span style="font-family:'Calibri','Calibri MS',sans-serif">Aa</span><small>Calibri</small></button>
              <button class="font-card" data-val="inter"><span style="font-family:'Inter',sans-serif">Aa</span><small>Inter</small></button>
              <button class="font-card" data-val="times"><span style="font-family:'Times New Roman',serif">Aa</span><small>Times</small></button>
              <button class="font-card" data-val="georgia"><span style="font-family:Georgia,serif">Aa</span><small>Georgia</small></button>
              <button class="font-card" data-val="serif"><span style="font-family:'Newsreader',Georgia,serif">Aa</span><small>Newsreader</small></button>
              <button class="font-card" data-val="mono"><span style="font-family:'JetBrains Mono',ui-monospace,monospace">Aa</span><small>Mono</small></button>
              <button class="font-card" data-val="system"><span style="font-family:system-ui,sans-serif">Aa</span><small>System</small></button>
            </div>
          </div>
          <div class="sfield">
            <label class="sfield-l">Highlight color</label>
            <div class="hl-cards" id="hl-cards">
              <button class="hl-card on" data-val="yellow"><span class="hl-swatch" style="background:#FFFF00"></span><small>Yellow</small></button>
              <button class="hl-card" data-val="cyan"><span class="hl-swatch" style="background:#00FFFF"></span><small>Cyan</small></button>
              <button class="hl-card" data-val="green"><span class="hl-swatch" style="background:#00FF00"></span><small>Green</small></button>
              <button class="hl-card" data-val="lilac"><span class="hl-swatch" style="background:#C7B7F1"></span><small>Lilac</small></button>
            </div>
          </div>
        </section>

        <!-- ACCOUNT -->
        <section class="spane" data-pane="account">
          <h4 class="spane-h">Account</h4>
          <div class="sfield sfield-row-pair">
            <div>
              <div class="sfield-l">Log out of all devices</div>
              <div class="sfield-sub">Ends every active session including this one.</div>
            </div>
            <button class="btn-danger" id="logout-all-btn">Log out</button>
          </div>
          <div class="sfield sfield-row-pair">
            <div>
              <div class="sfield-l">Delete account</div>
              <div class="sfield-sub">Coming soon. Contact support for now.</div>
            </div>
            <button class="btn-ghost" disabled>Delete account</button>
          </div>
          <div class="sfield">
            <div class="sfield-l">Organization ID</div>
            <div class="sfield-static mono" id="org-id">—</div>
          </div>
          <h4 class="spane-h mt">Active sessions</h4>
          <table class="sess-table" id="sess-table">
            <thead><tr><th>Device</th><th>Location</th><th>Created</th><th>Last active</th><th></th></tr></thead>
            <tbody id="sess-tbody"><tr><td colspan="5" class="sess-empty">Loading…</td></tr></tbody>
          </table>
        </section>

        <!-- BILLING -->
        <section class="spane" data-pane="billing">
          <div class="plan-card">
            <div class="plan-head">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 2v6M12 8l-6 4M12 8l6 4M6 12v6M18 12v6M12 14v8"/></svg>
              <div class="plan-head-text">
                <div class="plan-tier" id="plan-tier">Free plan</div>
                <div class="plan-sub" id="plan-sub">Basic usage limits</div>
                <div class="plan-renew" id="plan-renew"></div>
              </div>
              <button class="btn-secondary" id="plan-adjust">Adjust plan</button>
            </div>
            <div class="plan-sep"></div>
            <div class="plan-section">
              <div class="plan-section-h">Payment</div>
              <div class="pay-row" id="pay-row">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>
                <span id="pay-mask">No payment method</span>
                <button class="btn-ghost" id="pay-update">Update</button>
              </div>
            </div>
            <div class="plan-sep"></div>
            <div class="plan-section">
              <div class="plan-section-h">Invoices</div>
              <div class="invoice-empty" id="invoice-list">No invoices yet.</div>
            </div>
            <div class="plan-sep"></div>
            <div class="plan-section">
              <div class="plan-section-h">Cancellation</div>
              <div class="pay-row">
                <span style="flex:1">Cancel plan</span>
                <button class="btn-danger" id="plan-cancel" disabled>Cancel</button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>
</div>
```

- [ ] **Step 2: Add the CSS block to app.html**

Below the existing `.modal-backdrop` rules in the `<style>` block, append:

```css
/* Fullscreen settings */
.settings-backdrop{
  position:fixed;inset:0;background:rgba(15,15,25,.42);
  display:none;align-items:center;justify-content:center;z-index:300;
  opacity:0;transition:opacity .16s ease;
}
.settings-backdrop.open{display:flex;opacity:1}
.settings-shell{
  width:min(1040px,94vw);height:min(720px,90vh);
  background:#fff;border:1px solid var(--line);border-radius:14px;
  box-shadow:0 32px 80px -16px rgba(16,24,40,.28),0 4px 12px rgba(16,24,40,.06);
  display:flex;flex-direction:column;overflow:hidden;
  transform:translateY(10px) scale(.98);transition:transform .22s cubic-bezier(.2,.9,.3,1.1);
}
.settings-backdrop.open .settings-shell{transform:translateY(0) scale(1)}
.settings-head{
  display:flex;align-items:center;justify-content:space-between;
  padding:16px 22px;border-bottom:1px solid var(--line-soft);
}
.settings-head h3{margin:0;font:600 16px/1 var(--font-display);color:var(--ink)}
.settings-close{
  width:30px;height:30px;border-radius:6px;display:grid;place-items:center;
  background:transparent;border:1px solid transparent;color:var(--muted);cursor:pointer;
}
.settings-close:hover{background:var(--panel);color:var(--ink);border-color:var(--line)}
.settings-body{flex:1;display:grid;grid-template-columns:200px 1fr;min-height:0}
.settings-tabs{
  padding:16px 10px;border-right:1px solid var(--line-soft);
  display:flex;flex-direction:column;gap:2px;background:var(--panel);
}
.stab{
  display:flex;align-items:center;gap:8px;padding:8px 12px;
  border:0;background:transparent;border-radius:6px;text-align:left;cursor:pointer;
  font:500 13px/1 var(--font-display);color:var(--ink-2);
}
.stab:hover{background:#fff;box-shadow:var(--shadow-sm)}
.stab.active{background:#fff;box-shadow:var(--shadow-sm);color:var(--ink)}
.settings-panes{overflow:auto;padding:26px 32px 36px}
.spane{display:none}
.spane.on{display:block}
.spane-h{margin:0 0 14px;font:600 14px/1 var(--font-display);color:var(--ink);letter-spacing:-0.01em}
.spane-h.mt{margin-top:28px}
.sfield{margin-bottom:18px}
.sfield-l{display:block;font:600 13px/1.2 var(--font-display);color:var(--ink-2);margin-bottom:6px}
.sfield-hint{font:500 11px/1 var(--font-mono);color:var(--muted);margin-left:6px}
.sfield-sub{font:500 12px/1.4 var(--font-display);color:var(--muted);margin-top:2px}
.sfield-row{display:flex;gap:8px}
.sfield-input{
  flex:1;padding:9px 12px;border:1px solid var(--line);border-radius:8px;
  font:500 14px/1.2 var(--font-display);color:var(--ink);background:#fff;
}
.sfield-input:focus{border-color:var(--lilac-2);box-shadow:0 0 0 3px var(--lilac-soft);outline:0}
.sfield-save{
  padding:9px 14px;background:var(--ink);color:#fff;border:0;border-radius:8px;
  font:600 13px/1 var(--font-display);cursor:pointer;
}
.sfield-save:disabled{background:var(--muted-2);cursor:not-allowed}
.sfield-err{margin-top:6px;font:500 12px/1.2 var(--font-display);color:#B42318}
.sfield-static{padding:9px 12px;background:var(--panel);border:1px solid var(--line);border-radius:8px;color:var(--ink-2);font:500 13px/1 var(--font-display)}
.sfield-static.mono{font-family:var(--font-mono);font-size:12px}
.sfield-row-pair{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:14px 0;border-bottom:1px solid var(--line-soft)}
.sfield-row-pair:last-child{border-bottom:0}
.font-cards, .hl-cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
.font-card, .hl-card{
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;
  padding:14px 8px;border:1px solid var(--line);border-radius:10px;background:#fff;cursor:pointer;
}
.font-card span{font-size:26px;line-height:1;color:var(--ink)}
.font-card small, .hl-card small{font:500 11px/1 var(--font-display);color:var(--muted)}
.font-card.on, .hl-card.on{border-color:var(--lilac-2);box-shadow:0 0 0 2px var(--lilac-soft)}
.hl-swatch{width:36px;height:36px;border-radius:8px;border:1px solid rgba(0,0,0,.08)}
.btn-danger{padding:8px 14px;border:1px solid #F3B2AB;background:#fff;color:#B42318;border-radius:8px;font:600 13px/1 var(--font-display);cursor:pointer}
.btn-danger:hover{background:#FEF2F2}
.btn-danger:disabled{opacity:.5;cursor:not-allowed}
.btn-ghost{padding:8px 14px;border:1px solid var(--line);background:#fff;color:var(--ink-2);border-radius:8px;font:600 13px/1 var(--font-display);cursor:pointer}
.btn-ghost:hover{background:var(--panel);color:var(--ink)}
.btn-ghost:disabled{opacity:.5;cursor:not-allowed}
.btn-secondary{padding:8px 14px;border:1px solid var(--line-2);background:var(--ink);color:#fff;border-radius:8px;font:600 13px/1 var(--font-display);cursor:pointer}
.btn-secondary:hover{opacity:.92}

/* Sessions table */
.sess-table{width:100%;border-collapse:collapse;font:500 13px/1.3 var(--font-display);color:var(--ink-2)}
.sess-table th{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);color:var(--muted);font-weight:600;font-size:11.5px;text-transform:uppercase;letter-spacing:.08em}
.sess-table td{padding:10px;border-bottom:1px solid var(--line-soft)}
.sess-table td .badge-current{font:600 10px/1 var(--font-mono);background:var(--lilac-soft);color:var(--ink);padding:3px 6px;border-radius:4px;margin-left:6px}
.sess-revoke{background:transparent;border:0;color:var(--muted);cursor:pointer;padding:4px 6px;border-radius:4px}
.sess-revoke:hover{background:var(--panel);color:#B42318}
.sess-empty{padding:24px;text-align:center;color:var(--muted)}

/* Billing plan card */
.plan-card{border:1px solid var(--line);border-radius:12px;background:#fff;overflow:hidden}
.plan-head{display:flex;align-items:center;gap:14px;padding:18px 20px}
.plan-head-text{flex:1;min-width:0}
.plan-tier{font:700 18px/1.1 var(--font-display);color:var(--ink)}
.plan-sub{font:500 13px/1.3 var(--font-display);color:var(--muted);margin-top:3px}
.plan-renew{font:500 12px/1.3 var(--font-display);color:var(--muted);margin-top:2px}
.plan-sep{height:1px;background:var(--line-soft)}
.plan-section{padding:16px 20px}
.plan-section-h{font:600 13px/1 var(--font-display);color:var(--ink);margin-bottom:10px}
.pay-row{display:flex;align-items:center;gap:10px;color:var(--ink-2);font:500 13px/1.3 var(--font-display)}
.pay-row button{margin-left:auto}
.invoice-empty{font:500 13px/1.4 var(--font-display);color:var(--muted)}
```

- [ ] **Step 3: Add the JS controller to app-main.js**

Append near the end of the IIFE, before the closing `})();`:

```javascript
/* --- Settings v2 controller --- */
(function initSettingsV2() {
  const back = document.getElementById('settings-v2');
  if (!back) return;
  const closeBtn = document.getElementById('settings-v2-close');
  const tabs = back.querySelectorAll('.stab');
  const panes = back.querySelectorAll('.spane');

  function open(tab) {
    back.classList.add('open');
    back.setAttribute('aria-hidden', 'false');
    activate(tab || 'general');
    hydrateGeneral();
    if (tab === 'account' || !tab) hydrateAccount();
    if (tab === 'billing') hydrateBilling();
  }
  function close() {
    back.classList.remove('open');
    back.setAttribute('aria-hidden', 'true');
  }
  function activate(name) {
    tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    panes.forEach(p => p.classList.toggle('on', p.dataset.pane === name));
    if (name === 'account') hydrateAccount();
    if (name === 'billing') hydrateBilling();
  }

  closeBtn.addEventListener('click', close);
  back.addEventListener('click', (e) => { if (e.target === back) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && back.classList.contains('open')) close(); });
  tabs.forEach(t => t.addEventListener('click', () => activate(t.dataset.tab)));

  // General: profile name + font cards + highlight cards
  function hydrateGeneral() {
    const u = window.__verbaUser || {};
    const nameInput = document.getElementById('profile-name');
    const emailEl = document.getElementById('profile-email');
    const saveBtn = document.getElementById('profile-name-save');
    const hint = document.getElementById('name-cooldown-hint');
    const err = document.getElementById('profile-name-err');
    if (nameInput) nameInput.value = u.name || '';
    if (emailEl) emailEl.textContent = u.email || '—';
    err.style.display = 'none';
    saveBtn.disabled = true;
    const last = u.nameUpdatedAt ? new Date(u.nameUpdatedAt).getTime() : 0;
    const nextAllowed = last + 24 * 60 * 60 * 1000;
    if (last && Date.now() < nextAllowed) {
      const hrs = Math.ceil((nextAllowed - Date.now()) / 3600000);
      hint.textContent = `Can change again in ~${hrs}h`;
      nameInput.disabled = true;
    } else {
      hint.textContent = '';
      nameInput.disabled = false;
    }
    nameInput.oninput = () => { saveBtn.disabled = !nameInput.value.trim() || nameInput.value.trim() === (u.name || ''); };
    saveBtn.onclick = async () => {
      err.style.display = 'none';
      saveBtn.disabled = true;
      try {
        const res = await API.auth.updateProfile({ name: nameInput.value.trim() });
        window.__verbaUser = res.user;
        paintAccount(res.user);
        hydrateGeneral();
      } catch (e) {
        err.textContent = e.body?.error || e.message || 'Failed to save';
        err.style.display = 'block';
        saveBtn.disabled = false;
      }
    };

    // Font cards
    document.querySelectorAll('#font-cards .font-card').forEach(card => {
      card.classList.toggle('on', card.dataset.val === (TWEAKS.font || 'calibri'));
      card.onclick = () => {
        TWEAKS.font = card.dataset.val;
        applyTweaks(TWEAKS);
        persistTweaks();
        document.querySelectorAll('#font-cards .font-card').forEach(x => x.classList.toggle('on', x === card));
      };
    });
    // Highlight cards
    document.querySelectorAll('#hl-cards .hl-card').forEach(card => {
      card.classList.toggle('on', card.dataset.val === (TWEAKS.highlight || 'yellow'));
      card.onclick = () => {
        TWEAKS.highlight = card.dataset.val;
        applyTweaks(TWEAKS);
        persistTweaks();
        document.querySelectorAll('#hl-cards .hl-card').forEach(x => x.classList.toggle('on', x === card));
      };
    });
  }

  // Account: sessions + log out all
  async function hydrateAccount() {
    document.getElementById('org-id').textContent = (window.__verbaUser && window.__verbaUser.id) || '—';
    const body = document.getElementById('sess-tbody');
    body.innerHTML = '<tr><td colspan="5" class="sess-empty">Loading…</td></tr>';
    try {
      const { sessions } = await API.auth.listSessions();
      if (!sessions.length) {
        body.innerHTML = '<tr><td colspan="5" class="sess-empty">No sessions</td></tr>';
        return;
      }
      body.innerHTML = sessions.map(s => {
        const ua = parseUA(s.userAgent);
        const loc = s.ip || '—';
        return `<tr>
          <td>${esc(ua)}${s.current ? '<span class="badge-current">Current</span>' : ''}</td>
          <td>${esc(loc)}</td>
          <td>${fmtDate(s.createdAt)}</td>
          <td>${fmtDate(s.lastSeenAt)}</td>
          <td>${s.current ? '' : `<button class="sess-revoke" data-id="${esc(s.id)}" title="Revoke">Revoke</button>`}</td>
        </tr>`;
      }).join('');
      body.querySelectorAll('.sess-revoke').forEach(btn => btn.onclick = async () => {
        btn.disabled = true;
        try { await API.auth.revokeSession(btn.dataset.id); hydrateAccount(); }
        catch { btn.disabled = false; }
      });
    } catch {
      body.innerHTML = '<tr><td colspan="5" class="sess-empty">Failed to load</td></tr>';
    }
  }
  document.getElementById('logout-all-btn').onclick = async () => {
    if (!confirm('Log out of every device? You will need to sign in again.')) return;
    try { await API.auth.revokeAllSessions(); } catch {}
    location.href = '/signin';
  };

  function hydrateBilling() {
    const u = window.__verbaUser || {};
    const tier = (u.tier || 'free').toLowerCase();
    document.getElementById('plan-tier').textContent = tier === 'pro' ? 'Pro plan' : 'Free plan';
    document.getElementById('plan-sub').textContent = tier === 'pro' ? 'Higher limits and priority access' : 'Basic usage limits';
    document.getElementById('plan-renew').textContent = tier === 'pro' ? 'Renews on the 1st of each month' : '';
    document.getElementById('plan-adjust').onclick = () => window.__verba.openPricing();
    document.getElementById('pay-update').onclick = () => window.__verba.openPayment();
  }

  function parseUA(ua) {
    if (!ua) return 'Unknown device';
    const s = ua.toLowerCase();
    const browser = s.includes('chrome') ? 'Chrome' : s.includes('safari') ? 'Safari' : s.includes('firefox') ? 'Firefox' : 'Browser';
    const os = s.includes('windows') ? 'Windows' : s.includes('mac os') ? 'Mac' : s.includes('android') ? 'Android' : s.includes('iphone') ? 'iOS' : 'Unknown';
    return `${browser} (${os})`;
  }
  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) +
           ', ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }

  window.__verba.openSettings = open;
})();
```

- [ ] **Step 4: Ensure `/api/auth/me` returns `nameUpdatedAt`**

In `server/routes/auth.js`, update `publicUser`:

```javascript
function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, tier: u.tier, nameUpdatedAt: u.nameUpdatedAt || null };
}
```

- [ ] **Step 5: Manual test**

Open `/app` → click nameplate → Settings → verify General shows name, font cards (default Calibri highlighted), highlight cards (default Yellow highlighted). Change name, save, refresh, see it persisted. Change font → body font updates live. Click Account tab → see sessions list. Open another browser, sign in; refresh sessions → second row appears. Click Revoke on the non-current row → disappears.

- [ ] **Step 6: Commit**

```bash
git add public/app.html public/app-main.js server/routes/auth.js
git commit -m "feat(ui): tabbed fullscreen settings modal (general + account + billing)"
```

---

## Task 9: Fullscreen pricing overlay

**Files:**
- Modify: `public/app.html` (HTML + CSS)
- Modify: `public/app-main.js` (controller)

- [ ] **Step 1: Add the pricing overlay markup before `</body>`**

```html
<!-- PRICING OVERLAY -->
<div class="pricing-overlay" id="pricing-overlay" aria-hidden="true">
  <button class="pricing-back" id="pricing-back" aria-label="Back">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
  </button>
  <div class="pricing-wrap">
    <h1 class="pricing-title">Plans that grow with you</h1>
    <div class="pricing-tabs">
      <button class="pt-pill on">Individual</button>
      <button class="pt-pill" disabled>Team and Enterprise</button>
    </div>
    <div class="pricing-cards">
      <div class="pp-card">
        <div class="pp-mark"></div>
        <div class="pp-billing"><span class="pp-month on">Monthly</span><span class="pp-yearly">Yearly · Save 17%</span></div>
        <div class="pp-tier">Solo</div>
        <div class="pp-desc">Research, cut, and organize.</div>
        <div class="pp-price">$0<small>/ forever</small></div>
        <button class="pp-cta" id="pp-solo-cta" disabled>Current plan</button>
        <ul class="pp-feats">
          <li>Unlimited cards &amp; projects</li>
          <li>Cutter + library search</li>
          <li>50 assistant queries / month</li>
          <li>.docx import &amp; export</li>
        </ul>
      </div>
      <div class="pp-card feat">
        <div class="pp-mark"></div>
        <div class="pp-tier">Squad</div>
        <div class="pp-desc">Higher limits, priority access.</div>
        <div class="pp-price">From $9<small>/ debater / mo</small></div>
        <button class="pp-cta primary" id="pp-squad-cta">Start trial</button>
        <div class="pp-fineprint">No commitment · Cancel anytime</div>
        <ul class="pp-feats">
          <li>Everything in Solo</li>
          <li>Up to 20× more usage</li>
          <li>Shared team libraries</li>
          <li>Round-doc export</li>
          <li>Priority assistant access</li>
        </ul>
      </div>
    </div>
    <div class="pp-foot">Usage limits apply. Prices shown don't include applicable tax.</div>
  </div>
</div>
```

- [ ] **Step 2: Add the CSS**

```css
.pricing-overlay{
  position:fixed;inset:0;background:var(--bg);z-index:320;
  display:none;overflow:auto;
}
.pricing-overlay.open{display:block}
.pricing-back{
  position:absolute;top:18px;left:20px;
  width:36px;height:36px;border-radius:8px;
  background:transparent;border:1px solid transparent;color:var(--muted);
  display:grid;place-items:center;cursor:pointer;
}
.pricing-back:hover{background:var(--panel);color:var(--ink);border-color:var(--line)}
.pricing-wrap{max-width:980px;margin:0 auto;padding:88px 32px 64px;text-align:center}
.pricing-title{
  font:700 38px/1.1 var(--font-display);color:var(--ink);
  letter-spacing:-0.03em;margin:0 0 24px;
}
.pricing-tabs{display:inline-flex;gap:4px;padding:4px;background:var(--panel);border:1px solid var(--line);border-radius:10px;margin-bottom:32px}
.pt-pill{padding:8px 16px;font:500 13px/1 var(--font-display);color:var(--muted);background:transparent;border:0;border-radius:7px;cursor:pointer}
.pt-pill.on{background:#fff;color:var(--ink);box-shadow:var(--shadow-sm)}
.pt-pill:disabled{cursor:not-allowed;opacity:.6}
.pricing-cards{display:grid;grid-template-columns:1fr 1fr;gap:20px;text-align:left}
.pp-card{
  padding:28px;background:#fff;border:1px solid var(--line);border-radius:14px;
  display:flex;flex-direction:column;gap:8px;box-shadow:var(--shadow-sm);
}
.pp-card.feat{border-color:var(--lilac-2);box-shadow:0 0 0 2px var(--lilac-soft),var(--shadow-sm)}
.pp-mark{width:34px;height:34px;border-radius:8px;background:linear-gradient(135deg,#C7B7F1,#8B7FBF);margin-bottom:6px}
.pp-billing{display:inline-flex;gap:4px;padding:3px;background:var(--panel);border:1px solid var(--line);border-radius:8px;align-self:flex-end;margin-top:-38px}
.pp-billing span{padding:6px 12px;border-radius:6px;font:500 11.5px/1 var(--font-display);color:var(--muted);cursor:pointer}
.pp-billing span.on{background:#fff;color:var(--ink);box-shadow:var(--shadow-sm)}
.pp-tier{font:700 20px/1 var(--font-display);color:var(--ink);margin-top:6px}
.pp-desc{font:500 13.5px/1.4 var(--font-display);color:var(--muted);margin-bottom:8px}
.pp-price{font:700 34px/1 var(--font-display);color:var(--ink);letter-spacing:-0.02em;margin:6px 0}
.pp-price small{font:500 13px/1 var(--font-display);color:var(--muted);margin-left:6px}
.pp-cta{
  margin-top:10px;padding:12px 16px;border-radius:10px;border:1px solid var(--line);
  background:#fff;color:var(--ink);font:600 14px/1 var(--font-display);cursor:pointer;
}
.pp-cta:hover{background:var(--panel)}
.pp-cta.primary{background:var(--ink);color:#fff;border-color:var(--ink)}
.pp-cta.primary:hover{opacity:.92}
.pp-cta:disabled{cursor:not-allowed;opacity:.65}
.pp-fineprint{font:500 11.5px/1 var(--font-mono);color:var(--muted);text-align:center;margin-top:4px}
.pp-feats{list-style:none;margin:12px 0 0;padding:0;display:flex;flex-direction:column;gap:8px}
.pp-feats li{padding-left:22px;position:relative;font:500 13px/1.4 var(--font-display);color:var(--ink-2)}
.pp-feats li::before{content:"";position:absolute;left:0;top:6px;width:12px;height:8px;border-left:2px solid var(--ink);border-bottom:2px solid var(--ink);transform:rotate(-45deg)}
.pp-foot{margin-top:32px;font:500 12px/1.5 var(--font-display);color:var(--muted)}

@media (max-width:820px){
  .pricing-cards{grid-template-columns:1fr}
}
```

- [ ] **Step 3: Add the controller in app-main.js**

```javascript
/* --- Pricing overlay --- */
(function initPricing() {
  const ov = document.getElementById('pricing-overlay');
  if (!ov) return;
  const back = document.getElementById('pricing-back');
  function open() { ov.classList.add('open'); ov.setAttribute('aria-hidden','false'); }
  function close(){ ov.classList.remove('open'); ov.setAttribute('aria-hidden','true'); }
  back.addEventListener('click', close);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && ov.classList.contains('open')) close(); });
  document.getElementById('pp-squad-cta').addEventListener('click', () => {
    close();
    window.__verba.openPayment();
  });
  window.__verba.openPricing = open;
})();
```

- [ ] **Step 4: Manual test**

Click nameplate → Upgrade plan → pricing overlay opens fullscreen, back arrow returns to app. `Escape` also closes.

- [ ] **Step 5: Commit**

```bash
git add public/app.html public/app-main.js
git commit -m "feat(ui): fullscreen pricing overlay with back arrow"
```

---

## Task 10: Mock payment overlay

**Files:**
- Modify: `public/app.html`
- Modify: `public/app-main.js`

- [ ] **Step 1: Add the overlay markup before `</body>`**

```html
<!-- PAYMENT (mock) -->
<div class="pay-backdrop" id="pay-overlay" aria-hidden="true">
  <div class="pay-shell" role="dialog" aria-label="Adjust usage">
    <div class="pay-head">
      <h3>Adjust usage</h3>
      <button class="settings-close" id="pay-close"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
    </div>
    <div class="pay-body">
      <div class="pay-tier-row">
        <button class="pay-tier on" data-tier="5x"><small>Current plan</small><div>5× usage · Solo</div><span>$0/mo</span></button>
        <button class="pay-tier" data-tier="20x"><small>Save 50%</small><div>20× usage · Squad</div><span>$9/mo + tax</span></button>
      </div>
      <div class="pay-order">
        <h4>Order details</h4>
        <div class="pay-line"><span>Squad plan</span><span>$9.00</span></div>
        <div class="pay-line"><span>Tax</span><span>$0.63</span></div>
        <div class="pay-line total"><span>Total due today</span><span>$9.63</span></div>
      </div>
      <div class="pay-method">
        <div class="pay-method-h">Payment method</div>
        <div class="pay-method-row">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>
          <input id="pay-card" class="sfield-input" placeholder="Card number (demo — nothing is charged)" />
        </div>
        <div class="pay-method-row" style="margin-top:8px">
          <input class="sfield-input" placeholder="MM/YY" style="max-width:120px" />
          <input class="sfield-input" placeholder="CVC" style="max-width:90px;margin-left:8px" />
          <input class="sfield-input" placeholder="ZIP" style="max-width:110px;margin-left:8px" />
        </div>
      </div>
      <label class="pay-terms"><input type="checkbox" id="pay-agree"> You agree this is a demo and no card will be charged.</label>
      <button class="pp-cta primary" id="pay-submit" disabled style="width:100%">Upgrade to 20×</button>
    </div>
  </div>
</div>
```

- [ ] **Step 2: Add CSS**

```css
.pay-backdrop{position:fixed;inset:0;background:rgba(15,15,25,.42);display:none;align-items:center;justify-content:center;z-index:340;opacity:0;transition:opacity .16s}
.pay-backdrop.open{display:flex;opacity:1}
.pay-shell{width:min(520px,94vw);background:#fff;border:1px solid var(--line);border-radius:14px;box-shadow:0 32px 80px -16px rgba(16,24,40,.28);display:flex;flex-direction:column;overflow:hidden;max-height:90vh}
.pay-head{padding:16px 22px;border-bottom:1px solid var(--line-soft);display:flex;align-items:center;justify-content:space-between}
.pay-head h3{margin:0;font:700 18px/1 var(--font-display);color:var(--ink)}
.pay-body{overflow:auto;padding:20px 22px 22px;display:flex;flex-direction:column;gap:14px}
.pay-tier-row{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.pay-tier{text-align:left;padding:12px;border:1px solid var(--line);border-radius:10px;background:#fff;cursor:pointer;display:flex;flex-direction:column;gap:4px}
.pay-tier small{font:500 10.5px/1 var(--font-mono);color:var(--muted);text-transform:uppercase;letter-spacing:.08em}
.pay-tier.on{border-color:var(--lilac-2);box-shadow:0 0 0 2px var(--lilac-soft)}
.pay-tier div{font:600 13px/1.2 var(--font-display);color:var(--ink)}
.pay-tier span{font:500 12px/1 var(--font-display);color:var(--muted)}
.pay-order{border:1px solid var(--line);border-radius:10px;padding:14px}
.pay-order h4{margin:0 0 10px;font:600 13px/1 var(--font-display);color:var(--ink)}
.pay-line{display:flex;justify-content:space-between;padding:6px 0;font:500 13px/1.3 var(--font-display);color:var(--ink-2)}
.pay-line.total{border-top:1px solid var(--line-soft);margin-top:6px;padding-top:10px;font-weight:700;color:var(--ink)}
.pay-method{border:1px solid var(--line);border-radius:10px;padding:14px}
.pay-method-h{font:600 13px/1 var(--font-display);color:var(--ink);margin-bottom:10px}
.pay-method-row{display:flex;align-items:center;gap:8px}
.pay-terms{display:flex;gap:8px;align-items:flex-start;font:500 12.5px/1.4 var(--font-display);color:var(--muted)}
```

- [ ] **Step 3: Add controller**

```javascript
/* --- Payment overlay (mock) --- */
(function initPayment() {
  const ov = document.getElementById('pay-overlay');
  if (!ov) return;
  const agree = document.getElementById('pay-agree');
  const submit = document.getElementById('pay-submit');
  const tiers = ov.querySelectorAll('.pay-tier');
  tiers.forEach(t => t.addEventListener('click', () => {
    tiers.forEach(x => x.classList.toggle('on', x === t));
  }));
  agree.addEventListener('change', () => { submit.disabled = !agree.checked; });
  submit.addEventListener('click', () => {
    submit.disabled = true;
    submit.textContent = 'Processing…';
    setTimeout(() => {
      submit.textContent = 'Demo — no charge made';
      setTimeout(close, 900);
    }, 600);
  });
  document.getElementById('pay-close').addEventListener('click', close);
  ov.addEventListener('click', e => { if (e.target === ov) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && ov.classList.contains('open')) close(); });
  function open(){ ov.classList.add('open'); ov.setAttribute('aria-hidden','false'); submit.textContent='Upgrade to 20×'; submit.disabled=true; agree.checked=false; }
  function close(){ ov.classList.remove('open'); ov.setAttribute('aria-hidden','true'); }
  window.__verba.openPayment = open;
})();
```

- [ ] **Step 4: Commit**

```bash
git add public/app.html public/app-main.js
git commit -m "feat(ui): mock payment overlay for plan upgrade"
```

---

## Task 11: Keyboard shortcuts modal

**Files:**
- Modify: `public/app.html`
- Modify: `public/app-main.js`

- [ ] **Step 1: Add modal markup before `</body>`**

```html
<!-- KEYBOARD SHORTCUTS -->
<div class="modal-backdrop" id="ks-modal">
  <div class="modal" role="dialog" aria-label="Keyboard shortcuts" style="width:min(480px,92vw)">
    <div class="modal-head">
      <h3>Keyboard shortcuts</h3>
      <button class="close" id="ks-close" aria-label="Close"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
    </div>
    <div class="modal-body" style="padding:20px 24px;display:flex;flex-direction:column;gap:18px">
      <div class="ks-section">
        <div class="ks-h">General</div>
        <div class="ks-row"><span>Command palette</span><span><kbd>⌘</kbd><kbd>K</kbd></span></div>
        <div class="ks-row"><span>Settings</span><span><kbd>⌘</kbd><kbd>,</kbd></span></div>
        <div class="ks-row"><span>Keyboard shortcuts</span><span><kbd>⌘</kbd><kbd>/</kbd></span></div>
        <div class="ks-row"><span>Toggle sidebar</span><span><kbd>⌘</kbd><kbd>.</kbd></span></div>
      </div>
      <div class="ks-section">
        <div class="ks-h">Cutter</div>
        <div class="ks-row"><span>Highlight</span><span><kbd>H</kbd></span></div>
        <div class="ks-row"><span>Shrink</span><span><kbd>S</kbd></span></div>
        <div class="ks-row"><span>Warrant</span><span><kbd>W</kbd></span></div>
        <div class="ks-row"><span>Save card</span><span><kbd>⌘</kbd><kbd>↵</kbd></span></div>
        <div class="ks-row"><span>Export round doc</span><span><kbd>⇧</kbd><kbd>E</kbd></span></div>
      </div>
    </div>
  </div>
</div>
```

- [ ] **Step 2: Add CSS**

```css
.ks-h{font:600 11px/1 var(--font-mono);color:var(--muted);text-transform:uppercase;letter-spacing:.1em;margin-bottom:8px}
.ks-row{display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--line-soft);font:500 13px/1 var(--font-display);color:var(--ink-2)}
.ks-row:last-child{border-bottom:0}
.ks-row kbd{margin-left:4px}
```

- [ ] **Step 3: Controller**

```javascript
(function initShortcuts() {
  const m = document.getElementById('ks-modal');
  if (!m) return;
  document.getElementById('ks-close').onclick = () => m.classList.remove('open');
  m.addEventListener('click', e => { if (e.target === m) m.classList.remove('open'); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && m.classList.contains('open')) m.classList.remove('open'); });
  window.__verba.openShortcuts = () => m.classList.add('open');
})();
```

- [ ] **Step 4: Commit**

```bash
git add public/app.html public/app-main.js
git commit -m "feat(ui): keyboard shortcuts modal"
```

---

## Task 12: Sidebar collapse toggle

**Files:**
- Modify: `public/app.html` (add toggle button + collapse CSS)
- Modify: `public/app-main.js` (persist in TWEAKS)

- [ ] **Step 1: Add a toggle button inside the sidebar**

In `public/app.html`, find the `.brand` div at the top of `<aside class="sidebar">` and append a sibling button right after it:

```html
<button class="sb-toggle" id="sb-toggle" aria-label="Collapse sidebar" title="Collapse (⌘.)">
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M9 18l-6-6 6-6M15 18l6-6-6-6"/></svg>
</button>
```

- [ ] **Step 2: Add CSS for collapse state**

Below the existing `.sidebar` rule:

```css
.sb-toggle{
  position:absolute;top:14px;right:-12px;z-index:20;
  width:22px;height:22px;border-radius:50%;
  background:#fff;border:1px solid var(--line);color:var(--muted);
  display:none;align-items:center;justify-content:center;cursor:pointer;
  box-shadow:var(--shadow-sm);
}
.sidebar{position:relative}
.sidebar:hover .sb-toggle{display:flex}
.sb-toggle:hover{color:var(--ink);border-color:var(--line-2)}

.shell.sb-collapsed{grid-template-columns:0px minmax(0,1fr)}
.shell.sb-collapsed .sidebar{transform:translateX(-100%);transition:transform .22s cubic-bezier(.2,.9,.3,1.1)}
.shell:not(.sb-collapsed) .sidebar{transform:translateX(0);transition:transform .22s cubic-bezier(.2,.9,.3,1.1)}

.sb-open-fab{
  position:fixed;top:14px;left:14px;z-index:30;
  width:34px;height:34px;border-radius:8px;
  background:#fff;border:1px solid var(--line);color:var(--muted);
  display:none;align-items:center;justify-content:center;cursor:pointer;
  box-shadow:var(--shadow-sm);
}
.shell.sb-collapsed .sb-open-fab{display:flex}
.sb-open-fab:hover{color:var(--ink);border-color:var(--line-2)}
```

- [ ] **Step 3: Add an "open" FAB just inside `<body>` (before `<main>`)**

```html
<button class="sb-open-fab" id="sb-open-fab" aria-label="Open sidebar" title="Open sidebar (⌘.)">
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
</button>
```

- [ ] **Step 4: Extend TWEAKS schema**

In the `EDITMODE-BEGIN` block at the top of `app.html`, add `"sidebarCollapsed": false` to the initial TWEAKS object.

- [ ] **Step 5: Wire the toggle in app-main.js**

```javascript
(function initSidebarCollapse() {
  const shell = document.querySelector('.shell');
  const toggle = document.getElementById('sb-toggle');
  const fab = document.getElementById('sb-open-fab');
  if (!shell) return;
  function apply() { shell.classList.toggle('sb-collapsed', !!TWEAKS.sidebarCollapsed); }
  function flip() { TWEAKS.sidebarCollapsed = !TWEAKS.sidebarCollapsed; persistTweaks(); apply(); }
  apply();
  toggle && toggle.addEventListener('click', flip);
  fab && fab.addEventListener('click', flip);
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === '.') { e.preventDefault(); flip(); }
  });
})();
```

- [ ] **Step 6: Manual test**

Hover sidebar → chevron appears. Click → sidebar slides out, FAB appears top-left. Click FAB → slides back. `⌘.` toggles. Refresh — state persists.

- [ ] **Step 7: Commit**

```bash
git add public/app.html public/app-main.js
git commit -m "feat(ui): collapsible sidebar with persisted state"
```

---

## Task 13: Update graphify cache + final verification

**Files:** no code changes.

- [ ] **Step 1: Run graphify update**

```bash
graphify update .
```

Expected: graph updated, no API cost.

- [ ] **Step 2: End-to-end sanity check**

With server running and logged in:
1. Nameplate click → dropdown shows email + 4 items.
2. Settings → General: change name, rename cooldown shows next allowed time after save.
3. Settings → General: click each font card — body font updates live. Click each highlight card — highlight color updates in any card preview.
4. Settings → Account: active sessions lists this one (Current badge). Log in via incognito → refresh → second row appears with Revoke.
5. Settings → Account: "Log out of all devices" routes to /signin.
6. Settings → Billing: plan card shows Free. Adjust plan → pricing overlay opens.
7. Pricing → Start trial → payment overlay. Check agreement → Upgrade to 20× → "Demo — no charge made" flash → closes.
8. Sidebar chevron → collapses. FAB → opens. `⌘.` toggles. Reload → state persists.
9. `⌘,` opens Settings. `⌘/` opens Shortcuts modal. `Escape` closes any open overlay.

- [ ] **Step 3: Final commit (if graph files changed)**

```bash
git add graphify-out/
git commit -m "chore(graphify): refresh graph after settings/pricing revamp"
```

---

## Notes for the implementer

- **Theme parity.** All new overlays use `--bg`, `--ink`, `--ink-2`, `--muted`, `--panel`, `--line`, `--line-soft`, `--lilac-2`, `--lilac-soft`, `--font-display`, `--font-ui`, `--font-mono`, `--shadow-sm`. Do not introduce new colors.
- **No raw `alert()`.** The one `confirm()` in Task 8 Step 5 is acceptable for destructive "log out everywhere" — matches Claude's behavior. Everything else is inline UI.
- **Don't break the legacy tweaks panel.** The old floating `#tweaks-panel` (with its `.tweak-opts` / `.check-pill` controls) stays in place as a power-user quick shortcut. The new font/highlight cards just mutate the same `TWEAKS` object, so both stay in sync automatically.
- **Payment is strictly mock.** No backend route is added for billing. The overlay never calls the API.
- **Existing `publicUser` shape.** Adding `nameUpdatedAt` is backward-compatible — older clients just ignore it.
