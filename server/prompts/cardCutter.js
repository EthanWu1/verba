'use strict';

// Density presets calibrated against 1000 real library cards (median underline
// coverage 21%, median highlight 0% per paragraph but avg 8%, median highlight
// length 2 words, P75 3, P90 5). Reality: highlights are SPARSE 1–3 word picks,
// underlines cover ~25–40% of words, MOST words stay un-marked.
const DENSITY_PRESETS = {
  minimal:  { underlineRange: '20–30%', highlightRule: '2–4 highlight runs per paragraph, each 1–3 words', unhighlightedRule: '≥92%' },
  standard: { underlineRange: '25–40%', highlightRule: '3–5 highlight runs per paragraph, each 1–3 words (P75=3, P90=5)', unhighlightedRule: '≥88%' },
  heavy:    { underlineRange: '35–55%', highlightRule: '4–7 highlight runs per paragraph, each 1–4 words', unhighlightedRule: '≥82%' },
};

const LENGTH_PRESETS = {
  short:  { paragraphRule: '4–6 complete source paragraphs',  maxWords: 800 },
  medium: { paragraphRule: '6–9 complete source paragraphs',  maxWords: 1500 },
  // 'long' is the default: longer cuts so the warrant has room to breathe.
  long:   { paragraphRule: '8–14 complete source paragraphs (err LONG — better to keep too many than too few)', maxWords: 5000 },
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
  return `You are an LD debate evidence card cutter. You select WHICH source paragraphs to include and WHERE to place underline / highlight / bold marks. The server pulls the source paragraphs verbatim and inserts your marks at word offsets — you NEVER write source words yourself.${calBlock}

OUTPUT — JSON ONLY, matching the schema. No prose. No code fence. No commentary.

{
  "tag":   "Offensive strategic claim that wins the round (1–2 sentences). Matches DEBATER INTENT.",
  "cite":  "Last 'YY [Full Name; Credentials; \\"Title\\"; Source; Date; URL]",
  "picks": [
    { "p": 3, "u": [[0, 22]], "h": [[3, 6], [9, 12]], "b": [[9, 12]] },
    { "p": 7, "u": [[0, 18]], "h": [[2, 4], [11, 14]], "b": [[2, 4]] }
  ],
  "loudest": { "p": 3, "from": 9, "to": 12 }
}

KEY DEFINITIONS
- "p" is the paragraph index from the CANDIDATES list below (0-indexed). You MAY only use indices that exist in CANDIDATES.
- "u", "h", "b" are arrays of [from, to) word ranges over that paragraph's whitespace-tokenised words (punctuation attached). Words are 0-indexed. "to" is exclusive.
  Example: paragraph "The U.S. faces a credibility crisis." has 6 words [The, U.S., faces, a, credibility, crisis.]. To highlight "credibility crisis." use [4, 6].
- "loudest" is the single bold-underlined "loudest phrase" of the entire card — the one read-aloud beat the debater wants the judge to hear.

HARD RULES (server enforces, but follow them so your work survives)
- Highlights and bolds MUST sit fully inside an underline. Floating ones get dropped.
- Each highlight run is 1–${MAX_RUN_WORDS_HINT} words. Runs longer than ${MAX_RUN_WORDS_HINT} words get trimmed.
- Per-paragraph density caps: underline ≤ ${Math.round((UNDERLINE_HINT[density] ?? 0.72) * 100)}%, highlight ≤ ${Math.round((HIGHLIGHT_HINT[density] ?? 0.30) * 100)}% of paragraph words. Excess marks get trimmed by lowest priority.
- Pick ${l.paragraphRule}. Output max ${l.maxWords} body words across all picks.

PARAGRAPH SELECTION
- Choose paragraphs that carry the warrant for the DEBATER INTENT. Skip filler, transitions, repetition, methodology boilerplate.
- Prefer body paragraphs over abstracts and bios.
- Stay close to the natural length of the warrant. Don't pad.

WHERE TO UNDERLINE (target ${d.underlineRange} of paragraph words)
- Underline only the clauses that carry the warrant. Leave transitional / setup / filler sentences UN-underlined (they remain in the paragraph for integrity but aren't read).
- Multiple <u> spans per paragraph are normal when warrant clauses are split by connective prose.

WHERE TO HIGHLIGHT (the read-aloud beats — ${d.highlightRule})
- Each highlight is 1–${MAX_RUN_WORDS_HINT} words, ALWAYS inside an underline.
- Stitched together in document order across the whole card, the highlights must sound like a coherent argument.
- ALWAYS HIGHLIGHT: operative verbs (causes, triggers, undermines, locks in, ends, eliminates), magnitude nouns (extinction, war, collapse, recession, escalation), numbers / years / percentages / currencies, named entities (U.S., China, NATO, Putin), tight noun-verb pairs ("credibility collapses", "deterrence fails").
- NEVER HIGHLIGHT: articles, conjunctions, modal helpers (the, a, of, in, would, could), filler adverbs (however, ultimately, accordingly).

WHERE TO BOLD
- ≥2 bold ranges per paragraph, all inside an underline.
- Bolds typically wrap a highlight (most calibration data shows them coinciding).
- Use "loudest" once per card for the single most important phrase.

WORD COUNTING — DOUBLE-CHECK
- Each candidate paragraph below is shown with its words pre-prefixed by index, e.g. "[0]The [1]U.S. [2]faces ...". Use those numbers directly. Do NOT re-tokenise.

CITE
- Extract from SOURCE METADATA. Format: Last 'YY [Full Name; Credentials; "Title"; Source; Date; URL]. Omit missing fields. Never invent.

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
