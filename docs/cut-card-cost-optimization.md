# Card Cutter Cost Optimization — Foolproof Plan

**Goal:** ≥85% cost reduction per cut, while making 100% paragraph integrity a *structural* guarantee (not a post-hoc repair) and improving highlight quality.

**Status:** Research complete. Architecture below is the recommended replacement for the current `/api/ai/cut-card` and `/api/ai/instant-cut` paths.

---

## 1. Current pipeline audit

### Worst-case path on a single cut (`server/routes/ai.js:230` — `/cut-card`)

| Stage | Where | What it sends | Output | Calls |
|---|---|---|---|---|
| 1. Initial cut | `ai.js:250` | Full system prompt (~3000 tok) + calibration (~400 tok) + truncated source (≤16 000 tok) + meta + argument | Up to 8 000 tok of regurgitated source + marks + JSON | 1× Sonnet 4.6 |
| 2. JSON-parse retry | `ai.js:266` | Same as above + nudge | Same | 1× Sonnet 4.6 |
| 3. Hedge/empty escalation | `ai.js:285` | Same as above | Same | 1× Sonnet 4.6 |
| 4. validateCut critique retry | `ai.js:332` | Same + critique | Same | 1× Sonnet 4.6 |
| 5–6. Fidelity retries | `ai.js:353` (`MAX_FID_RETRIES = 2`) | Same + fidelity critique | Same | 2× Sonnet 4.6 |
| 7. Paragraph-integrity rewrite | `ai.js:398` | — server side | Replaces every model paragraph with verbatim source paragraph by token-overlap match | 0 (deterministic) |

**Worst case: 6 Sonnet calls, each ~24 000 token round-trips.**

At Sonnet 4.6 list pricing (~$3/M input, ~$15/M output):
- Single happy-path call: 16k × $3/M + 8k × $15/M ≈ **$0.168 / cut**
- Worst-case retry storm: ≈ **$1.00 / cut**

### Cost drivers (ranked)

1. **Output regurgitation (~50% of every bill).** Long preset budgets 8 000 output tokens. The model is rewriting source paragraphs verbatim and stuffing marks around them. Server already throws those words away in `enforceParagraphIntegrity` (`ai.js:116`) and replaces them with verbatim source. The LLM is doing expensive work the server discards.
2. **System prompt sent uncached every call (~25%).** `buildSystemPrompt` (`server/prompts/cardCutter.js:20`) emits ~3 000 tokens of identical text on every request. `services/llm.js:141` posts to OpenRouter with no `cache_control` block — Anthropic prompt caching is OFF. With caching, ~90% of those tokens become 10× cheaper.
3. **Source over-sending (~15%).** `smartTruncate(bodyText, 16000)` (`llm.js:63`) packs paragraphs greedily from the top. For a 30-paragraph article, ~25 paragraphs go to the model when ~10 are warrant-relevant.
4. **Retry cascade (~10%).** Up to 5 follow-up calls when fidelity check fails. Each one re-sends the *same* full prompt + source.
5. **No JSON mode.** `complete()` doesn't pass `response_format`. JSON parse failures still happen and trigger retry #2.
6. **No request-level cache.** Identical (article, argument, density, length) tuples re-cut from scratch.

### Why fidelity retries even fire

Sonnet 4.6 sometimes substitutes Unicode (curly quotes, em-dash → en-dash, ligatures) or paraphrases mid-paragraph. `verifyBodyFidelity` flags it (`ai.js:207`). But the *server already has* `enforceParagraphIntegrity` that replaces the model's paragraph with the source paragraph verbatim. The fidelity retries are redundant work — the deterministic stage downstream guarantees verbatim regardless of what the model produced.

---

## 2. The core insight

**The LLM is doing the *one* job a deterministic system can do for free, and is doing it badly.**

Asked of the LLM today:
- (a) Pick which paragraphs are warrant-bearing.
- (b) Write those paragraphs out verbatim.
- (c) Place `<u>`, `**`, `==` marks inside them.
- (d) Write `tag` and `cite`.

Step (b) is pure regurgitation. The server already discards the model's paragraph text and replaces it with the source paragraph (`enforceParagraphIntegrity`). The LLM's words for that paragraph are THROWN AWAY. We are paying $0.05–0.12 per cut for tokens nobody reads.

**Solution: stop asking the LLM to retype source.** Have it emit only:
- Paragraph indices (which source paragraphs to include).
- Mark spans (paragraph index + word offsets for each `<u>`/`==`/`**` run).
- Tag + cite.

Server pulls the source paragraphs verbatim, inserts marks at the specified offsets, and emits the final card. Verbatim is **structurally impossible to violate** — the model never writes source words at all.

---

## 3. Foolproof architecture

### 3a. Wire format the LLM emits

```json
{
  "tag": "Hypersonic shock collapses U.S. nuclear C2 — extinction.",
  "cite": "Acton 24 [James Acton; Senior Fellow, Carnegie; \"...\"; Foreign Affairs; 3-12-24; carnegieendowment.org/...]",
  "picks": [
    {
      "p": 4,
      "u": [[0, 38]],
      "h": [[3, 7], [12, 14], [22, 26]],
      "b": [[12, 14], [22, 26]],
      "loudest": [22, 26]
    },
    {
      "p": 7,
      "u": [[0, 22]],
      "h": [[5, 8], [11, 14]],
      "b": [[5, 8]]
    }
  ]
}
```

- `p` = 0-indexed paragraph index in the *candidate set* the server sent (NOT the original article — server resolves).
- `u` / `h` / `b` arrays are `[wordStartIdx, wordEndIdxExclusive]` ranges into that paragraph's word array.
- `loudest` (optional) marks the single bold-underlined "loudest phrase" of the whole card.
- All structural rules are enforced by code, not by prompt suasion.

### 3b. Pipeline stages

```
┌──────────────────────────────────────────────────────────────────┐
│ STAGE 0 — paragraph filter (deterministic, 0 LLM cost)           │
│  In:  full article text                                          │
│  Out: top-K candidate paragraphs (default K=15)                  │
│  How: BM25(argument vs paragraph) + cosine(argument-embed vs     │
│       paragraph-embed) using existing services/embedder.js +     │
│       sqlite-vec. Re-rank, take top K. Always include the        │
│       neighbor (±1) of any chosen paragraph for context.         │
│  Skip the abstract/acknowledgments/refs (already done in         │
│  cardCutter.js:154 — keep that).                                 │
│  Falls back to "first 15 body paragraphs" if embedder is cold.   │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│ STAGE 1 — annotation call (1 LLM call, structured output)        │
│  Model:   Haiku 4.5 first; Sonnet 4.6 fallback only on JSON     │
│           schema-violation (rare with json_schema).              │
│  System:  ~700 token prompt (rules only, no source examples)    │
│           with cache_control: {"type":"ephemeral"} for 90% off.  │
│  User:    "ARGUMENT: ...\n\nCANDIDATES (one per line, prefixed  │
│           with [P0], [P1], ...):\n[P0] word1 word2 ...\n[P1]    │
│           ..." — only the K candidate paragraphs go through.    │
│  Output:  JSON matching the schema in 3a. ~600 tokens max.      │
│  response_format: {                                              │
│    type: "json_schema",                                          │
│    json_schema: { name: "card", strict: true, schema: {...} }   │
│  }                                                               │
│  No retries on quality. One retry only on JSON-schema violation │
│  (which json_schema mode reduces to near-zero anyway).          │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│ STAGE 2 — deterministic reconstruction (server, 0 LLM cost)      │
│  For each pick:                                                  │
│    1. Pull the verbatim source paragraph from the candidate     │
│       array by index. (100% verbatim by construction.)          │
│    2. Tokenize into words (whitespace + punctuation-attached).  │
│    3. Validate each [a,b] span:                                  │
│       - clip to [0, words.length]                                │
│       - drop spans where b <= a                                  │
│       - drop overlapping highlights (later one wins)            │
│       - drop bolds and highlights NOT contained in some <u>     │
│    4. Apply density caps from cutValidator.js (HIGHLIGHT_CAPS,  │
│       UNDERLINE_CAPS) by *trimming the lowest-priority spans*   │
│       — never by re-asking the LLM. Priority order: keep        │
│       loudest > earlier-in-paragraph > shorter > later.         │
│    5. Insert <u>, **, == marks at word boundaries.              │
│    6. Join all selected paragraphs with \n\n.                    │
│  No fidelity check needed — the text never left source.         │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│ STAGE 3 — final structural QA (server, 0 LLM cost)               │
│  - validateCut() runs as today, but should always pass because  │
│    we constructed the body to satisfy it.                       │
│  - cite override: server's buildCite() wins (already does so   │
│    at ai.js:323 — keep).                                         │
│  - Save & return.                                                │
└──────────────────────────────────────────────────────────────────┘
```

### 3c. What this guarantees by construction

| Property | Old | New |
|---|---|---|
| Every output paragraph is a *whole* source paragraph | best-effort + post-hoc repair | **structural** — paragraph IS source[idx] |
| No word is paraphrased | best-effort + 5-window fidelity check | **structural** — model never writes source words |
| `<u>` / `**` / `==` are only at word boundaries | model-discretion | **structural** — server inserts at offsets |
| Highlight cap respected | retry on violation | **structural** — server trims spans |
| `**` / `==` always inside `<u>` | retry on violation | **structural** — server validates containment |
| One `**<u>…</u>**` per card | best-effort | **structural** — server picks the highest-priority span |
| Output is valid JSON | retry on parse fail | **structural** — `json_schema` strict mode |

Every "PARAGRAPH INTEGRITY — HARD RULE" violation the prompt threatens about (`cardCutter.js:34`) becomes mathematically impossible.

### 3d. New system prompt (much shorter, cache-friendly)

The current 140-line prompt exists because the model is asked to do verbatim word-for-word reproduction — half the prompt is begging it not to paraphrase. With the new wire format, the model only emits indices and offsets; the verbatim discipline is gone from its job description.

Trim to ~50 lines:
- Schema (the JSON it must emit).
- "Argument-relevance" guide: pick warrants, skip transitions.
- Highlight craftsmanship: 1–3 words, operative verbs, magnitudes, numbers, named entities; never function words.
- Density targets (still per density preset).
- Tag rules (offensive, claim that wins the round).
- Cite rules (server overrides anyway, but model still drafts).
- 1 worked example showing the exact JSON output for a 2-paragraph excerpt — no need for the long markdown examples currently at `cardCutter.js:124–140`.

Mark this as a single cacheable block via `cache_control: { type: "ephemeral" }`. Anthropic gives 90% input-token discount on cache hits. Calibration snippet goes in the SAME cache block (it changes once a month at most).

### 3e. Density preservation

Current density logic lives in two places: the prompt (for the model) and `cutValidator.js` (for retries). New design: cutValidator becomes the *only* source of truth and runs deterministically in Stage 2:

```
heavy:    underline ≤72%, highlight ≤30%, max run 5 words
standard: underline ≤55%, highlight ≤25%, max run 5 words
minimal:  underline ≤40%, highlight ≤20%, max run 5 words
```

When the LLM emits more highlights than the cap allows, server keeps highest-priority and drops the rest. Highlight priority (configurable, sane default):
1. Spans containing numbers / years / percentages / currency
2. Spans containing operative verbs (lookup against the existing `cardCutter.js` ALWAYS HIGHLIGHT list)
3. Spans inside a paragraph the LLM marked as `loudest`
4. Earlier in card
5. Shorter span (1–3 words preferred)

Trimming is structural — no retry, no apology.

### 3f. Streaming UX

`/instant-cut` streams the card to the client as the model types. With the new design the model emits a tiny JSON blob, so token-by-token streaming buys nothing. Instead:

1. Server emits `paragraphs` event with the verbatim candidate set the moment Stage 0 finishes (already does — `ai.js:767`).
2. Client renders the chosen paragraphs in plain text the *instant* the LLM's `picks` JSON parses (one shot).
3. Marks paint in via a fast client-side animation (200–400 ms) — feels like the highlights "find" the words.

Net UX: **faster** than the current streaming experience because no source-text typing latency.

---

## 4. Edge cases & failure modes

| Risk | Mitigation |
|---|---|
| LLM returns invalid paragraph index | Server filters; if <2 valid picks remain, fall back to top-2 BM25 paragraphs unmarked. Better than 502. |
| LLM returns out-of-range word offsets | Clamp to paragraph word count; drop empty spans. |
| Pre-filter discards the actually-relevant paragraph | K=15 + neighbor inclusion is a wide net. Worst article we'd miss has many short tangential paragraphs — solve with bigger K (cap=25) when article paragraph count > 40. |
| Argument is empty / "general research" | Stage 0 falls back to "first 15 body paragraphs" — same as today's smartTruncate. |
| `json_schema` not supported on chosen model | Set fallback to grammar-style `response_format: { type: "json_object" }` then a second retry escalates to Sonnet (which supports schema strict). At most 2 calls; identical to today's parse-retry but bounded. |
| User cuts the same article + argument twice | Add request-level cache keyed by sha256(article-canonical-text + argument + density + length). 1 hour TTL. Free re-cuts on duplicates. |
| Calibration is stale | Refresh calibration snippet weekly via existing `cutterCalibration` job. Cache key includes calibration-version so stale cache invalidates automatically. |
| Edit-card flow | Same wire format, but model can also emit `{ "remove": [pIdx, ...] }` and `{ "addMarks": [...]}` ops. Server applies. Edits never touch text either. |
| Streaming retry is no longer useful | Drop it. Single-shot JSON. |
| BM25/embed adds latency | BM25 is sub-millisecond; embeddings already exist for cards in DB but new article paragraphs need on-the-fly embed. Use Voyage 3 / OpenAI text-embedding-3-small (~$0.00002 per call total for 30 paragraphs). Or skip embed entirely and use BM25 only — already strong for argument→paragraph relevance. |

---

## 5. Quantified savings

Assumptions: 30-paragraph article, "long" preset, current Sonnet 4.6 pricing.

### Current happy path
- Input: 16 000 tok × $3/M = $0.048
- Output: 5 000 tok actual (paragraphs + marks + JSON) × $15/M = $0.075
- **Total: $0.123**

### Current with retries (occurs ~25% of the time per logs)
- ~3 calls average → **$0.37**

### New happy path (Haiku 4.5, single call, prompt cached after first)
- Cached system + calibration: 3 000 tok × $0.10/M (cache read) = $0.0003
- Fresh user msg (15 paras + argument): ~1 800 tok × $1/M = $0.0018
- Output (indices + spans + tag + cite): ~600 tok × $5/M = $0.003
- **Total: ~$0.0051** → **96% cheaper than current happy path**

### New with Sonnet escalation fallback
- Fallback fires only on JSON schema violation (rare). Even at 5% trigger rate:
- Average per cut: $0.0051 × 0.95 + $0.020 × 0.05 = **$0.0058**
- **~95% cheaper than current happy path, ~98% cheaper than current with-retries average**

### Volume math
At today's `FREE_CUTCARD_DAILY = 5/user`, even a modest 200 active users = 1 000 cuts/day.
- Today: 1 000 × $0.20 (blended) = **$200/day**
- New: 1 000 × $0.006 = **$6/day**
- **Saved: $194/day, ~$70 000/year.**

(Pricing is illustrative — your OpenRouter mix may differ. Ratios are what matters.)

---

## 6. Quality (not just cost)

| Dimension | Expected change |
|---|---|
| Verbatim integrity | 99% → **100%** (structural) |
| Paragraph integrity | 95% → **100%** (structural) |
| Highlight 1-3-word discipline | improved — cutValidator runs deterministically |
| Highlight argument-coherence (read-aloud chain) | likely improved — Haiku has more headroom when not regurgitating 5 000 tokens of source |
| Tag quality | unchanged |
| Cite accuracy | unchanged (server `buildCite` already wins) |
| Latency | improved — 1 call instead of 1–6, smaller output, no streaming latency on source text |
| 502 rate | improved — fewer failure modes; structural fallback never returns "altered every paragraph" |

---

## 7. Migration plan (incremental, safe)

### Phase 1 — Prompt caching only (1 day, zero risk)
- Patch `services/llm.js` to send Anthropic `cache_control: { type: "ephemeral" }` on the system message via OpenRouter's transformations field.
- No prompt changes. ~50% input-cost reduction immediately.
- Ship behind `LLM_PROMPT_CACHE=1` env flag. Verify cache-hit rate via OpenRouter dashboard.

### Phase 2 — Pre-filter paragraphs (1–2 days, low risk)
- Add `services/argumentRelevance.js`: BM25 ranker over paragraphs given the argument.
- In `/cut-card` and `/instant-cut`, replace `smartTruncate(bodyText, 16000)` with `selectCandidates({ bodyText, argument, k: 15, neighbors: 1 })`.
- Keep the existing prompt — model still gets the candidates as a labeled article.
- Verify in shadow mode: log both selections, compare card quality on 100 cards.
- Roll forward when quality holds; ~70% input-token reduction.

### Phase 3 — Wire-format swap (2–3 days, gated)
- New endpoint `POST /api/ai/cut-card-v2` returning the same response shape but using the new prompt + JSON schema + Stage-2 reconstruction.
- Frontend opt-in via feature flag (`CARD_CUTTER_V2=1`).
- Run side-by-side on 50 cuts; compare body_markdown diff (should be ~identical paragraphs, marks may differ slightly).
- Migrate `/cut-card` to call v2 internally; old code path becomes a thin shim.

### Phase 4 — Retire retry cascade (1 day)
- Drop fidelity retries (lines 350–392). Drop validateCut retry (lines 332–345). The structural reconstruction makes them dead code.
- Keep one final json_schema retry (Haiku → Sonnet) for the rare schema violation.
- Worst-case calls per cut drops from 6 to 2.

### Phase 5 — Default to Haiku (1 day)
- Switch `CARD_CUT_MODEL` default to `anthropic/claude-haiku-4.5`.
- Sonnet stays as the json_schema fallback only.
- Monitor 1 week of cards; if quality holds (highlight-coherence score doesn't regress on the calibration suite), keep.

### Phase 6 — Request-level cache (½ day)
- Add `sha256(canonicalArticleText + argument + density + length)` cache key.
- Hit returns the saved card immediately. 1-hour TTL.
- Probably 10–20% of cuts in real usage are dupes (same article re-prepped for different speeches).

---

## 8. Files that change

| File | Change |
|---|---|
| `server/services/llm.js` | Add `cache_control` and `response_format` support; add `completeJSON({schema})` helper |
| `server/services/argumentRelevance.js` | NEW — BM25 + optional embed re-rank |
| `server/services/cardReconstructor.js` | NEW — Stage 2 deterministic body builder |
| `server/prompts/cardCutter.js` | New `buildSelectionPrompt({argument, candidates, density, length, calibration})` returning the short cache-friendly prompt; old buildSystemPrompt kept for `/edit-card` initially |
| `server/services/cutValidator.js` | Becomes the structural arbiter for span trimming; add `trimToCaps(picks, density)` |
| `server/routes/ai.js` | New v2 cut path; old retry cascade deleted in Phase 4 |
| `public/app-main.js` | Optional Phase 3 — render verbatim paragraphs immediately, animate marks in |

---

## 9. Open questions to confirm before Phase 3

1. **Model availability of strict JSON schema on OpenRouter for Haiku 4.5.** If OpenRouter doesn't pass `response_format: { type: "json_schema" }` through to Anthropic for Haiku 4.5, we use `json_object` mode + lighter validation, and accept ~1% schema retries. Worth a 10-minute spike before committing.
2. **Does the `enforceParagraphIntegrity` token-overlap matcher ever pick a *different* paragraph than the model intended?** Worth a quick log study — if yes, the new design is strictly better; if rarely, no change in behavior.
3. **K=15 sufficient?** Sample 50 long-form articles, count how many warrant paragraphs each "best card" actually drew from. Adjust K accordingly.

---

## 10. Foolproof summary

The current system uses an LLM to do four jobs, three of which are deterministic. We pay for the deterministic ones in tokens AND in retry storms when the LLM fails them.

The new system has the LLM do exactly one job — *judgment about which words matter* — and lets code do everything that code can do correctly: pull source paragraphs, place marks at word offsets, enforce density caps, validate JSON.

Result:
- 100% paragraph integrity is **structurally impossible to violate**.
- 100% verbatim is **structurally impossible to violate**.
- Highlight quality goes up because the model has more attention budget for the only job that requires intelligence.
- Cost drops ~95%.
- Latency drops because it's one call producing 600 tokens instead of one (or six) calls producing 5 000 each.
- The 502 rate drops because there are far fewer ways to fail.

This is the approach you ship.
