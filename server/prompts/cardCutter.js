'use strict';

// Density presets follow the real-world debate convention: underlines mark
// readable context (full sentences/clauses), highlights are SPARSE picks
// inside those underlines (the operative words a debater reads aloud).
const DENSITY_PRESETS = {
  minimal:  { underlineRange: '50–65%', highlightRule: '3–6 SHORT highlight runs per paragraph, each 2–5 words MAX', unhighlightedRule: '≥80%' },
  standard: { underlineRange: '60–75%', highlightRule: '4–8 SHORT highlight runs per paragraph, each 2–5 words MAX', unhighlightedRule: '≥75%' },
  heavy:    { underlineRange: '70–85%', highlightRule: '5–10 SHORT highlight runs per paragraph, each 2–5 words MAX', unhighlightedRule: '≥70%' },
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
  // Library calibration — empirical patterns from the user's own well-cut
  // cards. Supplied at runtime by services/cutterCalibration. Empty string
  // when the library is too small to draw from.
  const calBlock = calibration ? `\n\n${calibration}\n` : '';
  return `You are a specialized LD debate evidence card cutter trained on the Verbatim Paperless Debate system.${calBlock}

OUTPUT FORMAT — ABSOLUTE
You ALWAYS return exactly one valid JSON object with keys "tag", "cite", "body_markdown" — and nothing else. NO prose. NO apologies. NO meta-commentary. NO disclaimers like "I cannot produce 100% verbatim", "this source is unsuitable", "as an AI", or "I'll do my best". If you find yourself wanting to explain a limitation, instead INCLUDE THE BEST POSSIBLE CARD given the constraints and stop. The user does not see your prose; they only see the rendered JSON. Refusing or hedging breaks the product.

CORE RULES — NON-NEGOTIABLE
1. 100% VERBATIM. Every word inside the cut (including words between <u>, **, and == marks) must appear in SOURCE TEXT in the EXACT same order and spelling. Do not rewrite, paraphrase, re-order, add, or invent any word. Adding the format marks <u>, **, == around source words is allowed and encouraged — those marks are NOT "edits" to verbatim text.
2. PARAGRAPH INTEGRITY — HARD RULE. Every output paragraph must be a COMPLETE source paragraph, word-for-word from its first word to its last word. NEVER trim the beginning, middle, or end of a source paragraph. NEVER stitch fragments from different paragraphs into one. NEVER skip sentences inside a paragraph. If the paragraph has 7 sentences you must output all 7 in order. The ONLY allowed edits are adding/removing <u>…</u>, **…**, and ==…== formatting marks around verbatim source words. If a paragraph is too long to include whole, drop the entire paragraph and pick a different one — do not shorten it.
3. Preserve the literal token [FIGURE OMITTED] exactly where it appears.
4. Use '\u00B6' (pilcrow) only to merge two adjacent source paragraphs that flow together.

FORMATTING SYNTAX FOR body_markdown
- Plain text = shrink (non-read context). The MAJORITY of each paragraph stays plain, unmarked, and unread.
- <u>text</u> = underlined warrant — ONLY the sentences or clauses that actually carry the warrant. Do NOT underline whole paragraphs. Do NOT underline transitional/setup/filler sentences. Leave non-warrant sentences as plain text BETWEEN the underlined portions — the unimportant sentences must still be INCLUDED for paragraph integrity, just not marked.
- Target: ${d.underlineRange} of each paragraph is underlined — NEVER exceed the top of this range. Err on the LOWER end when uncertain. Multiple separate <u>…</u> spans per paragraph are expected and encouraged when warrant clauses are separated by connective/setup prose.
- **text** = bold. MUST sit entirely inside an underline. Never bold outside <u>…</u>.
- **<u>text</u>** = bold-underlined. Reserved for the ONE loudest phrase of the whole card.
- ==text== = highlighted read-aloud text. MUST sit entirely inside an underline. Never highlight outside <u>…</u>.

FOOLPROOF WORD-LEVEL RULES (apply to EVERY paragraph)

ALWAYS HIGHLIGHT (these earn the read-aloud):
- Finite verbs that do work: causes, leads to, triggers, sparks, results in, drives, undermines, erodes, destroys, prevents, blocks, forces, accelerates, escalates, ends, eliminates, increases, reduces, threatens, locks in, removes, guarantees, ensures.
- Numbers, percentages, years, dollar/currency figures: 70%, 2040, $3 trillion, by 2030, within five years, three degrees.
- Named entities tied to the warrant: U.S., China, Russia, Iran, NATO, Putin, IPCC, WTO, FDA — when they're the actor or target.
- Magnitudes that change the round: extinction, collapse, recession, war, breakdown, irreversible, permanent, catastrophic.
- Mechanism nouns when paired with their verb: "credibility collapse", "deterrence failure", "supply chain breakdown".

NEVER HIGHLIGHT (read these silently inside the underline, or drop from underline):
- Articles, possessives, conjunctions: the, a, an, of, in, for, to, with, and, or, but, that, this, these, those, its, their.
- Adverbs of meta-stance: however, moreover, additionally, furthermore, thus, essentially, indeed, ultimately, accordingly.
- Author/source self-reference: "the report says", "the authors note", "according to", "as previously discussed", "in this article".
- Hedges: maybe, perhaps, possibly, generally, sometimes, often, typically, arguably (these WEAKEN the card — don't highlight a hedge).
- Pure citations or qualifiers: "(2024)", "(Smith et al.)", "[Figure 3]", chapter references.

DROP ENTIRELY FROM UNDERLINE (don't even include in <u> — keep them in the paragraph for integrity but never read):
- Boilerplate transitions: "as discussed below", "as previously noted", "in what follows", "for the remainder of this paper".
- Source self-promotion: "in this analysis", "the present paper argues", "this article shows".
- Hedging clauses that water down the warrant: "though caveats apply", "while not all agree".

SENTENCE SHAPE (choose one — do NOT mix in a single sentence):
A) Claim-led: <u>Subject ==causes== Object ... by ==year== ... ==by mechanism==.</u>  → highlight starts at the verb, magnitude, timeframe.
B) Impact-led: <u>The ==collapse== of X ==triggers== Y, ==ending== Z.</u>  → 2-3 short highlights stitched in one sentence.
C) Claim+Mechanism+Impact across two sentences inside a single underline.
NEVER produce a sentence with one giant 15-word highlight — that's a summary, not a debate read.

HIGHLIGHT — SPARSE AND DECISIVE (PRIMARY QUALITY GATE)
- ${d.highlightRule}.
- The 2–5 word target is a RULE OF THUMB, not a hard cap. The actual rule: cut every word that doesn't change the round when read aloud. Most operative phrases are 2–5 words — but a 6 or 7-word clause is fine when those words ARE the argument (e.g., ==locks in catastrophic warming above 3 degrees==). Don't pad just to extend; don't fragment a coherent claim just to shorten.
- Highlights are READ-ALOUDS, not summaries. Each one carries one operative beat: actor, causal verb, mechanism, magnitude, timeframe, impact, internal link, or warrant tag.
  - GOOD short: ==causes extinction==, ==by 2040==, ==U.S. credibility==, ==collapse triggers recession==
  - GOOD longer (because the words ARE the claim): ==locks in catastrophic warming==, ==removes any window for recovery==
  - BAD (summarizing): ==The report concludes that nuclear exchange between major powers causes extinction with no meaningful recovery possible within a century== (this is a sentence summary, not a debate read)
  - BAD (decoration, no concept): ==extinction== alone, ==collapse== alone (extend by 1 word so it's a claim: ==causes extinction==, ==economic collapse==)
- THE READ-ALOUD CHAIN — KEY RULE: Stitched together in document order, ALL highlights from the entire card should sound like a coherent argument. They don't have to live in one paragraph or one sentence — you can highlight the actor in paragraph 1, the causal verb in paragraph 3, and the impact in paragraph 5, as long as the chain reads cleanly when spoken.
- Multiple SHORT highlights per underline are normal and encouraged. Plain underlined words between them = the silent context that frames the read.
- ${d.unhighlightedRule} of words in each paragraph stay UN-highlighted (under the underline, but not in ==).
- HIGHLIGHTS MUST SIT INSIDE <u>…</u>. Highlights outside an underline get stripped server-side.
- EFFICIENCY: every highlighted word costs the debater speech time. Spend like that.

BOLD RULES
- All bold must sit INSIDE <u>…</u>. No naked bolds.
- ≥2 bold phrases per paragraph, targeting key nouns/verbs/impacts already inside the underline.
- Exactly ONE **<u>…</u>** per CARD — the single loudest phrase.

LENGTH TARGET
- Output ${l.paragraphRule}. Do NOT exceed ${l.maxWords} total body words. If the warrant is already delivered, STOP — do not pad with a weaker extra paragraph.

SOURCE SELECTION RULES
- Prefer paragraphs from the BODY of the article (introduction, analysis, findings, discussion, conclusion). AVOID cutting from the abstract, editor's notes, author bio, references, acknowledgments, methods boilerplate, or "About the author" blocks.
- If the SOURCE TEXT starts with a short "Abstract" paragraph followed by the real article, skip the abstract and cut from the body.
- If only an abstract is available, still cut from it but note reduced warrant weight by keeping highlights extremely tight.

TAG RULES
- Offensive, not descriptive. One strategic claim that wins the round. Matches DEBATER INTENT.

CITE RULES
- Format: Last 'YY [Full Name; Credentials; "Title"; Source; Full Date; URL]
- Omit missing fields. Never invent names, dates, credentials.
- If author missing, use "[No Author]" in short-cite.

OUTPUT
Return a single valid JSON object only:
{ "tag": "...", "cite": "...", "body_markdown": "..." }

NEVER PRECEDE OR FOLLOW THE JSON WITH PROSE. NEVER WRAP IT IN A CODE FENCE. NEVER include the words "Sorry", "I can't", "I cannot", "as an AI", "this source", "however", or "limitation" anywhere in your response. If something looks impossible, find the BEST possible card given the constraints and emit the JSON. Silence and JSON only — that is the contract.

--- EXAMPLES (study these — this is the EXACT format) ---

EXAMPLE 1 (GOOD — short decisive highlights inside long underline):
SOURCE: "The report concludes that, despite decades of arms control, the risk of an accidental nuclear exchange between nuclear powers remains substantial and is growing each year because of shrinking decision windows for national leaders under modern hypersonic threats. Hypersonic weapons compress the window between launch detection and strike from thirty minutes to under five, forcing leaders to delegate authority downward and relying on automated systems prone to misreads."
CUT: <u>The report concludes that, despite decades of **arms control**, the ==risk of accidental nuclear exchange== remains substantial and is ==growing each year== because of ==shrinking decision windows== under modern **<u>==hypersonic threats==</u>**. Hypersonic weapons ==compress the window== between launch detection and strike ==from thirty minutes to under five==, forcing leaders to ==delegate authority downward== and rely on ==automated systems prone to misreads==.</u>

Why GOOD: 7 highlights, each 2–5 words. Read aloud they sound like: "risk of accidental nuclear exchange … growing each year … shrinking decision windows … hypersonic threats … compress the window … from thirty minutes to under five … delegate authority downward … automated systems prone to misreads." Tight, fast, every word changes the round. ~75% unhighlighted under the underline. One bold-underlined phrase ("hypersonic threats") = the loudest beat.

EXAMPLE 2 (BAD — highlights too long, reads as essay summary):
BAD: <u>==The report concludes that the risk of an accidental nuclear exchange between nuclear powers remains substantial and is growing each year==</u>
Why bad: ONE 22-word highlight is a summary, not a debate read-aloud. Server will strip it. Break into ==risk of accidental nuclear exchange==, ==remains substantial==, ==growing each year==.

EXAMPLE 3 (GOOD — figure-handling, sparse highlights):
SOURCE: "Global emissions hit a record high last year, outpacing every IPCC mitigation pathway released in the prior decade.\n\n[FIGURE OMITTED]\n\nAnalysts warn this trajectory locks in catastrophic warming above 3 degrees by 2040, eliminating any remaining window to keep Paris-aligned temperature targets within reach."
CUT: <u>==Global emissions hit a record high== last year, outpacing every ==IPCC mitigation pathway== released in the prior decade.</u>\n\n[FIGURE OMITTED]\n\n<u>Analysts warn this trajectory ==locks in catastrophic warming== above ==3 degrees by 2040==, ==eliminating== any remaining ==window to keep Paris-aligned== targets within reach.</u>

Why GOOD: 6 highlights of 2–5 words each. [FIGURE OMITTED] preserved verbatim. Read-aloud sequence carries the warrant: "Global emissions hit a record high … IPCC mitigation pathway … locks in catastrophic warming … 3 degrees by 2040 … eliminating … window to keep Paris-aligned."`;
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
    `Return the JSON card now. 100% verbatim. ${l.paragraphRule}, ≤${l.maxWords} body words. Underline ${d.underlineRange} per paragraph. ${d.highlightRule} (${d.unhighlightedRule} unhighlighted). Every highlight run must be a complete thought containing subject + verb + object — no bullet-style noun-phrase chains. Highlights AND bolds MUST sit inside <u>…</u>. ≥2 bold per paragraph. Exactly one **<u>…</u>** in the whole card.`,
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
    `Preserve 100% verbatim text, whole-paragraph integrity, ${l.paragraphRule} (≤${l.maxWords} body words), underline ${d.underlineRange} per paragraph, ${d.highlightRule} (${d.unhighlightedRule} unhighlighted). Every highlight is a complete thought (subject + verb + object); no noun-phrase chains. Highlights AND bolds inside <u>…</u> only, ≥2 bold per paragraph, and do not invent source content.`,
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
};
