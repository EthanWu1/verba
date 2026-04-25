# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

`verbatim-ai` v2.0.0 — Lincoln-Douglas debate "card cutter" web app. Express server (Node ≥18) renders a vanilla-JS frontend, backed by SQLite (`better-sqlite3` + `sqlite-vec`) for cards, semantic embeddings, sessions, and the wiki/TOC indices.

## Commands

```bash
npm run dev      # nodemon server/index.js (auto-reload on changes)
npm start        # node server/index.js
npm test         # node --test (built-in test runner)
node --test server/services/__tests__/threatScorer.test.js   # run a single test file
```

Server listens on `PORT` (default `3000`). Required env in `.env` (see `.env.example`); auto-seed gates: `OPENCASELIST_USER` enables wiki seed on boot, `TOC_AUTOSEED=1` triggers TOC seed.

Helper scripts (manual, run with `node server/scripts/<file>.js`): `ingestAllZips`, `migrateJsonToSqlite`, `indexCards`, `classifyCards`, `cleanTopics`, `renormalizeTags`.

## Architecture

**Request flow.** `server/index.js` mounts route modules under `/api/*` (`ai`, `import`, `library`, `scrape`, `export`, `contentions`, `chat`, `projects`, `auth`, `mine`, `history`, `wiki`, `toc`, `rankings`), then serves `public/` statically. Page routes (`/`, `/signin`, `/app`) are explicit; `/app*` is gated by `requireAuthPage` which checks the `verba.sid` cookie via `services/auth.validateSession`. HTML is `no-store`; JS/CSS revalidate; other static assets are immutable-cached. `*` falls back to `landing.html` (no client router — multipage app).

**Data layer.** `server/services/db.js#getDb()` is the central hub (god node — 40 edges in the graph): opens the SQLite file, runs migrations, and exposes typed accessors. Every other service that touches storage goes through it. `sqlite-vec` provides KNN; `services/semanticIndex.js`, `embedder.js`, and `vectorSearch.js` form the semantic pipeline. Library search is hybrid: FTS5 + semantic with rank-fusion sort and a 0.05 cosine floor (see recent commits on `main`).

**External integrations.** `services/sources/*` are siloed search adapters (arxiv, openAlex, semanticScholar, crossref, gdelt, exa, tavily, core, jina, unpaywall, domainSearch). `services/cite/` (citoid, crossref) resolves citations. `services/instantResearch.js` and `services/scraper.js` (cheerio) orchestrate fan-out + scrape. LLM calls go through `services/llm.js`, `gemini.js`, and prompts in `server/prompts/`.

**Frontend.** `public/app.html` + `public/app-main.js` is the editor. `$()` (a jQuery-like selector helper in `app-main.js`) is the second god node — most DOM code goes through it. The mobile drawer hamburger (`#sb-open-fab`) is owned solely by the IIFE at the bottom of `app-main.js`; do not add extra handlers to it.

**Debate-specific subsystems.** `services/wikiDb.js` + `wikiIndexer.js` + `wikiCrawler.js` mirror opencaselist team pages. `services/tocDb.js` + `tocIndexer.js` + `tocParser.js` + `tocCrawler.js` index Tournament of Champions results. `services/docxBuilder.js` / `docxImport.js` / `zipImporter.js` handle Verbatim DOCX/ZIP round-trips. `services/cutValidator.js` and `prompts/cardCutter.js` enforce verbatim fidelity when the LLM "cuts" a card.

**Auth.** Cookie-based sessions (`verba.sid`), bcrypt passwords, password reset email via `services/emailSender.js` (nodemailer). `middleware/requireUser.js` gates API routes; `middleware/enforceLimit.js` applies per-user quotas backed by `services/limits.js`.

## Knowledge graph

Before answering architecture or codebase questions, consult `graphify-out/GRAPH_REPORT.md` (god nodes, communities, surprising connections). If `graphify-out/wiki/index.md` exists, navigate it instead of raw files. After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

## Mobile parity

When editing `public/*.html` or `public/assets/*.css`, also update the matching `@media (max-width:768px)` block in the same file (or `public/assets/mobile.css` for shared primitives). Every desktop change needs a matching mobile rule if it affects layout, sizing, or interaction. Full checklist: `docs/mobile-contract.md`.

---

## Behavioral guidelines

Bias toward caution over speed. For trivial tasks, use judgment.

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
