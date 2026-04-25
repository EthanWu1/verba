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
const compression  = require('compression');

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
const tocRoutes         = require('./routes/toc');
const rankingsRoutes    = require('./routes/rankings');
const tabroomRoutes     = require('./routes/tabroom');

const app  = express();
const PORT = process.env.PORT || 3000;

/* ── Middleware ── */
app.use(compression({ level: 6, threshold: 1024 }));
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
app.use('/api/toc',           tocRoutes);
app.use('/api/rankings',      rankingsRoutes);
app.use('/api/me',            tabroomRoutes);

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
      res.set('Cache-Control', 'public, max-age=31536000, immutable');
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
// Open DB + run migrations before listen, but defer facet/analytics warmup so server
// responds to requests immediately. First facet/analytics call pays the cold-cache cost once.
(function warmAndStart() {
  const tBoot = Date.now();
  const db = require('./services/db');
  try {
    console.log('[warm] opening DB...');
    const t1 = Date.now();
    db.getDb();
    console.log(`[warm] DB open (${Date.now() - t1}ms, ${db.countCards()} cards)`);
  } catch (err) {
    console.error('[warm] DB open FAILED:', err.stack || err.message);
  }

  app.listen(PORT, () => {
    console.log('');
    console.log('╔════════════════════════════════════════╗');
    console.log('║   Verbatim AI — Card Cutter v2.0       ║');
    console.log(`║   Running at http://localhost:${PORT}      ║`);
    console.log(`║   Model: ${(process.env.MODEL || 'llama-3.3-70b').padEnd(30)}║`);
    console.log('╚════════════════════════════════════════╝');
    console.log('');

    // Background warmup: populate facet + analytics caches without blocking the listener.
    // First request that needs them waits if still running; everything else is unblocked.
    setImmediate(() => {
      (async () => {
        try {
          const bw = Date.now();
          const { getLibraryAnalytics } = require('./services/libraryQuery');
          const dbm = require('./services/db');
          const t2 = Date.now();
          dbm.facetCounts(null, 20);
          console.log(`[warm] facet cache (${Date.now() - t2}ms) [bg]`);
          const t3 = Date.now();
          getLibraryAnalytics();
          console.log(`[warm] analytics cache (${Date.now() - t3}ms) [bg]`);
          console.log(`[warm] bg total ${Date.now() - bw}ms`);
        } catch (err) {
          console.error('[warm] bg warmup failed:', err.message);
        }
      })();
    });

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

    // Auto-seed TOC tournament index if empty
    try {
      const { countTournaments } = require('./services/tocDb');
      const { seedTocIndex } = require('./services/tocIndexer');
      if (countTournaments() === 0) {
        if (process.env.TOC_AUTOSEED === '1') {
          console.log('[toc] TOC_AUTOSEED=1 — seeding tournament index...');
          seedTocIndex()
            .then(r => console.log(`[toc] Seeded ${r.tournaments} tournaments, ${r.entries} entries, ${r.skipped} skipped, ${r.errors} errors`))
            .catch(err => console.error('[toc] Seed failed:', err.message));
        } else {
          console.log('[toc] No tournaments indexed. Set TOC_AUTOSEED=1 in .env or POST /api/toc/reindex to populate.');
        }
      }
    } catch (err) {
      console.error('[toc] Auto-seed init failed:', err.message);
    }

    // Tabroom crawler: initial run after 60s, then every 6 hours
    setTimeout(() => {
      (async () => {
        try {
          const { refreshAll } = require('./services/tabroomCrawler');
          await refreshAll();
        } catch (err) {
          console.error('[tabroom] Initial refresh failed:', err.message);
        }
      })();
    }, 60_000);
    setInterval(() => {
      (async () => {
        try {
          const { refreshAll } = require('./services/tabroomCrawler');
          await refreshAll();
        } catch (err) {
          console.error('[tabroom] Scheduled refresh failed:', err.message);
        }
      })();
    }, 6 * 60 * 60 * 1000);
  });
})();

module.exports = app;
