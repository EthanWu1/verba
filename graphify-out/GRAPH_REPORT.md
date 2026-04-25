# Graph Report - .  (2026-04-25)

## Corpus Check
- 130 files · ~386,417 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 808 nodes · 1627 edges · 68 communities detected
- Extraction: 71% EXTRACTED · 29% INFERRED · 0% AMBIGUOUS · INFERRED: 479 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 64|Community 64]]
- [[_COMMUNITY_Community 65|Community 65]]
- [[_COMMUNITY_Community 66|Community 66]]
- [[_COMMUNITY_Community 67|Community 67]]

## God Nodes (most connected - your core abstractions)
1. `getDb()` - 111 edges
2. `get()` - 73 edges
3. `push()` - 63 edges
4. `run()` - 43 edges
5. `now()` - 31 edges
6. `set()` - 27 edges
7. `$()` - 26 edges
8. `indexTournament()` - 24 edges
9. `importZipToLibrary()` - 18 edges
10. `crawlTeamDetail()` - 17 edges

## Surprising Connections (you probably didn't know these)
- `push()` --calls--> `dedupeByUrl()`  [INFERRED]
  public\lib\alertToast.js → server\services\instantResearch.js
- `requireAuthPage()` --calls--> `validateSession()`  [INFERRED]
  server\index.js → server\services\auth.js
- `getDb()` --calls--> `listSeasons()`  [INFERRED]
  server\services\db.js → server\services\rankingsDb.js
- `getDb()` --calls--> `history()`  [INFERRED]
  server\services\db.js → server\services\rankingsDb.js
- `get()` --calls--> `unwrapDuckDuckGoUrl()`  [INFERRED]
  server\services\fileCache.js → server\services\sources\domainSearch.js

## Hyperedges (group relationships)
- **Core LLM Coding Principles** — claude_think_before_coding, claude_simplicity_first, claude_surgical_changes, claude_goal_driven_execution [EXTRACTED 1.00]

## Communities

### Community 0 - "Community 0"
Cohesion: 0.03
Nodes (97): activate(), activeItem(), apply(), applyHighlightToSelection(), applyRoute(), applyState(), askArgument(), cardBodyHTML() (+89 more)

### Community 1 - "Community 1"
Cohesion: 0.05
Nodes (87): createSession(), createUser(), deleteAllSessionsForUser(), deleteSession(), findUserById(), _insertUserSync(), linkGoogleSub(), _newId() (+79 more)

### Community 2 - "Community 2"
Cohesion: 0.04
Nodes (80): _backfillDerivedLabels(), _backfillHasHighlight(), _backfillHighlightWordCount(), _buildFtsMatch(), _buildWhere(), countCards(), _ensureAnalyzed(), facetCounts() (+72 more)

### Community 3 - "Community 3"
Cohesion: 0.04
Nodes (60): set(), search(), findUserByEmail(), findUserByGoogleSub(), cacheGet(), cacheSet(), retrieveAnalytics(), retrieveCards() (+52 more)

### Community 4 - "Community 4"
Cohesion: 0.06
Nodes (42): ensureStack(), ensureStyle(), esc(), push(), buildCutPrompt(), stripAbstractPrelude(), stripBoilerplateSections(), decodeXml() (+34 more)

### Community 5 - "Community 5"
Cohesion: 0.12
Nodes (28): $(), closeProjModal(), openProjModal(), refreshNavCounts(), $(), load(), buildBodyParagraphsFromHtml(), buildBodyParagraphsFromMarkdown() (+20 more)

### Community 6 - "Community 6"
Cohesion: 0.1
Nodes (23): onPhase(), safeStringify(), send(), stripFormatMarks(), verifyBodyFidelity(), createKeywordMatcher(), dedupeByUrl(), extractDoi() (+15 more)

### Community 7 - "Community 7"
Cohesion: 0.11
Nodes (21): bootApp(), buildCite(), cleanAuthor(), formatDate(), inferCredentials(), parseLastName(), parseYear(), normalize() (+13 more)

### Community 8 - "Community 8"
Cohesion: 0.13
Nodes (23): refreshUsage(), setHighlightMode(), close(), renderBlockHtml(), toggle(), buildCopyHtml(), buildCopyPlain(), esc() (+15 more)

### Community 9 - "Community 9"
Cohesion: 0.16
Nodes (22): $(), attachEntryClicks(), bidClass(), bindStatic(), dedupeEvents(), esc(), isPastTournament(), loadEventBody() (+14 more)

### Community 10 - "Community 10"
Cohesion: 0.13
Nodes (18): init(), initComposer(), show(), getSelectedIds(), close(), open(), outsideClose(), listMessages() (+10 more)

### Community 11 - "Community 11"
Cohesion: 0.23
Nodes (15): addPasted(), close(), ensureWired(), escapeHtml(), iconFor(), open(), refreshList(), renderRow() (+7 more)

### Community 12 - "Community 12"
Cohesion: 0.21
Nodes (15): cardBlob(), classifyCutCard(), fingerprint(), saveCutCardForUser(), stripFormatMarks(), deriveAllLabels(), deriveResolutionLabel(), deriveScope() (+7 more)

### Community 13 - "Community 13"
Cohesion: 0.25
Nodes (14): $(), bind(), buildPageWindow(), chevronSvg(), esc(), gotoPage(), load(), loadSeasons() (+6 more)

### Community 14 - "Community 14"
Cohesion: 0.2
Nodes (12): CLAUDE.md Behavioral Guidelines, Goal-Driven Execution, GRAPH_REPORT.md, Graphify Knowledge Graph Integration, Rationale: Caution Over Speed Tradeoff, Rationale: No Speculative Code, Rationale: Clean Up Only Your Own Mess, Rationale: Verifiable Success Criteria (+4 more)

### Community 15 - "Community 15"
Cohesion: 0.47
Nodes (9): fetchCaselists(), fetchCites(), fetchRounds(), fetchSchools(), fetchTeams(), _get(), _login(), _sleep() (+1 more)

### Community 16 - "Community 16"
Cohesion: 0.36
Nodes (5): bodyPrefix(), bodyScore(), groupKeyFor(), highlightWordCount(), normalizeCite()

### Community 17 - "Community 17"
Cohesion: 0.39
Nodes (6): aggregateBallotsToResult(), applyElo(), expectedScore(), kBase(), kMult(), recomputeRatings()

### Community 18 - "Community 18"
Cohesion: 0.43
Nodes (5): alreadyEmbedded(), ensureSchema(), knn(), _loadVecExt(), upsertEmbedding()

### Community 19 - "Community 19"
Cohesion: 0.67
Nodes (5): isWord(), snapEnd(), snapStart(), snapToWordBoundaries(), wordAt()

### Community 20 - "Community 20"
Cohesion: 0.4
Nodes (0): 

### Community 21 - "Community 21"
Cohesion: 0.67
Nodes (2): normalizeMinMax(), scoreEntries()

### Community 22 - "Community 22"
Cohesion: 0.67
Nodes (0): 

### Community 23 - "Community 23"
Cohesion: 0.67
Nodes (0): 

### Community 24 - "Community 24"
Cohesion: 1.0
Nodes (2): sendPasswordReset(), transporter()

### Community 25 - "Community 25"
Cohesion: 1.0
Nodes (2): shortenDisplayName(), withShortenedName()

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

### Community 41 - "Community 41"
Cohesion: 1.0
Nodes (0): 

### Community 42 - "Community 42"
Cohesion: 1.0
Nodes (0): 

### Community 43 - "Community 43"
Cohesion: 1.0
Nodes (0): 

### Community 44 - "Community 44"
Cohesion: 1.0
Nodes (0): 

### Community 45 - "Community 45"
Cohesion: 1.0
Nodes (0): 

### Community 46 - "Community 46"
Cohesion: 1.0
Nodes (0): 

### Community 47 - "Community 47"
Cohesion: 1.0
Nodes (0): 

### Community 48 - "Community 48"
Cohesion: 1.0
Nodes (0): 

### Community 49 - "Community 49"
Cohesion: 1.0
Nodes (0): 

### Community 50 - "Community 50"
Cohesion: 1.0
Nodes (0): 

### Community 51 - "Community 51"
Cohesion: 1.0
Nodes (0): 

### Community 52 - "Community 52"
Cohesion: 1.0
Nodes (0): 

### Community 53 - "Community 53"
Cohesion: 1.0
Nodes (0): 

### Community 54 - "Community 54"
Cohesion: 1.0
Nodes (0): 

### Community 55 - "Community 55"
Cohesion: 1.0
Nodes (0): 

### Community 56 - "Community 56"
Cohesion: 1.0
Nodes (0): 

### Community 57 - "Community 57"
Cohesion: 1.0
Nodes (0): 

### Community 58 - "Community 58"
Cohesion: 1.0
Nodes (0): 

### Community 59 - "Community 59"
Cohesion: 1.0
Nodes (0): 

### Community 60 - "Community 60"
Cohesion: 1.0
Nodes (0): 

### Community 61 - "Community 61"
Cohesion: 1.0
Nodes (0): 

### Community 62 - "Community 62"
Cohesion: 1.0
Nodes (0): 

### Community 63 - "Community 63"
Cohesion: 1.0
Nodes (0): 

### Community 64 - "Community 64"
Cohesion: 1.0
Nodes (0): 

### Community 65 - "Community 65"
Cohesion: 1.0
Nodes (0): 

### Community 66 - "Community 66"
Cohesion: 1.0
Nodes (0): 

### Community 67 - "Community 67"
Cohesion: 1.0
Nodes (0): 

## Knowledge Gaps
- **6 isolated node(s):** `Rationale: Caution Over Speed Tradeoff`, `Rationale: No Speculative Code`, `Rationale: Clean Up Only Your Own Mess`, `Rationale: Verifiable Success Criteria`, `GRAPH_REPORT.md` (+1 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 26`** (2 nodes): `jsonFetch()`, `api.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 27`** (2 nodes): `filterEvidenceClient()`, `app-main.search.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 28`** (2 nodes): `mount()`, `cmdPalette.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 29`** (2 nodes): `isDirty()`, `isDirty.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 30`** (2 nodes): `isCaselistZip()`, `import-caselist.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 31`** (2 nodes): `pickChatMaxTokens()`, `chatBrevity.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 32`** (2 nodes): `loadProjects()`, `export.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 33`** (2 nodes): `fingerprint()`, `mine.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 34`** (2 nodes): `_validateEvent()`, `rankings.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 35`** (2 nodes): `wiki.js`, `_safeFilename()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 36`** (2 nodes): `search()`, `exa.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 37`** (2 nodes): `tavily.js`, `search()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 38`** (2 nodes): `ids()`, `evidence-random.test.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 39`** (2 nodes): `tocParser.test.js`, `make()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 40`** (2 nodes): `useTempDb()`, `_helpers.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 41`** (1 nodes): `force-crawl.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 42`** (1 nodes): `probe-ocl.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 43`** (1 nodes): `probe-rounds.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 44`** (1 nodes): `probe-tabroom.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 45`** (1 nodes): `_count-canon.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 46`** (1 nodes): `history.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 47`** (1 nodes): `import.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 48`** (1 nodes): `scrape.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 49`** (1 nodes): `tabroom.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 50`** (1 nodes): `threatScorer.test.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 51`** (1 nodes): `cardCutter-prompt.test.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 52`** (1 nodes): `carousel.test.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 53`** (1 nodes): `chat-brevity.test.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 54`** (1 nodes): `chatCommands.test.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 55`** (1 nodes): `chatRetrieval.test.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 56`** (1 nodes): `chatStore.test.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 57`** (1 nodes): `clipboard.test.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 58`** (1 nodes): `evidence-search.test.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 59`** (1 nodes): `expand-command.test.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 60`** (1 nodes): `instant-research.test.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 61`** (1 nodes): `isDirty.test.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 62`** (1 nodes): `limits.test.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 63`** (1 nodes): `project-cleanup.test.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 64`** (1 nodes): `rankingsEngine.test.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 65`** (1 nodes): `slash-enter.test.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 66`** (1 nodes): `wordAt.test.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 67`** (1 nodes): `wordSnap.test.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `push()` connect `Community 4` to `Community 0`, `Community 1`, `Community 2`, `Community 3`, `Community 5`, `Community 6`, `Community 8`, `Community 13`, `Community 17`?**
  _High betweenness centrality (0.242) - this node is a cross-community bridge._
- **Why does `get()` connect `Community 3` to `Community 1`, `Community 2`, `Community 5`, `Community 6`, `Community 7`, `Community 8`, `Community 9`, `Community 10`, `Community 12`, `Community 15`, `Community 17`, `Community 18`?**
  _High betweenness centrality (0.240) - this node is a cross-community bridge._
- **Why does `getDb()` connect `Community 1` to `Community 0`, `Community 2`, `Community 3`, `Community 4`, `Community 10`, `Community 11`, `Community 12`, `Community 17`, `Community 18`?**
  _High betweenness centrality (0.149) - this node is a cross-community bridge._
- **Are the 92 inferred relationships involving `getDb()` (e.g. with `main()` and `ownedProject()`) actually correct?**
  _`getDb()` has 92 INFERRED edges - model-reasoned connections that need verification._
- **Are the 72 inferred relationships involving `get()` (e.g. with `dedupeEvents()` and `groupBySchool()`) actually correct?**
  _`get()` has 72 INFERRED edges - model-reasoned connections that need verification._
- **Are the 59 inferred relationships involving `push()` (e.g. with `toast()` and `pushPhase()`) actually correct?**
  _`push()` has 59 INFERRED edges - model-reasoned connections that need verification._
- **Are the 42 inferred relationships involving `run()` (e.g. with `saveResult()` and `upsertCards()`) actually correct?**
  _`run()` has 42 INFERRED edges - model-reasoned connections that need verification._