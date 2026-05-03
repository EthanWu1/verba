#!/usr/bin/env node
/**
 * analyzeBlockfiles.js
 *
 * Reads the blockfile corpus JSONL produced by ingestBlockfiles.js and
 * mines deterministic patterns useful for biasing the chat prompt:
 *
 *   - Heading-path vocabulary (what kinds of blocks exist, per category)
 *   - Analytic-marker frequency + per-category mix (AT, 1], OV, EXT…)
 *   - Top opener / closer n-grams in analytic prose (recurring move starts/ends)
 *   - Block shape: word count, card density, analytic density (per category)
 *   - Card position within blocks (does a card open or close a block?)
 *   - Exemplar blocks per category (longest, densest — anchors for prompts)
 *
 * Pure statistics. No LLM calls. Counterpart to analyzeLibraryCards.js
 * (which mines the cards table for cardCutter prompt tuning).
 *
 * Usage:
 *   node server/scripts/analyzeBlockfiles.js
 *     [--in=server/data/blockfile-corpus.jsonl]
 *     [--out=server/data/blockfile-analysis.md]   # report path
 *     [--json=server/data/blockfile-analysis.json] # raw stats
 *     [--top=30]                                   # top-N for ranked lists
 *     [--minMarker=5]                              # min count to keep marker
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ── CLI ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (k, fallback) => {
  const m = args.find(a => a.startsWith(`--${k}=`));
  return m ? m.slice(k.length + 3) : fallback;
};

const IN        = flag('in',  path.resolve(__dirname, '../data/blockfile-corpus.jsonl'));
const OUT_MD    = flag('out', path.resolve(__dirname, '../data/blockfile-analysis.md'));
const OUT_JSON  = flag('json', path.resolve(__dirname, '../data/blockfile-analysis.json'));
const OUT_BAKE  = flag('bake', path.resolve(__dirname, '../prompts/chatPatterns.js'));
const TOP_N     = Number(flag('top', '30'));
const MIN_MARK  = Number(flag('minMarker', '5'));
const SHOULD_BAKE = args.includes('--bake') || args.some(a => a.startsWith('--bake='));

// ── Tokenization ────────────────────────────────────────────────────────
const STOPWORDS = new Set([
  'the','a','an','of','to','in','and','or','is','are','was','were','be','been',
  'being','have','has','had','do','does','did','that','this','these','those',
  'it','its','they','them','their','there','then','than','as','at','on','by',
  'with','for','from','about','into','through','over','under','but','not','no',
  'yes','if','so','also','can','will','would','could','should','may','might',
  'i','we','our','you','your','he','she','him','her','his','hers','one','two',
  'three','any','all','some','more','most','other','same','such','only','just',
  'now','here','very','too','what','which','who','whom','how','when','where',
  'why','because','while','until','before','after','out','up','down',
]);

function normTokens(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/<\/?[a-z]+\b[^>]*>/gi, ' ')   // strip stray tags
    .replace(/[*_=`~]+/g, ' ')               // strip md markup
    .replace(/[^a-z0-9'\-\s]/g, ' ')         // keep apostrophes + hyphens
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

function ngrams(tokens, n) {
  const out = [];
  for (let i = 0; i + n <= tokens.length; i++) {
    out.push(tokens.slice(i, i + n).join(' '));
  }
  return out;
}

// Strip stopwords from EDGES only (interior words preserved)
function trimStopwordEdges(tokens) {
  let lo = 0, hi = tokens.length;
  while (lo < hi && STOPWORDS.has(tokens[lo])) lo++;
  while (hi > lo && STOPWORDS.has(tokens[hi - 1])) hi--;
  return tokens.slice(lo, hi);
}

// Top-K by count; drops single-character + pure-numeric grams + grams
// that are entirely stopwords.
function topGrams(counter, k) {
  const entries = Object.entries(counter);
  const filtered = entries.filter(([gram, count]) => {
    const toks = gram.split(' ');
    if (toks.every(t => STOPWORDS.has(t))) return false;
    if (toks.every(t => /^\d+$/.test(t))) return false;
    if (toks.every(t => t.length <= 1)) return false;
    return count >= 2;
  });
  filtered.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return filtered.slice(0, k);
}

// ── Marker normalization ────────────────────────────────────────────────
// Analytic markers vary in punctuation/case. Normalize to a canonical key
// so "AT:", "AT —", "at-", "AT ‑" all collapse to "AT".
function canonMarker(raw) {
  let s = String(raw || '').toUpperCase().trim();
  // Trim trailing punctuation
  s = s.replace(/[.\s\-–—:_]+$/g, '').trim();
  // Strip leading enumerator forms: "1.", "2.", "1)", "1]", "(1)"
  // Keep "1]" as a structural marker only when nothing follows ("1]" alone)
  // — when prefixed to a word ("1. LOGIC"), drop the "1." so logic merges.
  const enumThenWord = /^\(?(\d+)\)?\s*[.\)\]:]\s*(.+)$/;
  const m = s.match(enumThenWord);
  if (m && m[2]) s = m[2].trim();
  // Collapse internal whitespace
  s = s.replace(/\s+/g, ' ');
  return s;
}

// Heuristic: does this line look like a card cite/credentials paragraph?
// (e.g. "Smith, professor of political science at Harvard, 2023, …").
// Gate on author/date shape + credentials vocabulary. Used to filter
// body n-gram noise.
const CITE_KEYWORDS = /\b(professor|prof\.|ph\.?d|associate|assistant|department|university|institute|fellow|director|editor|journalist|author|researcher|senior|policy|j\.d\.|m\.d\.|chair)\b/i;
function looksLikeCiteLine(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  // years like "2023" or "'23" — cites almost always carry one
  const hasYear = /\b(19|20)\d{2}\b/.test(t);
  if (!hasYear) return false;
  if (!CITE_KEYWORDS.test(t)) return false;
  // short-ish lines (cites rarely run longer than ~400 chars)
  if (t.length > 600) return false;
  return true;
}

// ── Report formatting ───────────────────────────────────────────────────
function formatPercent(n, total) {
  if (!total) return '0%';
  return ((n / total) * 100).toFixed(1) + '%';
}

function formatTable(rows, headers) {
  // simple markdown table
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map(r => String(r[i] ?? '').length))
  );
  const fmtRow = r => '| ' + r.map((c, i) =>
    String(c ?? '').padEnd(widths[i])
  ).join(' | ') + ' |';
  const sep = '|' + widths.map(w => '-'.repeat(w + 2)).join('|') + '|';
  return [fmtRow(headers), sep, ...rows.map(fmtRow)].join('\n');
}

// ── Main ────────────────────────────────────────────────────────────────
function main() {
  if (!fs.existsSync(IN)) {
    console.error(`Corpus not found: ${IN}`);
    console.error(`Run: node server/scripts/ingestBlockfiles.js first.`);
    process.exit(1);
  }

  // Per-category accumulators
  const cats = {}; // cat → { blocks, cards, analytics, totalChars, ... }
  const ALL  = { name: 'ALL' };
  const all = mkAccum(ALL);

  function mkAccum(holder) {
    holder.blocks       = 0;
    holder.cards        = 0;
    holder.analytics    = 0;
    holder.totalChars   = 0;
    holder.blockChars   = []; // per-block char count
    holder.headingTokens = {}; // word → count
    holder.headingPaths  = {}; // joined path → count
    holder.markerCounts  = {}; // canon marker → count
    holder.opener1g      = {}; // first content token of analytic
    holder.opener2g      = {};
    holder.opener3g      = {};
    holder.opener4g      = {};
    holder.opener5g      = {};
    holder.closer3g      = {}; // last 3-gram of analytic
    holder.closer5g      = {};
    holder.bigram        = {}; // body 2-grams
    holder.trigram       = {}; // body 3-grams
    holder.fourgram      = {}; // body 4-grams
    holder.cardPositions = []; // 0..1 normalized position of each card in its block
    holder.exemplars     = []; // candidate blocks for prompt anchors

    // Analytics-specific metrics
    holder.analyticChars = []; // per-analytic char count (plain, not markdown)
    holder.analyticSentences = []; // per-analytic sentence count
    holder.analyticBoldCount      = 0; // # analytics containing **...**
    holder.analyticUnderlineCount = 0; // # analytics containing <u>...</u>
    holder.analyticHighlightCount = 0; // # analytics containing ==...==
    holder.analyticNumberedCount  = 0; // # analytics with 1./2./3. shape
    holder.analyticEmDashChars    = 0; // total em-dash occurrences (— or ---)
    holder.analyticAllCapsHits    = 0; // total ALLCAPS-word occurrences (≥2 letters)
    holder.analyticTotalWords     = 0; // for normalization (per-100-word rates)
    holder.analyticBigram         = {}; // analytics-only 2-grams
    holder.analyticTrigram        = {}; // analytics-only 3-grams
    holder.abbreviations          = {}; // debate jargon hits
    return holder;
  }

  function bump(map, key, n = 1) { map[key] = (map[key] || 0) + n; }

  function ingest(holder, rec) {
    holder.blocks++;
    holder.cards     += rec.n_cards;
    holder.analytics += rec.n_analytics;
    holder.totalChars += rec.n_chars;
    holder.blockChars.push(rec.n_chars);

    // heading vocabulary
    const path = (rec.heading_path || []).filter(Boolean);
    if (path.length) {
      bump(holder.headingPaths, path.join(' › '));
      for (const seg of path) {
        for (const t of normTokens(seg)) {
          if (!STOPWORDS.has(t) && t.length > 1) bump(holder.headingTokens, t);
        }
      }
    }

    // analytic markers + opener/closer n-grams + formatting/style metrics
    for (const a of rec.analytics || []) {
      const m = canonMarker(a.marker);
      if (m) bump(holder.markerCounts, m);

      // Formatting markers (preserved by ingester via p.markdown)
      const md = String(a.text || '');
      if (/\*\*[^*]+\*\*/.test(md))   holder.analyticBoldCount++;
      if (/<u>[\s\S]+?<\/u>/i.test(md)) holder.analyticUnderlineCount++;
      if (/==[^=]+==/.test(md))         holder.analyticHighlightCount++;

      // Strip markup for plain-text analysis
      const plain = md
        .replace(/<\/?[a-z]+\b[^>]*>/gi, '')
        .replace(/[*_=`~]+/g, '')
        .trim();

      // Length + sentence count (split on .?! followed by space-or-end)
      holder.analyticChars.push(plain.length);
      const sentences = (plain.match(/[^.!?]+[.!?]+(?=\s|$)/g) || []).length || 1;
      holder.analyticSentences.push(sentences);

      // Em-dashes (real em-dash + double/triple-hyphen Verbatim convention)
      const emDashes = (plain.match(/—|–|---|--/g) || []).length;
      holder.analyticEmDashChars += emDashes;

      // ALLCAPS-emphasis: 2+ letter all-uppercase tokens (excludes 1-letter)
      const allCaps = (plain.match(/\b[A-Z]{2,}\b/g) || []).length;
      holder.analyticAllCapsHits += allCaps;

      // Word count for normalization
      const wordCount = (plain.match(/\b[a-zA-Z]+\b/g) || []).length;
      holder.analyticTotalWords += wordCount;

      // Numbered-list shape: starts with "1." OR contains "\n1." AND "\n2."
      const hasNumberedStart = /^\s*\d+\s*[.\)\]]\s/.test(plain);
      const hasMultipleSteps = /\n\s*1\s*[.\)\]]/.test(plain) && /\n\s*2\s*[.\)\]]/.test(plain);
      if (hasNumberedStart || hasMultipleSteps) holder.analyticNumberedCount++;

      // Debate abbreviations — count canonical jargon
      const jargonRe = /\b(DA|CP|NC|AC|AT|T|FW|UV|UQ|UNQ|NIBs?|RVI|PIC|XO|AFC|CSA|2NR|1NC|2NC|1AR|2AR|1AC|3NR|OV|EXT|MPX|IMP|SQ|CX|K|NL|NR|AFF|NEG|TT|RT|LD|CDA|NRT|NSDA|TOC)\b/g;
      const jargonHits = plain.match(jargonRe) || [];
      for (const j of jargonHits) bump(holder.abbreviations, j);

      // Analytics-only n-grams (cleaner signal than body trigrams)
      const aToks = normTokens(plain).filter(t => !STOPWORDS.has(t) && t.length > 1);
      for (const g of ngrams(aToks, 2)) bump(holder.analyticBigram, g);
      for (const g of ngrams(aToks, 3)) bump(holder.analyticTrigram, g);

      // Opener/closer n-grams (existing)
      const toks = trimStopwordEdges(aToks);
      if (toks.length >= 1) bump(holder.opener1g, toks[0]);
      for (const n of [2, 3, 4, 5]) {
        if (toks.length >= n) {
          const opener = toks.slice(0, n).join(' ');
          bump(holder['opener' + n + 'g'], opener);
        }
      }
      for (const n of [3, 5]) {
        if (toks.length >= n) {
          const closer = toks.slice(toks.length - n).join(' ');
          bump(holder['closer' + n + 'g'], closer);
        }
      }
    }

    // body n-grams (over body_text — captures phrasing across both prose
    // and any analytic markers). Filter cite-shaped lines out first; their
    // credentials vocabulary dominates n-grams otherwise.
    if (rec.body_text) {
      const cleanBody = String(rec.body_text)
        .split('\n')
        .filter(line => !looksLikeCiteLine(line))
        .join('\n');
      const toks = normTokens(cleanBody).filter(t => !STOPWORDS.has(t) && t.length > 1);
      for (const g of ngrams(toks, 2)) bump(holder.bigram, g);
      for (const g of ngrams(toks, 3)) bump(holder.trigram, g);
      for (const g of ngrams(toks, 4)) bump(holder.fourgram, g);
    }

    // card position (0=start, 1=end of block). Find each card's tag in
    // body_text and use its char offset / total chars. Cards in rec.cards
    // are in doc order, so scan from a moving cursor to handle duplicate
    // tags within one block.
    if (rec.body_text && rec.cards && rec.cards.length) {
      const bodyLen = Math.max(rec.body_text.length - 1, 1);
      let cursor = 0;
      for (const c of rec.cards) {
        const tag = String(c.tag || '').trim();
        if (!tag) continue;
        const idx = rec.body_text.indexOf(tag, cursor);
        if (idx < 0) continue;
        holder.cardPositions.push(idx / bodyLen);
        cursor = idx + tag.length;
      }
    }

    // exemplar candidate: high analytic density OR balanced cards+analytics
    const score = (rec.n_analytics * 60) + (rec.n_cards * 40) + Math.min(rec.n_chars, 4000) / 100;
    holder.exemplars.push({ score, rec });
  }

  // Stream JSONL
  const lines = fs.readFileSync(IN, 'utf8').split('\n').filter(Boolean);
  console.log(`[analyze] reading ${lines.length} blocks from ${IN}`);
  for (const line of lines) {
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    if (!rec || typeof rec !== 'object') continue;
    ingest(all, rec);
    const cat = rec.category || 'uncategorized';
    if (!cats[cat]) cats[cat] = mkAccum({ name: cat });
    ingest(cats[cat], rec);
  }

  // Summarize
  const summary = {
    generated_at: new Date().toISOString(),
    source: IN,
    blocks_total: all.blocks,
    cards_total:  all.cards,
    analytics_total: all.analytics,
    chars_total: all.totalChars,
    categories: {},
  };

  function pct50(arr) { return percentile(arr, 50); }
  function pct90(arr) { return percentile(arr, 90); }
  function percentile(arr, p) {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
  }

  function summarizeAccum(h) {
    const exemplars = [...h.exemplars]
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(({ rec }) => ({
        block_id: rec.block_id,
        file: rec.file,
        heading_path: rec.heading_path,
        n_cards: rec.n_cards,
        n_analytics: rec.n_analytics,
        n_chars: rec.n_chars,
      }));
    const meanLen = h.analyticChars.length
      ? Math.round(h.analyticChars.reduce((s, x) => s + x, 0) / h.analyticChars.length)
      : 0;
    const meanSentences = h.analyticSentences.length
      ? +(h.analyticSentences.reduce((s, x) => s + x, 0) / h.analyticSentences.length).toFixed(2)
      : 0;
    const wordsK = h.analyticTotalWords / 100; // per-100-word rate
    return {
      blocks: h.blocks,
      cards:  h.cards,
      analytics: h.analytics,
      chars: h.totalChars,
      avg_chars_per_block: h.blocks ? Math.round(h.totalChars / h.blocks) : 0,
      median_chars_per_block: pct50(h.blockChars),
      p90_chars_per_block: pct90(h.blockChars),
      avg_card_position: h.cardPositions.length
        ? +(h.cardPositions.reduce((s, x) => s + x, 0) / h.cardPositions.length).toFixed(3)
        : null,
      // Analytics formatting/style
      analytic_avg_chars: meanLen,
      analytic_median_chars: pct50(h.analyticChars),
      analytic_p90_chars: pct90(h.analyticChars),
      analytic_avg_sentences: meanSentences,
      analytic_pct_with_bold:      h.analytics ? +(100 * h.analyticBoldCount      / h.analytics).toFixed(1) : 0,
      analytic_pct_with_underline: h.analytics ? +(100 * h.analyticUnderlineCount / h.analytics).toFixed(1) : 0,
      analytic_pct_with_highlight: h.analytics ? +(100 * h.analyticHighlightCount / h.analytics).toFixed(1) : 0,
      analytic_pct_numbered_list:  h.analytics ? +(100 * h.analyticNumberedCount  / h.analytics).toFixed(1) : 0,
      analytic_em_dash_per_100w:   wordsK ? +(h.analyticEmDashChars / wordsK).toFixed(2) : 0,
      analytic_allcaps_per_100w:   wordsK ? +(h.analyticAllCapsHits / wordsK).toFixed(2) : 0,
      analytic_top_bigram:  topGrams(h.analyticBigram,  TOP_N),
      analytic_top_trigram: topGrams(h.analyticTrigram, TOP_N),
      top_abbreviations: Object.entries(h.abbreviations)
                          .sort((a, b) => b[1] - a[1])
                          .slice(0, TOP_N),
      top_heading_tokens: topGrams(h.headingTokens, TOP_N),
      top_heading_paths:  topGrams(h.headingPaths,  TOP_N),
      top_markers:        Object.entries(h.markerCounts)
                            .filter(([, n]) => n >= MIN_MARK)
                            .sort((a, b) => b[1] - a[1])
                            .slice(0, TOP_N),
      top_opener_1g: topGrams(h.opener1g, TOP_N),
      top_opener_2g: topGrams(h.opener2g, TOP_N),
      top_opener_3g: topGrams(h.opener3g, TOP_N),
      top_opener_4g: topGrams(h.opener4g, TOP_N),
      top_opener_5g: topGrams(h.opener5g, TOP_N),
      top_closer_3g: topGrams(h.closer3g, TOP_N),
      top_closer_5g: topGrams(h.closer5g, TOP_N),
      top_bigram:    topGrams(h.bigram,   TOP_N),
      top_trigram:   topGrams(h.trigram,  TOP_N),
      top_fourgram:  topGrams(h.fourgram, TOP_N),
      exemplars,
    };
  }

  summary.all = summarizeAccum(all);
  for (const [cat, h] of Object.entries(cats)) {
    summary.categories[cat] = summarizeAccum(h);
  }

  // ── Write JSON ────────────────────────────────────────────────────────
  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(summary, null, 2));
  console.log(`[analyze] wrote ${OUT_JSON} (${fs.statSync(OUT_JSON).size} bytes)`);

  // ── Write Markdown report ─────────────────────────────────────────────
  const lines2 = [];
  const W = (s = '') => lines2.push(s);

  W('# Blockfile Corpus Analysis');
  W('');
  W(`Generated ${summary.generated_at}`);
  W(`Source: \`${path.basename(IN)}\``);
  W('');
  W('## Corpus shape');
  W('');
  W(formatTable([
    ['blocks',         all.blocks],
    ['cards',          all.cards],
    ['analytic chunks', all.analytics],
    ['total chars',    all.totalChars.toLocaleString()],
    ['avg chars/block', summary.all.avg_chars_per_block],
    ['median chars/block', summary.all.median_chars_per_block],
    ['p90 chars/block', summary.all.p90_chars_per_block],
  ], ['metric', 'value']));
  W('');

  W('## Categories');
  W('');
  W(formatTable(
    Object.entries(summary.categories).map(([cat, s]) => [
      cat, s.blocks, s.cards, s.analytics, s.avg_chars_per_block,
      s.avg_card_position == null ? '-' : s.avg_card_position,
    ]),
    ['category', 'blocks', 'cards', 'analytics', 'avg chars', 'avg card pos (0=open,1=close)']
  ));
  W('');
  W('Card position interpretation: <0.4 = cards usually open blocks (read-then-explain pattern); >0.6 = cards usually close (analytic-then-cite pattern); ~0.5 = mixed.');
  W('');

  W('## Analytics — language & formatting fingerprint');
  W('');
  W('How analytic chunks are *written*, not just what they contain.');
  W('');
  W(formatTable([
    ['avg chars',                summary.all.analytic_avg_chars],
    ['median chars',             summary.all.analytic_median_chars],
    ['p90 chars',                summary.all.analytic_p90_chars],
    ['avg sentences',            summary.all.analytic_avg_sentences],
    ['% with **bold**',          summary.all.analytic_pct_with_bold + '%'],
    ['% with <u>underline</u>',  summary.all.analytic_pct_with_underline + '%'],
    ['% with ==highlight==',     summary.all.analytic_pct_with_highlight + '%'],
    ['% numbered-list shape',    summary.all.analytic_pct_numbered_list + '%'],
    ['em-dashes / 100 words',    summary.all.analytic_em_dash_per_100w],
    ['ALLCAPS hits / 100 words', summary.all.analytic_allcaps_per_100w],
  ], ['metric', 'value']));
  W('');
  W('Per-category formatting density:');
  W('');
  W(formatTable(
    Object.entries(summary.categories).map(([cat, s]) => [
      cat,
      s.analytic_avg_chars,
      s.analytic_avg_sentences,
      s.analytic_pct_with_bold + '%',
      s.analytic_pct_with_underline + '%',
      s.analytic_pct_with_highlight + '%',
      s.analytic_pct_numbered_list + '%',
      s.analytic_em_dash_per_100w,
      s.analytic_allcaps_per_100w,
    ]),
    ['cat', 'avg chars', 'avg sent', '% bold', '% under', '% hl', '% list', 'em-dash/100w', 'CAPS/100w']
  ));
  W('');

  W('## Top debate abbreviations in analytics');
  W('');
  W('Frequency of canonical jargon (DA, CP, NC, AC, AT, T, FW, K, etc.). High-rank tokens should be in the chat\'s tokenizer / not glossed.');
  W('');
  W(formatTable(
    summary.all.top_abbreviations.slice(0, TOP_N).map(([t, n]) => [t, n]),
    ['abbrev', 'count']
  ));
  W('');

  W('## Analytics-only top trigrams');
  W('');
  W('Trigrams computed over analytic-chunk text only (excludes card body prose). Cleaner signal for "how the debater talks" than corpus-wide body trigrams.');
  W('');
  W(formatTable(
    summary.all.analytic_top_trigram.slice(0, TOP_N).map(([g, n]) => [g, n]),
    ['trigram', 'count']
  ));
  W('');

  W('## Top analytic markers (canonical)');
  W('');
  W('Counts ≥ ' + MIN_MARK + '. These are the marker tokens that lead analytic chunks ("AT", "1]", "OV", etc.). High frequency = a recurring move worth a hardcoded template.');
  W('');
  W(formatTable(
    summary.all.top_markers.slice(0, TOP_N).map(([m, n]) => [m, n]),
    ['marker', 'count']
  ));
  W('');

  W('## Top heading-path tokens (corpus-wide)');
  W('');
  W('Vocabulary of block names. Tells you what kinds of responses get pre-written.');
  W('');
  W(formatTable(
    summary.all.top_heading_tokens.slice(0, TOP_N).map(([t, n]) => [t, n]),
    ['token', 'count']
  ));
  W('');

  W('## Top opener phrases in analytic prose');
  W('');
  W('Recurring sentence starts in analytic chunks. These are templated move-openers — bake into chat prompt as "phrase like a debater" priors.');
  W('');
  W('### 3-grams');
  W(formatTable(
    summary.all.top_opener_3g.slice(0, TOP_N).map(([g, n]) => [g, n]),
    ['opener', 'count']
  ));
  W('');
  W('### 5-grams');
  W(formatTable(
    summary.all.top_opener_5g.slice(0, Math.min(20, TOP_N)).map(([g, n]) => [g, n]),
    ['opener', 'count']
  ));
  W('');

  W('## Top closer phrases in analytic prose');
  W('');
  W('Recurring sentence ENDS — voters, impact-tags, link-extends.');
  W('');
  W(formatTable(
    summary.all.top_closer_5g.slice(0, Math.min(20, TOP_N)).map(([g, n]) => [g, n]),
    ['closer', 'count']
  ));
  W('');

  W('## Top body trigrams (full corpus)');
  W('');
  W('Generic linguistic priors across all block prose.');
  W('');
  W(formatTable(
    summary.all.top_trigram.slice(0, TOP_N).map(([g, n]) => [g, n]),
    ['trigram', 'count']
  ));
  W('');

  // Per-category drill-down
  W('## Per-category opener fingerprints');
  W('');
  for (const [cat, s] of Object.entries(summary.categories)) {
    W(`### ${cat} (${s.blocks} blocks)`);
    W('');
    W('Top markers:');
    W(formatTable(
      s.top_markers.slice(0, 10).map(([m, n]) => [m, n]),
      ['marker', 'count']
    ));
    W('');
    W('Top opener 3-grams:');
    W(formatTable(
      s.top_opener_3g.slice(0, 15).map(([g, n]) => [g, n]),
      ['opener', 'count']
    ));
    W('');
    W('Top body trigrams:');
    W(formatTable(
      s.top_trigram.slice(0, 15).map(([g, n]) => [g, n]),
      ['trigram', 'count']
    ));
    W('');
    W('Exemplar blocks (high-density anchors):');
    W(formatTable(
      s.exemplars.map(e => [
        e.file.slice(0, 40),
        (e.heading_path || []).join(' › ').slice(0, 60) || '(none)',
        e.n_cards,
        e.n_analytics,
        e.n_chars,
      ]),
      ['file', 'heading', 'cards', 'analytics', 'chars']
    ));
    W('');
  }

  W('## How to use this');
  W('');
  W('1. **Markers** with high count → bake a template per marker into the chat prompt ("when responding to an `AT - X` request, structure as: claim · warrant · impact").');
  W('2. **Opener phrases** → seed the chat with starter scaffolds ("They say…", "Even if conceded…").');
  W('3. **Closer phrases** → terminal phrasing for voters/extensions ("outweighs and turns case", "this is a voter").');
  W('4. **Heading paths** → response taxonomy (what kinds of blocks debaters expect to find).');
  W('5. **Exemplars** → few-shot anchors for the prompt; pick 2-3 per category.');
  W('');

  fs.mkdirSync(path.dirname(OUT_MD), { recursive: true });
  fs.writeFileSync(OUT_MD, lines2.join('\n'));
  console.log(`[analyze] wrote ${OUT_MD} (${fs.statSync(OUT_MD).size} bytes)`);

  // ── Bake patterns into prompts/chatPatterns.js ────────────────────────
  if (SHOULD_BAKE) {
    const baked = bakeChatPatterns(summary);
    fs.mkdirSync(path.dirname(OUT_BAKE), { recursive: true });
    fs.writeFileSync(OUT_BAKE, baked);
    console.log(`[analyze] baked ${OUT_BAKE} (${fs.statSync(OUT_BAKE).size} bytes)`);
  }

  // brief stdout summary
  console.log('');
  console.log('[analyze] === SUMMARY ===');
  console.log(`  blocks    : ${all.blocks}`);
  console.log(`  cards     : ${all.cards}`);
  console.log(`  analytics : ${all.analytics}`);
  console.log(`  unique markers (≥${MIN_MARK}): ${summary.all.top_markers.length}`);
  console.log(`  top marker: ${summary.all.top_markers[0]?.[0] || '(none)'} (${summary.all.top_markers[0]?.[1] || 0}×)`);
  console.log(`  top body trigram: "${summary.all.top_trigram[0]?.[0] || '(none)'}" (${summary.all.top_trigram[0]?.[1] || 0}×)`);
  console.log('');
  console.log(`  report: ${OUT_MD}`);
  console.log(`  json:   ${OUT_JSON}`);
  if (SHOULD_BAKE) console.log(`  bake:   ${OUT_BAKE}`);
}

// ── Bake — emit a JS module the chat route imports ────────────────────────
//
// Generates server/prompts/chatPatterns.js — a pure module exporting
// system-prompt fragments derived from the corpus stats. Mirrors how
// cardCutter.js carries HARDCODED_CALIBRATION baked from analyzeLibraryCards.
// The module is regenerable with `node analyzeBlockfiles.js --bake`.

function bakeChatPatterns(summary) {
  const all = summary.all;
  const cats = summary.categories;

  // Whitelist of canonical short markers (≤4 chars). Anything else under
  // 5 chars is almost always a leftover enumerator fragment ("NON" from
  // "1. NON-...", etc.) — drop those rather than ship them as guidance.
  const SHORT_OK = new Set(['AT','FW','OV','EXT','UV','UQ','UNQ','IL','MPX','IMP','SQ','NL','NR','RE','CP','DA','RVI','PIC','XO','AFC','CSA','TT','RT','LD','K','TURN']);
  const topMarkers = all.top_markers
    .filter(([m, n]) => n >= MIN_MARK && m.length <= 30 && (m.length >= 5 || SHORT_OK.has(m)))
    .slice(0, 12)
    .map(([m]) => m);
  const topJargon = all.top_abbreviations.slice(0, 20).map(([t]) => t);

  // Per-category one-line shape descriptors
  const catLines = Object.entries(cats).map(([name, s]) => {
    const len = s.analytic_avg_chars;
    const sent = s.analytic_avg_sentences;
    const u = s.analytic_pct_with_underline;
    const b = s.analytic_pct_with_bold;
    const list = s.analytic_pct_numbered_list;
    return `//   ${name.padEnd(16)} avg ${len} chars / ${sent} sent · ${u}% underline · ${b}% bold · ${list}% numbered`;
  }).join('\n');

  // Compose human-style brief — terse, prescriptive, mirrors corpus norms.
  const styleBrief =
    `STYLE — match the conventions of ${all.analytics.toLocaleString()} hand-cut analytic chunks across ${all.blocks.toLocaleString()} blockfiles:\n` +
    `- Default analytic length: ~${all.analytic_avg_chars} chars / ${all.analytic_avg_sentences} sentences. Single-claim answers can be 1–2 sentences.\n` +
    `- ${all.analytic_pct_numbered_list}% of analytics use a numbered-list shape (1./2./3.) — use it whenever you make multi-part arguments.\n` +
    `- ${all.analytic_pct_with_underline}% use <u>underline</u> on emphasized phrases. Underline the load-bearing claims; do not underline whole sentences.\n` +
    `- ${all.analytic_pct_with_bold}% use **bold** for the loudest 1–2 claims of a chunk. Use sparingly.\n` +
    `- Em-dashes (—) are conventional for offset clauses (~${all.analytic_em_dash_per_100w}/100 words).\n` +
    `- ALLCAPS is conventional for transition tokens like REASONABILITY, INNOVATION, NO LINK, NO IMPACT (~${all.analytic_allcaps_per_100w}/100 words).\n` +
    `- Lead chunks with a canonical marker when applicable: ${topMarkers.join(', ')}.\n` +
    `- Never gloss debate jargon — these are first-class vocabulary: ${topJargon.join(', ')}.`;

  const formatBrief =
    `FORMATTING — corpus-confirmed patterns:\n` +
    `- Frontline / overview / extension: lead with a CLAIM, then numbered warrants, then the IMPACT.\n` +
    `- "AT — X" responses: open by quoting/naming the opposing claim, then numbered turns/no-links.\n` +
    `- Cards open blocks (avg position ${all.avg_card_position == null ? '~0.15' : all.avg_card_position.toFixed(2)} from start, 0=open · 1=close) — when citing evidence, place the card first then layer analysis after.\n` +
    `- Theory analytics are short and punchy (~170 chars); K analytics are long and prosaic (~1,250 chars). Match the user's evident genre.`;

  const ts = new Date().toISOString();

  return `'use strict';
// AUTO-GENERATED by \`node server/scripts/analyzeBlockfiles.js --bake\`.
// DO NOT HAND-EDIT. Regenerate after re-running the analyzer.
//
// Source: ${path.relative(path.dirname(OUT_BAKE), OUT_JSON).replace(/\\/g, '/')}
// Generated: ${ts}
// Corpus: ${all.blocks} blocks, ${all.analytics} analytics, ${all.cards} cards.
//
// Per-category style shape:
${catLines}

const CHAT_STYLE_BRIEF = ${JSON.stringify(styleBrief)};

const CHAT_FORMATTING_BRIEF = ${JSON.stringify(formatBrief)};

const TOP_MARKERS = ${JSON.stringify(topMarkers)};

const DEBATE_JARGON = ${JSON.stringify(topJargon)};

const CORPUS_META = ${JSON.stringify({
    blocks: all.blocks,
    analytics: all.analytics,
    cards: all.cards,
    generated_at: ts,
    avg_analytic_chars: all.analytic_avg_chars,
    avg_analytic_sentences: all.analytic_avg_sentences,
    pct_numbered: all.analytic_pct_numbered_list,
    pct_underline: all.analytic_pct_with_underline,
    pct_bold: all.analytic_pct_with_bold,
  }, null, 2)};

module.exports = {
  CHAT_STYLE_BRIEF,
  CHAT_FORMATTING_BRIEF,
  TOP_MARKERS,
  DEBATE_JARGON,
  CORPUS_META,
};
`;
}

main();
