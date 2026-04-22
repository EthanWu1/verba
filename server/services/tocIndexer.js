'use strict';

const crawler = require('./tocCrawler');
const db      = require('./tocDb');
const parser  = require('./tocParser');

const DEBATE_ABBRS = new Set(['LD', 'PF', 'CX']);

let _seeding = false;
const _inflight = new Map();

async function seedTocIndex() {
  if (_seeding) return { skipped: true };
  _seeding = true;
  const stats = { tournaments: 0, entries: 0, skipped: 0, errors: 0 };
  try {
    const circuitId = await crawler.fetchTocCircuitId();
    const ids = await crawler.fetchCircuitTournIds(circuitId);
    for (const id of ids) {
      try {
        const indexed = await indexTournament(id);
        if (indexed) { stats.tournaments++; stats.entries += indexed.entries; }
        else stats.skipped++;
      } catch (err) {
        console.error(`[toc] tournament ${id} failed:`, err.message);
        stats.errors++;
      }
    }
    for (const { season } of db.listSeasons()) db.rebuildSeasonBids(season);
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

async function indexTournament(tournId) {
  const json = await crawler.fetchTournamentJson(tournId);

  const debateCats = (json.categories || []).filter(c => DEBATE_ABBRS.has((c.abbr || '').toUpperCase()));
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
    const abbr = cat.abbr.toUpperCase();
    for (const ev of (cat.events || [])) {
      if (ev.type !== 'debate') continue;
      const bid = parser.inferBidLevel(ev);
      db.upsertEvent(tournId, { eventId: Number(ev.id), abbr, name: ev.name, ...bid });
      for (const school of (json.schools || [])) {
        for (const entry of (school.entries || [])) {
          if (Number(entry.event) === Number(ev.id) && !entry.dropped) {
            entryEventMap.set(Number(entry.id), { abbr, school });
          }
        }
      }
    }
  }

  const earnedByEvent = new Map();
  for (const cat of debateCats) {
    for (const ev of (cat.events || [])) {
      if (ev.type !== 'debate') continue;
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
    const abbr = cat.abbr.toUpperCase();
    for (const ev of (cat.events || [])) {
      if (ev.type !== 'debate') continue;
      for (const ballot of parser.parseBallots(ev)) {
        db.insertBallot({ ...ballot, tournId: Number(tournId), eventAbbr: abbr });
      }
    }
  }

  db.clearResultsForTournament(tournId);
  for (const cat of debateCats) {
    const abbr = cat.abbr.toUpperCase();
    for (const ev of (cat.events || [])) {
      if (ev.type !== 'debate') continue;
      for (const r of parser.parseResults(ev)) {
        db.upsertResult({ tournId: Number(tournId), eventAbbr: abbr, ...r });
      }
    }
  }

  db.setTournamentCrawled(tournId);
  db.rebuildSeasonBids(season);

  return { entries: entryEventMap.size };
}

module.exports = { seedTocIndex, crawlTournament };
