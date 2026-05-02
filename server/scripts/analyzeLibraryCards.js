#!/usr/bin/env node
/**
 * analyzeLibraryCards.js
 *
 * Reads saved cards from the SQLite library and computes empirical
 * stats on highlight / underline / bold patterns. Output is a JSON
 * summary plus a human-readable report — useful for confirming or
 * refining the cardCutter.js prompt rules.
 *
 * Usage:
 *   node server/scripts/analyzeLibraryCards.js [--limit=200] [--user=<id>] [--json]
 *
 * Defaults to the 100 most-recent cards. --json emits raw stats instead
 * of the prose report.
 */

'use strict';

const path = require('path');
const { getDb } = require('../services/db');

const args = process.argv.slice(2);
const flag = (k, fallback) => {
  const m = args.find(a => a.startsWith(`--${k}=`));
  return m ? m.slice(k.length + 3) : fallback;
};
const has = k => args.includes(`--${k}`);

const LIMIT = Number(flag('limit', '100'));
const USER  = flag('user', null);
const AS_JSON = has('json');

function findBodyColumn(db) {
  // Different schema versions name the body column differently. Probe.
  const cols = db.prepare(`PRAGMA table_info(user_saved_cards)`).all();
  if (!cols.length) return null;
  const names = new Set(cols.map(c => c.name));
  for (const cand of ['body_markdown', 'bodyMarkdown', 'body', 'body_md']) {
    if (names.has(cand)) return cand;
  }
  return null;
}

function pickCards(db, bodyCol) {
  const where = USER ? 'WHERE userId = ?' : '';
  const params = USER ? [USER] : [];
  const sql = `
    SELECT id, ${bodyCol} AS body
    FROM user_saved_cards
    ${where}
    ORDER BY rowid DESC
    LIMIT ?
  `;
  return db.prepare(sql).all(...params, LIMIT);
}

function stripFormatMarks(s) {
  return String(s || '')
    .replace(/\*\*<u>([\s\S]*?)<\/u>\*\*/g, '$1')
    .replace(/<u>([\s\S]*?)<\/u>/g, '$1')
    .replace(/\*\*([\s\S]*?)\*\*/g, '$1')
    .replace(/==([\s\S]*?)==/g, '$1')
    .replace(/¶/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── QUALITATIVE CLASSIFIERS ───────────────────────────────────────────
// We classify each highlighted phrase by what KIND of debate move it makes.

const VERB_LIST = new Set([
  // causal
  'cause', 'causes', 'caused', 'causing',
  'lead', 'leads', 'led', 'leading',
  'trigger', 'triggers', 'triggered', 'triggering',
  'spark', 'sparks', 'sparked',
  'result', 'results', 'resulted',
  'drive', 'drives', 'drove', 'driven', 'driving',
  'collapse', 'collapses', 'collapsing',
  'undermine', 'undermines', 'undermined',
  'erode', 'erodes', 'eroded',
  'destroy', 'destroys', 'destroyed',
  'guarantee', 'guarantees', 'guaranteed',
  'ensure', 'ensures', 'ensured',
  'prevent', 'prevents', 'prevented',
  'block', 'blocks', 'blocked',
  // accelerating
  'accelerate', 'accelerates', 'accelerated',
  'amplify', 'amplifies', 'amplified',
  'escalate', 'escalates', 'escalated',
  // ending / final
  'end', 'ends', 'ended',
  'eliminate', 'eliminates', 'eliminated',
  'extinct', 'extinction',
  'exhaust', 'exhausts', 'exhausted',
  // making/doing
  'make', 'makes', 'made',
  'force', 'forces', 'forced', 'forcing',
  'compel', 'compels', 'compelled',
  'require', 'requires', 'required',
  // increase/decrease
  'increase', 'increases', 'increased', 'increasing',
  'decrease', 'decreases', 'decreased',
  'reduce', 'reduces', 'reduced', 'reducing',
  'cut', 'cuts',
  'rise', 'rises', 'rose', 'risen', 'rising',
  'fall', 'falls', 'fell', 'fallen',
  'grow', 'grows', 'grew', 'growing',
  'shrink', 'shrinks', 'shrank', 'shrinking',
  // stating
  'concludes', 'concluded', 'argues', 'argued',
  'shows', 'showed', 'demonstrates', 'demonstrated',
  'finds', 'found', 'reveals', 'revealed',
  'warns', 'warned', 'predicts', 'predicted',
  // be
  'is', 'are', 'was', 'were', 'becomes', 'became',
  'remains', 'remained', 'stays', 'stayed',
  'will',
]);

const NUMBER_RE = /\b(?:\d+(?:[.,]\d+)?(?:%)?|\$\d+|by\s+\d{4}|in\s+\d{4}|\d+\s*(?:billion|million|trillion|thousand|years?|decades?))\b/i;
const ENTITY_RE = /\b(?:U\.?S\.?|UN|EU|NATO|China|Russia|India|Japan|Korea|Iran|Israel|Putin|Biden|Trump|Xi|IPCC|WTO|IMF|FDA)\b/;
const TIMEFRAME_RE = /\b(?:by\s+\d{4}|in\s+\d{4}|within\s+\d+\s*(?:year|month|decade)s?|next\s+(?:year|month|decade))\b/i;

function classifyHighlight(phrase) {
  const lower = String(phrase || '').toLowerCase();
  const words = lower.split(/\s+/).filter(Boolean);
  const tokens = words.map(w => w.replace(/[.,;:!?'"()\[\]]/g, ''));
  const hasVerb = tokens.some(t => VERB_LIST.has(t));
  const hasNumber = NUMBER_RE.test(phrase);
  const hasEntity = ENTITY_RE.test(phrase);
  const hasTimeframe = TIMEFRAME_RE.test(phrase);
  // capitalized non-stopword words OUTSIDE the entity list (proper nouns)
  const capWords = phrase.split(/\s+/).filter(w => /^[A-Z][a-z]/.test(w)).length;
  return {
    words: words.length,
    hasVerb,
    hasNumber,
    hasEntity,
    hasTimeframe,
    capWords,
    // Operative-class taxonomy: which beat does this highlight carry?
    kind: hasNumber || hasTimeframe ? 'magnitude_or_timeframe'
        : hasVerb ? 'causal_action'
        : hasEntity || capWords >= 2 ? 'actor_or_entity'
        : 'concept_or_noun',
  };
}

// Rough position in containing paragraph: where (0–1) does the highlight sit?
function positionInParagraph(highlight, paraText) {
  const idx = paraText.toLowerCase().indexOf(highlight.toLowerCase());
  if (idx === -1) return null;
  const plain = stripFormatMarks(paraText);
  if (!plain.length) return null;
  const plainIdx = stripFormatMarks(paraText.slice(0, idx)).length;
  return Math.min(1, Math.max(0, plainIdx / Math.max(1, plain.length)));
}

// Build a frequency map of n-gram phrases (for "what gets highlighted most often")
function topNgrams(allHighlights, n = 2, top = 25) {
  const counts = new Map();
  for (const h of allHighlights) {
    const tokens = String(h).toLowerCase().replace(/[^\w\s'-]/g, '').split(/\s+/).filter(Boolean);
    for (let i = 0; i + n <= tokens.length; i++) {
      const gram = tokens.slice(i, i + n).join(' ');
      counts.set(gram, (counts.get(gram) || 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, top);
}

function analyzeCard(body) {
  const text = String(body || '');
  if (!text) return null;

  const paras = text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  const allHighlights = [];
  const paraStats = paras.map((para, paraIdx) => {
    const highlights = [...para.matchAll(/==([^=\n]+?)==/g)].map(m => m[1].trim());
    const bolds = [...para.matchAll(/\*\*<u>[\s\S]*?<\/u>\*\*|\*\*([\s\S]*?)\*\*/g)]
      .map(m => (m[1] || '').replace(/<\/?u>/g, '').trim())
      .filter(Boolean);
    const underlines = [...para.matchAll(/<u>([\s\S]*?)<\/u>/g)].map(m => m[1].trim());
    const plain = stripFormatMarks(para);
    const totalWords = plain.split(/\s+/).filter(Boolean).length;
    const highlightWords = highlights.reduce((sum, h) => sum + h.split(/\s+/).filter(Boolean).length, 0);
    const underlineWords = underlines.reduce((sum, u) => sum + stripFormatMarks(u).split(/\s+/).filter(Boolean).length, 0);

    // Per-highlight classification
    const classified = highlights.map(h => ({
      text: h,
      ...classifyHighlight(h),
      position: positionInParagraph(h, para),
      paraIdx,
    }));

    // Where is the bold? Inside a highlight or just inside an underline?
    let boldsInsideHighlights = 0;
    for (const b of bolds) {
      const bl = b.toLowerCase();
      if (highlights.some(h => h.toLowerCase().includes(bl))) boldsInsideHighlights++;
    }

    allHighlights.push(...classified);

    return {
      totalWords,
      highlightCount: highlights.length,
      highlightWordLengths: highlights.map(h => h.split(/\s+/).filter(Boolean).length),
      bolds: bolds.length,
      boldsInsideHighlights,
      underlines: underlines.length,
      underlineWords,
      highlightWords,
      underlineRatio: totalWords ? underlineWords / totalWords : 0,
      highlightRatio: totalWords ? highlightWords / totalWords : 0,
      classified,
    };
  });

  // Where (relative paragraph index) does the loudest **<u>…</u>** sit?
  let loudestParaPosition = null;
  for (let i = 0; i < paras.length; i++) {
    if (/\*\*<u>[\s\S]*?<\/u>\*\*/.test(paras[i])) {
      loudestParaPosition = paras.length > 1 ? i / (paras.length - 1) : 0;
      break;
    }
  }

  // Chain coherence: do consecutive paragraphs share content tokens between
  // their highlighted spans? Score 0-1 = avg jaccard overlap of highlight
  // token sets between adjacent paragraphs (small overlap = good in debate;
  // huge overlap = repetitive; zero = unrelated).
  let chainScore = null;
  if (paraStats.length > 1) {
    const overlaps = [];
    for (let i = 0; i + 1 < paraStats.length; i++) {
      const a = new Set((paraStats[i].classified || []).flatMap(c =>
        c.text.toLowerCase().split(/\s+/).filter(w => w.length > 3)));
      const b = new Set((paraStats[i + 1].classified || []).flatMap(c =>
        c.text.toLowerCase().split(/\s+/).filter(w => w.length > 3)));
      if (!a.size || !b.size) { overlaps.push(0); continue; }
      const inter = [...a].filter(t => b.has(t)).length;
      const uni = new Set([...a, ...b]).size;
      overlaps.push(uni ? inter / uni : 0);
    }
    chainScore = overlaps.reduce((s, x) => s + x, 0) / overlaps.length;
  }

  return {
    paragraphCount: paras.length,
    paraStats,
    allHighlights,
    boldUnderlineCount: (text.match(/\*\*<u>[\s\S]*?<\/u>\*\*/g) || []).length,
    loudestParaPosition,
    chainScore,
  };
}

function summarize(allStats) {
  const cards = allStats.filter(Boolean);
  if (!cards.length) return { count: 0, error: 'no cards parsed' };

  const sum = (arr) => arr.reduce((a, b) => a + b, 0);
  const avg = (arr) => arr.length ? sum(arr) / arr.length : 0;
  const median = (arr) => {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  const pctile = (arr, p) => {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(s.length * p))];
  };

  const allParas = cards.flatMap(c => c.paraStats);
  const allHlLens = allParas.flatMap(p => p.highlightWordLengths);
  const allClassified = cards.flatMap(c => c.allHighlights || []);
  const allHighlightTexts = allClassified.map(h => h.text).filter(Boolean);

  // Position-in-paragraph bins (start 0–0.33, mid 0.33–0.66, end 0.66–1.0)
  const positions = allClassified.map(h => h.position).filter(p => p != null);
  const posBins = { start: 0, mid: 0, end: 0 };
  for (const p of positions) {
    if (p < 0.33) posBins.start++;
    else if (p < 0.66) posBins.mid++;
    else posBins.end++;
  }
  const posTotal = positions.length || 1;

  // Operative-class taxonomy
  const kindCounts = {};
  for (const h of allClassified) {
    kindCounts[h.kind] = (kindCounts[h.kind] || 0) + 1;
  }
  const kindTotal = allClassified.length || 1;
  const kindPct = Object.fromEntries(
    Object.entries(kindCounts).map(([k, v]) => [k, +(v / kindTotal * 100).toFixed(1)])
  );

  // Verb / number / entity / timeframe presence rates
  const linguistic = {
    hasVerbPct:      +(allClassified.filter(h => h.hasVerb).length      / kindTotal * 100).toFixed(1),
    hasNumberPct:    +(allClassified.filter(h => h.hasNumber).length    / kindTotal * 100).toFixed(1),
    hasEntityPct:    +(allClassified.filter(h => h.hasEntity).length    / kindTotal * 100).toFixed(1),
    hasTimeframePct: +(allClassified.filter(h => h.hasTimeframe).length / kindTotal * 100).toFixed(1),
  };

  // Bold-inside-highlight ratio (best practice: most bolds wrap a highlighted word)
  const totalBolds = allParas.reduce((s, p) => s + p.bolds, 0);
  const boldsInHl = allParas.reduce((s, p) => s + (p.boldsInsideHighlights || 0), 0);
  const boldsInHlPct = totalBolds ? +(boldsInHl / totalBolds * 100).toFixed(1) : 0;

  // Loudest-paragraph position: where in the card does the bold-underline sit?
  const loudestPositions = cards.map(c => c.loudestParaPosition).filter(p => p != null);
  const loudestPosAvg = loudestPositions.length ? +(avg(loudestPositions)).toFixed(2) : null;

  // Chain coherence
  const chainScores = cards.map(c => c.chainScore).filter(s => s != null);
  const chainAvg = chainScores.length ? +avg(chainScores).toFixed(3) : null;

  // Most common 2-gram and 3-gram highlights
  const top2 = topNgrams(allHighlightTexts, 2, 20);
  const top3 = topNgrams(allHighlightTexts, 3, 15);

  return {
    cards: cards.length,
    paragraphs: {
      perCard: {
        avg: +avg(cards.map(c => c.paragraphCount)).toFixed(1),
        median: median(cards.map(c => c.paragraphCount)),
        p25: pctile(cards.map(c => c.paragraphCount), 0.25),
        p75: pctile(cards.map(c => c.paragraphCount), 0.75),
      },
    },
    highlights: {
      perParagraph: {
        avg:    +avg(allParas.map(p => p.highlightCount)).toFixed(2),
        median: median(allParas.map(p => p.highlightCount)),
      },
      wordLength: {
        avg:    +avg(allHlLens).toFixed(2),
        median: median(allHlLens),
        p75:    pctile(allHlLens, 0.75),
        p90:    pctile(allHlLens, 0.90),
        max:    Math.max(0, ...allHlLens),
      },
      lengthHistogram: bucket(allHlLens, [1, 2, 3, 4, 5, 6, 7, 8, 10, 15, 20, 30]),
      // QUALITATIVE
      positionInParagraph: {
        startPct: +(posBins.start / posTotal * 100).toFixed(1),
        midPct:   +(posBins.mid   / posTotal * 100).toFixed(1),
        endPct:   +(posBins.end   / posTotal * 100).toFixed(1),
      },
      operativeKindPct: kindPct,
      linguistic,
      topBigrams:  top2,
      topTrigrams: top3,
    },
    bolds: {
      perParagraph: {
        avg: +avg(allParas.map(p => p.bolds)).toFixed(2),
        median: median(allParas.map(p => p.bolds)),
      },
      boldUnderlinesPerCard: {
        avg: +avg(cards.map(c => c.boldUnderlineCount)).toFixed(2),
      },
      boldsInsideHighlightsPct: boldsInHlPct,
      loudestParagraphAvgPosition: loudestPosAvg,   // 0=first para, 1=last
    },
    densityRatios: {
      underlineFraction: {
        avg: +avg(allParas.map(p => p.underlineRatio)).toFixed(3),
        median: +median(allParas.map(p => p.underlineRatio)).toFixed(3),
      },
      highlightFraction: {
        avg: +avg(allParas.map(p => p.highlightRatio)).toFixed(3),
        median: +median(allParas.map(p => p.highlightRatio)).toFixed(3),
      },
    },
    chainCoherence: {
      // Higher = adjacent paragraphs' highlights share content tokens.
      // Real debate cards usually 0.05–0.20 (some shared subject/topic but
      // each paragraph advances a new beat).
      avgAdjacentHighlightOverlap: chainAvg,
    },
  };
}

function bucket(values, edges) {
  const counts = new Array(edges.length).fill(0);
  for (const v of values) {
    for (let i = 0; i < edges.length; i++) {
      if (v <= edges[i]) { counts[i]++; break; }
    }
  }
  const out = {};
  for (let i = 0; i < edges.length; i++) {
    const lo = i === 0 ? 1 : edges[i - 1] + 1;
    const hi = edges[i];
    out[`${lo}-${hi}w`] = counts[i];
  }
  return out;
}

function prettyReport(s) {
  if (!s.cards) return `No cards found.`;
  const lines = [];
  lines.push(`=== Library card analysis (n=${s.cards}) ===`);
  lines.push(``);
  lines.push(`── STRUCTURE ──`);
  lines.push(`Paragraphs per card: avg ${s.paragraphs.perCard.avg}, median ${s.paragraphs.perCard.median} (P25 ${s.paragraphs.perCard.p25}, P75 ${s.paragraphs.perCard.p75})`);
  lines.push(``);
  lines.push(`── HIGHLIGHT VOLUME ──`);
  lines.push(`Highlights per paragraph: avg ${s.highlights.perParagraph.avg}, median ${s.highlights.perParagraph.median}`);
  lines.push(`Highlight word-length:    avg ${s.highlights.wordLength.avg}, median ${s.highlights.wordLength.median}, P75 ${s.highlights.wordLength.p75}, P90 ${s.highlights.wordLength.p90}, max ${s.highlights.wordLength.max}`);
  lines.push(`Length histogram (word counts):`);
  for (const [k, v] of Object.entries(s.highlights.lengthHistogram)) {
    lines.push(`  ${k.padEnd(8)} ${v}`);
  }
  lines.push(``);
  lines.push(`── HIGHLIGHT POSITION (where in the paragraph) ──`);
  const pp = s.highlights.positionInParagraph;
  lines.push(`Start of paragraph (0–33%): ${pp.startPct}%`);
  lines.push(`Middle (33–66%):            ${pp.midPct}%`);
  lines.push(`End (66–100%):              ${pp.endPct}%`);
  if (pp.endPct > pp.startPct + 15) lines.push(`  → highlights cluster toward paragraph END (impact-heavy reads)`);
  else if (pp.startPct > pp.endPct + 15) lines.push(`  → highlights cluster toward paragraph START (claim-led reads)`);
  else lines.push(`  → highlights distributed evenly (balanced reads)`);
  lines.push(``);
  lines.push(`── HIGHLIGHT KIND (what's being marked) ──`);
  for (const [kind, pct] of Object.entries(s.highlights.operativeKindPct).sort((a, b) => b[1] - a[1])) {
    lines.push(`  ${kind.padEnd(28)} ${pct}%`);
  }
  lines.push(``);
  lines.push(`── LINGUISTIC FEATURES (% of highlights containing) ──`);
  const ling = s.highlights.linguistic;
  lines.push(`  finite verb (causes/leads/...): ${ling.hasVerbPct}%`);
  lines.push(`  number / percent / year:        ${ling.hasNumberPct}%`);
  lines.push(`  named entity (US/EU/Putin/...): ${ling.hasEntityPct}%`);
  lines.push(`  timeframe (by 2040/...):        ${ling.hasTimeframePct}%`);
  lines.push(``);
  lines.push(`── BOLD/UNDERLINE PATTERN ──`);
  lines.push(`Bolds per paragraph:                 avg ${s.bolds.perParagraph.avg}, median ${s.bolds.perParagraph.median}`);
  lines.push(`Bolds INSIDE a highlight:            ${s.bolds.boldsInsideHighlightsPct}% of all bolds`);
  lines.push(`Bold-underlines per card:            avg ${s.bolds.boldUnderlinesPerCard.avg}`);
  if (s.bolds.loudestParagraphAvgPosition !== null) {
    const lpp = s.bolds.loudestParagraphAvgPosition;
    const where = lpp < 0.33 ? 'first third' : lpp < 0.66 ? 'middle third' : 'last third';
    lines.push(`Loudest **<u>...</u>** typically sits in: ${where} of the card (avg position ${lpp})`);
  }
  lines.push(``);
  lines.push(`── DENSITY ──`);
  lines.push(`Underline fraction:  avg ${s.densityRatios.underlineFraction.avg}, median ${s.densityRatios.underlineFraction.median}`);
  lines.push(`Highlight fraction:  avg ${s.densityRatios.highlightFraction.avg}, median ${s.densityRatios.highlightFraction.median}`);
  lines.push(``);
  lines.push(`── CHAIN COHERENCE ──`);
  if (s.chainCoherence.avgAdjacentHighlightOverlap !== null) {
    const cs = s.chainCoherence.avgAdjacentHighlightOverlap;
    lines.push(`Adjacent-paragraph highlight token overlap: ${cs} (Jaccard)`);
    if (cs < 0.05) lines.push(`  → low — paragraphs are content-independent (each carries its own beat)`);
    else if (cs < 0.20) lines.push(`  → moderate — shared subject/topic across paragraphs (typical for debate cards)`);
    else lines.push(`  → high — paragraphs repeat themselves (consider cutting redundancy)`);
  } else {
    lines.push(`Adjacent overlap: n/a (single-paragraph cards only)`);
  }
  lines.push(``);
  lines.push(`── TOP HIGHLIGHTED PHRASES ──`);
  lines.push(`Most-frequent 2-grams:`);
  for (const [g, c] of s.highlights.topBigrams.slice(0, 10)) {
    lines.push(`  ${String(c).padStart(4)} × "${g}"`);
  }
  lines.push(`Most-frequent 3-grams:`);
  for (const [g, c] of s.highlights.topTrigrams.slice(0, 8)) {
    lines.push(`  ${String(c).padStart(4)} × "${g}"`);
  }
  lines.push(``);
  lines.push(`── SUGGESTED PROMPT TARGETS ──`);
  const hl = s.highlights;
  const dr = s.densityRatios;
  lines.push(`  highlights/paragraph: ${hl.perParagraph.median}–${hl.perParagraph.median + 2}`);
  lines.push(`  highlight word length: ${Math.max(2, hl.wordLength.median - 1)}–${hl.wordLength.p75} words (P90 ${hl.wordLength.p90})`);
  lines.push(`  underline fraction:    ${(dr.underlineFraction.median * 100).toFixed(0)}–${Math.min(95, (dr.underlineFraction.median * 100 + 15)).toFixed(0)}%`);
  lines.push(`  highlight fraction:    ${(dr.highlightFraction.median * 100).toFixed(0)}–${Math.min(40, (dr.highlightFraction.median * 100 + 10)).toFixed(0)}%`);
  lines.push(`  highlights with verbs: ${ling.hasVerbPct}% (target: copy this rate)`);
  lines.push(`  bold inside highlight: ${s.bolds.boldsInsideHighlightsPct}% (target: copy this rate)`);
  return lines.join('\n');
}

(function main() {
  const db = getDb();
  const bodyCol = findBodyColumn(db);
  if (!bodyCol) {
    console.error('No user_saved_cards table or no body column found.');
    process.exit(1);
  }
  const rows = pickCards(db, bodyCol);
  const stats = rows.map(r => analyzeCard(r.body));
  const summary = summarize(stats);
  if (AS_JSON) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(prettyReport(summary));
  }
})();
