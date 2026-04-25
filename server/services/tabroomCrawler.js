'use strict';
/**
 * tabroomCrawler.js — fetches public Tabroom tournament data and indexes it.
 *
 * Data source: https://www.tabroom.com/api/download_data.mhtml?tourn_id=<ID>
 * No auth required. Public JSON.
 */
const axios = require('axios');
const zlib  = require('zlib');
const { getDb } = require('./db');

const BASE_URL = 'https://www.tabroom.com';
const DOWNLOAD_URL = (id) => `${BASE_URL}/api/download_data.mhtml?tourn_id=${id}`;

/**
 * Parse schools[].entries[] into tabroom_entry_index rows.
 * Returns array of row objects.
 */
function parseEntries(json, tournId) {
  const rows = [];
  const schools = json.schools || [];

  // Build event lookup: eventId → { abbr, name }
  const eventMap = {};
  for (const cat of (json.categories || [])) {
    for (const ev of (cat.events || [])) {
      eventMap[ev.id] = { abbr: ev.abbr || ev.name, name: ev.name };
    }
  }

  for (const school of schools) {
    const schoolName = (school.name || '').trim();
    for (const entry of (school.entries || [])) {
      const code = (entry.code || '').trim();
      if (!code) continue;

      // Resolve event info — entry.event is the event id
      const ev = eventMap[entry.event] || {};
      const eventAbbr = (ev.abbr || entry.event || '').toString();
      const eventName = (ev.name || eventAbbr).toString();

      const studentNames = JSON.stringify(
        (entry.students || []).map(s => {
          if (typeof s === 'string') return s;
          return [s.first, s.last].filter(Boolean).join(' ');
        })
      );

      rows.push({
        tournId,
        teamCode:     code,
        schoolName,
        entryId:      entry.id,
        eventAbbr,
        eventName,
        studentNames,
        dropped:      entry.dropped ? 1 : 0,
      });
    }
  }
  return rows;
}

/**
 * Fetch a tournament by ID, cache compressed JSON, and upsert entry index.
 * Returns the number of entry rows indexed.
 */
async function fetchTournament(tournId) {
  tournId = Number(tournId);
  const db = getDb();

  let json;
  try {
    const resp = await axios.get(DOWNLOAD_URL(tournId), {
      timeout: 30000,
      headers: { 'User-Agent': 'VerbatimAI/2.0 (educational; contact ethanzhouwu@gmail.com)' },
    });
    json = resp.data;
  } catch (err) {
    throw new Error(`[tabroom] fetchTournament(${tournId}) HTTP error: ${err.message}`);
  }

  // Store compressed JSON
  const rawJson = zlib.gzipSync(JSON.stringify(json));
  const name      = json.name      || String(tournId);
  const startDate = json.start     || null;
  const endDate   = json.end       || null;
  const fetchedAt = Date.now();

  db.prepare(`
    INSERT OR REPLACE INTO tabroom_tournament_cache
      (tournId, name, startDate, endDate, fetchedAt, rawJson)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(tournId, name, startDate, endDate, fetchedAt, rawJson);

  // Upsert entry index
  const rows = parseEntries(json, tournId);
  const upsert = db.prepare(`
    INSERT OR REPLACE INTO tabroom_entry_index
      (tournId, teamCode, schoolName, entryId, eventAbbr, eventName, studentNames, dropped)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const upsertMany = db.transaction((entries) => {
    for (const r of entries) {
      upsert.run(r.tournId, r.teamCode, r.schoolName, r.entryId,
                 r.eventAbbr, r.eventName, r.studentNames, r.dropped);
    }
  });
  upsertMany(rows);

  console.log(`[tabroom] fetchTournament(${tournId}) "${name}": ${rows.length} entries indexed`);
  return rows.length;
}

/**
 * Scrape the Tabroom homepage for upcoming tournament IDs and names.
 * Returns [{tournId, name}]
 */
async function findUpcoming() {
  let html;
  try {
    const resp = await axios.get(`${BASE_URL}/index/index.mhtml`, {
      timeout: 20000,
      headers: { 'User-Agent': 'VerbatimAI/2.0 (educational; contact ethanzhouwu@gmail.com)' },
    });
    html = resp.data;
  } catch (err) {
    console.error('[tabroom] findUpcoming scrape failed:', err.message);
    return [];
  }

  // cheerio may not be available — use a simple regex fallback
  let cheerio;
  try { cheerio = require('cheerio'); } catch {}

  if (cheerio) {
    const $ = cheerio.load(html);
    const results = [];
    $('a[href*="tourn_id="]').each((_i, el) => {
      const href = $(el).attr('href') || '';
      const m = href.match(/tourn_id=(\d+)/);
      if (!m) return;
      const tournId = Number(m[1]);
      const name = $(el).text().trim() || `Tournament ${tournId}`;
      results.push({ tournId, name });
    });
    // Deduplicate by tournId
    const seen = new Set();
    return results.filter(r => { if (seen.has(r.tournId)) return false; seen.add(r.tournId); return true; });
  }

  // Regex fallback
  const re = /href="[^"]*tourn_id=(\d+)[^"]*"[^>]*>([^<]+)</g;
  const results = [];
  const seen = new Set();
  let m;
  while ((m = re.exec(html)) !== null) {
    const tournId = Number(m[1]);
    if (seen.has(tournId)) continue;
    seen.add(tournId);
    results.push({ tournId, name: m[2].trim() });
  }
  return results;
}

/**
 * Refresh all upcoming tournaments: find IDs, fetch each with 1s delay.
 * opts: { maxTournaments? }
 */
async function refreshAll(opts = {}) {
  const upcoming = await findUpcoming();
  const limit = opts.maxTournaments || upcoming.length;
  let fetched = 0, errors = 0;

  for (let i = 0; i < Math.min(upcoming.length, limit); i++) {
    if (i > 0) await new Promise(r => setTimeout(r, 1000));
    try {
      await fetchTournament(upcoming[i].tournId);
      fetched++;
    } catch (err) {
      errors++;
      console.error(`[tabroom] refreshAll error for ${upcoming[i].tournId}:`, err.message);
    }
  }
  console.log(`[tabroom] refreshAll done: ${fetched} fetched, ${errors} errors`);
  return { fetched, errors };
}

module.exports = { fetchTournament, parseEntries, findUpcoming, refreshAll };
