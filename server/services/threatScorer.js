'use strict';

const BID_LEVEL_WEIGHT = {
  Triples: 1.0, Doubles: 0.9, Octas: 0.75, Quarters: 0.6, Semis: 0.45, Finals: 0.3,
};

function placementScore(placements) {
  if (!Array.isArray(placements) || !placements.length) return 0;
  const top3 = [...placements]
    .sort((a, b) => (a.place || 99) - (b.place || 99))
    .slice(0, 3);
  let total = 0;
  for (const p of top3) {
    const lvlMult = BID_LEVEL_WEIGHT[p.bidLevel] || 0.2;
    const placeBonus = Math.max(0, 17 - (p.place || 16));
    total += placeBonus * lvlMult;
  }
  return total;
}

function normalizeMinMax(values) {
  if (!values.length) return () => 0;
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return () => 1;
  return v => (v - min) / (max - min);
}

function scoreEntries(entries, _season, cap = 30) {
  if (!entries || !entries.length) return [];
  const bids = entries.map(e => e.seasonBids || 0);
  const placements = entries.map(e => placementScore(e.recentPlacements));
  const normBids = normalizeMinMax(bids);
  const normPlace = normalizeMinMax(placements);
  return entries
    .map((e, i) => ({
      ...e,
      _placementScore: placements[i],
      score: 0.6 * normBids(bids[i]) + 0.4 * normPlace(placements[i]),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, cap);
}

module.exports = { scoreEntries, placementScore };
