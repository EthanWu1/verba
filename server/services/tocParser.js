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
  const sid = school?.id != null ? String(school.id) : ('h:' + fnv1a(String(school?.name || '').toLowerCase()));
  const students = Array.isArray(entry.students) ? [...entry.students].map(String).sort() : [];
  return `${sid}:${students.join(',')}`;
}

const BID_MAP = { 64: 'Triples', 32: 'Doubles', 16: 'Octas', 8: 'Quarters', 4: 'Semis', 2: 'Finals' };

function inferBidLevel(event) {
  const rs = (event.result_sets || []).find(r => /bid/i.test(r.label || ''));
  if (!rs) return { bidLevel: null, fullBids: 0, partialBids: 0 };
  let full = 0, partial = 0;
  for (const result of (rs.results || [])) {
    const vals = result.values || [];
    if (vals.some(v => v.value === 'Full')) full++;
    else if (vals.some(v => v.value === 'Partial')) partial++;
  }
  return { bidLevel: BID_MAP[full] || null, fullBids: full, partialBids: partial };
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

function parseEarnedBids(event) {
  const bids = (event.result_sets || []).find(r => /bid/i.test(r.label || ''));
  const map = new Map();
  if (!bids) return map;
  for (const r of (bids.results || [])) {
    if (!r.entry) continue;
    const vals = r.values || [];
    if (vals.some(v => v.value === 'Full')) map.set(Number(r.entry), 'Full');
    else if (vals.some(v => v.value === 'Partial')) map.set(Number(r.entry), 'Partial');
  }
  return map;
}

module.exports = {
  fnv1a, seasonFor, teamKeyFor, inferBidLevel, parseBallots, parseResults, parseEarnedBids,
};
