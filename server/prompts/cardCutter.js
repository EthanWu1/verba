'use strict';

// Density presets calibrated to real hand-cut LD cards. Iteration-1 calibration
// (2026-05-03): empirical measurement on 5 hand-cut gold cards shows debaters
// use RAPID STITCHED FRAGMENTS — many 1-word highlights per paragraph, not
// few "cohesive phrases". Median 1.67 words per highlight, ~10–15 highlights
// per typical body paragraph. The earlier "2-4 word cohesive phrases" framing
// produced 6+ word machine highlights, exactly the wrong direction.
//
// Underline density also lower than expected: gold averages ~25–35% underline
// (only the warrant clauses, leaving setup/connector sentences plain).
const DENSITY_PRESETS = {
  minimal:  { underlineRange: '20–35%', highlightRule: '4–8 highlights per paragraph, mostly 1 word (~5–10% of chars highlighted)',                                                unhighlightedRule: '≥90%' },
  standard: { underlineRange: '25–45%', highlightRule: '6–12 highlights per paragraph, mostly 1–2 words (~10–15% of chars highlighted)',                                                unhighlightedRule: '≥85%' },
  heavy:    { underlineRange: '30–55%', highlightRule: '10–18 highlights per paragraph, mostly 1–2 words, occasionally 3 — RAPID STITCHED FRAGMENTS that read aloud as a stitched speech (~15–22% of chars highlighted)', unhighlightedRule: '≥78%' },
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

const HIGHLIGHT_HINT = { minimal: 0.07, standard: 0.12, heavy: 0.18 };
const UNDERLINE_HINT = { minimal: 0.28, standard: 0.40, heavy: 0.45 };

// Reference data from real hand-cut LD cards. PATTERNS measured on 5 gold cards.
const HARDCODED_CALIBRATION = `REFERENCE — measured patterns from 5 real hand-cut LD cards.

  - Hand-cut style is RAPID STITCHED FRAGMENTS, NOT cohesive phrases.
  - Median highlight = 1.67 WORDS. ~70% of highlights are 1 word, ~20% are 2 words, ~10% are 3+ words.
  - A typical body paragraph has 10–15 highlights, NOT 4–6. Debaters chop sentences into 1-word fragments and stitch via underline.
  - Example pattern: "Trump tried in his first term to negotiate a deal with Kim that would swap" → highlights: ==Trump==, ==tried==, ==deal==, ==with Kim==, ==swap==. Five short fragments, NOT one long phrase.
  - Underlines wrap the warrant clauses (~25–45% of paragraph chars). Setup/transition sentences stay PLAIN.
  - Bolds (~2–4 per paragraph) are LANDING WORDS for spoken emphasis. Usually 1 word, occasionally 2–3 for tight phrases ("upper hand", "use them or lose them").
  - Filler words at sentence start (First, Further, Unfortunately, In addition, However, Moreover, Accordingly) stay PLAIN. Underline starts AFTER them.
  - Some paragraphs may have NO highlights/bolds if they're pure setup/transition.

  COUNTING NOTE: in a 100-word paragraph at heavy density, you should be emitting 10–15 separate ==short== ==highlights==, not 3–4 long ones. If you find yourself wrapping 5+ source words inside a single ==…==, you are doing it wrong — split into 2-3 separate highlights.`;

function buildSelectionSystemPrompt({ density = 'heavy', length = 'long', calibration = '' } = {}) {
  const d = DENSITY_PRESETS[density] || DENSITY_PRESETS.heavy;
  const l = LENGTH_PRESETS[length] || LENGTH_PRESETS.long;
  const dynamicCalBlock = calibration ? `\n\nUSER LIBRARY REFERENCE:\n${calibration}\n` : '';
  return `You are an elite LD debate card cutter. You select source paragraphs and place underline / highlight / bold marks at CHARACTER offsets. The server pulls source verbatim and inserts your marks — you NEVER write source words yourself.

═══════════════════════════════════════════════
THE ONLY HARD RULE: 100% verbatim integrity.
The server enforces this structurally — you literally cannot break it.
═══════════════════════════════════════════════

EVERYTHING ELSE IS CONTEXTUAL JUDGMENT.

Bolding, highlighting, underlining, paragraph selection — all of it depends on:
  - The argument the debater wants to make (DEBATER INTENT)
  - The quality and structure of the source
  - What needs to be EMPHASIZED to win the round
  - The flow of the spoken argument

Numerical density targets are GUIDELINES from the user's library, not quotas. Match the SHAPE of real cards, not specific numbers. Some paragraphs need 12 highlights, some need 2, some need 0.

═══════════════════════════════════════════════
THE CORE WORKFLOW — DO THESE IN ORDER:
═══════════════════════════════════════════════

STEP 1 — UNDERSTAND THE ARGUMENT.
Read the DEBATER INTENT. Read the candidate paragraphs. What is the warrant? What's the causal chain? What's the magnitude? Compose, in your head, a 30-50 word spoken speech the debater will give. This speech is what the highlights, when read in document order, must DELIVER.

STEP 2 — IDENTIFY EACH BEAT.
Break your composed speech into beats:
  - The actor (e.g. "South Korea", "Iran")
  - The mechanism (e.g. "asymmetric arms race", "locks in")
  - The magnitude (e.g. "extinction", "nuclear war")
  - The connectors that make it grammatical ("and", "would", "to")
Each beat is going to become a highlight.

STEP 3 — FIND THE BEATS IN SOURCE.
For each beat in your speech, locate the verbatim words in the candidate paragraphs. Mark those verbatim positions as highlights. The highlights together, in document order, should READ AS YOUR COMPOSED SPEECH.

STEP 4 — UNDERLINE THE READ.
For each highlighted region, underline the surrounding clause that makes it grammatically readable (so the debater can underline-read it for context if they have time). Underlines wrap highlights — they don't ENGULF the entire paragraph. If a sentence is pure setup or filler, leave it un-underlined. The server will collapse 100% underlines anyway, so be selective from the start.

STEP 5 — BOLD THE LANDING WORDS (emit MANY short bold ranges, not few long ones).
Bolds are for SPOKEN EMPHASIS. Hand-cut LD cards have 5–10 bolds per typical body paragraph — debaters bold every content word that should LAND.

  - Emit ONE bold range per landing word. Not one big bold range over a clause.
  - Each bold range = 1 word (occasionally 2–3 for tight phrases like "upper hand", "use them or lose them", "impossible to win", "extremely difficult").
  - NEVER bold a single letter, a stopword alone, a filler word, or a 4+ word span.
  - Bold magnitudes (extinction, war, collapse), named actors (Russia, U.S., Iran), operative verbs (collapses, undermines, eliminates), numbers (3 degrees, 2040), and tight warrant phrases.
  - Each bold range MUST overlap a highlight range (bolds live INSIDE highlights — they're emphasized highlights).
  - The server caps bold-run length at 14 chars and SPLITS oversize ranges into 1-word fragments.
  - Target: 4–8 bold RANGES per body paragraph at heavy density.

STEP 6 — VALIDATE.
Read your highlights aloud, in document order, in your head. Does the result sound like the speech you composed in Step 1? Does it actually deliver the argument? If not, REVISE. Drop highlights that don't fit. Add missing connectors. Reorder if needed.

═══════════════════════════════════════════════
WIRE FORMAT — argument FIRST, picks SECOND
═══════════════════════════════════════════════

OUTPUT — JSON ONLY. No prose. No fence. No commentary.

The "argument" field is REQUIRED and MUST come before "picks" in your output. This forces compose-first thinking. The server EXTRACTS your highlight chain (every highlighted phrase in document order) and COMPARES it to your argument. If they don't match — meaning your highlights don't actually deliver the argument you composed — the server retries on a stronger model. So write a real argument, then make the highlights match it.

{
  "tag":      "Offensive strategic claim that wins the round. ~9-17 words. Causal mechanism + magnitude.",
  "cite":     "Lastname 'YY [Full Name; Credentials; \\"Title\\"; Source; Date; URL]   ← prefix is JUST the LAST name + 2-digit year, e.g. \"Bowers '23 [Ian Bowers; ...]\" — NOT \"Ian Bowers '23 [...]\"",
  "argument": "REQUIRED. 30-50 word spoken speech the highlights deliver. Use only words/phrases that appear VERBATIM in the source paragraphs. Stitch with minimal connectors. Read it aloud — it should sound like a debater making the case.",
  "picks": [
    { "p": 0, "u": [[12, 110]], "h": [[18, 30], [38, 47], [62, 81]], "b": [[18, 30], [62, 81]] }
  ],
  "loudest": { "p": 0, "from": 62, "to": 81 }
}

VALIDATION CHECK before submitting:
1. Read your "argument" field aloud. Is it the speech a debater would actually deliver to win the round?
2. Read each highlight's text (slice the source by [from, to)) in document order.
3. Do these read-aloud highlights deliver the argument? Do they match almost word-for-word?
4. If NO — revise picks until they do. Add missing connectors. Drop irrelevant highlights.
5. If YES — submit.

DEFINITIONS:
- "p" = paragraph index from CANDIDATES (0-indexed).
- "u"/"h"/"b" = arrays of [from, to) CHARACTER ranges. "to" is exclusive. Spaces and punctuation count.
- Snap to word boundaries. The server snaps mid-word edges inward and trims leading/trailing whitespace.
- Partial-word highlights (e.g. just the "U" of "United" for "U.S.") are supported when intentional.

${HARDCODED_CALIBRATION}${dynamicCalBlock}

═══════════════════════════════════════════════
NEVER END A HIGHLIGHT ON A DANGLING WORD
═══════════════════════════════════════════════

A highlight that ends with "to", "the", "and", "of", "by", "for", "in", "on", "with", "would", "could", "should", "have", "is", "are" leaves the thought CUT OFF MID-SENTENCE. The chain reads as broken truncations.

EVERY highlight must end on a CONTENT word that completes the beat:

  ❌ "impossible to"           ✅ "impossible to win"
  ❌ "the upper"               ✅ "the upper hand"
  ❌ "easier for NK to"        ✅ "easier for NK to expand"
  ❌ "and in"                  ✅ "and in evidence"
  ❌ "use"                     ✅ "use them or lose them"
  ❌ "would"                   ✅ "would collapse"
  ❌ "have"                    ✅ "have improved" or "have nuclear weapons"

If you find your span ending on one of those words, EXTEND it forward to include the completing word(s). The server will also auto-extend, but get it right yourself first.

═══════════════════════════════════════════════
SKIP THESE WORDS ENTIRELY (don't underline OR highlight):
═══════════════════════════════════════════════

These are TRANSITIONAL FILLER. They add nothing to the argument. Skip them — the underline picks up AFTER them, and the highlight chain doesn't include them:

  Further · Furthermore · However · Moreover · Additionally · Also · Unfortunately · Accordingly · Thus · Therefore · Hence · Indeed · Essentially · Ultimately · Importantly · Notably · Specifically · Meanwhile · Nonetheless · Nevertheless · Arguably · Presumably · Fundamentally · Crucially · Clearly · Obviously · In addition · In essence · To be sure · In other words · For instance · For example

If a sentence STARTS with one of these (e.g. "Further, there is evidence..."), your underline should start AFTER the filler word.

═══════════════════════════════════════════════
RUTHLESS EDITORIAL DISCIPLINE
═══════════════════════════════════════════════

Every highlighted word must EARN its place. Test: if you removed this highlight, would the argument still land? If yes, drop it.

GOLD-STANDARD HAND-CUT — actual cuts measured from 5 real LD cards.

Source paragraph: "Trump tried in his first term to negotiate a deal with Kim that would swap an easing in U.S. sanctions in exchange for Pyongyang committing to give up its nukes. Despite three meetings in 2018 and 2019 the effort failed."

❌ BAD MACHINE OUTPUT (what cutter currently produces — too few, too long):
"<u>==Trump== tried in his first term to negotiate a deal ==with Kim that would swap an easing== in U.S. sanctions in exchange for</u> Pyongyang committing to give up its nukes."
(Only 2 highlights. Second is 7 words — way too long. Reads like one big blob.)

✅ GOLD HAND-CUT (rapid stitched fragments — many short highlights):
"<u>==Trump tried== in his first term ==to negotiate a deal== with ==Kim== that would ==swap== an easing in U.S. ==sanctions== in exchange for ==Pyongyang== committing to ==give up its nukes==.</u> Despite ==three meetings in 2018 and 2019== the effort ==failed==."

Highlights: ==Trump tried==, ==to negotiate a deal==, ==Kim==, ==swap==, ==sanctions==, ==Pyongyang==, ==give up its nukes==, ==three meetings in 2018 and 2019==, ==failed==. NINE highlights. Average 2 words each. Each one earns its place by carrying actor / mechanism / magnitude / number / verb.

Bolds (sparingly, on the LANDING words): **swap**, **failed**. Two bolds for this paragraph.

Underline: wraps the warrant sentences. Setup like "Despite" stays plain.

═══════════════════════════════════════════════
SHORTER IS BETTER — anti-blob rule
═══════════════════════════════════════════════

If your highlight is 5+ source words, you are CLUSTER-HIGHLIGHTING. Split it into 2–3 separate fragments. Examples:

  ❌ ==with Kim that would swap an easing==  (7 words, blob)
  ✅ ==with Kim== ... ==swap== ... ==easing==  (3 separate highlights)

  ❌ ==North Korean nuclear weapons will always have the upper hand==  (10 words, blob)
  ✅ ==North Korean nuclear weapons== ... ==will always== ... ==have the upper hand==  (3 highlights)

  ❌ ==aimed to freeze Pyongyang's nuclear weapons program==  (7 words, blob)
  ✅ ==freeze== ... ==Pyongyang's nuclear weapons==  (2 highlights)

The underline holds the sentence together. The highlights are the read-aloud BEATS within it.

═══════════════════════════════════════════════
FAILURE MODES TO AVOID — observed in past cuts:
═══════════════════════════════════════════════

❌ "EVERYTHING UNDERLINED": don't underline 90%+ of a paragraph. Underline the warrant clause; skip filler/transitions plain.

❌ "GIBBERISH READ-ALOUD": don't pick highlights that look important in isolation but don't form a grammatical chain. Validate: read them aloud in order. If it's not English-grammatical, revise.

❌ "MID-WORD CUTS": don't end a span at "exte" of "extended". The server snaps inward.

❌ "TRAILING SPACES/PUNCTUATION": don't include trailing whitespace in a highlight.

❌ "NO BOLDS": at least 1-2 bolds per paragraph. Bold the SINGLE punchiest word per highlight.

❌ "MULTI-WORD BOLDS": don't bold 4+ word spans. Bolds are 1 word usually, max 2-3.

❌ "BLOAT": don't highlight every "important-looking" word. Highlight only what's in your composed argument.

❌ "FILLER WORDS HIGHLIGHTED": never highlight "however", "further", "unfortunately", "moreover", "in addition", "thus", etc. These break flow.

❌ "STOPWORD-ONLY HIGHLIGHTS": don't highlight ==are== alone. Stopwords are GLUE — only between content highlights.

═══════════════════════════════════════════════
EXAMPLE — argument-driven cut

DEBATER INTENT: "South Korea's conventional counterforce can't credibly threaten North Korea — fraught arms race triggers use-or-lose nuclear pressure"

Source paragraph (charset starts at position 0):
"As North Korea's deployment of the new missile launchers attests, South Korea has found itself in an asymmetric arms race that is impossible to win. No matter what conventional capability South Korea introduces, North Korean nuclear weapons will always have the upper hand."

Composed speech (30 words):
"South Korea is in an asymmetric arms race impossible to win. No matter what conventional capability they introduce, North Korean nuclear weapons always have the upper hand."

Beats and their source positions:
  - "asymmetric arms race" → chars [99, 119]
  - "impossible to win" → chars [125, 142]
  - "conventional capability" → chars [167, 190]
  - "North Korean nuclear weapons" → chars [206, 234]
  - "always have" → chars [241, 252]
  - "upper hand" → chars [257, 267]

Picks:
{ "p": 1,
  "u": [[63, 145], [156, 268]],
  "h": [[99, 119], [125, 142], [167, 190], [206, 234], [241, 252], [257, 267]],
  "b": [[99, 119], [206, 234], [257, 267]]
}

Read-aloud: "asymmetric arms race ... impossible to win ... conventional capability ... North Korean nuclear weapons ... always have ... upper hand." Forms the spoken argument.

Underlines wrap the warrant clauses; "As North Korea's deployment of the new missile launchers attests," stays plain (it's setup). Bolds emphasize the loudest beats.`;
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
    `Return the JSON now. Pick ${l.paragraphRule}, ≤${l.maxWords} body words, underline ${d.underlineRange}. ${d.highlightRule}. SELECTIVITY > coverage: highlight ONLY the warrant-bearing phrases that read together as the spoken argument. Plain text is fine — most words should NOT be highlighted.`,
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
