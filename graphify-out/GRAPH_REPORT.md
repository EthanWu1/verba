# Graph Report - C:/Users/ethan/OneDrive/Desktop/verba  (2026-04-15)

## Corpus Check
- Corpus is ~12,004 words - fits in a single context window. You may not need a graph.

## Summary
- 188 nodes · 365 edges · 19 communities detected
- Extraction: 90% EXTRACTED · 10% INFERRED · 0% AMBIGUOUS · INFERRED: 38 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_UI Workbench Rendering|UI Workbench Rendering]]
- [[_COMMUNITY_Card Processing & DOCX Import|Card Processing & DOCX Import]]
- [[_COMMUNITY_Research & Web Search|Research & Web Search]]
- [[_COMMUNITY_Library Query & Chat|Library Query & Chat]]
- [[_COMMUNITY_Citation Parsing|Citation Parsing]]
- [[_COMMUNITY_Obsidian Export|Obsidian Export]]
- [[_COMMUNITY_Text Scoring & Extraction|Text Scoring & Extraction]]
- [[_COMMUNITY_Dev Guidelines & Graphify|Dev Guidelines & Graphify]]
- [[_COMMUNITY_DOCX Generation|DOCX Generation]]
- [[_COMMUNITY_ZIP Import|ZIP Import]]
- [[_COMMUNITY_Card Cutting Prompts|Card Cutting Prompts]]
- [[_COMMUNITY_AI  LLM Interface|AI / LLM Interface]]
- [[_COMMUNITY_Server Entry|Server Entry]]
- [[_COMMUNITY_Export Route|Export Route]]
- [[_COMMUNITY_Import Route|Import Route]]
- [[_COMMUNITY_Library Route|Library Route]]
- [[_COMMUNITY_Scrape Route|Scrape Route]]
- [[_COMMUNITY_Research Tests|Research Tests]]
- [[_COMMUNITY_Cleanup Tests|Cleanup Tests]]

## God Nodes (most connected - your core abstractions)
1. `text()` - 12 edges
2. `runResearch()` - 11 edges
3. `scrapeUrl()` - 11 edges
4. `$()` - 9 edges
5. `init()` - 9 edges
6. `exportToVault()` - 9 edges
7. `hydrateCard()` - 8 edges
8. `syncEditorToState()` - 8 edges
9. `importZipToLibrary()` - 8 edges
10. `loadMeta()` - 8 edges

## Surprising Connections (you probably didn't know these)
- `buildBodyParagraphsFromHtml()` --calls--> `$()`  [INFERRED]
  server\services\docxBuilder.js → public\app.js
- `htmlNodeToRuns()` --calls--> `$()`  [INFERRED]
  server\services\docxBuilder.js → public\app.js
- `loadSearchResults()` --calls--> `$()`  [INFERRED]
  server\services\instantResearch.js → public\app.js
- `exportToVault()` --calls--> `loadCards()`  [INFERRED]
  scripts\export-to-obsidian.js → server\services\libraryStore.js
- `exportToVault()` --calls--> `loadMeta()`  [INFERRED]
  scripts\export-to-obsidian.js → server\services\libraryStore.js

## Hyperedges (group relationships)
- **Core LLM Coding Principles** — claude_think_before_coding, claude_simplicity_first, claude_surgical_changes, claude_goal_driven_execution [EXTRACTED 1.00]

## Communities

### Community 0 - "UI Workbench Rendering"
Cohesion: 0.12
Nodes (35): appendModelSummary(), applyWrap(), bind(), cardMarkup(), cardPreviewMarkup(), closeWorkbench(), condenseParagraphs(), esc() (+27 more)

### Community 1 - "Card Processing & DOCX Import"
Cohesion: 0.12
Nodes (30): chooseCanonicals(), computeWarrantDensity(), countBreakdown(), enrichCard(), execFileAsync(), extractDocxXmlFromZip(), extractParagraphs(), fingerprintBody() (+22 more)

### Community 2 - "Research & Web Search"
Cohesion: 0.22
Nodes (13): createKeywordMatcher(), findBestResearchSource(), isBadResearchCandidate(), loadBingRssResults(), loadSearchResults(), normalizeText(), pickBestExcerpt(), scoreTextForQuery() (+5 more)

### Community 3 - "Library Query & Chat"
Cohesion: 0.26
Nodes (14): applyFilters(), buildChatContext(), countOptions(), getHydratedCards(), getLibraryAnalytics(), getLibraryCards(), hydrateCard(), inferResolution() (+6 more)

### Community 4 - "Citation Parsing"
Cohesion: 0.23
Nodes (12): buildCite(), formatDate(), inferCredentials(), parseLastName(), parseYear(), checkDailyReset(), complete(), estimateTokens() (+4 more)

### Community 5 - "Obsidian Export"
Cohesion: 0.3
Nodes (10): buildCardNote(), buildFrontmatter(), buildIndexNote(), countBy(), ensureDir(), exportToVault(), groupBy(), readVaultPath() (+2 more)

### Community 6 - "Text Scoring & Extraction"
Cohesion: 0.38
Nodes (11): $(), scoreCard(), text(), tokenize(), cleanText(), extractAuthor(), extractDate(), extractSource() (+3 more)

### Community 7 - "Dev Guidelines & Graphify"
Cohesion: 0.2
Nodes (12): CLAUDE.md Behavioral Guidelines, Goal-Driven Execution, GRAPH_REPORT.md, Graphify Knowledge Graph Integration, Rationale: Caution Over Speed Tradeoff, Rationale: No Speculative Code, Rationale: Clean Up Only Your Own Mess, Rationale: Verifiable Success Criteria (+4 more)

### Community 8 - "DOCX Generation"
Cohesion: 0.38
Nodes (10): baseState(), buildBodyParagraphsFromHtml(), buildBodyParagraphsFromMarkdown(), buildCiteRuns(), buildDocx(), htmlChildrenToRuns(), htmlNodeToRuns(), makeRun() (+2 more)

### Community 9 - "ZIP Import"
Cohesion: 0.6
Nodes (5): execTar(), listZipEntries(), previewZipImport(), resolveProjectPath(), summarizeEntries()

### Community 10 - "Card Cutting Prompts"
Cohesion: 0.67
Nodes (0): 

### Community 11 - "AI / LLM Interface"
Cohesion: 0.67
Nodes (0): 

### Community 12 - "Server Entry"
Cohesion: 1.0
Nodes (0): 

### Community 13 - "Export Route"
Cohesion: 1.0
Nodes (0): 

### Community 14 - "Import Route"
Cohesion: 1.0
Nodes (0): 

### Community 15 - "Library Route"
Cohesion: 1.0
Nodes (0): 

### Community 16 - "Scrape Route"
Cohesion: 1.0
Nodes (0): 

### Community 17 - "Research Tests"
Cohesion: 1.0
Nodes (0): 

### Community 18 - "Cleanup Tests"
Cohesion: 1.0
Nodes (0): 

## Knowledge Gaps
- **6 isolated node(s):** `Rationale: Caution Over Speed Tradeoff`, `Rationale: No Speculative Code`, `Rationale: Clean Up Only Your Own Mess`, `Rationale: Verifiable Success Criteria`, `GRAPH_REPORT.md` (+1 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Server Entry`** (1 nodes): `index.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Export Route`** (1 nodes): `export.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Import Route`** (1 nodes): `import.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Library Route`** (1 nodes): `library.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Scrape Route`** (1 nodes): `scrape.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Research Tests`** (1 nodes): `instant-research.test.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Cleanup Tests`** (1 nodes): `project-cleanup.test.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `$()` connect `Text Scoring & Extraction` to `UI Workbench Rendering`, `DOCX Generation`, `Research & Web Search`?**
  _High betweenness centrality (0.085) - this node is a cross-community bridge._
- **Why does `loadMeta()` connect `Card Processing & DOCX Import` to `Library Query & Chat`, `Obsidian Export`?**
  _High betweenness centrality (0.043) - this node is a cross-community bridge._
- **Why does `exportToVault()` connect `Obsidian Export` to `Card Processing & DOCX Import`?**
  _High betweenness centrality (0.035) - this node is a cross-community bridge._
- **Are the 4 inferred relationships involving `text()` (e.g. with `scrapeUrl()` and `extractTitle()`) actually correct?**
  _`text()` has 4 INFERRED edges - model-reasoned connections that need verification._
- **Are the 4 inferred relationships involving `scrapeUrl()` (e.g. with `findBestResearchSource()` and `scrapeArticleWithFallback()`) actually correct?**
  _`scrapeUrl()` has 4 INFERRED edges - model-reasoned connections that need verification._
- **Are the 8 inferred relationships involving `$()` (e.g. with `buildBodyParagraphsFromHtml()` and `htmlNodeToRuns()`) actually correct?**
  _`$()` has 8 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Rationale: Caution Over Speed Tradeoff`, `Rationale: No Speculative Code`, `Rationale: Clean Up Only Your Own Mess` to the rest of the system?**
  _6 weakly-connected nodes found - possible documentation gaps or missing edges._