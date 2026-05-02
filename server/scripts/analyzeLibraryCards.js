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

// Quality filter — only pull cards that look like real, well-cut evidence:
//   1) has at least one ==highlight==
//   2) has at least one <u>underline</u>
//   3) body length between 800 and 8000 chars (skips stubs and walls of text)
//   4) at least 3 paragraphs (skips single-line cuts)
//   5) tag and cite present (skips drafts / failures)
// Sample is pulled from the WHOLE table, randomized so we don't bias to one
// epoch or one user's style. Returns up to LIMIT cards.
function pickCards(db, bodyCol) {
  const where = USER ? 'WHERE userId = ? AND' : 'WHERE';
  const params = USER ? [USER] : [];
  const sql = `
    SELECT id, ${bodyCol} AS body
    FROM user_saved_cards
    ${where}
      ${bodyCol} IS NOT NULL
      AND length(${bodyCol}) BETWEEN 800 AND 8000
      AND ${bodyCol} LIKE '%==%'
      AND ${bodyCol} LIKE '%<u>%'
      AND tag IS NOT NULL AND length(trim(tag)) > 0 AND tag NOT LIKE '%untitled%'
      AND cite IS NOT NULL AND length(trim(cite)) > 0
    ORDER BY RANDOM()
    LIMIT ?
  `;
  try {
    return db.prepare(sql).all(...params, LIMIT);
  } catch (e) {
    // Schema variants may not have tag/cite columns — fall back to a softer filter.
    const fallback = `
      SELECT id, ${bodyCol} AS body
      FROM user_saved_cards
      ${where}
        ${bodyCol} IS NOT NULL
        AND length(${bodyCol}) BETWEEN 800 AND 8000
        AND ${bodyCol} LIKE '%==%'
        AND ${bodyCol} LIKE '%<u>%'
      ORDER BY RANDOM()
      LIMIT ?
    `;
    return db.prepare(fallback).all(...params, LIMIT);
  }
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

// ── WORD-KIND CLASSIFIER ─────────────────────────────────────────────
// Breaks each word into a rough part-of-speech / function class so we can
// compute "what KIND of word tends to be highlighted vs skipped".

const STOPWORDS = new Set([
  'the','a','an','of','in','for','to','with','and','or','but','at','on','by',
  'from','as','that','this','these','those','it','its','their','his','her',
  'they','them','we','us','our','you','your','i','me','my','he','she',
  'is','are','was','were','be','been','being','am','do','does','did','done',
  'have','has','had','having','will','would','could','should','may','might',
  'can','must','shall','than','then','so','if','because','while','when',
  'where','who','what','which','how','why','some','any','all','each','every',
  'no','not','also','just','only','very','more','most','less','least','too',
  'into','onto','upon','about','across','after','against','before','between',
  'during','through','under','over','out','off','up','down','here','there',
]);

const COMMON_VERBS = new Set([
  // already in VERB_LIST but kept here for word-kind classification too
  'cause','causes','caused','causing','lead','leads','led','leading',
  'trigger','triggers','triggered','spark','sparks','sparked',
  'result','results','resulted','drive','drives','drove','driven',
  'collapse','collapses','collapsing','undermine','undermines','undermined',
  'erode','erodes','eroded','destroy','destroys','destroyed','prevent','prevents',
  'block','blocks','blocked','accelerate','accelerates','escalate','escalates',
  'end','ends','ended','eliminate','eliminates','make','makes','made','force',
  'forces','forced','compel','compels','require','requires','increase',
  'increases','reduce','reduces','rise','rises','fall','falls','grow','grows',
  'shrink','shrinks','concludes','concluded','argues','argued','shows','showed',
  'demonstrates','finds','found','reveals','revealed','warns','warned','predicts',
  'remains','remained','say','says','said','believes','believe','found','show',
  'find','threaten','threatens','threatened','create','creates','created',
  'mean','means','meant','allow','allows','allowed','enable','enables',
]);

function wordKind(rawWord) {
  const w = String(rawWord || '').toLowerCase().replace(/[.,;:!?'"()\[\]]/g, '');
  if (!w) return null;
  if (/^\d+(?:[.,]\d+)?(?:%)?$/.test(w) || /^\d{4}$/.test(w)) return 'number';
  if (STOPWORDS.has(w)) return 'stopword';
  if (COMMON_VERBS.has(w)) return 'verb';
  if (/^[A-Z][a-z]/.test(rawWord)) return 'proper_noun';
  if (/(?:tion|ment|ness|ity|ism|ence|ance)s?$/.test(w)) return 'noun_abstract';
  if (/(?:ing|ed|ly|ize|ate)$/.test(w)) return 'verb_or_adverb';
  return 'noun_or_other';
}

// Split a paragraph into rough sentences (heuristic — splits on . ! ? + space).
function splitSentences(paraText) {
  // Avoid splitting on abbreviations (Mr., e.g., U.S., 3.5) — rough but ok.
  return paraText
    .replace(/([.!?])\s+(?=[A-Z(])/g, '$1\x01')
    .split('\x01')
    .map(s => s.trim())
    .filter(Boolean);
}

// Returns sentence-level classification for a paragraph:
//   highlighted    — sentence contains at least one ==…==
//   underlined     — sentence has <u>…</u> but no ==
//   plain          — sentence has neither
function classifySentence(sent) {
  const hasHl = /==[^=\n]+?==/.test(sent);
  const hasUl = /<u>[\s\S]+?<\/u>/.test(sent);
  if (hasHl) return 'highlighted';
  if (hasUl) return 'underlined';
  return 'plain';
}

// ── SENTENCE SKELETON + DROPPED / GAP PHRASE EXTRACTION ──────────────
// For each paragraph, build:
//   sentenceSkeletons — compressed run-length string like "U3 H2 U4 H1 U2"
//                       (U=underlined-not-highlighted, H=highlighted, D=dropped)
//   droppedPhrases    — text that's IN the paragraph but OUTSIDE every <u>
//                       (the "unnecessary" sentences/words kept for integrity)
//   gapPhrases        — text INSIDE an underline but BETWEEN highlights
//                       (the "necessary context not read aloud")
// Returns { skeletons, dropped, gaps }.
function extractSkeletonAndGaps(paraText) {
  // Strip just the format marks but REMEMBER which spans were what.
  // Walk the raw paragraph, mapping each plain-text character to an "H/U/D".
  const labels = []; // one entry per plain-text character: 'H' | 'U' | 'D'
  const plainChars = [];
  let inU = 0;          // depth of <u> nesting
  let inHl = false;     // currently inside ==…==
  let inBold = false;   // currently inside **…**
  let i = 0;
  const s = paraText;
  while (i < s.length) {
    if (s[i] === '<' && s.substr(i, 3) === '<u>') { inU++; i += 3; continue; }
    if (s[i] === '<' && s.substr(i, 4) === '</u>') { inU = Math.max(0, inU - 1); i += 4; continue; }
    if (s[i] === '*' && s[i + 1] === '*') { inBold = !inBold; i += 2; continue; }
    if (s[i] === '=' && s[i + 1] === '=') { inHl = !inHl; i += 2; continue; }
    plainChars.push(s[i]);
    labels.push(inHl ? 'H' : (inU ? 'U' : 'D'));
    i++;
  }
  const plain = plainChars.join('');

  // Build skeleton + gap/dropped collectors per sentence.
  const sentences = splitSentences(plain);
  const skeletons = [];
  const dropped = [];
  const gaps = [];
  let cursor = 0;
  for (const sent of sentences) {
    if (!sent.trim()) continue;
    // Find this sentence's labels by aligning to plain-text cursor.
    const sLabels = labels.slice(cursor, cursor + sent.length);
    cursor += sent.length;
    // Skip whitespace+punctuation between sentences in plain
    while (cursor < plain.length && /\s/.test(plain[cursor])) cursor++;

    if (!sLabels.length) continue;

    // Compress sentence labels into runs of H/U/D, counted in WORDS not chars.
    // Walk word-by-word: a word's label is its dominant character label.
    const words = sent.split(/(\s+)/).filter(Boolean);
    let charIdx = 0;
    const wordLabels = [];
    for (const w of words) {
      if (/^\s+$/.test(w)) { charIdx += w.length; continue; }
      const slice = sLabels.slice(charIdx, charIdx + w.length);
      // Majority label
      const counts = { H: 0, U: 0, D: 0 };
      for (const c of slice) counts[c] = (counts[c] || 0) + 1;
      const winner = counts.H >= counts.U && counts.H > 0 ? 'H'
                  : counts.U > 0 ? 'U' : 'D';
      wordLabels.push({ word: w, label: winner });
      charIdx += w.length;
    }

    // Run-length compress
    const skel = [];
    let cur = null, run = 0;
    for (const wl of wordLabels) {
      if (wl.label === cur) run++;
      else { if (cur) skel.push(`${cur}${run}`); cur = wl.label; run = 1; }
    }
    if (cur) skel.push(`${cur}${run}`);
    skeletons.push(skel.join(' '));

    // Collect dropped phrases (consecutive D-labeled words) and gap phrases
    // (consecutive U-labeled words BETWEEN H runs in the same sentence).
    let buf = [], curLbl = null;
    let sentenceHadH = wordLabels.some(w => w.label === 'H');
    for (const wl of wordLabels) {
      if (wl.label !== curLbl) {
        if (buf.length && curLbl === 'D') dropped.push(buf.join('').trim());
        if (buf.length && curLbl === 'U' && sentenceHadH) gaps.push(buf.join('').trim());
        buf = [];
        curLbl = wl.label;
      }
      buf.push(wl.word);
    }
    if (buf.length && curLbl === 'D') dropped.push(buf.join('').trim());
    if (buf.length && curLbl === 'U' && sentenceHadH) gaps.push(buf.join('').trim());
  }

  return {
    skeletons,
    dropped: dropped.filter(t => t.length > 1),
    gaps:    gaps.filter(t => t.length > 1),
  };
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
      paraIdx,
    }));

    // Where is the bold? Inside a highlight or just inside an underline?
    let boldsInsideHighlights = 0;
    for (const b of bolds) {
      const bl = b.toLowerCase();
      if (highlights.some(h => h.toLowerCase().includes(bl))) boldsInsideHighlights++;
    }

    // Sentence-level classification (highlighted / underlined / plain)
    const sentences = splitSentences(para);
    const sentClasses = sentences.map(classifySentence);

    // Word-level kind tracking: which kinds of words END UP IN highlights
    // vs end up in plain underlined context vs are dropped from underlines.
    const allParaWords = stripFormatMarks(para).split(/\s+/).filter(Boolean);
    const hlWords = new Set(highlights.flatMap(h => h.toLowerCase().split(/\s+/).filter(Boolean).map(w => w.replace(/[.,;:!?'"()]/g, ''))));
    const ulPlain = underlines.map(stripFormatMarks).join(' ').toLowerCase();
    const wordKinds = { all: {}, highlighted: {}, underlined: {}, dropped: {} };
    for (const raw of allParaWords) {
      const k = wordKind(raw);
      if (!k) continue;
      wordKinds.all[k] = (wordKinds.all[k] || 0) + 1;
      const cleanW = raw.toLowerCase().replace(/[.,;:!?'"()]/g, '');
      if (hlWords.has(cleanW)) {
        wordKinds.highlighted[k] = (wordKinds.highlighted[k] || 0) + 1;
      } else if (ulPlain.includes(cleanW)) {
        wordKinds.underlined[k] = (wordKinds.underlined[k] || 0) + 1;
      } else {
        wordKinds.dropped[k] = (wordKinds.dropped[k] || 0) + 1;
      }
    }

    // Sentence skeleton + dropped/gap phrase extraction
    const sk = extractSkeletonAndGaps(para);

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
      sentenceClasses: sentClasses,
      wordKinds,
      skeletons: sk.skeletons,
      droppedPhrases: sk.dropped,
      gapPhrases: sk.gaps,
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

  // ── SENTENCE-LEVEL STATS ─────────────────────────────────────────
  // Aggregate sentence classifications across every paragraph.
  const sentBuckets = { highlighted: 0, underlined: 0, plain: 0 };
  for (const p of allParas) {
    for (const c of p.sentenceClasses || []) sentBuckets[c]++;
  }
  const sentTotal = sentBuckets.highlighted + sentBuckets.underlined + sentBuckets.plain || 1;
  const sentencePct = {
    highlightedPct: +(sentBuckets.highlighted / sentTotal * 100).toFixed(1),
    underlinedOnlyPct: +(sentBuckets.underlined / sentTotal * 100).toFixed(1),
    plainPct:          +(sentBuckets.plain      / sentTotal * 100).toFixed(1),
  };

  // ── WORD-KIND HIGHLIGHT RATES ────────────────────────────────────
  // For each kind of word (verb / noun / number / stopword / proper noun),
  // what fraction of occurrences end up highlighted vs underlined vs dropped?
  const kindAggregate = {};
  for (const p of allParas) {
    for (const cat of ['all', 'highlighted', 'underlined', 'dropped']) {
      for (const [k, v] of Object.entries(p.wordKinds?.[cat] || {})) {
        kindAggregate[k] = kindAggregate[k] || { all: 0, highlighted: 0, underlined: 0, dropped: 0 };
        kindAggregate[k][cat] += v;
      }
    }
  }
  const wordKindRates = {};
  for (const [k, counts] of Object.entries(kindAggregate)) {
    if (!counts.all) continue;
    wordKindRates[k] = {
      total: counts.all,
      highlightRatePct: +(counts.highlighted / counts.all * 100).toFixed(1),
      underlineRatePct: +(counts.underlined / counts.all * 100).toFixed(1),
      droppedPct:       +(counts.dropped    / counts.all * 100).toFixed(1),
    };
  }

  // ── COMPRESSION EFFICIENCY ───────────────────────────────────────
  // Per-card: total words, underlined words, highlighted words.
  const efficiency = {
    avgUnderlineFraction: +avg(allParas.map(p => p.underlineRatio)).toFixed(3),
    avgHighlightFraction: +avg(allParas.map(p => p.highlightRatio)).toFixed(3),
    // What % of "read-aloud time" (= highlighted words) compresses the
    // total card body? Lower = more efficient.
    avgReadCompression: +avg(allParas.map(p => p.totalWords ? p.highlightWords / p.totalWords : 0)).toFixed(3),
    // Words-per-highlight = how "dense" each operative phrase is (avg).
    avgWordsPerHighlight: +avg(allHlLens).toFixed(2),
  };

  // ── WITHIN-CARD REDUNDANCY ───────────────────────────────────────
  // For each card, count duplicate highlight phrases (case-insensitive).
  // Reports the % of highlights that are repeats — a card with 0% repeats
  // is maximally information-dense. Real cards usually 5–15%.
  const repeatRates = cards.map(c => {
    const counts = new Map();
    for (const h of c.allHighlights || []) {
      const k = h.text.toLowerCase().trim();
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    const total = c.allHighlights?.length || 0;
    const repeats = [...counts.values()].reduce((s, v) => s + Math.max(0, v - 1), 0);
    return total ? repeats / total : 0;
  });
  const withinCardRepeatPct = +avg(repeatRates).toFixed(3);

  // ── WHAT'S IGNORED ───────────────────────────────────────────────
  // Among included paragraphs, what fraction of sentences receive NO
  // markup? These are the connective-tissue sentences the cutter chose to
  // include for paragraph integrity but not to read aloud.
  const ignoredSentencePct = sentencePct.plainPct;

  // ── SENTENCE SKELETONS + GAP / DROPPED PHRASE FREQUENCIES ────────
  // Aggregate the per-paragraph skeleton strings and gap/dropped phrase
  // lists so we can see (a) common sentence shapes and (b) the most-
  // common "filler" the cutter deemed unnecessary.
  const allSkeletons = allParas.flatMap(p => p.skeletons || []);
  const skelCounts = new Map();
  for (const sk of allSkeletons) {
    if (!sk) continue;
    skelCounts.set(sk, (skelCounts.get(sk) || 0) + 1);
  }
  const topSkeletons = [...skelCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);

  // Frequency of words/phrases that fall in gaps (between highlights inside
  // an underline) and dropped (in paragraph but outside any underline).
  const gapTexts = allParas.flatMap(p => p.gapPhrases || []);
  const dropTexts = allParas.flatMap(p => p.droppedPhrases || []);
  // Tokenize and frequency-rank single words (cleaner signal than n-grams here).
  const tokenFreq = (texts) => {
    const m = new Map();
    for (const t of texts) {
      for (const raw of t.toLowerCase().split(/\s+/)) {
        const w = raw.replace(/[.,;:!?'"()\[\]]/g, '');
        if (!w || w.length < 2) continue;
        m.set(w, (m.get(w) || 0) + 1);
      }
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const topGapWords = tokenFreq(gapTexts).slice(0, 25);
  const topDroppedWords = tokenFreq(dropTexts).slice(0, 25);
  // Also: most common dropped multi-word phrases (verbatim).
  const dropPhraseCounts = new Map();
  for (const t of dropTexts) {
    const norm = t.toLowerCase().replace(/\s+/g, ' ').trim();
    if (norm.split(' ').length < 3) continue;
    dropPhraseCounts.set(norm, (dropPhraseCounts.get(norm) || 0) + 1);
  }
  const topDroppedPhrases = [...dropPhraseCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  // Most common gap (between-highlight) phrases — the connective tissue.
  const gapPhraseCounts = new Map();
  for (const t of gapTexts) {
    const norm = t.toLowerCase().replace(/\s+/g, ' ').trim();
    if (norm.split(' ').length < 2) continue;
    gapPhraseCounts.set(norm, (gapPhraseCounts.get(norm) || 0) + 1);
  }
  const topGapPhrases = [...gapPhraseCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);

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
      operativeKindPct: kindPct,
      linguistic,
      topBigrams:  top2,
      topTrigrams: top3,
    },
    sentenceStructure: sentencePct,
    wordKindRates,
    efficiency,
    redundancy: {
      withinCardRepeatPct,
      ignoredSentencePct,
    },
    sentenceSkeletons: {
      total: allSkeletons.length,
      topPatterns: topSkeletons,
    },
    droppedAndGap: {
      topGapWords,
      topDroppedWords,
      topGapPhrases,
      topDroppedPhrases,
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
  lines.push(`── SENTENCE STRUCTURE (what % of sentences are…) ──`);
  const ss = s.sentenceStructure;
  lines.push(`Highlighted (has ==…==):     ${ss.highlightedPct}%`);
  lines.push(`Underlined-only (<u> no ==): ${ss.underlinedOnlyPct}%`);
  lines.push(`Plain (ignored):             ${ss.plainPct}%`);
  if (ss.plainPct > 30) lines.push(`  → cards include lots of context that's NOT read — paragraph-integrity-driven`);
  else if (ss.plainPct < 10) lines.push(`  → almost everything is at least underlined — dense reads`);
  lines.push(``);
  lines.push(`── WORD-KIND HIGHLIGHT RATES (% of each kind of word that ends up highlighted) ──`);
  // Sort by total occurrences so we see the high-volume kinds first
  const wkr = Object.entries(s.wordKindRates || {}).sort((a, b) => b[1].total - a[1].total);
  for (const [kind, r] of wkr) {
    lines.push(`  ${kind.padEnd(18)} (n=${String(r.total).padStart(5)})  ${r.highlightRatePct}% highlighted, ${r.underlineRatePct}% underlined-only, ${r.droppedPct}% dropped`);
  }
  lines.push(``);
  lines.push(`── HIGHLIGHT KIND (what concept the highlight carries) ──`);
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
  lines.push(`── COMPRESSION EFFICIENCY ──`);
  const ef = s.efficiency;
  lines.push(`Underline coverage: ${(ef.avgUnderlineFraction * 100).toFixed(0)}% of paragraph words sit inside <u>`);
  lines.push(`Highlight coverage: ${(ef.avgHighlightFraction * 100).toFixed(0)}% of paragraph words are highlighted`);
  lines.push(`Avg words per highlight: ${ef.avgWordsPerHighlight}  (lower = tighter operative phrases)`);
  lines.push(`Read-aloud compression:  ${(ef.avgReadCompression * 100).toFixed(1)}% of total card body is actually read aloud`);
  lines.push(``);
  lines.push(`── REDUNDANCY ──`);
  const rd = s.redundancy;
  lines.push(`Repeated highlight phrases within a card: ${(rd.withinCardRepeatPct * 100).toFixed(1)}%`);
  if (rd.withinCardRepeatPct > 0.15) lines.push(`  → high — cards re-highlight the same phrase often (consider varying the read)`);
  else if (rd.withinCardRepeatPct < 0.05) lines.push(`  → low — every highlight advances new content (efficient)`);
  else lines.push(`  → moderate (typical)`);
  lines.push(`Plain (ignored) sentences in included paragraphs: ${rd.ignoredSentencePct}%`);
  lines.push(`  → these are connective-tissue sentences kept for paragraph integrity but NOT read aloud`);
  lines.push(``);
  lines.push(`── SENTENCE SKELETONS (run-length: H=highlighted, U=underlined-not-highlighted, D=dropped) ──`);
  if (s.sentenceSkeletons && s.sentenceSkeletons.topPatterns && s.sentenceSkeletons.topPatterns.length) {
    for (const [pattern, count] of s.sentenceSkeletons.topPatterns) {
      lines.push(`  ${String(count).padStart(4)} × "${pattern}"`);
    }
    lines.push(``);
    lines.push(`  "U3 H2 U4 H1" = 3 underlined-only words, then 2 highlighted, then 4 underlined, then 1 highlighted.`);
    lines.push(`  Patterns starting with U → claim setup before operative read.`);
    lines.push(`  Patterns ending with H  → impact-led close.`);
  }
  lines.push(``);
  lines.push(`── WHAT'S DROPPED (in paragraph but OUTSIDE every <u> — kept only for paragraph integrity) ──`);
  lines.push(`Top dropped single words:`);
  for (const [w, c] of ((s.droppedAndGap && s.droppedAndGap.topDroppedWords) || []).slice(0, 15)) {
    lines.push(`  ${String(c).padStart(4)} × ${w}`);
  }
  if (s.droppedAndGap && s.droppedAndGap.topDroppedPhrases && s.droppedAndGap.topDroppedPhrases.length) {
    lines.push(`Top dropped phrases (>=3 words):`);
    for (const [p, c] of s.droppedAndGap.topDroppedPhrases) {
      lines.push(`  ${String(c).padStart(4)} x "${p}"`);
    }
  }
  lines.push(``);
  lines.push(`── WHAT'S BETWEEN HIGHLIGHTS (inside <u>, NOT in == — connective tissue read silently) ──`);
  lines.push(`Top gap single words:`);
  for (const [w, c] of ((s.droppedAndGap && s.droppedAndGap.topGapWords) || []).slice(0, 15)) {
    lines.push(`  ${String(c).padStart(4)} × ${w}`);
  }
  if (s.droppedAndGap && s.droppedAndGap.topGapPhrases && s.droppedAndGap.topGapPhrases.length) {
    lines.push(`Top gap phrases (>=2 words):`);
    for (const [p, c] of s.droppedAndGap.topGapPhrases) {
      lines.push(`  ${String(c).padStart(4)} x "${p}"`);
    }
  }
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

// Public API for server-side calibration. Pulls QUALITY cards (random
// sample, not 'most recent') with the same filter the CLI uses: must have
// highlights, underlines, real tag + cite, body length 800–8000.
function summarizeFromDb({ limit = 300, userId = null } = {}) {
  const db = getDb();
  const bodyCol = findBodyColumn(db);
  if (!bodyCol) return { cards: 0 };
  const userClause = userId ? 'userId = ? AND' : '';
  const params = userId ? [userId] : [];
  const fullSql = `
    SELECT id, ${bodyCol} AS body
    FROM user_saved_cards
    WHERE ${userClause}
          ${bodyCol} IS NOT NULL
      AND length(${bodyCol}) BETWEEN 800 AND 8000
      AND ${bodyCol} LIKE '%==%'
      AND ${bodyCol} LIKE '%<u>%'
      AND tag  IS NOT NULL AND length(trim(tag))  > 0 AND tag  NOT LIKE '%untitled%'
      AND cite IS NOT NULL AND length(trim(cite)) > 0
    ORDER BY RANDOM()
    LIMIT ?
  `;
  const fallbackSql = `
    SELECT id, ${bodyCol} AS body
    FROM user_saved_cards
    WHERE ${userClause}
          ${bodyCol} IS NOT NULL
      AND length(${bodyCol}) BETWEEN 800 AND 8000
      AND ${bodyCol} LIKE '%==%'
      AND ${bodyCol} LIKE '%<u>%'
    ORDER BY RANDOM()
    LIMIT ?
  `;
  let rows;
  try { rows = db.prepare(fullSql).all(...params, limit); }
  catch { rows = db.prepare(fallbackSql).all(...params, limit); }
  const stats = rows.map(r => analyzeCard(r.body));
  return summarize(stats);
}

module.exports = {
  summarizeFromDb,
  analyzeCard,
  summarize,
  prettyReport,
};

// CLI entry — only runs when executed directly via `node analyzeLibraryCards.js`
if (require.main === module) {
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
}
