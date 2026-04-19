# Cite Propagation, Assistant Add-Card, Toolbar Toggle Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make scholarly sources cite with real author+date, ensure card-cutter uses Claude Sonnet 4.6, fix assistant panel so chip-click saves the full card (not just tagline) with clear visual confirmation and only-highlighted-body filter, and make the formatting toolbar (Highlight/Underline/Bold) behave as proper toggles with persistent highlight mode.

**Architecture:**
- **Cite propagation**: enrich adapter candidates with author/date/doi fields upstream so `buildCite` has more than `[No Author]` to work with, and fall back to Unpaywall DOI + Crossref lookup when a scholarly URL is present.
- **Model revert**: pin `CARD_CUT_MODEL` to `anthropic/claude-sonnet-4.6` via `.env` and audit call sites.
- **Assistant save-card**: expand SSE chip protocol `[[CARD|id|cite|qual|preview]]` so the chip carries a real card ID; client looks up the full card record by ID, saves it, and animates a "Saved" confirmation.
- **Toolbar toggles**: replace single-fire `document.execCommand` calls with a stateful toggle. `Underline` strips existing `<u>` spans inside the selection; `Highlight` becomes a latched mode where any selection toggles highlight state; clicking the button a second time deactivates the mode.

**Tech Stack:** Node.js (Express), OpenRouter (Claude Sonnet 4.6), vanilla JS client, Crossref/Citoid for citation fill, Unpaywall for OA URL upgrade.

---

## File Structure

**Create:**
- (none — this is all modifications to existing files)

**Modify:**
- `server/services/sources/semanticScholar.js` — ensure adapter returns `author`, `date`, `doi` on each candidate
- `server/services/sources/openAlex.js` — same
- `server/services/sources/crossref.js` — same
- `server/services/sources/unpaywall.js` — already returns author/date/doi, verify shape
- `server/services/instantResearch.js` — propagate `author`, `date`, `doi` from the winning candidate into the article object used for cite building
- `server/services/autocite.js` — expand DOI detection to arxiv IDs and scholarly URLs, fall back to Unpaywall→Crossref on DOI
- `server/routes/ai.js` — pass `candidate.doi` into `buildCite`; remove any model override that isn't Claude Sonnet
- `.env` — ensure `CARD_CUT_MODEL=anthropic/claude-sonnet-4.6` (or unset so default wins)
- `server/routes/chat.js` — change chip token to `[[CARD|id|cite|qual|preview]]`; include a short lookup ID when a library card matches; update system prompt example
- `server/services/libraryQuery.js` (if it injects cards into context) — expose the matched card IDs in the candidates list
- `public/app-main.js` — update `CARD_RE` to accept 5 fields; `buildCardChip` takes `id` and looks up full card on click; add "Saved ✓" animation; gate chip render on `body_markdown` containing `==`; rewrite format-toolbar handler for toggles + latched highlight
- `public/app.html` — add `.pane-fmt-tools .tool-btn.active` style so latched Highlight button is visibly on; add `.ap-card-chip.saved` style for confirmation flash

---

## Task 1: Ensure scholarly adapters emit author/date/doi

**Files:**
- Modify: `server/services/sources/semanticScholar.js`
- Modify: `server/services/sources/openAlex.js`
- Modify: `server/services/sources/crossref.js`
- Modify: `server/services/sources/unpaywall.js` (audit only)

- [ ] **Step 1: Open each adapter and confirm return shape**

Every candidate object must contain `{ url, title, source, author, date, doi }`. If any field is missing, add it.

For `semanticScholar.js`, the S2 API returns `authors[]` (array of `{name}`) and `externalIds.DOI`. Normalize:

```js
return results.map(p => ({
  url: p.url || (p.externalIds?.DOI ? `https://doi.org/${p.externalIds.DOI}` : ''),
  title: p.title || '',
  source: p.venue || p.journal?.name || 'Semantic Scholar',
  author: (p.authors || []).map(a => a.name).filter(Boolean).join(', '),
  date: p.year ? String(p.year) : '',
  doi: p.externalIds?.DOI || '',
  excerpt: p.abstract || '',
})).filter(r => r.url);
```

For `openAlex.js`, OpenAlex returns `authorships[].author.display_name`:

```js
return results.map(w => ({
  url: w.primary_location?.source?.host_organization_name ? w.doi : (w.id || ''),
  title: w.title || '',
  source: w.primary_location?.source?.display_name || '',
  author: (w.authorships || []).map(a => a.author?.display_name).filter(Boolean).join(', '),
  date: w.publication_date || (w.publication_year ? String(w.publication_year) : ''),
  doi: (w.doi || '').replace(/^https?:\/\/doi\.org\//, ''),
  excerpt: w.abstract_inverted_index ? '' : '',
})).filter(r => r.url);
```

For `crossref.js`, the REST API returns `author[]` with `given`/`family`:

```js
return items.map(m => ({
  url: m.URL || (m.DOI ? `https://doi.org/${m.DOI}` : ''),
  title: Array.isArray(m.title) ? m.title[0] : '',
  source: Array.isArray(m['container-title']) ? m['container-title'][0] : '',
  author: (m.author || []).map(a => [a.given, a.family].filter(Boolean).join(' ')).filter(Boolean).join(', '),
  date: m.issued?.['date-parts']?.[0]?.join('-') || '',
  doi: m.DOI || '',
  excerpt: m.abstract || '',
})).filter(r => r.url);
```

For `unpaywall.js`, already returns `author`, `date`, `doi` — confirm by reading the file and diffing against the shape above.

- [ ] **Step 2: Smoke test each adapter**

Start the server: `cd server && npm run dev`
In a scratch node REPL:

```js
const ss = require('./server/services/sources/semanticScholar');
ss.search('nuclear deterrence', 3).then(r => console.log(JSON.stringify(r[0], null, 2)));
```

Expected: `author`, `date`, `doi` all populated on the first result.
Repeat for openAlex, crossref, unpaywall.

- [ ] **Step 3: Commit**

```bash
git add server/services/sources/
git commit -m "feat(sources): emit author/date/doi on every scholarly candidate"
```

---

## Task 2: Propagate candidate metadata into scraped article

**Files:**
- Modify: `server/services/instantResearch.js:126-165` (scrapeWithConcurrency)
- Modify: `server/services/instantResearch.js:218-285` (findBestResearchSource — ranking/winner block)

- [ ] **Step 1: Merge candidate metadata into article during scrape**

In `scrapeWithConcurrency`, after a successful scrape of URL `c.url`, the scraper returns an `article` object that often lacks author/date because publisher pages don't expose meta tags cleanly. The adapter already knows author/date/doi — merge them in as fallback:

```js
if (bt && !looksAbstractOnly && !bt.startsWith('[SCRAPE LIMITED]')) {
  const enriched = {
    ...article,
    author: article.author || c.author || '',
    date: article.date || c.date || '',
    doi: article.doi || c.doi || '',
    source: article.source || c.source || '',
    title: article.title || c.title || '',
  };
  if (onPhase) onPhase({ type: 'scrape_done', url: c.url, chars: bt.length });
  out.push({ candidate: c, article: enriched });
  continue;
}
```

Apply the same enrichment in the Jina-mirror fallback block inside the same function.

- [ ] **Step 2: Also enrich in the single-URL branch of findBestResearchSource**

In the `if (url.trim())` branch, after scraping, merge in DOI lookup:

```js
const article = await withTimeout(scrapeUrl(finalUrl), 12000, 'scrape-url');
// Try DOI detection from URL for cite fill
const doiMatch = finalUrl.match(/doi\.org\/(10\.\d+\/[^\s?#]+)/i);
if (doiMatch && !article.doi) article.doi = doiMatch[1];
```

- [ ] **Step 3: Verify by running a known scholarly query**

Start server. Hit `/api/research-source-stream?query=reflective%20endorsement%20normativity&argument=test` and log the `source` event payload. Expect `article.author` and `article.date` to be non-empty for a Semantic Scholar hit.

- [ ] **Step 4: Commit**

```bash
git add server/services/instantResearch.js
git commit -m "feat(instantResearch): merge adapter author/date/doi into scraped article"
```

---

## Task 3: Expand autocite to use DOI from scholarly sources

**Files:**
- Modify: `server/services/autocite.js:7-30`

- [ ] **Step 1: Accept a `doi` field on the meta object and prefer it**

Replace the DOI-detection block:

```js
async function buildCite(meta, { inferQuals = true } = {}) {
  let title  = String(meta.title || '').trim();
  let author = cleanAuthor(meta.author);
  let date   = String(meta.date || '').trim();
  let source = String(meta.source || '').trim();
  const url  = String(meta.url || '').trim();
  const explicitDoi = String(meta.doi || '').trim();

  if ((!author || !date) && (url || explicitDoi)) {
    const doiFromUrl = url.match(/doi\.org\/(10\.\d+\/[^\s?#]+)/i)?.[1];
    const doiFromTitle = title.match(/10\.\d+\/[^\s?#]+/)?.[0];
    const doi = explicitDoi || doiFromUrl || doiFromTitle;
    const thirdParty =
      (doi ? await crossref.resolve({ doi }) : null)
      || await citoid.resolve(url)
      || (title ? await crossref.resolve({ title }) : null);
    if (thirdParty) {
      if (!author && thirdParty.author) author = cleanAuthor(thirdParty.author);
      if (!date && thirdParty.date) date = thirdParty.date;
      if (!title && thirdParty.title) title = thirdParty.title;
      if (!source && thirdParty.source) source = thirdParty.source;
    }
  }
  // ...rest unchanged
```

- [ ] **Step 2: Pass doi from ai.js into buildCite**

In `server/routes/ai.js` around line 353, extend the meta passed to `buildCite`:

```js
citeData = await buildCite({
  ...result.article,
  doi: result.article.doi || '',
}, { inferQuals: true });
```

- [ ] **Step 3: Manual test**

Cut a card from a Semantic Scholar / OpenAlex URL. Short-cite should now read `Korsgaard '96` not `[No Author]`.

- [ ] **Step 4: Commit**

```bash
git add server/services/autocite.js server/routes/ai.js
git commit -m "feat(cite): route adapter DOIs into Crossref resolver"
```

---

## Task 4: Pin card-cutter model to Claude Sonnet 4.6

**Files:**
- Modify: `.env`
- Modify: `server/routes/ai.js:22`

- [ ] **Step 1: Read current .env**

```bash
grep -n CARD_CUT_MODEL .env || echo "not set"
```

- [ ] **Step 2: Ensure the env line pins Sonnet 4.6**

In `.env`:

```
CARD_CUT_MODEL=anthropic/claude-sonnet-4.6
```

If the line is missing or points elsewhere, set it exactly as above.

- [ ] **Step 3: Confirm ai.js default matches and no call site overrides it**

Verify `server/routes/ai.js:22`:

```js
const CARD_CUT_MODEL = process.env.CARD_CUT_MODEL || 'anthropic/claude-sonnet-4.6';
```

Grep for any stray `forceModel:` usage in ai.js that does NOT use `CARD_CUT_MODEL` — there should be none.

- [ ] **Step 4: Restart server and cut a test card**

After a successful cut, check the `card` SSE payload — the `model` field should be `anthropic/claude-sonnet-4.6`.

- [ ] **Step 5: Commit**

```bash
git add .env server/routes/ai.js
git commit -m "chore: pin CARD_CUT_MODEL to claude-sonnet-4.6"
```

---

## Task 5: Chat chip protocol — add card ID field

**Files:**
- Modify: `server/routes/chat.js:40-41`
- Modify: `server/routes/chat.js` (system prompt and context-build section)
- Modify: `server/services/libraryQuery.js` (expose card IDs on matches)

- [ ] **Step 1: Audit libraryQuery to ensure matched cards expose an `id`**

Open `server/services/libraryQuery.js`. The function `getRelevantAnalytics` returns card objects to the chat system prompt. Each card must include an `id` (use `card.id` if present, otherwise generate a stable hash from `tag|cite` — `require('crypto').createHash('md5').update(tag+cite).digest('hex').slice(0,10)`). Ensure `id` is included in whatever payload is fed into the system prompt.

- [ ] **Step 2: Update chat system prompt**

In `server/routes/chat.js`, change the chip token format in the system prompt from 4 to 5 fields. The new format is:

```
[[CARD|<id>|Author 'YY|QualShort|One-line preview of the warrant]]
```

Update the example line too:

```
Example: [[CARD|a3f9b21c|Korsgaard '96|Harvard Phil|Reflective consciousness makes normativity inescapable]]
```

When the chat route loads candidate cards for the model, include the ID in the "available cards" context block so the model has a valid ID to cite.

- [ ] **Step 3: Client chip regex — 5 fields**

In `public/app-main.js`, replace:

```js
const CARD_RE = /\[\[CARD\|([^|\]]*)\|([^|\]]*)\|([^\]]*)\]\]/g;
```

with:

```js
const CARD_RE = /\[\[CARD\|([^|\]]*)\|([^|\]]*)\|([^|\]]*)\|([^\]]*)\]\]/g;
```

And in the render loop, update the buildCardChip call site:

```js
frag.appendChild(buildCardChip(m[1].trim(), m[2].trim(), m[3].trim(), m[4].trim()));
```

- [ ] **Step 4: Smoke test**

Open assistant, ask "give me cards on deterrence." Inspect a streamed response: each chip token should have 5 pipe-separated fields and the first must look like an 8-10 char ID.

- [ ] **Step 5: Commit**

```bash
git add server/routes/chat.js server/services/libraryQuery.js public/app-main.js
git commit -m "feat(assistant): add card ID to chip token for full-card lookup"
```

---

## Task 6: Assistant chip click — save FULL card, not just preview

**Files:**
- Modify: `public/app-main.js:1424-1453` (buildCardChip)
- Modify: `public/app.html` (add `.ap-card-chip.saved` CSS + pulse animation)

- [ ] **Step 1: Gate chip rendering on highlighted body**

In `public/app-main.js`, inside `renderBot`, before appending a chip, check that the card has a real highlighted body. Since the chat route injects cards the model may reference, the client already knows which library cards are available — stash them on a module-level `lastChatCards` map `id → full card record` when the chat response arrives.

First, modify `API.chat` call site in `doSend`:

```js
const r = await API.chat({ messages: convo });
thinking.stop();
if (Array.isArray(r.cards)) {
  r.cards.forEach(c => lastChatCards.set(c.id, c));
}
```

Add `const lastChatCards = new Map();` at the top of the assistant IIFE.

Server-side, `server/routes/chat.js` must return `cards: [...]` in its JSON response alongside the existing `reply` — the array should be the library cards that were exposed to the model in this turn.

Then in the chip render, drop any chip whose `id` maps to a card without `==` in `body_markdown`:

```js
while ((m = CARD_RE.exec(para)) !== null) {
  const id = m[1].trim();
  const full = lastChatCards.get(id);
  if (!full || !/==[^=]+==/.test(full.body_markdown || '')) continue; // skip un-highlighted
  // ... existing chip insert using full
}
```

- [ ] **Step 2: Chip click saves the full card record**

Rewrite `buildCardChip`:

```js
function buildCardChip(id, cite, qual, preview) {
  const chip = document.createElement('div');
  chip.className = 'ap-card-chip';
  chip.title = 'Click to save to My Cards';
  const shortCite = String(cite || '').replace(/\s*\[.*$/, '').trim();
  const author = shortCite.split(/\s*'/)[0].trim() || 'Unknown';
  const tag = (preview || shortCite || 'card').slice(0, 80);
  chip.innerHTML = `
    <svg class="ap-cc-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h10M7 13h10M7 17h6"/></svg>
    <span class="ap-cc-tag"></span>
    <span class="ap-cc-author"></span>
    <span class="ap-cc-saved">+ Add</span>`;
  chip.querySelector('.ap-cc-tag').textContent = tag;
  chip.querySelector('.ap-cc-author').textContent = author;
  chip.addEventListener('click', () => {
    const full = lastChatCards.get(id);
    if (!full) { toast('Card not found'); return; }
    const card = {
      tag: full.tag || tag,
      cite: full.cite || cite,
      shortCite: full.shortCite || cite,
      body_plain: full.body_plain || full.body_markdown || '',
      body_markdown: full.body_markdown || full.body_plain || '',
      body_html: full.body_html || '',
    };
    const r = API.mine.save(card);
    if (r.duplicate) { toast('Already saved'); return; }
    chip.classList.add('saved');
    chip.querySelector('.ap-cc-saved').textContent = 'Saved ✓';
    toast('Saved full card to My Cards ✓');
  });
  return chip;
}
```

- [ ] **Step 3: Add CSS for the saved-state flash**

In `public/app.html` `<style>` block:

```css
.ap-card-chip{transition:background .2s,border-color .2s,transform .15s}
.ap-card-chip:hover{background:#f4f4f5}
.ap-card-chip.saved{background:#dcfce7;border-color:#16a34a;animation:chipPulse .5s ease-out}
.ap-card-chip.saved .ap-cc-saved{color:#15803d;font-weight:600}
@keyframes chipPulse{0%{transform:scale(1)}40%{transform:scale(1.04)}100%{transform:scale(1)}}
```

- [ ] **Step 4: Manual test**

Open assistant, ask for cards, click a chip. Expect: pulse animation, chip turns green with "Saved ✓", and the card appears in "My Cards" with full body + highlights, not just tagline. Clicking again shows "Already saved" toast.

- [ ] **Step 5: Commit**

```bash
git add public/app-main.js public/app.html server/routes/chat.js
git commit -m "feat(assistant): save full card on chip click with pulse confirmation"
```

---

## Task 7: Toolbar — Underline as toggle, Highlight as latched mode

**Files:**
- Modify: `public/app-main.js:574-585` (toolbar handler)
- Modify: `public/app.html` (`.pane-fmt-tools .tool-btn.active` CSS)

- [ ] **Step 1: Add an active-state style for the Highlight button**

In `public/app.html`:

```css
.pane-fmt-tools .tool-btn.active{background:#fef08a;border-color:#eab308;color:#713f12}
.pane-fmt-tools .tool-btn.active svg{stroke:#713f12}
body.highlight-mode #wb-body{cursor:text}
body.highlight-mode #wb-body .body{caret-color:#eab308}
```

- [ ] **Step 2: Rewrite the toolbar handler**

Replace the existing handler in `public/app-main.js:574-585`:

```js
// Formatting toolbar — Underline toggles, Highlight is latched mode
let highlightMode = false;
function setHighlightMode(on) {
  highlightMode = on;
  document.body.classList.toggle('highlight-mode', on);
  $$('.pane-fmt-tools .tool-btn[data-fmt="highlight"]').forEach(b => b.classList.toggle('active', on));
}

function applyHighlightToSelection() {
  const body = $('#wb-body .body') || $('#wb-body');
  if (!selectionInside(body)) return;
  document.execCommand('styleWithCSS', false, true);
  const existing = selectionOverlapsHighlight(window.getSelection());
  if (existing) {
    // Unwrap: remove backgroundColor on matched mark/span
    document.execCommand('hiliteColor', false, 'transparent');
    // Also strip inline <mark> wrapper if present
    if (existing.tagName === 'MARK') {
      const parent = existing.parentNode;
      while (existing.firstChild) parent.insertBefore(existing.firstChild, existing);
      parent.removeChild(existing);
    }
  } else {
    document.execCommand('hiliteColor', false, '#FFFF00');
  }
  syncCardFromDom();
}

$$('.pane-fmt-tools .tool-btn[data-fmt], .pane-foot .tool-btn[data-fmt]').forEach((b) => {
  b.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const fmt = b.dataset.fmt;
    const body = $('#wb-body .body') || $('#wb-body');

    if (fmt === 'highlight') {
      // Toggle the latched mode. If a selection already exists, also apply immediately.
      setHighlightMode(!highlightMode);
      if (highlightMode && selectionInside(body) && !window.getSelection().isCollapsed) {
        applyHighlightToSelection();
      }
      return;
    }

    if (!selectionInside(body)) { toast('Select text in the card first'); return; }
    document.execCommand('styleWithCSS', false, true);
    if (fmt === 'underline') {
      // Native execCommand already toggles — if selection is fully underlined it removes.
      document.execCommand('underline');
    } else if (fmt === 'bold') {
      document.execCommand('bold');
    }
    syncCardFromDom();
  });
});

// While highlight mode is on, any mouseup with a non-empty selection inside the card body applies highlight toggle
document.addEventListener('mouseup', () => {
  if (!highlightMode) return;
  const body = $('#wb-body .body') || $('#wb-body');
  if (!body || !selectionInside(body)) return;
  if (window.getSelection().isCollapsed) return;
  applyHighlightToSelection();
});
```

The key behaviors:
- Underline button: single call to `document.execCommand('underline')` already toggles — passing it through works because the browser removes underline if every char in the selection is underlined. Verify in the test step.
- Highlight button click: flips `highlightMode`. If a selection exists at the moment of click, also applies immediately so the single-click highlight works as before.
- With highlightMode on: any selection in card body automatically highlights (or unhighlights if overlap) on mouseup.
- Second click on Highlight button: turns mode off — no further auto-highlighting until clicked again.

- [ ] **Step 3: Manual tests**

Type test text in the card body, then:

1. Select a word → click Underline → underline appears. Select same word → click Underline → underline removed.
2. Click Highlight → button turns yellow (active class). Select any text → highlight auto-applies on mouseup. Select already-highlighted text → highlight removed. Click Highlight again → button deactivates; selecting text does nothing.
3. Select a word → click Bold → bold applied. Select same word → click Bold → bold removed.

- [ ] **Step 4: Commit**

```bash
git add public/app-main.js public/app.html
git commit -m "feat(editor): underline toggle + latched highlight mode + active-state UI"
```

---

## Task 8: End-to-end verification

- [ ] **Step 1: Run a full cut → save flow**

1. Start server: `cd server && npm run dev`
2. Open `http://localhost:3000`
3. Submit a scholarly query (e.g., "reflective endorsement Korsgaard"). Expect:
   - Phase log shows scholarly adapters first (Semantic Scholar, OpenAlex, Crossref, Unpaywall)
   - Source panel lands on a scholarly paper (not a blog)
   - Cite field in the cut card reads `LastName 'YY [Full Name; …]` — no `[No Author]`
   - Model string in console = `anthropic/claude-sonnet-4.6`
4. Open assistant, ask for a card on the same topic. Only chips backed by highlighted library cards appear.
5. Click one chip — pulse animation, green "Saved ✓", navigate to My Cards, the full body with highlights is present (not just tagline).
6. In the cut card, test: Underline toggle, Highlight latched mode, Bold toggle as described in Task 7.

- [ ] **Step 2: Commit any final fixes under a single commit**

```bash
git add -A
git commit -m "fix: e2e verification adjustments"
```

---

## Self-Review Checklist

- **Spec coverage:**
  - Cite scholarly articles → Tasks 1–3
  - Revert to Claude Sonnet → Task 4
  - Assistant includes only highlighted cards → Task 6 Step 1
  - More obvious add confirmation → Task 6 Steps 3–4
  - Add saves full card not just tagline → Tasks 5–6
  - Underline toggles → Task 7 Step 2 (native execCommand toggle)
  - Highlight latched-mode toggle → Task 7 Step 2
- **Placeholder scan:** no TBDs, no "similar to Task N" shorthand.
- **Type consistency:** `CARD_RE` signature change matches `buildCardChip(id, cite, qual, preview)` call sites; chip token format is `[[CARD|id|cite|qual|preview]]` everywhere (server prompt + client regex).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-19-cite-assistant-toolbar-fixes.md`. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks.
2. **Inline Execution** — execute tasks in this session using executing-plans.

Which approach?
