'use strict';

const crawler = require('./wikiCrawler');
const db      = require('./wikiDb');

let _indexing = false;

// Debounce FTS rebuild across rapid successive team crawls.
// Individual rebuilds scan all wiki_arguments; consecutive crawls in <5s coalesce into one rebuild.
let _ftsRebuildTimer = null;
function _scheduleArgumentsFtsRebuild() {
  clearTimeout(_ftsRebuildTimer);
  _ftsRebuildTimer = setTimeout(() => {
    try { db.rebuildArgumentsFts(); }
    catch (err) { console.error('[wiki] FTS rebuild error:', err.message); }
    _ftsRebuildTimer = null;
  }, 5000);
}

async function seedTeamIndex() {
  if (_indexing) return { skipped: true };
  _indexing = true;
  let inserted = 0;
  try {
    const caselists = await crawler.fetchCaselists();
    for (const cl of caselists) {
      if (cl.archived) continue;
      const schools = await crawler.fetchSchools(cl.name);
      for (const school of schools) {
        if (school.archived) continue;
        const teams = await crawler.fetchTeams(cl.name, school.name);
        for (const team of teams) {
          db.upsertTeam({
            school:   school.display_name || school.name,
            code:     team.display_name || team.name,
            fullName: `${school.display_name || school.name} ${team.display_name || team.name}`,
            event:    cl.event,
            pageUrl:  `https://opencaselist.com/${cl.name}/${encodeURIComponent(school.name)}/${encodeURIComponent(team.name)}`,
          });
          inserted++;
        }
      }
    }
    db.rebuildTeamsFts();
  } finally {
    _indexing = false;
  }
  return { inserted };
}

async function crawlTeamDetail(teamId) {
  const team = db.getTeam(teamId);
  if (!team) throw new Error(`Team not found: ${teamId}`);

  db.setTeamCrawlStatus(teamId, 'crawling');

  try {
    const parts = new URL(team.pageUrl).pathname.split('/').filter(Boolean);
    const [caselist, school, code] = parts.map(decodeURIComponent);

    const [rounds, cites] = await Promise.all([
      crawler.fetchRounds(caselist, school, code),
      crawler.fetchCites(caselist, school, code),
    ]);

    // Index cites by round_id for quick lookup
    const citesByRound = new Map();
    for (const cite of (cites || [])) {
      if (!citesByRound.has(cite.round_id)) citesByRound.set(cite.round_id, []);
      citesByRound.get(cite.round_id).push(cite);
    }

    db.clearRoundReports(teamId);

    // Build arg groups from rounds (authoritative) + match cites when available
    const sorted = [...(rounds || [])].sort((a, b) => {
      const tA = a.created_at ? Date.parse(a.created_at) : a.round_id || 0;
      const tB = b.created_at ? Date.parse(b.created_at) : b.round_id || 0;
      return tA - tB;
    });

    const groups = new Map();
    for (const round of sorted) {
      const matchedCites = citesByRound.get(round.round_id) || [];
      const baseSide = round.side === 'A' ? 'aff' : round.side === 'N' ? 'neg' : null;

      if (matchedCites.length) {
        for (const cite of matchedCites) {
          const name = _stripTournamentPrefix(cite.title || `${round.tournament} ${round.round}`);
          const side = _inferSide(cite.title || '', round.side) || baseSide;
          const key = `${side}::${name.toLowerCase()}`;
          let g = groups.get(key);
          if (!g) {
            g = { name, side, fullText: cite.cites || '', reads: [] };
            groups.set(key, g);
          } else if (!g.fullText && cite.cites) {
            g.fullText = cite.cites;
          }
          g.reads.push({ round });
        }
      } else {
        // No cite — still record the round so UI shows the arg/download
        const name = `${round.tournament || 'Round'} ${round.round || ''}`.trim();
        const side = baseSide;
        const key = `${side}::${name.toLowerCase()}`;
        let g = groups.get(key);
        if (!g) {
          const docxLink = round.opensource ? `https://opencaselist.com/openev/${round.opensource}.docx` : null;
          const body = round.report
            ? round.report
            : docxLink
              ? `Open-source docx: ${docxLink}`
              : '';
          g = { name, side, fullText: body, reads: [] };
          groups.set(key, g);
        }
        g.reads.push({ round });
      }
    }

    for (const g of groups.values()) {
      const argId = db.upsertArgument({
        teamId,
        name:      g.name,
        side:      g.side,
        readCount: g.reads.length,
        fullText:  g.fullText,
      });
      for (const { round } of g.reads) {
        if (!round) continue;
        db.insertRoundReport({
          teamId,
          argumentId: argId,
          tournament: round.tournament,
          round:      round.round,
          opponent:   round.opponent,
          side:       round.side === 'A' ? 'aff' : (round.side === 'N' ? 'neg' : null),
        });
      }
    }

    _scheduleArgumentsFtsRebuild();
    db.setTeamCrawled(teamId);
  } catch (err) {
    db.setTeamCrawlStatus(teamId, 'error');
    throw err;
  }
}

// Side inference: prefer explicit title markers; fall back to round.side ('A'/'N').
function _inferSide(title, roundSide) {
  const t = (title || '').toLowerCase();
  if (/(^|[^a-z])(aff|1ac|2ac)([^a-z]|$)/.test(t)) return 'aff';
  if (/(^|[^a-z])(neg|1nc|2nr|nc|cp|da|k|t|pik|th|phil)([^a-z]|$)/.test(t)) return 'neg';
  if (roundSide === 'A') return 'aff';
  if (roundSide === 'N') return 'neg';
  return 'aff';
}

// Strip opencaselist tournament prefix (e.g. "JF---", "MA---", "SO---").
function _stripTournamentPrefix(title) {
  return String(title || '').replace(/^[A-Z0-9]{1,4}---/, '').trim();
}

module.exports = { seedTeamIndex, crawlTeamDetail };
