'use strict';

const crawler = require('./wikiCrawler');
const db      = require('./wikiDb');

let _indexing = false;

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

    const roundById = new Map();
    (rounds || []).forEach(r => roundById.set(r.round_id, r));

    db.clearRoundReports(teamId);

    const sortedCites = [...(cites || [])].sort((a, b) => {
      const rA = roundById.get(a.round_id);
      const rB = roundById.get(b.round_id);
      const tA = rA?.created_at ? Date.parse(rA.created_at) : a.round_id || 0;
      const tB = rB?.created_at ? Date.parse(rB.created_at) : b.round_id || 0;
      return tA - tB;
    });

    const groups = new Map();
    for (const cite of sortedCites) {
      const name = _stripTournamentPrefix(cite.title || 'Untitled');
      const round = roundById.get(cite.round_id);
      const side = _inferSide(cite.title || '', round?.side);
      const key = `${side}::${name}`;

      let g = groups.get(key);
      if (!g) {
        g = { name, side, fullText: cite.cites || '', reads: [] };
        groups.set(key, g);
      } else {
        g.fullText = cite.cites || g.fullText;
      }
      g.reads.push({ round, originalTitle: cite.title });
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

    db.rebuildArgumentsFts();
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
