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
app.use(express.static(PUBLIC, { index: false }));

// Landing is the default home page
app.get('/', (_req, res) => res.sendFile(path.join(PUBLIC, 'landing.html')));
app.get('/signin', (_req, res) => res.sendFile(path.join(PUBLIC, 'signin.html')));
app.get('/signup', (_req, res) => res.sendFile(path.join(PUBLIC, 'signin.html')));
app.get('/login',  (_req, res) => res.sendFile(path.join(PUBLIC, 'signin.html')));
app.get('/forgot', (_req, res) => res.sendFile(path.join(PUBLIC, 'forgot.html')));
app.get('/reset',  (_req, res) => res.sendFile(path.join(PUBLIC, 'reset.html')));
app.get(['/app', '/app/*'], (_req, res) => res.sendFile(path.join(PUBLIC, 'app.html')));

// SPA-ish fallback — anything else that isn't an API call goes to landing.
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(PUBLIC, 'landing.html'));
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
  });
})();

module.exports = app;
