'use strict';
/**
 * cutterCalibration.js
 *
 * Pulls the analyzer's summary against the user's saved library and
 * caches it. The cardCutter prompt builder reads this and bakes
 * library-specific examples + numbers into the system prompt so the
 * cutter copies the user's voice empirically (not just generic rules).
 *
 * Cache: in-memory, 60-minute TTL. Refreshes lazily.
 */

const { summarizeFromDb } = require('../scripts/analyzeLibraryCards');

let _cache = null;
let _cacheAt = 0;
const TTL_MS = 60 * 60 * 1000;   // 1 hour

// Pull from the WHOLE database (no userId filter). The voice reference is
// shared — patterns from any well-cut card teach the model how to format,
// and a new user with an empty library still gets the benefit. Override
// with userId if you ever want a per-user voice instead.
function getCalibration({ force = false, limit = 200, userId = null } = {}) {
  const now = Date.now();
  if (!force && _cache && now - _cacheAt < TTL_MS) return _cache;
  try {
    const summary = summarizeFromDb({ limit, userId });
    _cache = summary && summary.cards >= 8 ? summary : null;
    _cacheAt = now;
    return _cache;
  } catch (e) {
    console.warn('[cutterCalibration] summarize failed:', e.message);
    return _cache;   // stale is better than nothing
  }
}

// Build a compact, prompt-ready snippet from the calibration summary. Returns
// '' if no usable calibration (library too small / not present yet).
function buildCalibrationSnippet(cal) {
  if (!cal || !cal.cards || cal.cards < 8) return '';
  const lines = [];
  lines.push(`LIBRARY CALIBRATION — match these EMPIRICAL patterns from the user's existing well-cut cards (n=${cal.cards}):`);
  // Length / density targets
  const para = cal.paragraphs && cal.paragraphs.perCard;
  if (para) lines.push(`- Paragraphs per card: typical ${para.p25}–${para.p75} (median ${para.median}).`);
  if (cal.highlights && cal.highlights.perParagraph) {
    lines.push(`- Highlights per paragraph: median ${cal.highlights.perParagraph.median} (avg ${cal.highlights.perParagraph.avg}).`);
  }
  if (cal.highlights && cal.highlights.wordLength) {
    lines.push(`- Highlight word length: median ${cal.highlights.wordLength.median}, P75 ${cal.highlights.wordLength.p75}, P90 ${cal.highlights.wordLength.p90}.`);
  }
  if (cal.densityRatios) {
    lines.push(`- Underline coverage: ~${(cal.densityRatios.underlineFraction.median * 100).toFixed(0)}% of paragraph words inside <u>.`);
    lines.push(`- Highlight coverage: ~${(cal.densityRatios.highlightFraction.median * 100).toFixed(0)}% of paragraph words inside ==…==.`);
  }
  // Linguistic biases
  if (cal.highlights && cal.highlights.linguistic) {
    const ling = cal.highlights.linguistic;
    lines.push(`- ${ling.hasVerbPct}% of highlights contain a finite verb. ${ling.hasNumberPct}% contain a number/year. Bias hard toward those.`);
  }
  // Top sentence skeletons
  if (cal.sentenceSkeletons && cal.sentenceSkeletons.topPatterns && cal.sentenceSkeletons.topPatterns.length) {
    const top = cal.sentenceSkeletons.topPatterns.slice(0, 5).map(([p]) => `"${p}"`).join(', ');
    lines.push(`- Common sentence skeletons (run-length, U=underlined-only, H=highlighted, D=dropped): ${top}. Reuse these shapes.`);
  }
  // Words to skip — what gets dropped from underlines in the user's library
  if (cal.droppedAndGap) {
    const dWords = (cal.droppedAndGap.topDroppedWords || []).slice(0, 12).map(([w]) => w);
    if (dWords.length) lines.push(`- Words/phrases the library DROPS (don't underline these): ${dWords.join(', ')}.`);
    const dPhr = (cal.droppedAndGap.topDroppedPhrases || []).slice(0, 5).map(([p]) => `"${p}"`);
    if (dPhr.length) lines.push(`- Boilerplate phrases routinely dropped: ${dPhr.join(', ')}.`);
    const gWords = (cal.droppedAndGap.topGapWords || []).slice(0, 10).map(([w]) => w);
    if (gWords.length) lines.push(`- Function words found INSIDE underlines but NOT highlighted (read silently): ${gWords.join(', ')}.`);
  }
  // Top phrases — voice reference
  if (cal.highlights && cal.highlights.topBigrams && cal.highlights.topBigrams.length) {
    const top2 = cal.highlights.topBigrams.slice(0, 8).map(([g]) => `"${g}"`).join(', ');
    lines.push(`- Most-frequent highlight 2-grams in this library: ${top2}.`);
  }
  if (cal.highlights && cal.highlights.topTrigrams && cal.highlights.topTrigrams.length) {
    const top3 = cal.highlights.topTrigrams.slice(0, 5).map(([g]) => `"${g}"`).join(', ');
    lines.push(`- Most-frequent highlight 3-grams: ${top3}.`);
  }
  // Bold-pattern guidance
  if (cal.bolds && cal.bolds.boldsInsideHighlightsPct != null) {
    lines.push(`- ${cal.bolds.boldsInsideHighlightsPct}% of bolds in the library sit INSIDE a highlight — match this rate.`);
  }
  return lines.join('\n');
}

module.exports = { getCalibration, buildCalibrationSnippet };
