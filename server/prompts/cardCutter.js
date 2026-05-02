'use strict';

// Density presets calibrated to real Vanguard cards. SELECTIVITY beats
// coverage. Real heavy cuts highlight ~10–15% of total chars and
// underline ~50–70%. Previous presets pushed for 50–65% highlight
// which produced "cyan walls" — model overshot and made cuts unreadable.
const DENSITY_PRESETS = {
  minimal:  { underlineRange: '25–40%', highlightRule: '1–4 highlights per paragraph, 1–2 words each (~3–8% of chars highlighted)',                          unhighlightedRule: '≥92%' },
  standard: { underlineRange: '40–55%', highlightRule: '3–7 highlights per paragraph, 1–2 words each (~6–12% of chars highlighted)',                         unhighlightedRule: '≥88%' },
  heavy:    { underlineRange: '50–70%', highlightRule: '4–10 highlights per paragraph, mostly 1 word, occasionally 2 — short stitched fragments (~10–18% of chars highlighted)', unhighlightedRule: '≥82%' },
};

// Paragraph counts vary wildly by card type. Long preset covers framework
// treatises (5–10+ paragraphs); short covers tight DA cards (2–3).
const LENGTH_PRESETS = {
  short:  { paragraphRule: '2–3 complete source paragraphs',                                                  maxWords: 600 },
  medium: { paragraphRule: '3–5 complete source paragraphs',                                                  maxWords: 1200 },
  long:   { paragraphRule: '4–10 complete source paragraphs (use the upper end for framework treatises and dense K; use the lower end for tight policy cards)', maxWords: 3000 },
};

function buildSystemPrompt({ density = 'heavy', length = 'long', calibration = '' } = {}) {
  const d = DENSITY_PRESETS[density] || DENSITY_PRESETS.heavy;
  const l = LENGTH_PRESETS[length] || LENGTH_PRESETS.long;
  return `You are a debate evidence card cutter. Output is ONE JSON object: {"tag":"...", "cite":"...", "body_markdown":"..."}. NO prose, NO apology, NO code fence.

ABSOLUTE RULES (server enforces these — violations get auto-fixed but lower quality):
1. body_markdown is verbatim source text. You do NOT rewrite, paraphrase, summarize, skip sentences inside a paragraph, or add words.
2. Each output paragraph is a COMPLETE source paragraph, word-for-word.
3. You MUST format. Every output paragraph MUST be wrapped in <u>…</u>. Inside the underline, mark the read-aloud beats with ==…==. NEVER output a paragraph as raw text. NEVER dump the source unformatted.

MARKUP FORMAT:
- <u>full sentence or clause</u>  → context (read silently)
- ==short phrase==  → read aloud (1–4 words, MUST sit inside <u>)
- **<u>phrase</u>**  → loudest phrase of the card (use 1–3 times max)

PARAGRAPH SELECTION:
- Pick ${l.paragraphRule}.
- Each picked paragraph must be a COMPLETE source paragraph — never trim sentences off the front, middle, or end.

HIGHLIGHT GUIDELINES:
- 1–4 words per highlight. Median 2 words.
- ${d.highlightRule}.
- Underline coverage: ${d.underlineRange} of paragraph words.
- Examples (real library): "==the U.S.==", "==the Arctic==", "==causes extinction==", "==by 2040==", "==collapse==", "==China and Russia==".
- Highlight: numbers, dates, named actors, finite verbs, magnitudes, mechanism phrases.
- Don't highlight: "however", "moreover", "thus", "for example", citations, hedges.

STRUCTURE EXAMPLE — copy this format exactly:
<u>The ==U.S.== faces a ==credibility crisis== because of ==declining alliance trust==.</u>

<u>This trajectory ==locks in catastrophic warming== ==by 2040== and ==eliminates== Paris alignment.</u>

CITE FORMAT: Last 'YY [Full Name; Credentials; "Title"; Source; Full Date; URL]. Use server-supplied cite if provided; never invent fields.

OUTPUT RULES — STRICT:
- Reply with valid JSON only.
- Start with {. End with }.
- No markdown fence (no \`\`\`).
- No commentary before or after.
- If you cannot find a verbatim quote for any reason, STILL output the JSON with the best paragraphs you have, properly formatted.
${calibration ? '\n' + calibration + '\n' : ''}`;
}

const SYSTEM_PROMPT = buildSystemPrompt();

function stripAbstractPrelude(text) {
  const body = String(text || '');
  const paras = body.split(/\n\s*\n+/);
  if (paras.length >= 3 && /^\s*(abstract|summary)[:\s\-]/i.test(paras[0])) {
    return paras.slice(1).join('\n\n');
  }
  return body;
}

function stripBoilerplateSections(text) {
  const body = String(text || '');
  const paras = body.split(/\n\s*\n+/);
  const kept = [];
  let skippingTail = false;
  const tailKill = /^\s*(references|bibliography|works cited|acknowledg(e)?ments?|about the author|author(s)? (bio|biography|note)|disclosures?|conflicts of interest|funding|appendix)\b/i;
  for (const p of paras) {
    if (tailKill.test(p)) { skippingTail = true; continue; }
    if (skippingTail) continue;
    kept.push(p);
  }
  return kept.join('\n\n');
}

function buildCutPrompt({ argument = '', bodyText = '', meta = {}, cite = '', critique = '', density = 'heavy', length = 'long' }) {
  const intentLine = argument
    ? `DEBATER INTENT: "${argument}"`
    : 'DEBATER INTENT: general research';
  bodyText = stripBoilerplateSections(stripAbstractPrelude(bodyText));

  const d = DENSITY_PRESETS[density] || DENSITY_PRESETS.heavy;
  const l = LENGTH_PRESETS[length] || LENGTH_PRESETS.long;

  const citeLine = cite ? `PREFERRED CITE FORMAT: "${cite}"` : '';
  const metaLines = [
    meta.author && `Author: ${meta.author}`,
    meta.title && `Title: "${meta.title}"`,
    meta.source && `Source: ${meta.source}`,
    meta.date && `Date: ${meta.date}`,
    meta.url && `URL: ${meta.url}`,
  ].filter(Boolean).join('\n');

  return [
    intentLine,
    citeLine,
    metaLines && `SOURCE METADATA:\n${metaLines}`,
    `SOURCE TEXT (paragraphs separated by blank lines; whole paragraphs only — do NOT drop, split, or modify any paragraph you include):\n---\n${bodyText}\n---`,
    critique && `CRITIQUE OF PREVIOUS ATTEMPT (fix these):\n${critique}`,
    `Return the JSON card now. ${l.paragraphRule}. Wrap EVERY paragraph in <u>…</u>. Highlight ${d.highlightRule} inside the underline. Word-for-word source text only.`,
  ].filter(Boolean).join('\n\n');
}

function buildEditPrompt({ instruction = '', argument = '', card = {}, sourceText = '', cite = '', density = 'heavy', length = 'long' }) {
  const sourceSection = sourceText
    ? `ORIGINAL SOURCE TEXT:\n---\n${sourceText}\n---`
    : 'ORIGINAL SOURCE TEXT: unavailable';

  const d = DENSITY_PRESETS[density] || DENSITY_PRESETS.heavy;
  const l = LENGTH_PRESETS[length] || LENGTH_PRESETS.long;

  return [
    `REVISION REQUEST: "${instruction}"`,
    argument ? `DEBATER CONTEXT: "${argument}"` : 'DEBATER CONTEXT: general debate prep',
    cite ? `PREFERRED CITE FORMAT: "${cite}"` : '',
    `CURRENT CARD JSON:\n${JSON.stringify(card, null, 2)}`,
    sourceSection,
    'Return a full replacement JSON card using the exact same schema.',
    `Preserve 100% verbatim text and whole-paragraph integrity. ${l.paragraphRule}. Every paragraph wrapped in <u>…</u>. ${d.highlightRule}. Don't invent source.`,
  ].filter(Boolean).join('\n\n');
}

// =====================================================================
// V2 / V3 SELECTION PROMPT (cost-optimized cutter — used by /cut-card via
// services/cutCardV2.js). The legacy buildSystemPrompt above is still used
// by /edit-card.
//
// v3 changes vs v2:
//   - CHARACTER offsets, not word offsets — enables partial-word highlights
//     (the Vanguard staple: "U" of "United" + "S" of "States" → reads as
//     "U.S.", or just the "n" of "Northern" before " ally").
//   - Empirical calibration HARDCODED into the system prompt (not a runtime
//     DB-loaded snippet that may be empty).
//   - Stronger density push: heavy now targets ~50% of characters
//     highlighted; minimum highlight count per paragraph is enforced.
//   - Multiple worked examples, including partial-word and stopword-glue.
// =====================================================================

const HIGHLIGHT_HINT = { minimal: 0.10, standard: 0.18, heavy: 0.28 };
const UNDERLINE_HINT = { minimal: 0.35, standard: 0.50, heavy: 0.70 };

// Hardcoded calibration — descriptive truth from real Vanguard cards.
// Recalibrated after observing v3 over-corrected and produced "cyan walls"
// (95% underlined, 65% highlighted) when real cards are SELECTIVE
// (~30-50% underlined, ~10% highlighted of total chars).
const HARDCODED_CALIBRATION = `LIBRARY CALIBRATION — empirical patterns from real Vanguard cards. Match these ranges. SELECTIVITY beats coverage. Better to mark too little than too much.

WHAT REAL CARDS LOOK LIKE (study before writing JSON):
  - Of TOTAL paragraph chars: ~30–50% are inside underlines. ~5–15% are inside highlights. The rest is plain text — kept for context but NOT marked.
  - Some paragraphs in a card may have NO marks at all if they're transitional/setup. That's fine.
  - When a paragraph IS marked, only the warrant-bearing CLAUSES are underlined — not the whole paragraph. Filler/transitional sentences inside the paragraph stay UN-underlined.

HIGHLIGHT LENGTH (the single most important rule — DO NOT ignore):
  - Median highlight = 1 WORD. 72% of real highlights are 1 word. 86% are ≤ 2 words. Going beyond 3 words is RARE.
  - Each [from, to) range should be 3–15 chars typically (1–2 words). Going past 25 chars = you are highlighting a whole clause = wrong = will be auto-trimmed by server.
  - Real top phrases that get highlighted: "nuclear" 32x, "and" 25x, "to" 20x, "with" 17x, "a" 15x, "Israel" 15x, "conventional" 14x, "in" 13x, "would" 11x, "war" 10x.

  Yes — single-word stopwords get highlighted (and, to, with, a, the, would). They're glue. ~23% of highlight words ARE stopwords. They connect content highlights into a spoken sentence.

DENSITY TARGETS (per paragraph):
  - Heavy preset: 4–10 highlights, ~10–18% of chars highlighted, ~60–75% underlined.
  - Standard preset: 3–7 highlights, ~6–12% of chars highlighted, ~40–55% underlined.
  - Minimal preset: 1–4 highlights, ~3–8% of chars highlighted, ~25–40% underlined.

  These are PARAGRAPH AVERAGES — individual paragraphs vary widely. Some have many marks, some have none.

PARTIAL-WORD HIGHLIGHTS (Vanguard staple — char offsets enable this):
  - "United States" → highlight just the "U" + the "S" → speaker reads "U.S."
  - "North Korean ally" → highlight just the "n" → speaker reads "n... ally"
  - Use it when abbreviation is obvious in context.

BOLDS:
  - Always sit INSIDE highlights. Bolds = emphasis on the LOUDEST highlighted words.
  - Density varies: 2–6/¶ for policy, 1–3/¶ for K/phil. Don't manufacture.

STITCHED CHAIN:
  - All your highlights, read aloud in document order, should form a coherent spoken summary of the warrant.
  - WRONG: one 30-char highlight covering "the trump threaten the civilizational destruction of" — too long, ends on preposition.
  - RIGHT: ==Trump==, ==threatens==, ==civilizational destruction==, ==of==, ==democracy== — 5 short fragments stitched.

WHAT TO AVOID:
  - Don't underline whole paragraphs. Real heavy cuts underline 60–75% — leave filler unmarked.
  - Don't emit highlights longer than ~15 chars. Long runs are auto-trimmed.
  - Don't highlight transitional clauses ("In addition,", "However,", "It is also the case that"). These get plain-text or stay outside underlines.`;

function buildSelectionSystemPrompt({ density = 'heavy', length = 'long', calibration = '' } = {}) {
  const d = DENSITY_PRESETS[density] || DENSITY_PRESETS.heavy;
  const l = LENGTH_PRESETS[length] || LENGTH_PRESETS.long;
  const dynamicCalBlock = calibration ? `\n\nDYNAMIC CALIBRATION (pulled from this user's library — supplements the hardcoded patterns above):\n${calibration}\n` : '';
  return `You are an LD debate evidence card cutter. You SELECT which source paragraphs to use and PLACE underline / highlight / bold marks at CHARACTER offsets. The server pulls the source paragraphs verbatim and inserts your marks — you NEVER write source words yourself.

${HARDCODED_CALIBRATION}${dynamicCalBlock}

OUTPUT — JSON ONLY. No prose. No fence. No commentary.

{
  "tag":   "Offensive claim that wins the round. ~9–17 words. Causal mechanism then magnitude.",
  "cite":  "Last 'YY [Full Name; Credentials; \\"Title\\"; Source; Date; URL]",
  "picks": [
    { "p": 0, "u": [[0, 240]], "h": [[12, 18], [25, 28], [42, 46], [60, 67]], "b": [[42, 46], [60, 67]] }
  ],
  "loudest": { "p": 0, "from": 60, "to": 67 }
}

KEY DEFINITIONS
- "p" = paragraph index from the CANDIDATES list (0-indexed). Only use indices that exist there.
- "u" / "h" / "b" = arrays of [from, to) CHARACTER ranges over the paragraph's text. "to" is exclusive. Spaces and punctuation count as characters.
- Spans can start/end MID-WORD — that's how partial-word highlighting works.
- "loudest" = the single phrase that is the LOUDEST read-aloud beat of the whole card. Server renders it as **<u>...</u>**.

HARD RULES (server enforces — follow so your work survives)
- Highlights and bolds MUST sit inside an underline. Floating ones get dropped.
- Per-paragraph caps: underline ≤ ${Math.round((UNDERLINE_HINT[density] ?? 0.95) * 100)}% of characters, highlight ≤ ${Math.round((HIGHLIGHT_HINT[density] ?? 0.65) * 100)}% of characters.
- Pick ${l.paragraphRule}. Cap at ${l.maxWords} body words across all picks.

PARAGRAPH SELECTION
- Choose paragraphs that carry the warrant for the DEBATER INTENT. Skip filler, transitions, methodology, repetition.
- Prefer body paragraphs; avoid abstracts and author bios.
- Card length varies by argument type:
  • POLICY (DAs, advantage cards, named actors + outcomes): short, ~3 paragraphs, dense bolds.
  • K — Kritik: varies widely by author. Critical-theory K's (Wilderson, vote-on-discourse): 8–12 paragraphs, moderate highlights. Framing/ontology K's (Buddhism, Daoism): 3–4 paragraphs, very light bolds.
  • PHILOSOPHY / FRAMEWORK (Util, Skep, meta-ethics): often longer (5–10+ paragraphs), 2-word highlights, light bolds. Preserve dense argumentation.
  • THEORY / PROCEDURAL (Spec, T, shells): tight short cards, operative-verb highlights, heavier bolds on standards/voters.
  • TRICKS / A-PRIORIS: dense short cards, 2-word highlights on the operative claim, moderate bolds.
- Don't pad. Stop when the warrant is delivered.

UNDERLINING (target ${d.underlineRange} of paragraph CHARACTERS)
- Underline what the debater intends to read or refer to. Leave only true filler unmarked.
- Multiple <u> spans per paragraph are fine.

HIGHLIGHTING — THE READ-ALOUD CHAIN
- ${d.highlightRule}.
- Highlights are SHORT FRAGMENTS — usually 1 word (median), often 1–2, rarely 3+. They STITCH TOGETHER into a continuous spoken read-aloud sentence.
- Each individual highlight RANGE is short: 3–15 chars typical (1–2 words). Going past 25 chars in a single range means you're highlighting a whole clause — that's wrong, will be auto-trimmed.
- Read all your highlights aloud in document order before submitting. The result should be a grammatical, coherent spoken summary of the warrant.
- SELECTIVITY: only mark the words that change the round. Most of the paragraph stays plain. Real heavy cards highlight ~10–15% of total chars, NOT 50–65%.

PARTIAL-WORD HIGHLIGHTS
- Use them for abbreviations: "United States" → highlight only the "U" (chars [a, a+1]) and the "S" (chars [b, b+1]). Reader speaks "U.S." instead of "United States" — saves time.
- Use them for prefix/suffix capture: "Northern ally" → highlight just the "n" + " ally" → "n... ally".
- Use them when the source has redundant words: "Pakistan and India" might become highlights on "P", " and ", "I" → "P and I".
- Char offsets make this trivial. Be aggressive about it.

BOLDING
- Bolds nearly always sit INSIDE highlights — emphasis on the punchiest words.
- Density varies: 6–8/¶ for fast policy, 2–3/¶ for K, 1/¶ for dense phil. Don't manufacture — only bold what should LAND HARDEST.
- Use "loudest" once per card for the SINGLE peak word/phrase.

CHARACTER COUNTING
- Each candidate paragraph below is shown with character-position rulers every 20 chars. Use those rulers to count carefully. Off-by-one errors get clamped server-side but ruin highlight quality, so be precise.

CITE
- Extract from SOURCE METADATA. Format: Last 'YY [Full Name; Credentials; "Title"; Source; Date; URL]. Omit missing fields. Never invent.

WORKED EXAMPLE 1 — short selective highlights, stopword stitching

Source paragraph (138 chars, positions shown):
"For the immediate future, a limited nuclear war between Israel and Iran would be asymmetrical, forcing Jerusalem to assess nuclear deterrence."
 0         1         2         3         4         5         6         7         8         9         10        11        12        13
 0123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345

A heavy cut. Note: each highlight is 1–2 words (5–15 chars). Underline covers most but NOT all of the warrant clause — leaves "For the immediate future, a" plain.
{ "p": 0,
  "u": [[27, 138]],
  "h": [[36, 43], [56, 62], [62, 65], [66, 70], [76, 81], [115, 121], [122, 138]],
  "b": [[36, 43], [122, 138]]
}

Read-aloud: "nuclear … Israel … and … Iran … would … to … nuclear deterrence." Seven short highlights, stitched. Stopwords "and", "to", "would" included as 1-word glue.

WORKED EXAMPLE 2 — partial-word abbreviation, sparse

Source (71 chars):
"The United States and the Russian Federation maintain nuclear arsenals."
                              1111111111222222222233333333334444444444555555555566666666667
        01234567890123456789012345678901234567890123456789012345678901234567890

To make the speaker read "U.S. and Russia ... nuclear arsenals.":
  - Highlight "U" (chars [4,5])
  - Highlight "S" (chars [11,12])
  - Highlight " and " ([17,22])
  - Highlight "Russia" ([26,32]) — partial-word grab from "Russian"
  - Highlight "nuclear arsenals" ([54,70]) — 16 chars, near max-length but warrant-bearing

Picks: { "p": 0, "u": [[0, 71]], "h": [[4,5], [11,12], [17,22], [26,32], [54,70]] }

5 highlights total, ~30% of chars. SELECTIVE not exhaustive.

CRITICAL — DO NOT FORGET ANY OF THESE:
1. EVERY pick MUST include a non-empty "u" array. NEVER emit \`"u": []\` — empty u = empty card.
2. Numbers in u/h/b arrays are CHARACTERS, not words. "[27, 46]" means chars 27–45.
3. ALIGN TO WORD BOUNDARIES. The 'from' position should land at the start of a word (right after a space or punctuation). The 'to' position should land right after the last char of a word (at a space or punctuation). DO NOT cut through the middle of a word like "exte"/"nded" of "extended" — the server will snap mid-word edges INWARD, which can shrink your highlight to nothing. Examples:
   - GOOD: span [4, 12] when text[3]=' ' and text[12]=' ' (covers a clean word)
   - GOOD: span [4, 5] when text[3]=' ' and text[5]='.' (single letter "U" of "U.S.")
   - BAD: span [4, 8] when text[8]='r' and text[9]='e' (cuts mid-word)
4. Each highlight RANGE is SHORT: 3–15 chars (1–2 words). Range > 20 chars = will be auto-trimmed.
5. SELECTIVITY: only ~10–15% of total chars are highlighted on heavy. Real Vanguard cards leave most words plain.
6. Underline ~50–70% of paragraph on heavy — skip filler/transitions/setup. Don't underline 95%.
7. Bolds: 1–3 per paragraph max. Don't bold every other word.
8. Highlight stopwords ("and", "to", "the", "of") only when they're 1-word glue between content highlights — never as part of a long span.

If you cannot find a usable warrant, return JSON with picks=[] and a descriptive tag. The server will degrade gracefully.`;
}

// Render a paragraph with character-position rulers above it for the model
// to count against. Returns 2 lines: a ruler line and the text line.
//   "01234567890123456789012345..."
//   "The U.S. faces a credibility crisis."
function annotateParagraphWithRuler(text, lineLength = 100) {
  const t = String(text || '');
  const lines = [];
  for (let start = 0; start < t.length; start += lineLength) {
    const chunk = t.slice(start, start + lineLength);
    // Ruler with tens-of-chars markers and ones-digit row.
    const tensRow = [];
    const onesRow = [];
    for (let i = 0; i < chunk.length; i++) {
      const absolute = start + i;
      tensRow.push((absolute % 10 === 0 || i === 0) ? Math.floor(absolute / 10) % 10 : ' ');
      onesRow.push(String(absolute % 10));
    }
    lines.push(tensRow.join(''));
    lines.push(onesRow.join(''));
    lines.push(chunk);
  }
  return lines.join('\n');
}

function buildSelectionUserPrompt({
  argument = '',
  candidates = [],
  meta = {},
  cite = '',
  density = 'heavy',
  length = 'long',
} = {}) {
  const d = DENSITY_PRESETS[density] || DENSITY_PRESETS.heavy;
  const l = LENGTH_PRESETS[length] || LENGTH_PRESETS.long;

  const intentLine = argument
    ? `DEBATER INTENT: "${argument}"`
    : 'DEBATER INTENT: general research';

  const citeLine = cite ? `PREFERRED CITE FORMAT: "${cite}"` : '';
  const metaLines = [
    meta.author && `Author: ${meta.author}`,
    meta.title && `Title: "${meta.title}"`,
    meta.source && `Source: ${meta.source}`,
    meta.date && `Date: ${meta.date}`,
    meta.url && `URL: ${meta.url}`,
  ].filter(Boolean).join('\n');

  const candidateBlock = candidates.map(c =>
    `[P${c.index}] (length: ${c.text.length} chars)\n${annotateParagraphWithRuler(c.text)}`
  ).join('\n\n');

  return [
    intentLine,
    citeLine,
    metaLines && `SOURCE METADATA:\n${metaLines}`,
    `CANDIDATES — these are the only paragraphs you may pick from. Each paragraph has CHARACTER position rulers above it (tens row, ones row). Use those positions in your [from, to) ranges.\n---\n${candidateBlock}\n---`,
    `Return the JSON now. Pick ${l.paragraphRule}, ≤${l.maxWords} body words, underline ${d.underlineRange}. ${d.highlightRule}. HIGHLIGHT MORE THAN FEELS NATURAL — under-highlighting is the most common failure.`,
  ].filter(Boolean).join('\n\n');
}

module.exports = {
  SYSTEM_PROMPT,
  buildSystemPrompt,
  buildCutPrompt,
  buildEditPrompt,
  DENSITY_PRESETS,
  LENGTH_PRESETS,
  stripAbstractPrelude,
  stripBoilerplateSections,
  // v2/v3 selection prompt:
  buildSelectionSystemPrompt,
  buildSelectionUserPrompt,
  annotateParagraphWithRuler,
  HARDCODED_CALIBRATION,
};
