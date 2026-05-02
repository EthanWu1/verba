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

function analyzeCard(body) {
  const text = String(body || '');
  if (!text) return null;

  // Paragraphs (split on blank lines)
  const paras = text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  const paraStats = paras.map(para => {
    const highlights = [...para.matchAll(/==([^=\n]+?)==/g)].map(m => m[1].trim());
    const bolds = [...para.matchAll(/\*\*<u>[\s\S]*?<\/u>\*\*|\*\*([\s\S]*?)\*\*/g)]
      .map(m => (m[1] || '').replace(/<\/?u>/g, '').trim())
      .filter(Boolean);
    const underlines = [...para.matchAll(/<u>([\s\S]*?)<\/u>/g)].map(m => m[1].trim());
    const plain = stripFormatMarks(para);
    const totalWords = plain.split(/\s+/).filter(Boolean).length;
    const highlightWords = highlights.reduce((sum, h) => sum + h.split(/\s+/).filter(Boolean).length, 0);
    const underlineWords = underlines.reduce((sum, u) => sum + stripFormatMarks(u).split(/\s+/).filter(Boolean).length, 0);
    return {
      totalWords,
      highlightCount: highlights.length,
      highlightWordLengths: highlights.map(h => h.split(/\s+/).filter(Boolean).length),
      bolds: bolds.length,
      underlines: underlines.length,
      underlineWords,
      highlightWords,
      underlineRatio: totalWords ? underlineWords / totalWords : 0,
      highlightRatio: totalWords ? highlightWords / totalWords : 0,
    };
  });

  return {
    paragraphCount: paras.length,
    paraStats,
    boldUnderlineCount: (text.match(/\*\*<u>[\s\S]*?<\/u>\*\*/g) || []).length,
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
      // Distribution of highlight word-lengths so we can see the curve.
      lengthHistogram: bucket(allHlLens, [1, 2, 3, 4, 5, 6, 7, 8, 10, 15, 20, 30]),
    },
    bolds: {
      perParagraph: {
        avg: +avg(allParas.map(p => p.bolds)).toFixed(2),
        median: median(allParas.map(p => p.bolds)),
      },
      boldUnderlinesPerCard: {
        avg: +avg(cards.map(c => c.boldUnderlineCount)).toFixed(2),
      },
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
  lines.push(`Paragraphs per card: avg ${s.paragraphs.perCard.avg}, median ${s.paragraphs.perCard.median} (P25 ${s.paragraphs.perCard.p25}, P75 ${s.paragraphs.perCard.p75})`);
  lines.push(``);
  lines.push(`Highlights per paragraph: avg ${s.highlights.perParagraph.avg}, median ${s.highlights.perParagraph.median}`);
  lines.push(`Highlight word-length:    avg ${s.highlights.wordLength.avg}, median ${s.highlights.wordLength.median}, P75 ${s.highlights.wordLength.p75}, P90 ${s.highlights.wordLength.p90}, max ${s.highlights.wordLength.max}`);
  lines.push(`Highlight length histogram (word counts):`);
  for (const [k, v] of Object.entries(s.highlights.lengthHistogram)) {
    lines.push(`  ${k.padEnd(8)} ${v}`);
  }
  lines.push(``);
  lines.push(`Bolds per paragraph:      avg ${s.bolds.perParagraph.avg}, median ${s.bolds.perParagraph.median}`);
  lines.push(`Bold-underlines per card: avg ${s.bolds.boldUnderlinesPerCard.avg}`);
  lines.push(``);
  lines.push(`Underline fraction:  avg ${s.densityRatios.underlineFraction.avg}, median ${s.densityRatios.underlineFraction.median}`);
  lines.push(`Highlight fraction:  avg ${s.densityRatios.highlightFraction.avg}, median ${s.densityRatios.highlightFraction.median}`);
  lines.push(``);
  lines.push(`---`);
  lines.push(`Suggested prompt targets (based on observed medians):`);
  const hl = s.highlights;
  const dr = s.densityRatios;
  lines.push(`  highlights/paragraph: ${hl.perParagraph.median}–${hl.perParagraph.median + 2}`);
  lines.push(`  highlight word length: ${Math.max(2, hl.wordLength.median - 1)}–${hl.wordLength.p75} words (cap suggestion: ${hl.wordLength.p90})`);
  lines.push(`  underline fraction:    ${(dr.underlineFraction.median * 100).toFixed(0)}–${Math.min(95, (dr.underlineFraction.median * 100 + 15)).toFixed(0)}%`);
  lines.push(`  highlight fraction:    ${(dr.highlightFraction.median * 100).toFixed(0)}–${Math.min(40, (dr.highlightFraction.median * 100 + 10)).toFixed(0)}%`);
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
