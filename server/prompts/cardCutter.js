'use strict';

const { formatReferenceCuts } = require('./referenceCuts');

// Density presets — iteration-3 calibration (2026-05-03) from 5 hand-cut
// gold cards. Hand-cut style: RAPID STITCHED FRAGMENTS, with EXTENSIVE
// bolding of every warrant beat that lands.
//
// Measured gold averages:
//   highlights/body para: 15–25 (range 9–35)
//   bolds/body para:      8–18 (range 5–25)
//   avg highlight length: 1.5–2.5 words
//   bold ratio: ~50% of highlights ALSO bolded (the loud ones)
const DENSITY_PRESETS = {
  minimal:  { underlineRange: '20–35%', highlightRule: '6–10 highlights per paragraph, mostly 1–2 words (~5–10% of chars highlighted), 3–5 bolds',                                                                                                            unhighlightedRule: '≥90%' },
  standard: { underlineRange: '25–45%', highlightRule: '10–18 highlights per paragraph, mostly 1–2 words (~10–15% of chars highlighted), 5–10 bolds',                                                                                                          unhighlightedRule: '≥85%' },
  heavy:    { underlineRange: '30–55%', highlightRule: '15–25 highlights per paragraph, mostly 1–2 words, occasionally 3 — RAPID STITCHED FRAGMENTS that read aloud as a stitched speech (~15–22% of chars highlighted). 8–15 BOLDS per paragraph — bold EVERY warrant beat that lands (hand-cut cards bold ~50% of their highlights).', unhighlightedRule: '≥78%' },
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
  return `You are an elite LD debate card cutter. You select source paragraphs and emit VERBATIM TEXT QUOTES that the server will mark as underline / highlight / bold. You echo source text exactly — punctuation, spelling, capitalization — and the server inserts marks where your quotes match.

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
For each beat in your speech, locate the verbatim text in the candidate paragraphs. Emit each beat as a SHORT VERBATIM STRING (typically 1–3 words) in the "h" array. The highlights together, in document order, should READ AS YOUR COMPOSED SPEECH.

STEP 4 — UNDERLINE THE READ.
For each highlighted region, underline the surrounding clause that makes it grammatically readable (so the debater can underline-read it for context if they have time). Underlines wrap highlights — they don't ENGULF the entire paragraph. If a sentence is pure setup or filler, leave it un-underlined. The server will collapse 100% underlines anyway, so be selective from the start.

STEP 5 — BOLD AGGRESSIVELY (hand-cut style — bold ~50% of your highlights).
Bolds are for SPOKEN EMPHASIS. Hand-cut LD cards bold A LOT — typically 8–15 bolds per typical body paragraph. Almost every warrant-bearing highlight that LANDS becomes bold. Bolding is NOT rare — it's the default for impactful content.

  WHAT TO BOLD (and emit each as a separate "b" string):
  - Numbers: "198 kilometers", "2040", "3 degrees", "$5 trillion"
  - Named actors and locations: "Russia", "U.S.", "Iran", "China", "North Korean border"
  - Magnitudes: "extinction", "war", "collapse", "annihilation", "global thermonuclear exchange"
  - Operative verbs: "collapses", "undermines", "eliminates", "destroys", "decapitate"
  - Causal mechanisms: "first-strike counterforce", "use-or-lose dilemma", "asymmetric arms race"
  - Specific warrant facts: "no resolution", "increase nuclear risks", "unique dangers", "even closer"
  - Contrast/turn words: "false", "irrational", "flawed", "impossible", "doesn't"

  RULES:
  - Each bold = 1 word usually. 2–4 words OK for tight warrant phrases ("most militarized region", "use them or lose them", "increase nuclear risks", "would be used").
  - NEVER bold a single letter, a stopword alone ("the", "and"), or a filler word ("however", "further").
  - Each bold string SHOULD also appear in the "h" array (bolds live INSIDE highlights).
  - Target: 8–15 bolds per body paragraph at heavy density. If you have 5 bolds, you're missing landing words — find more.

  REFERENCE — gold-cut card 3 had 38 BOLDS in 3 paragraphs:
  no resolution | increase nuclearization | not make South Korea any safer | increase nuclear risks | most militarized | tense region | nuclear adversary | unique dangers | 198 kilometers | North Korean border | even closer | proximity | overreaction | escalation | likely | nuclear weapons would be used | broader regional security | China | Russia | nuclear threat | Chinese nuclear weapons sites | Beijing | within range | facilities | similar distances | tactical nuclear weapons | regional nuclear strike option | below the strategic level | Chinese and Russian | deployments | strategies | undermine | South Korean | Japanese security
  Notice: every magnitude, named actor, number, location, and impact verb is bolded.

STEP 6 — VALIDATE.
Read your highlights aloud, in document order, in your head. Does the result sound like the speech you composed in Step 1? Does it actually deliver the argument? If not, REVISE. Drop highlights that don't fit. Add missing connectors. Reorder if needed.

═══════════════════════════════════════════════
WIRE FORMAT — argument FIRST, picks SECOND
═══════════════════════════════════════════════

OUTPUT — JSON ONLY. No prose. No fence. No commentary.

The "argument" field is REQUIRED. Compose your spoken argument FIRST, THEN emit the quotes that deliver it.

{
  "tag":      "Offensive strategic claim that wins the round. 7–13 words, AS SHORT AS POSSIBLE while still carrying mechanism + magnitude. AVOID EM DASHES (—) — use a period or just shorten the tag instead. Hyphens (-) are fine. Examples: 'Forward deployment destabilizes the region. Goes nuclear and draws in Russia and China.' / 'Diplomacy fails. North Korean threats not abating, ignoring backfires.'",
  "cite":     "Lastname 'YY [Full Name; Credentials; \\"Title\\"; Source; Date; URL]   ← prefix is JUST the LAST name + 2-digit year, e.g. \"Bowers '23 [Ian Bowers; ...]\" — NOT \"Ian Bowers '23 [...]\"",
  "argument": "REQUIRED. 30-50 word spoken speech the highlights deliver. Read it aloud — it should sound like a debater making the case.",
  "picks": [
    {
      "p": 0,
      "u": ["Trump tried in his first term to negotiate a deal with Kim that would swap an easing in U.S. sanctions in exchange for Pyongyang committing to give up its nukes."],
      "h": ["Trump tried", "to negotiate a deal", "Kim", "swap", "sanctions", "Pyongyang", "give up its nukes"],
      "b": ["swap", "Pyongyang"]
    }
  ]
}

DEFINITIONS:
- "p"   = paragraph index from CANDIDATES (0-indexed).
- "u"   = array of VERBATIM strings to UNDERLINE. Each string is a full warrant clause/sentence the debater will read silently for context.
- "h"   = array of VERBATIM strings to HIGHLIGHT (read aloud). Each string is a SHORT warrant fragment, typically 1–3 words. The chain of highlights, in order, IS the spoken argument.
- "b"   = array of VERBATIM strings to BOLD (loudest emphasis). Each string is 1 word usually, max 2–3. Bolds usually overlap a highlight (the loudest part of an already-loud span).

QUOTE RULES — STRICT:
1. EVERY string MUST appear VERBATIM in the source paragraph "p". Match exact characters: same spelling, same punctuation, same capitalization. The server will reject quotes it can't find.
2. Highlights are SHORT — 1–3 words each. NEVER emit a 5+ word highlight. Split long phrases into multiple short ones.
3. NEVER emit a highlight that consists ENTIRELY of a stopword ("the", "and", "of", "to") or a filler word ("however", "further", "unfortunately", "first", "in addition"). Skip those — let the underline carry them as plain context.
4. NEVER emit a bold that's just a single letter, a stopword, or a filler word.
5. Order matters: emit highlights in DOCUMENT ORDER (left-to-right, top-to-bottom).
6. The same exact string should NOT appear twice in the same array. If a phrase repeats in source, you can pick which occurrence by including more surrounding context in the quote.

VALIDATION CHECK before submitting:
1. For every quote in u/h/b, can you find it character-for-character in the paragraph? If not, fix it.
2. Read the h array in order — does it deliver the "argument" field?
3. Are highlights mostly 1–3 words? If any is 5+ words, split it.
4. Do bolds overlap highlights? They should be the LOUDEST sub-phrase of a highlighted span, almost always.

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
TAG-ANCHORED HIGHLIGHTING — repeat the tag's key concepts
═══════════════════════════════════════════════

The TAG names 3–6 KEY CONCEPTS. Extract them. For each KEY CONCEPT, search source paragraphs for that word/phrase (or close synonym) and highlight EVERY occurrence. This anchors the chain to the tag.

Tag types — adapt the cut style:
- POLICY tag (countries, numbers, "fails to", "destabilizes"): tight impact chains, dense bolding of landing words, capture numbers/actors.
- KRITIK/THEORY tag (theoretical terms like "fantasy", "discourse", "preconscious", "grammar of"; philosopher names like Wilderson, Meiches, Foucault): highlight CONCEPT FLAGS every time they appear; capture claim-level statements ("X is constituted by Y", "X produces Z", "X is connected to W").
- HYBRID tag: blend both.

Extra K-card warrant verbs: "is constituted by" / "produces" / "engenders" / "renders thinkable" / "represses" / "naturalizes" / "donates" / "intensifies" / "operates as" / "structures".

Example, tag = "Forward deployment destabilizes the region — goes nuclear and draws in Russia and China":
  Key concepts: deployment, destabilizes, region, nuclear, Russia, China
  Highlight every "deploying", "deployment", "destabilizes", "region", "nuclear weapons", "Russia", "China", "Beijing", "increasing the nuclear threat".

Example, tag = "Debates must center the preconscious. Debate's grammar of abstraction moves away from pain":
  Key concepts: debates, preconscious, grammar, abstraction, pain
  Highlight every "debate(s)", "preconscious", "grammar", "abstraction", "pain", "sorrow/heartbreak/joy" (synonyms of pain).

If a key concept appears 5 times in source, highlight all 5. Repetition anchors the argument.

═══════════════════════════════════════════════
WORKED EXAMPLES — real hand-cut LD cards. Match this style.
═══════════════════════════════════════════════

${formatReferenceCuts()}

Notice across these examples:
  - h-array order matches document order (left-to-right reading)
  - Most highlights are 1–3 words; some are longer warrant phrases
  - Bolds usually appear in h too (loud sub-phrases of highlighted spans)
  - Policy cuts capture numbers and named actors aggressively
  - K cuts repeat key concepts (preconscious, nuclear policy) and capture claim-level statements ("is deeply connected to", "is constituted by")
  - Filler/attribution stays plain (not in h or b)

═══════════════════════════════════════════════
QUOTED MATERIAL ALSO carries warrants
═══════════════════════════════════════════════

When the source has a QUOTE delivering a sharp claim or a POLICY DOCUMENT/JOINT STATEMENT with specific wording, the punchline INSIDE those quotes is warrant-bearing. Highlight the impact words inside, skip the attribution:

  Source: "The document called out Pyongyang's 'challenges to peace and stability' and recommitted the U.S. to 'denuclearization' of the Korean Peninsula."
  ✓ Highlight: "called out" / "challenges to peace" / "recommitted" / "denuclearization" / "Korean Peninsula"

  Source: "JAKE SULLIVAN told NatSec Daily: 'we will have to see if Kim Jong-un feels that he needs to rattle the cage.'"
  ✓ Highlight: "rattle the cage" (the punchline), skip "JAKE SULLIVAN told NatSec Daily" (attribution).

═══════════════════════════════════════════════
PRIORITIZE IMPACT MARKERS — verbs and phrases that scream "WARRANT"
═══════════════════════════════════════════════

When scanning candidates, FIRST locate sentences containing these IMPACT MARKERS — they almost always carry the warrant:

  - "could backfire" / "would backfire" / "leads to" / "results in" / "causes"
  - "would expose" / "exposes" / "puts at risk" / "increases the risk"
  - "rolled out" / "deployed" / "tested" / "demonstrated" (escalation/capability proofs)
  - "called out" / "warned" / "recommitted to" / "abandoned" (policy actions)
  - "no evidence" / "no guarantee" / "cannot be contained" / "impossible to" (skepticism/limit-claims)
  - "rattle the cage" / "lash out" / "doesn't like" (behavioral predictions)
  - "would result" / "will result" / "shall be launched" (causal predictions)
  - "fails to" / "failed to" / "is non-existent" (failure claims)
  - "trigger" / "spark" / "spawn" / "drive" / "induce" (causal verbs)

Sentences with these markers are WHERE THE WARRANT LIVES. Highlight aggressively in those sentences. Skip past sentences that are pure chronology ("In 2018...", "After this period...", "Trump tried in his first term...") UNLESS those chronological facts directly prove the tag.

═══════════════════════════════════════════════
TAG-PROOF RULE — every highlight must prove the tag
═══════════════════════════════════════════════

The TAG is the offensive claim the debater wins the round with. Your highlights MUST be the EVIDENCE that proves it. Not background, not chronology, not attribution.

For each highlight, ask: "Does this word/phrase prove the tag?"
  - If YES → highlight it.
  - If it's BACKGROUND CONTEXT (when/where/who-said-what without warrant content) → leave plain.
  - If it's CHRONOLOGY OR DESCRIPTION without warrant → leave plain.

EXAMPLES of the distinction:

Tag: "Diplomacy fails. North Korean threats not abating, ignoring backfires."

Source sentence: "Trump tried in his first term to negotiate a deal with Kim that would swap an easing in U.S. sanctions in exchange for Pyongyang committing to give up its nukes."
  ❌ BAD highlights (chronology/background): "Trump tried" / "first term" / "negotiate a deal" / "Kim" / "swap" / "sanctions"
     — these describe what happened, not whether the tag is true.
  ✓ GOOD highlights (warrant-bearing): "swap an easing in U.S. sanctions" / "Pyongyang committing to give up its nukes"
     — proves the kind of deal being attempted (helps tag's "diplomacy fails" warrant).

Source sentence: "Despite three meetings in 2018 and 2019 the effort failed."
  ✓ HIGHLIGHT: "three meetings in 2018 and 2019" / "failed"
     — proves diplomacy has empirically failed before.

Source sentence: "Underplaying Pyongyang's military threat could backfire."
  ✓ HIGHLIGHT: "Underplaying Pyongyang's" / "threat could backfire"
     — directly proves "ignoring backfires" warrant in tag.

Source sentence: "There's no evidence that threats from North Korea have abated."
  ✓ HIGHLIGHT: "no evidence" / "threats" / "from North Korea" / "abated"
     — directly proves "threats not abating" warrant in tag.

THE FILTER: read each candidate sentence twice.
  - First pass: skip sentences that are pure background ("As Shampa Biswas illustrates...", "After this period...", "In his first term...").
  - Second pass: in remaining warrant-bearing sentences, highlight ONLY the words that carry the warrant (the impact, the mechanism, the magnitude, the contrast).

═══════════════════════════════════════════════
WARRANT CAPTURE — what to highlight (and bold)
═══════════════════════════════════════════════

Warrants are the SPECIFIC reasons the argument is true. They're carried by:

  1. NUMBERS and MAGNITUDES: "198 kilometers", "2040", "3 degrees", "extinction", "global thermonuclear exchange". ALWAYS highlight + bold these.
  2. NAMED ACTORS / LOCATIONS: "U.S.", "China", "Russia", "Korean Peninsula", "North Korean border", "Beijing". ALWAYS highlight; bold key ones.
  3. CAUSAL VERBS: "causes", "triggers", "collapses", "undermines", "eliminates", "decapitate", "spurs", "drives". ALWAYS highlight + bold.
  4. CONTRAST/TURN WORDS: "false", "irrational", "flawed", "impossible", "doesn't", "no resolution", "not safer". These flip the argument — capture them.
  5. SPECIFIC WARRANT CLAIMS: "increase nuclear risks", "unique dangers", "use them or lose them", "no guarantee against unlimited escalation". The clauses that make the argument WIN.
  6. TIME PHRASES: "by 2040", "this year", "since 1991", "in 2018 and 2019". Tie warrant to specific timeframe.

When in doubt, ASK: would the debater point at this word with their finger to make their case? If yes → highlight. If it's the LOUDEST word in that beat → bold too.

EXTRACTION CHECKLIST — before submitting, scan your candidate paragraphs and ensure you captured:
  - Every NUMBER that quantifies the warrant (kilometers, percentages, dates, kill counts)
  - Every NAMED ACTOR that does or suffers something
  - Every CAUSAL VERB linking actor → impact
  - Every MAGNITUDE word (war, extinction, collapse)
  - Every TURN/CONTRAST word that flips the opposing claim

If the source mentions "198 kilometers" and you didn't highlight it, you missed a warrant beat.

═══════════════════════════════════════════════
ARGUMENT-CHAIN ALIGNMENT (chain MUST match the TAG)
═══════════════════════════════════════════════

The TAG declares the argument. Your COMPOSED ARGUMENT (the "argument" field) restates it as a 30-50 word speech. Your HIGHLIGHTS (the "h" array) deliver that argument verbatim from source.

Step-by-step:
  1. Read the TAG. Identify its KEY CONCEPTS (the warrant words) and its IMPACT.
  2. For each KEY CONCEPT in the tag, find the source sentence(s) that prove it.
  3. Highlight the warrant words IN those sentences.
  4. Verify: every key concept in the tag has at least 1–2 highlights that prove it.

EXAMPLE (K card, tag="Debates must center the preconscious. Debate's grammar of abstraction moves away from pain"):
  Tag key concepts: preconscious, debate(s), grammar of abstraction, moves away from pain
  Required highlights:
    - "preconscious" (must appear, multiple times)
    - "99 percent of debates" (concrete claim about debate)
    - "structure of grammar represses" (proves "grammar moves away")
    - "sorrow / heartbreak / pain" (the pain)
    - "unconscious wants fantasies" (the move-away-from)

EXAMPLE (policy card, tag="Forward deployment destabilizes the region — goes nuclear and draws in Russia and China"):
  Tag key concepts: forward deployment, destabilizes, region, nuclear, Russia, China
  Required highlights:
    - "deploying US nuclear weapons"
    - "most militarized region"
    - "198 kilometers from North Korean border"
    - "increase the risk of overreaction and escalation"
    - "nuclear weapons would be used"
    - "China and Russia" / "increasing the nuclear threat"

VALIDATION: read your h-array in order. Does it deliver the tag's argument? Specifically — for EACH KEY CONCEPT in the tag, point to ≥1 highlight that proves it. If you can't, the chain is incomplete — add more highlights from warrant-bearing sentences.

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

  // Iteration 8: dropped char-position ruler. Model emits VERBATIM QUOTES,
  // not offsets — server resolves quotes via indexOf, so positions don't
  // matter. The ruler was confusing the model into emitting block ranges.
  const candidateBlock = candidates.map(c =>
    `[P${c.index}]\n${c.text}`
  ).join('\n\n');

  return [
    intentLine,
    citeLine,
    metaLines && `SOURCE METADATA:\n${metaLines}`,
    `CANDIDATES — these are the only paragraphs you may pick from. Reference each by its [P#] index. Echo VERBATIM strings from these paragraphs in your u/h/b arrays.\n---\n${candidateBlock}\n---`,
    `Return the JSON now. Pick ${l.paragraphRule}, ≤${l.maxWords} body words, underline ${d.underlineRange}. ${d.highlightRule}. SELECTIVITY > coverage: highlight ONLY the warrant-bearing phrases that read together as the spoken argument. Plain text is fine — most words should NOT be highlighted.

LENGTH-AWARE DENSITY:
- Short paragraphs (<200 chars, 1–2 sentences): 4–8 highlights, 2–4 bolds.
- Medium paragraphs (200–500 chars, 2–4 sentences): 8–14 highlights, 4–8 bolds.
- Long paragraphs (500+ chars, 4+ sentences): 12–22 highlights, 6–14 bolds.
Don't force the upper end on short paragraphs — over-highlighting them is the most common drift.

TAG-PROOF FILTER:
Before you pick a highlight, ask: "does this word PROVE the tag, or just describe surrounding context?" If it's surrounding context (chronology, attribution, who-said-what without warrant content), leave it plain. The chain of your highlights, read aloud, should sound like a debater making the case for the tag — not summarizing the article.`,
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
