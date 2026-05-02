'use strict';

// Density presets recalibrated against 85 hand-cut Vanguard cards.
// IMPORTANT: real cards highlight FAR more than typical AI defaults.
// On heavy density, ~50–65% of paragraph CHARACTERS are inside ==..==
// marks. The model's persistent failure mode is under-highlighting —
// these presets push hard against that.
const DENSITY_PRESETS = {
  minimal:  { underlineRange: '60–75%', highlightRule: '4–10 highlights per paragraph, mostly 1–2 words each (median 1, ~20–30% of characters highlighted)',  unhighlightedRule: '≥70%' },
  standard: { underlineRange: '75–90%', highlightRule: '6–15 highlights per paragraph, mostly 1–2 words each (median 1, ~35–45% of characters highlighted)',  unhighlightedRule: '≥55%' },
  heavy:    { underlineRange: '85–95%', highlightRule: '10–25 highlights per paragraph, mostly 1–2 words each — short stitched fragments — TARGET ~50–65% OF PARAGRAPH CHARACTERS HIGHLIGHTED', unhighlightedRule: '≥35%' },
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

const HIGHLIGHT_HINT = { minimal: 0.30, standard: 0.45, heavy: 0.65 };
const UNDERLINE_HINT = { minimal: 0.60, standard: 0.80, heavy: 0.95 };

// Hardcoded calibration — derived from analyzing 85 hand-cut Vanguard cards
// (33 policy + 52 K/phil/theory) totaling 2703 highlights and 1782 bolds.
// This is the DESCRIPTIVE empirical truth the model should match. It is
// always shipped in the system prompt; runtime calibration (if available)
// supplements it but does NOT replace it.
const HARDCODED_CALIBRATION = `LIBRARY CALIBRATION — these are the empirical patterns from 85 hand-cut Vanguard cards (2703 highlights, 1782 bolds) you MUST reproduce:

DENSITY (this is much higher than typical AI defaults — DO NOT under-highlight):
  - Heavy preset: ~50–65% of paragraph CHARACTERS are inside highlights. Every paragraph has 10–25 highlight runs.
  - Standard preset: ~35–45% of characters highlighted. Every paragraph has 6–15 runs.
  - Minimal preset: ~20–30% of characters highlighted. Every paragraph has 4–10 runs.

HIGHLIGHT LENGTH (the single most important pattern):
  - Median highlight = 1 WORD. 72% of all highlights are 1 word. 86% are ≤ 2 words. P90 = 3 words.
  - Real top phrases (frequency in 85 cards): "nuclear" 32x, "and" 25x, "to" 20x, "with" 17x, "a" 15x, "Israel" 15x, "conventional" 14x, "in" 13x, "Iran" 13x, "the" 11x, "would" 11x, "war" 10x, "could" 9x, "of" 9x.

  Notice: 1-word highlights of stopwords (and, to, with, a, the, would, of) are NORMAL and FREQUENT. 23% of all highlight words are stopwords. They GET highlighted because they connect the spoken read-aloud chain into grammatical English.

PARTIAL-WORD HIGHLIGHTS (Vanguard-specific staple — supported by char offsets):
  - "United States" → highlight just the "U" of "United" + the "S" of "States" → speaker reads "U.S." (saves 11 chars of speech time)
  - "Northern ally" → highlight just the "n" of "Northern" + the rest of " ally" or similar → speaker reads "n... ally" or shorthand
  - "Pakistan and India" → highlight "P", "and", "I" only → speaker reads "P and I"
  - This is character-precise. Use it when the abbreviation is obvious in context.

BOLDS:
  - Always nested inside highlights. Bolds are emphasis on the loudest READ words.
  - Density varies by source: 6–8 bolds/¶ for policy, 2–3/¶ for K, 1/¶ for dense philosophy.

THE STITCHED CHAIN (universal rule, all card types):
  - All highlights from the entire card, read aloud in document order, must form a GRAMMATICAL, COHERENT SPOKEN SENTENCE that delivers the warrant in ~25% the words of the source.
  - Highlights are not isolated noun phrases. They are SPEECH FRAGMENTS that connect.
  - WRONG: highlight "the trump threaten the civilizational destruction of" then stop. That's an 8-word run that ends mid-sentence on a preposition. Bad.
  - RIGHT: highlight ==Trump==, ==threatens==, ==civilizational destruction==, ==of=, ==democracy==. Five 1–2-word highlights that stitch into "Trump threatens civilizational destruction of democracy." A complete spoken sentence.`;

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

HIGHLIGHTING — THE READ-ALOUD CHAIN (most important rule)
- ${d.highlightRule}.
- Highlights are SHORT FRAGMENTS — usually 1 word (median), often 1–2, rarely 3+. They STITCH TOGETHER into a continuous spoken read-aloud sentence.
- Read all your highlights ALOUD in document order before submitting. The result MUST be a grammatical, coherent spoken sentence that delivers the warrant. If it ends on a preposition, "the", "and", "of", "to" — KEEP GOING and add the next highlight to complete the thought.
- COVERAGE: the model that came before you under-highlighted. Highlight FAR MORE than feels natural. Aim for 50%+ of the characters of underlined regions. Stopwords are part of the chain — include them.

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

WORKED EXAMPLE 1 — heavy density, stopword stitching

Source paragraph (one line, char positions shown):
"For the immediate future, a limited nuclear war between Israel and Iran would be asymmetrical, forcing Jerusalem to assess nuclear deterrence."
 0         1         2         3         4         5         6         7         8         9         10        11        12        13
 0123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345

A heavy cut (~17 highlights, ~50% chars highlighted):
{ "p": 0,
  "u": [[0, 138]],
  "h": [[27, 46], [56, 62], [62, 65], [66, 70], [76, 81], [102, 111], [112, 114], [115, 121], [122, 138]],
  "b": [[27, 46], [56, 62], [102, 111], [122, 138]]
}

Read-aloud chain: "limited nuclear war … Israel … and … Iran … would … Jerusalem … to … assess … nuclear deterrence." A complete spoken sentence built from short fragments including the stopwords "and", "to", "would" as glue.

WORKED EXAMPLE 2 — partial-word abbreviation

Source: "The United States and the Russian Federation maintain nuclear arsenals."
                              1111111111222222222233333333334444444444555555555566666666667
        01234567890123456789012345678901234567890123456789012345678901234567890

To make the speaker read "U.S. and Russia maintain nuclear arsenals.":
  - Highlight "U" (chars [4,5]) of "United"
  - Highlight "S" (chars [11,12]) of "States"
  - Highlight " and " ([17,22])
  - Highlight "Russia" ([26,32]) — partial-word grab from "Russian"
  - Highlight "maintain nuclear arsenals." ([45,71])

Picks: { "p": 0, "u": [[0, 71]], "h": [[4,5], [11,12], [17,22], [26,32], [45,71]] }

Stitched read: "U S and Russia maintain nuclear arsenals." (Speaker fluently says "U.S.")

CRITICAL — DO NOT FORGET ANY OF THESE:
1. EVERY pick MUST include a non-empty "u" array. Default if unsure: \`"u": [[0, paragraphLength]]\` to underline the whole paragraph. NEVER emit \`"u": []\` — the server drops every highlight that isn't inside an underline, so empty u = empty card.
2. Numbers in u/h/b arrays are CHARACTERS, not words. The example "[27, 46]" means chars 27 through 45, NOT words 27 through 45. Refer to the rulers under each paragraph.
3. Include MANY highlights — heavy density = ~10–25 per paragraph. The most common AI failure mode is emitting only 2–3 long highlights. Don't do that. Emit MANY short ones.
4. Highlight stopwords ("and", "to", "the", "of", "with", "would") freely when they're glue between content highlights — that's how the read-aloud chain stays grammatical.

If you cannot find a usable warrant, still return JSON with picks=[] and a tag describing the source. The server will degrade gracefully.`;
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
