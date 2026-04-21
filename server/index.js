/**
 * server/index.js
 * Verbatim AI — Express server entry point
 * Serves static frontend from /public and mounts API routes
 */

'use strict';

require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const cookieParser = require('cookie-parser');

const aiRoutes          = require('./routes/ai');
const importRoutes      = require('./routes/import');
const libraryRoutes     = require('./routes/library');
const scrapeRoutes      = require('./routes/scrape');
const exportRoutes      = require('./routes/export');
const contentionsRoutes = require('./routes/contentions');
const chatRoutes        = require('./routes/chat');
const projectsRoutes    = require('./routes/projects');
const authRoutes        = require('./routes/auth');
const mineRoutes        = require('./routes/mine');
const historyRoutes     = require('./routes/history');
const wikiRoutes        = require('./routes/wiki');

const app  = express();
const PORT = process.env.PORT || 3000;

/* ── Middleware ── */
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

/* ── Request logger ── */
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const dur = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} → ${res.statusCode} (${dur}ms)`);
  });
  next();
});

/* ── API Routes ── */
app.use('/api',               aiRoutes);
app.use('/api/import',        importRoutes);
app.use('/api/library',       libraryRoutes);
app.use('/api/scrape',        scrapeRoutes);
app.use('/api/export',        exportRoutes);
app.use('/api/contentions',   contentionsRoutes);
app.use('/api/chat',          chatRoutes);
app.use('/api/projects',      projectsRoutes);
app.use('/api/auth',          authRoutes);
app.use('/api/mine',          mineRoutes);
app.use('/api/history',       historyRoutes);
app.use('/api/wiki',          wikiRoutes);

/* ── Health check ── */
app.get('/api/health', (req, res) => {
  res.json({
    status:  'ok',
    version: '2.0.0',
    model:   process.env.MODEL || 'meta-llama/llama-3.3-70b-instruct:free',
    time:    new Date().toISOString(),
  });
});

/* ── Serve static frontend ── */
const PUBLIC = path.join(__dirname, '..', 'public');

// Auth gate for the editor. No session → bounce to signin.
const { validateSession } = require('./services/auth');
function requireAuthPage(req, res, next) {
  const sid = req.cookies && req.cookies['verba.sid'];
  const ctx = validateSession(sid);
  if (!ctx) return res.redirect('/signin');
  next();
}
// Always send fresh HTML — browser never uses stale cache for document navigation.
function sendHtmlNoCache(res, file) {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.sendFile(path.join(PUBLIC, file));
}

app.get(['/app.html', '/app', '/app/*'], requireAuthPage, (_req, res) => {
  sendHtmlNoCache(res, 'app.html');
});

app.use(express.static(PUBLIC, {
  index: false,
  setHeaders(res, filePath) {
    // HTML never cached; JS/CSS revalidate every request; assets long cache.
    if (filePath.endsWith('.html')) {
      res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    } else if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.set('Cache-Control', 'no-cache, must-revalidate');
    } else {
      res.set('Cache-Control', 'public, max-age=86400');
    }
  },
}));

// Landing is the default home page
app.get('/', (_req, res) => sendHtmlNoCache(res, 'landing.html'));
app.get('/signin', (_req, res) => sendHtmlNoCache(res, 'signin.html'));
app.get('/signup', (_req, res) => sendHtmlNoCache(res, 'signin.html'));
app.get('/login',  (_req, res) => sendHtmlNoCache(res, 'signin.html'));
app.get('/forgot', (_req, res) => sendHtmlNoCache(res, 'forgot.html'));
app.get('/reset',  (_req, res) => sendHtmlNoCache(res, 'reset.html'));

// SPA-ish fallback — anything else that isn't an API call goes to landing.
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  sendHtmlNoCache(res, 'landing.html');
});

/* ── Start ── */
// Warm DB BEFORE listen so first request isn't blocked on migrations/FTS rebuild.
(function warmAndStart() {
  const tBoot = Date.now();
  try {
    const db = require('./services/db');
    const { getLibraryAnalytics } = require('./services/libraryQuery');
    console.log('[warm] opening DB...');
    const t1 = Date.now();
    db.getDb();
    console.log(`[warm] DB open (${Date.now() - t1}ms)`);
    const t2 = Date.now();
    db.facetCounts(null, 20);
    console.log(`[warm] facet cache (${Date.now() - t2}ms)`);
    const t3 = Date.now();
    getLibraryAnalytics();
    console.log(`[warm] analytics cache (${Date.now() - t3}ms)`);
    console.log(`[warm] total ${Date.now() - tBoot}ms, ${db.countCards()} cards`);
  } catch (err) {
    console.error('[warm] boot warmup FAILED:', err.stack || err.message);
  }

  app.listen(PORT, () => {
    console.log('');
    console.log('╔════════════════════════════════════════╗');
    console.log('║   Verbatim AI — Card Cutter v2.0       ║');
    console.log(`║   Running at http://localhost:${PORT}      ║`);
    console.log(`║   Model: ${(process.env.MODEL || 'llama-3.3-70b').padEnd(30)}║`);
    console.log('╚════════════════════════════════════════╝');
    console.log('');

    // Auto-seed wiki team index if empty
    try {
      const { countTeams } = require('./services/wikiDb');
      const { seedTeamIndex } = require('./services/wikiIndexer');
      if (process.env.OPENCASELIST_USER && countTeams() === 0) {
        console.log('[wiki] No teams indexed — seeding from opencaselist...');
        seedTeamIndex()
          .then(r => console.log(`[wiki] Seeded ${r.inserted} teams`))
          .catch(err => console.error('[wiki] Seed failed:', err.message));
      }
    } catch (err) {
      console.error('[wiki] Auto-seed init failed:', err.message);
    }
  });
})();

module.exports = app;
