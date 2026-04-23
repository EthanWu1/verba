'use strict';

// FNV-1a 32-bit hex hash
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16);
}

// Season derivation: Jul+ = current-next; else prev-current
function seasonFor(isoDate) {
  const d = new Date(isoDate);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  if (m >= 7) return `${y}-${String(y + 1).slice(-2)}`;
  return `${y - 1}-${String(y).slice(-2)}`;
}

function teamKeyFor(entry, school) {
  // Student IDs are globally unique in tabroom. Key on them (not schoolId) so the
  // same team merges across tournaments even when tabroom assigns different
  // schoolIds to the same school at different sites.
  const students = Array.isArray(entry.students) ? [...entry.students].map(String).filter(Boolean).sort() : [];
  if (students.length) return 's:' + students.join(',');
  // Fallback when no student ids: hash school name + entry code for a stable key.
  const sHash = 'h:' + fnv1a(String(school?.name || '').toLowerCase());
  const eHash = 'c:' + fnv1a(String(entry.code || entry.name || ''));
  return `${sHash}:${eHash}`;
}

const BID_MAP = { 128: 'Triples', 64: 'Triples', 32: 'Doubles', 16: 'Octos', 8: 'Quarters', 4: 'Semis', 2: 'Finals' };
const BID_RANK = { Triples: 0, Doubles: 1, Octos: 2, Quarters: 3, Semis: 4, Finals: 5 };

function inferBidLevel(event) {
  const bidSets = (event.result_sets || []).filter(r => /bid/i.test(r.label || ''));
  if (!bidSets.length) return { bidLevel: null, fullBids: 0, partialBids: 0 };
  let full = 0, partial = 0;
  let bestLevel = null;
  for (const rs of bidSets) {
    let rsFull = 0, rsPartial = 0;
    for (const result of (rs.results || [])) {
      const vals = result.values || [];
      const label = vals.map(v => String(v.value || '').trim()).find(Boolean);
      if (!label) continue;
      if (label === 'Full') rsFull++;
      else rsPartial++; // Silver Bid / Ghost Bid / Partial all count as secondary
    }
    full += rsFull;
    partial += rsPartial;
    const lvl = BID_MAP[rsFull];
    if (lvl && (!bestLevel || BID_RANK[lvl] > BID_RANK[bestLevel])) bestLevel = lvl;
  }
  return { bidLevel: bestLevel, fullBids: full, partialBids: partial };
}

function _side(side) {
  if (side === 1 || side === '1') return 'aff';
  if (side === 2 || side === '2') return 'neg';
  return null;
}

function _result(scores) {
  const wl = (scores || []).find(s => s.tag === 'winloss');
  if (!wl) return null;
  return Number(wl.value) === 1 ? 'W' : (Number(wl.value) === 0 ? 'L' : null);
}

function _points(scores) {
  const p = (scores || []).find(s => s.tag === 'point');
  if (!p) return null;
  const n = Number(p.value);
  return Number.isFinite(n) ? n : null;
}

function parseBallots(event) {
  const rows = [];
  for (const round of (event.rounds || [])) {
    const roundId = Number(round.id);
    const roundName = String(round.name ?? '');
    const roundType = round.type || null;
    for (const section of (round.sections || [])) {
      const ballots = section.ballots || [];
      for (const b of ballots) {
        const opp = ballots.find(o => o.entry !== b.entry);
        const judge = [b.judge_first, b.judge_last].filter(Boolean).join(' ').trim() || null;
        rows.push({
          id:               Number(b.id),
          roundId,
          roundName,
          roundType,
          entryId:          Number(b.entry),
          opponentEntryId:  opp ? Number(opp.entry) : null,
          side:             _side(b.side),
          judgeName:        judge,
          result:           _result(b.scores),
          speakerPoints:    _points(b.scores),
        });
      }
    }
  }
  return rows;
}

function parseResults(event) {
  const out = new Map();
  const fp = (event.result_sets || []).find(r => /final places/i.test(r.label || ''));
  if (fp) {
    for (const r of (fp.results || [])) {
      if (!r.entry) continue;
      const k = Number(r.entry);
      const row = out.get(k) || {};
      row.place = r.place || null;
      row.rank = Number.isFinite(Number(r.rank)) ? Number(r.rank) : null;
      out.set(k, row);
    }
  }
  const sa = (event.result_sets || []).find(r => /speaker awards/i.test(r.label || ''));
  if (sa) {
    const keys = sa.result_keys || [];
    const ptsIdx = keys.findIndex(k => (k.tag || '').toUpperCase() === 'PTS');
    const results = sa.results || [];
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (!r.entry) continue;
      const k = Number(r.entry);
      const row = out.get(k) || {};
      row.speakerRank = i + 1;
      if (ptsIdx >= 0) {
        const v = (r.values || [])[ptsIdx]?.value;
        const n = Number(v);
        row.speakerPoints = Number.isFinite(n) ? n : null;
      }
      out.set(k, row);
    }
  }
  return [...out.entries()].map(([entryId, row]) => ({ entryId, ...row }));
}

const BID_TIER_RANK = { 'Full': 3, 'Silver Bid': 2, 'Ghost Bid': 1, 'Partial': 0 };
function _tierOf(label) {
  return BID_TIER_RANK[label] != null ? BID_TIER_RANK[label] : -1;
}

function parseEarnedBids(event) {
  const map = new Map();
  const bidSets = (event.result_sets || []).filter(r => /bid/i.test(r.label || ''));
  for (const bids of bidSets) {
    for (const r of (bids.results || [])) {
      if (!r.entry) continue;
      const entryId = Number(r.entry);
      const vals = r.values || [];
      // Pick first non-empty cell. Tabroom stores the bid tier as a string
      // like "Full", "Silver Bid", "Ghost Bid", "Partial".
      const label = vals.map(v => String(v.value || '').trim()).find(Boolean);
      if (!label) continue;
      const prev = map.get(entryId);
      if (!prev || _tierOf(label) > _tierOf(prev)) map.set(entryId, label);
    }
  }
  return map;
}

module.exports = {
  fnv1a, seasonFor, teamKeyFor, inferBidLevel, parseBallots, parseResults, parseEarnedBids,
};
