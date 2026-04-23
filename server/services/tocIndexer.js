'use strict';

const crawler = require('./tocCrawler');
const db      = require('./tocDb');
const parser  = require('./tocParser');
const rankings = require('./rankingsEngine');

// Tabroom uses category abbrs like VLD (Varsity LD), VPF, JVLD etc. We normalize
// to canonical LD/PF/CX and skip non-varsity divisions entirely.
const ABBR_CANON = {
  LD: 'LD', VLD: 'LD', SLD: 'LD', OLD: 'LD',
  PF: 'PF', VPF: 'PF', SPF: 'PF',
  CX: 'CX', VCX: 'CX', POL: 'CX',
};
function _canonicalAbbr(rawAbbr) {
  return ABBR_CANON[String(rawAbbr || '').toUpperCase()] || null;
}
const NON_VARSITY_RE = /novice|junior varsity|\bjv\b|\bms\b|middle school/i;
function _isNonVarsityEvent(ev) {
  const blob = `${ev && ev.name || ''} ${ev && ev.abbr || ''}`;
  return NON_VARSITY_RE.test(blob);
}

let _seeding = false;
const _inflight = new Map();

const SEED_CONCURRENCY = 3;

async function runWithConcurrency(items, limit, worker) {
  let idx = 0;
  async function next() {
    while (idx < items.length) {
      const i = idx++;
      try { await worker(items[i], i); }
      catch (e) { /* worker handles its own logging; just keep draining */ }
    }
  }
  const pool = Array.from({ length: Math.min(limit, items.length) }, () => next());
  await Promise.all(pool);
}

async function seedTocIndex() {
  if (_seeding) return { skipped: true };
  _seeding = true;
  const stats = { tournaments: 0, entries: 0, skipped: 0, errors: 0 };
  try {
    const circuitId = await crawler.fetchTocCircuitId();
    const ids = await crawler.fetchCircuitTournIds(circuitId);
    console.log(`[toc] seeding ${ids.length} tournaments with concurrency=${SEED_CONCURRENCY}`);

    await runWithConcurrency(ids, SEED_CONCURRENCY, async (id) => {
      try {
        const indexed = await indexTournament(id, { skipRecompute: true });
        if (indexed) { stats.tournaments++; stats.entries += indexed.entries; }
        else stats.skipped++;
      } catch (err) {
        console.error(`[toc] tournament ${id} failed:`, err.message);
        stats.errors++;
      }
    });

    for (const { season } of db.listSeasons()) {
      db.rebuildSeasonBids(season);
      try { rankings.recomputeRatings(season); }
      catch (err) { console.error('[rankings] seed recompute failed for', season, '-', err.message); }
    }
  } finally {
    _seeding = false;
  }
  return stats;
}

async function crawlTournament(tournId) {
  if (_inflight.has(tournId)) return _inflight.get(tournId);
  const p = (async () => {
    try { return await indexTournament(tournId); }
    finally { _inflight.delete(tournId); }
  })();
  _inflight.set(tournId, p);
  return p;
}

async function indexTournament(tournId, opts = {}) {
  const { skipRecompute = false } = opts;
  const json = await crawler.fetchTournamentJson(tournId);

  // Consider any category whose abbr or whose event.abbr canonicalizes to LD/PF/CX
  const debateCats = (json.categories || []).filter(c => {
    if (_canonicalAbbr(c.abbr)) return true;
    return (c.events || []).some(ev => _canonicalAbbr(ev.abbr));
  });
  if (!debateCats.length) return null;

  const season = parser.seasonFor(json.start);
  db.upsertTournament({
    tourn_id:  Number(json.id),
    name:      json.name,
    webname:   json.webname,
    city:      json.city,
    state:     json.state,
    country:   json.country,
    startDate: String(json.start).slice(0, 10),
    endDate:   String(json.end).slice(0, 10),
    season,
  });

  const entryEventMap = new Map();
  for (const cat of debateCats) {
    for (const ev of (cat.events || [])) {
      if (ev.type !== 'debate') continue;
      if (_isNonVarsityEvent(ev)) continue;
      const canon = _canonicalAbbr(ev.abbr) || _canonicalAbbr(cat.abbr);
      if (!canon) continue;
      const bid = parser.inferBidLevel(ev);
      db.upsertEvent(tournId, { eventId: Number(ev.id), abbr: canon, name: ev.name, ...bid });
      for (const school of (json.schools || [])) {
        for (const entry of (school.entries || [])) {
          if (Number(entry.event) === Number(ev.id) && !entry.dropped) {
            entryEventMap.set(Number(entry.id), { abbr: canon, school });
          }
        }
      }
    }
  }

  const earnedByEvent = new Map();
  for (const cat of debateCats) {
    for (const ev of (cat.events || [])) {
      if (ev.type !== 'debate') continue;
      if (_isNonVarsityEvent(ev)) continue;
      if (!_canonicalAbbr(ev.abbr) && !_canonicalAbbr(cat.abbr)) continue;
      const map = parser.parseEarnedBids(ev);
      for (const [eid, val] of map) earnedByEvent.set(eid, val);
    }
  }

  db.clearEntriesForTournament(tournId);
  for (const school of (json.schools || [])) {
    for (const entry of (school.entries || [])) {
      const match = entryEventMap.get(Number(entry.id));
      if (!match) continue;
      const teamKey = parser.teamKeyFor(entry, school);
      db.upsertEntry(tournId, {
        eventAbbr:   match.abbr,
        entryId:     Number(entry.id),
        teamKey,
        schoolId:    school.id != null ? Number(school.id) : null,
        schoolName:  school.name,
        schoolCode:  school.code,
        displayName: entry.code || entry.name || '',
        earnedBid:   earnedByEvent.get(Number(entry.id)) || null,
      });
    }
  }

  db.clearBallotsForTournament(tournId);
  for (const cat of debateCats) {
    for (const ev of (cat.events || [])) {
      if (ev.type !== 'debate') continue;
      if (_isNonVarsityEvent(ev)) continue;
      const canon = _canonicalAbbr(ev.abbr) || _canonicalAbbr(cat.abbr);
      if (!canon) continue;
      for (const ballot of parser.parseBallots(ev)) {
        db.insertBallot({ ...ballot, tournId: Number(tournId), eventAbbr: canon });
      }
    }
  }

  db.clearResultsForTournament(tournId);
  for (const cat of debateCats) {
    for (const ev of (cat.events || [])) {
      if (ev.type !== 'debate') continue;
      if (_isNonVarsityEvent(ev)) continue;
      const canon = _canonicalAbbr(ev.abbr) || _canonicalAbbr(cat.abbr);
      if (!canon) continue;
      for (const r of parser.parseResults(ev)) {
        db.upsertResult({ tournId: Number(tournId), eventAbbr: canon, ...r });
      }
    }
  }

  db.setTournamentCrawled(tournId);
  if (!skipRecompute) {
    db.rebuildSeasonBids(season);
    try { rankings.recomputeRatings(season); }
    catch (err) { console.error('[rankings] recompute failed for', season, '-', err.message); }
  }

  return { entries: entryEventMap.size };
}

module.exports = { seedTocIndex, crawlTournament };
