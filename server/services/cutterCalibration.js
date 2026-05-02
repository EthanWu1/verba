'use strict';
/**
 * cutterCalibration.js
 *
 * One-and-done analyzer. The first time anything calls getCalibration()
 * (or the server is started without a calibration file present), it pulls
 * 300 random quality cards from the library, runs the analyzer, writes
 * the summary to disk, and uses it forever after. Subsequent boots load
 * the persisted JSON from disk — no re-analysis.
 *
 * To re-run: delete data/cutter-calibration.json (or pass force:true,
 * or run `node server/scripts/analyzeLibraryCards.js --regenerate`).
 */

const fs = require('fs');
const path = require('path');
const { summarizeFromDb } = require('../scripts/analyzeLibraryCards');

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(__dirname, '..', '..', 'data');
const CAL_FILE = path.join(DATA_DIR, 'cutter-calibration.json');

let _cache = null;

// Try to load persisted calibration on module load — happens once per server boot.
function loadFromDisk() {
  try {
    if (fs.existsSync(CAL_FILE)) {
      _cache = JSON.parse(fs.readFileSync(CAL_FILE, 'utf8'));
      if (_cache && _cache.cards) {
        console.log(`[cutterCalibration] loaded ${_cache.cards}-card calibration from ${CAL_FILE}`);
      }
    }
  } catch (e) {
    console.warn('[cutterCalibration] could not load persisted calibration:', e.message);
    _cache = null;
  }
}
loadFromDisk();

function saveToDisk(summary) {
  try {
    fs.mkdirSync(path.dirname(CAL_FILE), { recursive: true });
    fs.writeFileSync(CAL_FILE, JSON.stringify(summary, null, 2));
    console.log(`[cutterCalibration] persisted ${summary.cards}-card calibration to ${CAL_FILE}`);
  } catch (e) {
    console.warn('[cutterCalibration] could not persist calibration:', e.message);
  }
}

// Pull from the WHOLE database (no userId filter). The voice reference is
// shared — patterns from any well-cut card teach the model how to format,
// and a new user with an empty library still gets the benefit. Override
// with userId if you ever want a per-user voice instead.
function getCalibration({ force = false, limit = 300, userId = null } = {}) {
  // Already calibrated? Use the cached/persisted result. No expiration.
  if (!force && _cache) return _cache;
  const started = Date.now();
  try {
    const summary = summarizeFromDb({ limit, userId });
    const elapsed = Date.now() - started;
    if (summary && summary.cards >= 8) {
      _cache = summary;
      saveToDisk(summary);
      console.log(`[cutterCalibration] one-time analysis complete: ${summary.cards} quality cards studied in ${elapsed}ms`);
    } else {
      _cache = null;
      console.log(`[cutterCalibration] only ${summary && summary.cards || 0} quality cards found — running with static rules only (need >=8)`);
    }
    return _cache;
  } catch (e) {
    console.warn('[cutterCalibration] analysis failed:', e.message);
    return _cache;   // whatever we had
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
