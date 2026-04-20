# Graph Report - .  (2026-04-19)

## Corpus Check
- 63 files · ~266,767 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 410 nodes · 739 edges · 41 communities detected
- Extraction: 83% EXTRACTED · 17% INFERRED · 0% AMBIGUOUS · INFERRED: 124 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]

## God Nodes (most connected - your core abstractions)
1. `getDb()` - 40 edges
2. `$()` - 32 edges
3. `run()` - 17 edges
4. `importZipToLibrary()` - 16 edges
5. `esc()` - 12 edges
6. `scrapeUrl()` - 11 edges
7. `exportToVault()` - 10 edges
8. `findBestResearchSource()` - 10 edges
9. `doSend()` - 9 edges
10. `upsertCards()` - 9 edges

## Surprising Connections (you probably didn't know these)
- `buildBodyParagraphsFromHtml()` --calls--> `$()`  [INFERRED]
  server\services\docxBuilder.js → public\app-main.js
- `htmlNodeToRuns()` --calls--> `$()`  [INFERRED]
  server\services\docxBuilder.js → public\app-main.js
- `scrapeUrl()` --calls--> `$()`  [INFERRED]
  server\services\scraper.js → public\app-main.js
- `extractJsonLd()` --calls--> `$()`  [INFERRED]
  server\services\scraper.js → public\app-main.js
- `extractTitle()` --calls--> `$()`  [INFERRED]
  server\services\scraper.js → public\app-main.js

## Hyperedges (group relationships)
- **Core LLM Coding Principles** — claude_think_before_coding, claude_simplicity_first, claude_surgical_changes, claude_goal_driven_execution [EXTRACTED 1.00]

## Communities

### Community 0 - "Community 0"
Cohesion: 0.05
Nodes (76): $(), activateJob(), appendUser(), apply(), applyHighlightToSelection(), askArgument(), autosize(), cardBodyHTML() (+68 more)

### Community 1 - "Community 1"
Cohesion: 0.06
Nodes (59): activate(), hydrateAccount(), hydrateBilling(), hydrateGeneral(), open(), createSession(), createUser(), deleteAllSessionsForUser() (+51 more)

### Community 2 - "Community 2"
Cohesion: 0.09
Nodes (40): getExistingFingerprints(), recanonicalizeGroups(), chooseCanonicals(), computeWarrantDensity(), countArgumentBreakdown(), countBreakdown(), enrichCard(), extractDocxXmlFromZip() (+32 more)

### Community 3 - "Community 3"
Cohesion: 0.12
Nodes (19): onPhase(), safeStringify(), send(), stripFormatMarks(), verifyBodyFidelity(), createKeywordMatcher(), fanoutResearch(), findBestResearchSource() (+11 more)

### Community 4 - "Community 4"
Cohesion: 0.18
Nodes (16): classifyBatch(), main(), saveResult(), callGeminiJSON(), pickBestWindow(), rankRelevance(), splitIntoWindows(), checkDailyReset() (+8 more)

### Community 5 - "Community 5"
Cohesion: 0.18
Nodes (12): load(), buildSiteFilter(), search(), extractAuthor(), extractDate(), extractJsonLd(), extractSource(), extractStructuredBody() (+4 more)

### Community 6 - "Community 6"
Cohesion: 0.16
Nodes (10): bootApp(), buildCite(), cleanAuthor(), formatDate(), inferCredentials(), parseLastName(), parseYear(), normalize() (+2 more)

### Community 7 - "Community 7"
Cohesion: 0.33
Nodes (10): buildBodyParagraphsFromHtml(), buildBodyParagraphsFromMarkdown(), buildCiteRuns(), buildDocx(), buildProjectDocx(), htmlChildrenToRuns(), htmlNodeToRuns(), makeRun() (+2 more)

### Community 8 - "Community 8"
Cohesion: 0.3
Nodes (10): buildCardNote(), buildFrontmatter(), buildIndexNote(), countBy(), ensureDir(), exportToVault(), groupBy(), readVaultPath() (+2 more)

### Community 9 - "Community 9"
Cohesion: 0.2
Nodes (12): CLAUDE.md Behavioral Guidelines, Goal-Driven Execution, GRAPH_REPORT.md, Graphify Knowledge Graph Integration, Rationale: Caution Over Speed Tradeoff, Rationale: No Speculative Code, Rationale: Clean Up Only Your Own Mess, Rationale: Verifiable Success Criteria (+4 more)

### Community 10 - "Community 10"
Cohesion: 0.35
Nodes (10): deriveAllLabels(), deriveResolutionLabel(), deriveScope(), deriveSourceLabel(), deriveTopicLabel(), deriveTypeLabel(), parseJsonArray(), titleCase() (+2 more)

### Community 11 - "Community 11"
Cohesion: 0.53
Nodes (8): buildSourceParagraphIndex(), getHighlightRuns(), normalizeForMatch(), outsideUnderlineSpans(), splitParagraphs(), stripMarks(), validateCut(), wordCount()

### Community 12 - "Community 12"
Cohesion: 0.32
Nodes (5): enforceLimit(), checkAndBudget(), getCount(), hit(), nextResetAt()

### Community 13 - "Community 13"
Cohesion: 0.67
Nodes (2): buildCutPrompt(), stripAbstractPrelude()

### Community 14 - "Community 14"
Cohesion: 0.67
Nodes (2): pickBestOaUrl(), resolveDoi()

### Community 15 - "Community 15"
Cohesion: 0.5
Nodes (2): normalizeTag(), main()

### Community 16 - "Community 16"
Cohesion: 0.67
Nodes (0): 

### Community 17 - "Community 17"
Cohesion: 1.0
Nodes (2): sendPasswordReset(), transporter()

### Community 18 - "Community 18"
Cohesion: 1.0
Nodes (0): 

### Community 19 - "Community 19"
Cohesion: 1.0
Nodes (0): 

### Community 20 - "Community 20"
Cohesion: 1.0
Nodes (0): 

### Community 21 - "Community 21"
Cohesion: 1.0
Nodes (0): 

### Community 22 - "Community 22"
Cohesion: 1.0
Nodes (0): 

### Community 23 - "Community 23"
Cohesion: 1.0
Nodes (0): 

### Community 24 - "Community 24"
Cohesion: 1.0
Nodes (0): 

### Community 25 - "Community 25"
Cohesion: 1.0
Nodes (0): 

### Community 26 - "Community 26"
Cohesion: 1.0
Nodes (0): 

### Community 27 - "Community 27"
Cohesion: 1.0
Nodes (0): 

### Community 28 - "Community 28"
Cohesion: 1.0
Nodes (0): 

### Community 29 - "Community 29"
Cohesion: 1.0
Nodes (0): 

### Community 30 - "Community 30"
Cohesion: 1.0
Nodes (0): 

### Community 31 - "Community 31"
Cohesion: 1.0
Nodes (0): 

### Community 32 - "Community 32"
Cohesion: 1.0
Nodes (0): 

### Community 33 - "Community 33"
Cohesion: 1.0
Nodes (0): 

### Community 34 - "Community 34"
Cohesion: 1.0
Nodes (0): 

### Community 35 - "Community 35"
Cohesion: 1.0
Nodes (0): 

### Community 36 - "Community 36"
Cohesion: 1.0
Nodes (0): 

### Community 37 - "Community 37"
Cohesion: 1.0
Nodes (0): 

### Community 38 - "Community 38"
Cohesion: 1.0
Nodes (0): 

### Community 39 - "Community 39"
Cohesion: 1.0
Nodes (0): 

### Community 40 - "Community 40"
Cohesion: 1.0
Nodes (0): 

## Knowledge Gaps
- **6 isolated node(s):** `Rationale: Caution Over Speed Tradeoff`, `Rationale: No Speculative Code`, `Rationale: Clean Up Only Your Own Mess`, `Rationale: Verifiable Success Criteria`, `GRAPH_REPORT.md` (+1 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 18`** (2 nodes): `jsonFetch()`, `api.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 19`** (2 nodes): `loadProjects()`, `export.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 20`** (2 nodes): `fingerprint()`, `mine.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 21`** (2 nodes): `resolve()`, `citoid.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 22`** (2 nodes): `search()`, `arxiv.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 23`** (2 nodes): `search()`, `core.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 24`** (2 nodes): `search()`, `crossref.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 25`** (2 nodes): `search()`, `exa.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 26`** (2 nodes): `search()`, `gdelt.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 27`** (2 nodes): `fetchViaJina()`, `jina.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 28`** (2 nodes): `search()`, `openAlex.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 29`** (2 nodes): `search()`, `semanticScholar.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 30`** (2 nodes): `tavily.js`, `search()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 31`** (2 nodes): `useTempDb()`, `_helpers.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 32`** (1 nodes): `index.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 33`** (1 nodes): `chat.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 34`** (1 nodes): `history.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 35`** (1 nodes): `import.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 36`** (1 nodes): `library.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 37`** (1 nodes): `scrape.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 38`** (1 nodes): `instant-research.test.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 39`** (1 nodes): `limits.test.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 40`** (1 nodes): `project-cleanup.test.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `getDb()` connect `Community 1` to `Community 2`, `Community 4`, `Community 12`, `Community 15`?**
  _High betweenness centrality (0.354) - this node is a cross-community bridge._
- **Why does `hydrateAccount()` connect `Community 1` to `Community 0`?**
  _High betweenness centrality (0.223) - this node is a cross-community bridge._
- **Are the 22 inferred relationships involving `getDb()` (e.g. with `ownedProject()` and `saveResult()`) actually correct?**
  _`getDb()` has 22 INFERRED edges - model-reasoned connections that need verification._
- **Are the 9 inferred relationships involving `$()` (e.g. with `buildBodyParagraphsFromHtml()` and `htmlNodeToRuns()`) actually correct?**
  _`$()` has 9 INFERRED edges - model-reasoned connections that need verification._
- **Are the 16 inferred relationships involving `run()` (e.g. with `saveResult()` and `upsertCards()`) actually correct?**
  _`run()` has 16 INFERRED edges - model-reasoned connections that need verification._
- **Are the 10 inferred relationships involving `importZipToLibrary()` (e.g. with `main()` and `previewZipImport()`) actually correct?**
  _`importZipToLibrary()` has 10 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Rationale: Caution Over Speed Tradeoff`, `Rationale: No Speculative Code`, `Rationale: Clean Up Only Your Own Mess` to the rest of the system?**
  _6 weakly-connected nodes found - possible documentation gaps or missing edges._