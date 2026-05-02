'use strict';

// Density presets recalibrated against 85 hand-cut Vanguard cards.
// K, theory, philosophy, and trick cards each have their OWN distinct
// patterns and vary widely within each category — so the presets below
// describe a spectrum (minimal/standard/heavy) rather than a card type.
// Examples per file (descriptive, not prescriptive):
//   Policy DA/1AC:           heavy, dense bolds, 1-word highlights.
//   K (Nuclear Property):    long cards, moderate density, ~3 bolds/¶.
//   K (Buddhism):            short cards, light bolds, 1-word highlights.
//   Phil (Util, Skep):       longer cards, 2-word highlights, light bolds.
//   Theory/procedural:       tight cards, heavy bolds on standards/voters.
//   Tricks/skep-killers:     dense single/short cards, 2-word highlights.
// Across all: ~27% of highlight words are stopwords (glue in the chain).
const DENSITY_PRESETS = {
  minimal:  { underlineRange: '40–55%', highlightRule: '3–7 highlights per paragraph, 1–3 words each (light density — phil treatises, ontology K)', unhighlightedRule: '≥80%' },
  standard: { underlineRange: '50–65%', highlightRule: '5–10 highlights per paragraph, mostly 1–2 words each (median 1–2, P75 2–3)',                unhighlightedRule: '≥70%' },
  heavy:    { underlineRange: '60–75%', highlightRule: '8–15 highlights per paragraph, mostly 1–2 words each — short fragments that stitch into a coherent read-aloud chain (policy / dense K)', unhighlightedRule: '≥65%' },
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
// V2 SELECTION-ONLY PROMPT (cost-optimized cutter — used by /cut-card via
// services/cutCardV2.js). The legacy buildSystemPrompt above is still used
// by /edit-card.
//
// In v2 the LLM no longer writes source text — it only emits paragraph
// indices and word-offset spans. The server pulls source paragraphs
// verbatim and inserts marks, so paragraph integrity and verbatim are
// structural guarantees, not prompt instructions.
// =====================================================================

const MAX_RUN_WORDS_HINT = 5;
const UNDERLINE_HINT = { minimal: 0.40, standard: 0.55, heavy: 0.72 };
const HIGHLIGHT_HINT = { minimal: 0.20, standard: 0.25, heavy: 0.30 };

function buildSelectionSystemPrompt({ density = 'heavy', length = 'long', calibration = '' } = {}) {
  const d = DENSITY_PRESETS[density] || DENSITY_PRESETS.heavy;
  const l = LENGTH_PRESETS[length] || LENGTH_PRESETS.long;
  const calBlock = calibration ? `\n\n${calibration}\n` : '';
  return `You are an LD debate evidence card cutter. You SELECT which source paragraphs to use and PLACE underline / highlight / bold marks at word offsets. The server pulls the source paragraphs verbatim and inserts your marks — you NEVER write source words yourself.${calBlock}

OUTPUT — JSON ONLY. No prose. No fence. No commentary.

{
  "tag":   "Offensive claim that wins the round. ~9–17 words. Two sentences if needed: causal mechanism then magnitude.",
  "cite":  "Last 'YY [Full Name; Credentials; \\"Title\\"; Source; Date; URL]",
  "picks": [
    { "p": 3, "u": [[0, 22]], "h": [[3, 4], [5, 6], [9, 11]], "b": [[3, 4], [9, 11]] }
  ],
  "loudest": { "p": 3, "from": 9, "to": 11 }
}

KEY DEFINITIONS
- "p" = paragraph index from the CANDIDATES list below (0-indexed). Only use indices that exist there.
- "u" / "h" / "b" = arrays of [from, to) word ranges over the paragraph's whitespace-tokenised words. "to" is exclusive.
  Example: paragraph "The U.S. faces a credibility crisis." → words [The, U.S., faces, a, credibility, crisis.]. To highlight "credibility" use [4,5]. To highlight "credibility crisis." use [4,6].
- "loudest" = the single phrase that is the LOUDEST READ-ALOUD beat of the whole card. Server emits it as **<u>...</u>**.

HARD RULES (server enforces — follow them so your work survives)
- Highlights and bolds MUST sit inside an underline. Floating ones get dropped.
- Per-paragraph caps: underline ≤ ${Math.round((UNDERLINE_HINT[density] ?? 0.72) * 100)}%, highlight ≤ ${Math.round((HIGHLIGHT_HINT[density] ?? 0.30) * 100)}% of paragraph words.
- Pick ${l.paragraphRule}. Cap at ${l.maxWords} body words across all picks.

PARAGRAPH SELECTION
- Choose paragraphs that carry the warrant for the DEBATER INTENT. Skip filler, transitions, methodology, repetition.
- Prefer body paragraphs; avoid abstracts and author bios.
- Card length varies a lot by argument type. The user picks length via the LENGTH preset (short/medium/long) you're already given — match that. Do NOT pad. When the warrant is delivered, stop.

CARD-TYPE PATTERNS (descriptive — let the DEBATER INTENT and density/length presets guide the actual choice; styles overlap)
- POLICY (DAs, advantage cards, naming actors + outcomes — "U.S. credibility collapse", "X causes Y war"): short cards (~3 paragraphs), highlights mostly 1 word, dense bolds (~6–8/¶), fast punchy read-aloud chain.
- KRITIK (K) — varies WIDELY by author: dense critical-theory K's (Wilderson, vote-on-discourse) often run 8–12 paragraphs with moderate highlights; framing/ontology K's (Buddhism, Daoism) often run 3–4 paragraphs with very light bolds. Match the style of the source.
- PHILOSOPHY / FRAMEWORK (Util, Skep, deontology shells, meta-ethics): often longer cards (5–10+ paragraphs for framework treatises), highlights tend to 2 words, bolds variable but often light (1–3/¶). Preserve philosophical texture — don't fragment dense argumentation.
- THEORY / PROCEDURAL (Spec, T, framework shells): typically tight — short violation card with operative-verb highlights, heavier bolds on the standards / voters. Insufficient empirical sample to characterize density precisely; lean on the user's preset.
- TRICKS / A-PRIORIS / SKEP-KILLERS: dense single-paragraph or short-multi-paragraph blips, 2-word highlights on the operative claim and warrant, moderate bolds. Treat as policy-density-dialed-up.

The constant across ALL card types: the read-aloud chain (highlights stitched in document order) reads as a coherent spoken sentence that delivers the warrant.

UNDERLINING (${d.underlineRange} per paragraph)
- Underline what the debater intends to read or refer to. Leave only true filler unmarked.
- Multiple <u> spans per paragraph are fine; the underlined region can span most of a sentence.

HIGHLIGHTING — THE READ-ALOUD CHAIN (this is the most important rule)
- ${d.highlightRule}.
- Highlights are NOT noun phrases or "complete thoughts". They are SHORT FRAGMENTS — typically a single word, sometimes two — that STITCH TOGETHER across the paragraph (and across the whole card) into a continuous read-aloud sentence.
- Read all your highlights aloud in document order. They should form a grammatical, coherent argument that delivers the warrant in 1/4 the words of the original.
- HIGHLIGHT FREELY: operative verbs (causes, triggers, undermines, locks in), magnitude nouns (extinction, war, collapse), numbers/years/percentages, named entities (U.S., China, Israel, Iran, NATO), connector words (to, of, in, with, and, would, could, the, a) — INCLUDE the connector when it's part of the spoken read-aloud chain. Real cards highlight stopwords ~23% of the time precisely because they're the glue of speech.
- Highlights can be 1 word, 2 words, occasionally 3. Going beyond 3 is rare; runs over 5 words get auto-trimmed.
- Example of stitched highlights from a real card: ==Israel==, ==need==, ==to==, ==assess==, ==nuclear deterrence==, ==regarding==, ==biological==, ==war==, ==EMP==, ==massive==, ==conventional==, ==attacks==. Read aloud: "Israel … need to assess nuclear deterrence regarding … biological war … EMP … massive conventional attacks." Each highlight is 1–2 words; together they speak the warrant.

BOLDING
- Bolds nearly always sit INSIDE highlights — they're emphasis on the most punchy words inside an already-highlighted phrase.
- Bold density varies by source style: as dense as 6–8/¶ for fast punchy policy cards, as light as 1/¶ for dense philosophical treatises. Don't manufacture bolds — only bold what should LAND HARDEST when read aloud.
- Use "loudest" once per card for the SINGLE peak word/phrase the debater wants the judge to hear above all others.

WORD COUNTING
- Each candidate is shown with words prefixed: "[0]The [1]U.S. [2]faces …". Use those numbers directly. DO NOT re-tokenise.

CITE
- Extract from SOURCE METADATA. Format: Last 'YY [Full Name; Credentials; "Title"; Source; Date; URL]. Omit missing fields. Never invent.

WORKED EXAMPLE — STUDY THE STITCHING

Source paragraph (24 words, 0-indexed):
[0]For [1]the [2]immediate [3]future, [4]a [5]limited [6]nuclear [7]war [8]between [9]Israel [10]and [11]Iran [12]would [13]be [14]asymmetrical, [15]forcing [16]Jerusalem [17]to [18]assess [19]nuclear [20]deterrence [21]against [22]Iranian [23]threats.

A heavy cut:
{ "p": 0,
  "u": [[0, 24]],
  "h": [[5, 8], [9, 10], [10, 12], [12, 13], [16, 17], [17, 18], [18, 19], [19, 21], [22, 24]],
  "b": [[5, 8], [9, 10], [16, 17], [19, 21], [22, 24]]
}

Read-aloud chain: "limited nuclear war … Israel … and Iran … would … Jerusalem … to … assess … nuclear deterrence … Iranian threats." Notice ==and==, ==to==, ==would== are stopwords that GET highlighted because they connect the spoken chain. That's the Vanguard style.

If you cannot find a usable warrant, still return JSON with picks=[] and a tag describing the source. The server will degrade gracefully.`;
}

// Render a single paragraph with each word prefixed by its 0-based index.
// e.g. "The U.S. faces a crisis." →
//      "[0]The [1]U.S. [2]faces [3]a [4]crisis."
function indexParagraphWords(text) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  return words.map((w, i) => `[${i}]${w}`).join(' ');
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
    `[P${c.index}] ${indexParagraphWords(c.text)}`
  ).join('\n\n');

  return [
    intentLine,
    citeLine,
    metaLines && `SOURCE METADATA:\n${metaLines}`,
    `CANDIDATES — these are the only paragraphs you may pick from. Word indices are pre-labelled; use them directly.\n---\n${candidateBlock}\n---`,
    `Return the JSON now. Pick ${l.paragraphRule}, ≤${l.maxWords} body words, underline ${d.underlineRange}, ${d.highlightRule}.`,
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
  // v2 selection prompt:
  buildSelectionSystemPrompt,
  buildSelectionUserPrompt,
  indexParagraphWords,
};
