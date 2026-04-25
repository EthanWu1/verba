'use strict';

const crawler = require('./tocCrawler');
const db      = require('./tocDb');
const parser  = require('./tocParser');
const rankings = require('./rankingsEngine');

// Tabroom uses many abbr variants: LD, VLD, LD-O, LD-INP, OLD (Open LD),
// PF, VPF, PF-O, PF-INP, PF-ONL; CX, VCX, CX-INP, POL. Match by pattern on
// both abbr and event name; skip non-varsity (novice / JV / middle school).
const NON_VARSITY_NAME_RE = /novice|junior\s*varsity|\bjv\b|\bjunior\b|\bms\b|middle\s*school|rising\s*star|\bCFL\b|\bCHSSA\b|-\s*CA\b|\bCA\s*(?:bracket|division|championship)/i;
// Side events that are not the main competitive draw: round robins, challenge/invite
// sub-brackets, exhibitions. These often share abbrs like PFRR, LDRR, CXRR, PFCh, etc.
const SIDE_EVENT_NAME_RE = /round\s*robin|challenge|showcase|exhibit|invitational\s*round/i;
const NON_VARSITY_ABBR_EXACT = new Set([
  'JVLD', 'JVPF', 'JVCX', 'JVPOL', 'JVPOLICY',
  'NLD', 'NPF', 'NCX', 'NPOL', 'NPOLICY',
  'MSLD', 'MSPF', 'MSCX',
  'NOVLD', 'NOVPF', 'NOVCX',
  'JRVLD', 'JRVPF', 'JRVCX',
]);
function _isNonVarsityEvent(ev) {
  const name = String(ev && ev.name || '');
  const abbr = String(ev && ev.abbr || '').toUpperCase();
  if (NON_VARSITY_NAME_RE.test(name)) return true;
  if (SIDE_EVENT_NAME_RE.test(name)) return true;
  if (NON_VARSITY_ABBR_EXACT.has(abbr)) return true;
  if (/^JV/.test(abbr)) return true;                 // JVLD, JV-LD, JV_PF…
  if (/^MS[A-Z]/.test(abbr)) return true;            // MSLD, etc.
  if (/^NOV/.test(abbr)) return true;                // NOVLD
  if (/^N(LD|PF|CX|POL)/.test(abbr)) return true;    // NLD, NPF, NCX, NPOL
  if (/RR$/.test(abbr)) return true;                 // PFRR, LDRR, CXRR (Round Robin)
  if (/-CA$/.test(abbr)) return true;                 // LD-CA, PF-CA (California bracket)
  if (/-RS$/.test(abbr)) return true;                 // LD-RS, PF-RS, CX-RS (Rising Star)
  if (/^J(LD|PF|CX|POL)/.test(abbr)) return true;     // JLD, JPF, JCX (Junior)
  return false;
}
function _canonicalAbbrFromText(text) {
  const s = String(text || '').toUpperCase();
  if (!s) return null;
  if (NON_VARSITY_NAME_RE.test(s)) return null;
  // Allow optional "V" varsity prefix (VLD, VPF, VCX) — Tabroom uses these
  // for tournaments like Heart of Texas. JV/N/MS prefixes are caught earlier
  // by NON_VARSITY_ABBR_EXACT and the ^JV/^MS/^N regexes in _isNonVarsityEvent.
  if (/\bV?LD\b|LINCOLN[-\s]?DOUGLAS/.test(s)) return 'LD';
  if (/\bV?PF\b|PUBLIC\s*FORUM/.test(s))        return 'PF';
  if (/\bV?CX\b|POLICY(?!\s*DEBATE.*SPEAKER)/.test(s)) return 'CX';
  return null;
}
function _canonicalAbbr(rawAbbr) {
  return _canonicalAbbrFromText(rawAbbr);
}
function _canonicalFromEvent(ev, cat) {
  if (!ev) return null;
  if (_isNonVarsityEvent(ev)) return null;
  return _canonicalAbbrFromText(ev.abbr)
      || _canonicalAbbrFromText(ev.name)
      || _canonicalAbbrFromText(cat && cat.abbr)
      || _canonicalAbbrFromText(cat && cat.name);
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
    if (_canonicalAbbrFromText(c.abbr) || _canonicalAbbrFromText(c.name)) return true;
    return (c.events || []).some(ev => _canonicalFromEvent(ev, c));
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

  db.clearEventsForTournament(tournId);
  const entryEventMap = new Map();
  for (const cat of debateCats) {
    for (const ev of (cat.events || [])) {
      if (ev.type !== 'debate') continue;
      if (_isNonVarsityEvent(ev)) continue;
      const canon = _canonicalFromEvent(ev, cat);
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
      if (!_canonicalFromEvent(ev, cat)) continue;
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
      const canon = _canonicalFromEvent(ev, cat);
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
      const canon = _canonicalFromEvent(ev, cat);
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
