# Cutter quality plan — 2026-05-03

## Problem statement

Two intertwined symptoms in production cuts (Sonnet output, real article on Korean asymmetric deterrence):

1. **Chain validation fails on Haiku every cut** → forced Sonnet retry (~5x cost, +latency).
   Logs show: `coverage=0.63 bloat=0.47 filler=1 danglers=0/12`.
   Bloat (>0.40) and filler (>0) are the killers.

2. **Even Sonnet output is low-quality vs hand-cut**:
   - **a.** Cite shows `Ian Bowers '23` instead of `Bowers '23`.
   - **b.** Bolds are random / overlong: single letter `e`, filler phrases like
     `no matter what`, multi-clause runs like `short-range missiles has expanded
     rapidly. As a result`.
   - **c.** Highlights are fragmented (`has found`, `no matter what conventional`)
     vs hand-cut where they're cohesive 2–4 word warrant phrases.

User goal: **chain validation passes on Haiku without quality loss**, AND fix the
quality issues that show up even on Sonnet.

## Hand-cut vs machine-cut analysis

Side-by-side from the same source paragraph (North Korea / asymmetric arms race):

**Hand-cut (gold)**:
- Highlights: cohesive warrant phrases — `South Korea has found`, `asymmetric`,
  `arms race that is impossible to win`, `North Korean nuclear weapons`,
  `will always have the upper hand`, `severely impact crisis stability`.
- Bolds: strategic single-word emphasis on landing words — `asymmetric`,
  `impossible to win`, `extremely difficult`, `one nuclear warhead`,
  `"use them or lose them" dilemma`.
- Filler (`First,`, `Further,`, `In addition,`) **plain** — no underline, no
  highlight.
- Most words underlined as context; ~30–40% highlighted.
- Bolds: 5–8 per paragraph, all 1–4 words each.

**Machine-cut (current Sonnet output)**:
- Highlights mid-word and on filler — `e new missile launchers attests,`,
  `No matter what conventional`, `has found`, `to use nuclear`.
- Bolds long and random — `launcher attests`, `short-range missiles has
  expanded rapidly. As a result`, single letter `e`.
- Filler highlighted — `As a result`, `In addition`.
- Highlight density ~50%, way over real cards.

## Root causes

1. **Prompt pushes over-highlighting.** Final user-prompt line says
   `HIGHLIGHT MORE THAN FEELS NATURAL — under-highlighting is the most common failure.`
   This is wrong: looking at production output, **over-highlighting is now the
   common failure**. This line was added when the model under-cut; it now
   overcorrects.

2. **Density target too high.** `heavy.highlightRule = ~10–18% of chars` in
   the preset, but `HIGHLIGHT_HINT.heavy = 0.28` and prompt says
   `~50% of characters highlighted`. Real heavy cards are ~15% highlight,
   ~50–70% underline. Haiku is calibrating to the inflated number.

3. **Bold cap is per-span, not visual.** `MAX_BOLD_RUN_CHARS=18` trims a
   single span, but adjacent bolds with one-char gaps render as continuous
   visual bolds (`**short-range** **missiles** **has expanded**…` looks
   identical to `**short-range missiles has expanded**`). No merging across
   gap, no per-paragraph bold-count cap.

4. **No "cohesion" signal in chain validation.** Current score: coverage,
   bloat, filler, danglers. Doesn't penalize fragmentation
   (3+ tiny phrases vs 1 cohesive phrase). Hand-cut chain looks like
   `asymmetric arms race ... impossible to win ... North Korean nuclear
   weapons ... upper hand` (5–6 phrases, 3–5 words each). Machine chain
   looks like `e ... has found ... No matter what ... South Korea ...
   conventional capability ... North Korea ...` (15+ phrases, 1–3 words
   each). Both can have similar coverage/bloat numbers but the second is
   garbage.

5. **Cite shortCite extraction takes whatever's before the `[`.** If the LLM
   emits `Ian Bowers '23 [...]`, shortCite becomes `Ian Bowers '23`. No
   post-processing reduces it to `Bowers '23`.

6. **Filler-only-span detection runs late, but FILLER inside a non-filler-only
   span survives.** A highlight `to expand its nuclear weapons program than
   it is for South Korea` contains `for`, which never trips the filter (it's
   only triggered when the WHOLE highlight is filler). So `bloat` stays high.

## Plan — three layered fixes, executed in order

### Phase 1 — prompt revision (the main lever)

Edit `server/prompts/cardCutter.js` `buildSelectionSystemPrompt`:

- **Remove** the "highlight more than feels natural" line at the bottom
  of `buildSelectionUserPrompt`.
- **Replace density numbers**:
  - `heavy.highlightRule`: `4–10 highlights per paragraph, mostly 1 word, occasionally 2 — short stitched fragments (~10–18% of chars highlighted)` → `5–9 highlights per paragraph, mostly 2–4 words each, cohesive warrant phrases (~12–18% of chars highlighted)`.
  - `HIGHLIGHT_HINT.heavy = 0.28` → `0.15`.
  - Strike "~50% of characters highlighted" framing.
- **Add a hand-cut gold-standard example** in the prompt (the actual
  paragraph from the screenshot) showing exactly which words get
  underlined / highlighted / bolded in cohesive form.
- **Tighten BOLD rules**: bolds are LANDING WORDS — usually 1 word, max 2-3
  for tight phrases (`upper hand`, `use them or lose them`). NEVER bold a
  full clause. Examples of OK vs BAD bolds.
- **Add explicit "skip filler from underline too" rule**: `First,`,
  `Further,`, `Unfortunately,` start of sentence — start the underline
  AFTER them.
- **Move "compose argument first"** closer to the top, before the
  STEP 1-6 workflow.
- **Cite format clarification**: explicit `Lastname 'YY [Full Name; …]`
  with example `Bowers '23 [Ian Bowers; …]` — the prefix is JUST lastname.

### Phase 2 — server reconstructor improvements

Edit `server/services/cardReconstructor.js`:

- **Per-paragraph bold count cap.** New constant `MAX_BOLDS_PER_PARAGRAPH = 5`.
  After all other trimming, drop lowest-priority bolds beyond cap.
- **Tighter bold cap.** `MAX_BOLD_RUN_CHARS = 18` → `14` (one strong word
  or `use them` style two-word phrase; longer is cluster-bolding).
- **Drop single-character bolds.** A bold of 1 char is almost certainly
  an off-by-one slip; drop it.
- **Drop bolds that are stopword-only** (e, of, the, etc.) — extend
  `isFillerOnlySpan` check to bolds with a stopword set.
- **Fragment penalty in `chainArgumentScore`.** New field
  `fragmentation = phrases / argSize`. If chain has many tiny phrases
  vs argument size, treat as low quality (return as factor in retry
  decision).
- **Filler-substring drop in highlights.** Currently we only drop
  highlights that are ENTIRELY filler. Add: if a highlight starts OR ends
  on a filler word (`As a result`, `In addition`), trim that part off.
- **shortCite post-processing.** In `cutCardV2.js`, after extracting the
  pre-`[` prefix, run a regex: `/\b(\w+)\s+'?\d{2}\b/` matches `LastName 'YY`;
  if the prefix has more than 2 words and matches `Firstname Lastname 'YY`,
  reduce to `Lastname 'YY`. Or simpler: if the autocite-built `cite` was
  passed to cutCardV2, just use the autocite-derived `lastYY` directly
  (plumb it through).

### Phase 3 — chain validation tuning

Edit `server/services/cutCardV2.js`:

- Keep `CHAIN_BLOAT_MAX = 0.40` and `filler == 0` (do NOT loosen — these
  catch real failures). Phase 1+2 should bring Haiku into compliance.
- Add fragmentation gate: `phraseCount > 2 * argSize / 5` or similar
  (means highlights average <2.5 source-words per arg-word).
- Improve critique: include a hand-cut-style positive example in the
  retry prompt, not just diagnosed issues.
- (Optional) **Compose-only retry**: if Haiku passes coverage but fails
  bloat or fragmentation, retry on Haiku itself with a critique that says
  "merge adjacent tiny highlights into 2–4 word phrases" — cheaper than
  Sonnet.

## Validation strategy

1. **Unit tests**: extend `cutCardV2-pipeline.test.js` with synthetic picks
   that exhibit each failure mode (fragmented, overlong bold, filler-prefix
   highlight, "Firstname Lastname 'YY" cite). Assert reconstructor cleans
   them up.

2. **Live A/B**: cut the SAME article (the Bowers piece from the screenshot)
   on dev with old prompt vs new prompt. Compare:
   - Highlight density (target ~15%, not 50%)
   - Bold count per paragraph (target 5–8, not 12+)
   - Chain validation pass/fail rate
   - shortCite value
   - Visual fragmentation

3. **Production smoke**: after deploy, watch `pm2 logs` for 10–15 cuts:
   - `chain coverage=__% bloat=__% filler=__ danglers=__/__`
   - Goal: ≥80% of Haiku cuts pass validation. Bloat <0.40 typical.
   - No `CHAIN_RETRIED` for 8/10 cuts.

## Open questions for user

1. **Density target confirmation.** Hand-cut shows ~30–40% highlight density
   (lots of cyan). My read: real heavy cards highlight ~15% chars but
   underline/highlight at the SENTENCE level, so visually it looks denser.
   What's the target — 15% chars OR 30–40%? This drives `HIGHLIGHT_HINT.heavy`.

2. **Bold count.** Hand-cut paragraph 2 shows ~7 bolds. OK to cap at 8 per
   paragraph? Or higher tolerance for high-warrant paragraphs?

3. **Fragment penalty trigger.** OK if I retry on Haiku-self (cheaper) for
   bloat/fragmentation issues, only escalate to Sonnet for coverage issues?

4. **Cite plumbing.** Easiest cite fix is to pass `lastYY` from autocite
   through to cutCardV2 and skip regex extraction. Adds one field to the
   args. OK?

5. **Skip filler underlines too?** Hand-cut starts paragraph 2 underline at
   `conventional counterforce` (skipping `First,`). Should `First,`,
   `Further,`, `Unfortunately,` etc. also be excluded from underline starts?
   Currently the rule only excludes them from highlights.

## Files to touch

- `server/prompts/cardCutter.js` — prompt revision (Phase 1)
- `server/services/cardReconstructor.js` — bold caps, filler trimming,
  fragmentation score (Phase 2)
- `server/services/cutCardV2.js` — chain validation tuning, shortCite fix
  (Phase 2 + 3)
- `test/cutCardV2-pipeline.test.js` — add regression tests
- `test/cardCutter-prompt.test.js` — update prompt assertions if any
  reference removed lines
