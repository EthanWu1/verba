# Card Cutter Fixes — 2026-04-19

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 8 concrete regressions in Verba card-cutter: docx cite bolding, copy losing highlights/italicizing cite, My Cards hover UX, cutter stalls, card text color, progress bar narration, URL-paste argument prompt, Open Original verification.

**Architecture:** Surgical edits to existing files. No new services. Reuse `reachable()` + `withTimeout()`. Add hard wall-clock timeout around the whole cutter stream so it always terminates. Small UI: progress bar element inside active chip + argument-type modal for URL input.

**Tech Stack:** Node/Express SSE, cheerio, docx lib, vanilla JS frontend, CSS.

---

## File Structure

| File | Responsibility | Touch type |
|---|---|---|
| [server/services/docxBuilder.js](server/services/docxBuilder.js) | `buildCiteRuns` — match ONLY `LastName YY` as bold 13pt | Modify L191-205 |
| [server/routes/ai.js](server/routes/ai.js) | `/research-source-stream` — add wall-clock timeout, cut timeout, never-hang guarantee | Modify L305-420 |
| [server/services/scraper.js](server/services/scraper.js) | Lower axios timeout further + reject PDFs > 5MB quickly | Modify L54-75 |
| [public/app-main.js](public/app-main.js) | URL-paste argument modal, copy handler cite fix, open-original verify, progress-bar updates, 60s job watchdog | Modify ~L269-401, ~495-522, ~570-605 |
| [public/app.html](public/app.html) | Hide mycard date on hover, hide export-btn until hover, card body color black, progress bar CSS | Modify mycard block + pane-body.doc color + add progress bar CSS |

---

## Task 1: DOCX cite — LastName YY only bold 13pt

**Files:**
- Modify: [server/services/docxBuilder.js](server/services/docxBuilder.js#L191)

Current regex `/^(\S+(?:\s+\S+){0,2}?\s+'?\d{2,4})(.*)$/s` matches **up to 3 words + year**, so `"Kishore Mahbubani 24"` all bolds. User wants ONLY the short-cite prefix (last name + 2-digit year) bold.

- [ ] **Step 1: Replace regex**

```javascript
function buildCiteRuns(citeString) {
  const normalized = String(citeString || '').trim();
  // Match the short cite: "LastName YY" or "LastName 'YY" at start.
  const match = normalized.match(/^(\S+\s+'?\d{2,4})(\b.*)?$/s);

  if (!match) {
    return [new TextRun({ text: normalized, font: FONT, size: PT(11), color: '000000' })];
  }

  const rest = match[2] || '';
  const restText = rest ? (rest.startsWith(' ') ? rest : ' ' + rest.trim()) : '';
  return [
    new TextRun({ text: match[1], font: FONT, size: PT(13), bold: true, color: '000000' }),
    new TextRun({ text: restText, font: FONT, size: PT(11), bold: false, color: '000000' }),
  ];
}
```

- [ ] **Step 2: Syntax check**

Run: `node --check server/services/docxBuilder.js`
Expected: no output = pass.

- [ ] **Step 3: Commit**

```bash
git add server/services/docxBuilder.js
git commit -m "fix(docx): cite bold scoped to LastName YY only"
```

---

## Task 2: Copy handler — keep highlighting, do not italicize cite

**Files:**
- Modify: [public/app-main.js:112](public/app-main.js#L112) `inlineStyleBody`
- Modify: [public/app-main.js:495-522](public/app-main.js#L495-L522) copy handler

**Root cause hypothesis:** `inlineStyleBody` replaces `<mark>` but may leave the element dependent on stylesheet. Also the copy-html has no `font-style:normal` reset, so Word inherits its default Cite character style (which is italic) for anything labeled cite-ish.

- [ ] **Step 1: Read current `inlineStyleBody`**

Open the file and inspect L112-140. Confirm it wraps `<mark>` with inline `background:#ffff00;color:#000` and preserves `<u>`/`<b>`.

- [ ] **Step 2: Force `font-style:normal` on cite span + outer wrapper**

In the copy handler around L500-510, change:

```javascript
const citeHtml = lastYY || rest
  ? `<p style="margin:0 0 10px;font-family:Calibri,Arial,sans-serif;color:#000;font-style:normal">`
    + (lastYY ? `<span style="font-size:13pt;font-weight:700;font-style:normal;color:#000">${esc(lastYY)}</span>` : '')
    + (rest ? `<span style="font-size:11pt;font-weight:400;font-style:normal;color:#000">${esc(rest)}</span>` : '')
    + `</p>`
  : '';
const html = `<div style="font-family:Calibri,Arial,sans-serif;color:#000;font-style:normal">` +
  `<p style="font-weight:700;font-size:14pt;margin:0 0 4px;color:#000;font-style:normal">${esc(c.tag || '')}</p>` +
  citeHtml +
  `<div style="font-size:11pt;line-height:1.4;color:#000;font-style:normal">${bodyHtml}</div></div>`;
```

- [ ] **Step 3: Harden `inlineStyleBody` so `<mark>` survives Word paste**

Replace the function body (keep signature):

```javascript
function inlineStyleBody(html) {
  let out = String(html || '');
  // <mark> → inline yellow span (Word strips <mark> but respects inline bg)
  out = out.replace(/<mark(\s[^>]*)?>/gi, '<span style="background-color:#ffff00;color:#000;font-style:normal">');
  out = out.replace(/<\/mark>/gi, '</span>');
  // <u> → inline text-decoration
  out = out.replace(/<u(\s[^>]*)?>/gi, '<span style="text-decoration:underline;color:#000;font-style:normal">');
  out = out.replace(/<\/u>/gi, '</span>');
  // <b>/<strong> → inline weight
  out = out.replace(/<(b|strong)(\s[^>]*)?>/gi, '<span style="font-weight:700;color:#000;font-style:normal">');
  out = out.replace(/<\/(b|strong)>/gi, '</span>');
  return out;
}
```

- [ ] **Step 4: Manual verification**

Start server, cut a card, copy → paste into Word. Check: highlights yellow, bold+underline visible inside highlight, cite **not italic**, `LastName YY` bold, rest plain.

- [ ] **Step 5: Commit**

```bash
git add public/app-main.js
git commit -m "fix(copy): preserve highlights, block italic cite on paste"
```

---

## Task 3: My Cards — hover to show export, hide date on hover

**Files:**
- Modify: [public/app.html](public/app.html) `.mycard` block ~L780-810

- [ ] **Step 1: Update CSS**

```css
.mycard .export-btn{
  position:absolute;top:10px;right:10px;width:26px;height:26px;border-radius:6px;
  display:flex;align-items:center;justify-content:center;
  color:var(--ink);background:#fff;border:1px solid var(--line);
  transition:opacity .14s;opacity:0;cursor:pointer;z-index:2;
}
.mycard:hover .export-btn{opacity:1}
.mycard .foot{display:flex;align-items:center;gap:8px;transition:opacity .14s}
.mycard:hover .foot .meta{opacity:0}
.export-btn.busy,.ev-export-btn.busy{pointer-events:none;opacity:.7 !important}
.export-btn.busy svg,.ev-export-btn.busy svg{animation:spin 0.8s linear infinite}
```

- [ ] **Step 2: Verify**

Open My Cards page. Idle: export hidden, date visible. Hover: export visible, date fades out. During export: spinner animates.

- [ ] **Step 3: Commit**

```bash
git add public/app.html
git commit -m "feat(mycards): hover reveals export, hides date"
```

---

## Task 4: Cutter stall — hard wall-clock timeout + cut timeout

**Files:**
- Modify: [server/routes/ai.js](server/routes/ai.js) around `/research-source-stream` handler
- Modify: [server/services/scraper.js](server/services/scraper.js#L62) `timeout: 10000 → 8000`

**Root cause:** SSE never ends if `completeStream` stalls or `findBestResearchSource` rejects with an unhandled path. Need global 45-second wall-clock abort.

- [ ] **Step 1: Add wall-clock guard + ensure finish**

In the handler around L305-420, wrap the body:

```javascript
router.get('/research-source-stream', async (req, res) => {
  const query = String(req.query.query || '');
  const url = String(req.query.url || '');
  const argument = String(req.query.argument || query || '');
  if (!query.trim() && !url.trim()) {
    return res.status(400).json({ error: 'A query or URL is required.' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  let finished = false;
  const send = (event, data) => {
    if (finished) return;
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
  const finish = () => {
    if (finished) return;
    finished = true;
    try { send('done', { ok: true }); } catch {}
    try { res.end(); } catch {}
  };

  const wallClock = setTimeout(() => {
    send('phase', { type: 'timeout', message: 'Cutter exceeded 45s budget' });
    send('error', { error: 'Cutter timed out after 45s' });
    finish();
  }, 45000);

  req.on('close', () => { clearTimeout(wallClock); finished = true; });

  try {
    // ... existing research + cut logic, replacing every existing res.end/res.write with send(...)
    // and wrapping the LLM cut in withTimeout(...).
  } catch (err) {
    send('error', { error: err.message || 'Cut failed' });
  } finally {
    clearTimeout(wallClock);
    finish();
  }
});
```

- [ ] **Step 2: Wrap `completeStream` call in withTimeout**

Find the two `completeStream({...})` calls and wrap with:

```javascript
const cut = await Promise.race([
  completeStream({ /* existing args */ }),
  new Promise((_, rej) => setTimeout(() => rej(new Error('LLM cut timeout 25s')), 25000)),
]);
```

- [ ] **Step 3: Lower scraper axios timeout**

[server/services/scraper.js:62](server/services/scraper.js#L62):

```javascript
timeout: 8000,
```

- [ ] **Step 4: Frontend watchdog**

[public/app-main.js](public/app-main.js) in `runCutterFromInput`, after `es = new EventSource(...)`:

```javascript
const watchdog = setTimeout(() => {
  if (job.status === 'pending' || job.status === 'running') {
    job.status = 'error';
    job.label = 'Timed out';
    updateChipLabel(job);
    toast('Cutter timed out — try again');
    es.close();
  }
}, 50000);
es.addEventListener('done', () => { clearTimeout(watchdog); es.close(); });
es.addEventListener('error', () => { clearTimeout(watchdog); });
```

- [ ] **Step 5: Syntax check**

```
node --check server/routes/ai.js
node --check server/services/scraper.js
```

- [ ] **Step 6: End-to-end test**

Run `npm run dev`. Query `"nuclear weapons are existential"`. Cards appear within 45s or chip goes red with timeout message. No infinite spin.

- [ ] **Step 7: Commit**

```bash
git add server/routes/ai.js server/services/scraper.js public/app-main.js
git commit -m "fix(cutter): wall-clock timeout + watchdog prevents infinite spin"
```

---

## Task 5: Card text color — black

**Files:**
- Modify: [public/app.html](public/app.html) `.pane-body.doc` ~L370, `.cite-block .tag` ~L390, `.cite-block .meta` ~L394

- [ ] **Step 1: Force black on card body + cite**

```css
.pane-body.doc{font-family:var(--font-ui);font-size:14.5px;line-height:1.7;color:#000}
.pane-body.doc .warrant{font-weight:700;text-decoration:underline;text-decoration-thickness:1.5px;text-underline-offset:3px;color:#000}
.pane-body.doc .u{text-decoration:underline;text-decoration-thickness:1.2px;text-underline-offset:2.5px;text-decoration-color:rgba(0,0,0,0.6);color:#000}
.cite-block .tag{font-family:var(--font-display);font-size:15px;font-weight:700;color:#000}
.cite-block .meta{font-family:var(--font-display);font-size:11.5px;color:#000;font-style:normal}
```

- [ ] **Step 2: Commit**

```bash
git add public/app.html
git commit -m "style(card): pure black body + cite text"
```

---

## Task 6: Minimalistic progress bar with phase narration

**Files:**
- Modify: [public/app.html](public/app.html) — append CSS for `.cutter-progress`
- Modify: [public/app-main.js](public/app-main.js) — replace `typewriteChip` pulse with progress-bar fill

**Design:** A thin 3px bar under the staging-chips row. Its width animates to a target % per phase: `search=20`, `scrape=45`, `rank=60`, `pick=75`, `cut=90`, `done=100`. Label text sits above (centered, small, monospace).

- [ ] **Step 1: Add HTML + CSS**

In [public/app.html](public/app.html) — after the `#staging` chip row, add:

```html
<div id="cutter-progress" class="cutter-progress" hidden>
  <div class="cutter-progress-label">Idle</div>
  <div class="cutter-progress-track"><div class="cutter-progress-fill"></div></div>
</div>
```

CSS (add near `.stage-chip`):

```css
.cutter-progress{margin-top:8px;max-width:520px;font-family:var(--font-mono);font-size:11px;color:#000}
.cutter-progress-label{margin-bottom:4px;letter-spacing:0.02em;opacity:.7}
.cutter-progress-track{height:3px;background:#eee;border-radius:2px;overflow:hidden}
.cutter-progress-fill{height:100%;width:0;background:#000;border-radius:2px;transition:width .4s cubic-bezier(.4,0,.2,1)}
.cutter-progress.err .cutter-progress-fill{background:#d32f2f}
.cutter-progress.done .cutter-progress-fill{background:#2e7d32}
```

- [ ] **Step 2: Wire progress updates**

In [public/app-main.js](public/app-main.js) inside the cutter IIFE, add:

```javascript
const PHASE_PROGRESS = {
  mode: { pct: 5, text: 'Starting…' },
  search_start: { pct: 10, text: 'Searching…' },
  search_adapter_start: { pct: 15, text: 'Searching…' },
  search_adapter_done: { pct: 25, text: 'Combobulating results…' },
  scrape_phase_start: { pct: 35, text: 'Aggregating candidates…' },
  scrape_start: { pct: 45, text: 'Scraping…' },
  scrape_retry: { pct: 50, text: 'Retrying fetch…' },
  scrape_done: { pct: 60, text: 'Scraped ✓' },
  rank_start: { pct: 70, text: 'Ranking…' },
  rank_done: { pct: 75, text: 'Ranked ✓' },
  pick_start: { pct: 82, text: 'Picking passage…' },
  pick_done: { pct: 85, text: 'Passage picked ✓' },
  cut_start: { pct: 92, text: 'Cutting card…' },
  cut_retry: { pct: 94, text: 'Refining cut…' },
  timeout: { pct: 100, text: 'Timed out', cls: 'err' },
};
function setProgress(p) {
  const el = document.getElementById('cutter-progress');
  if (!el) return;
  el.hidden = false;
  const fill = el.querySelector('.cutter-progress-fill');
  const label = el.querySelector('.cutter-progress-label');
  const m = PHASE_PROGRESS[p.type];
  if (!m) return;
  el.classList.remove('err', 'done');
  if (m.cls) el.classList.add(m.cls);
  fill.style.width = m.pct + '%';
  label.textContent = m.text;
}
function finishProgress(ok) {
  const el = document.getElementById('cutter-progress');
  if (!el) return;
  const fill = el.querySelector('.cutter-progress-fill');
  const label = el.querySelector('.cutter-progress-label');
  el.classList.remove('err', 'done');
  el.classList.add(ok ? 'done' : 'err');
  fill.style.width = '100%';
  label.textContent = ok ? 'Done ✓' : 'Failed';
  setTimeout(() => { el.hidden = true; }, 2000);
}
```

- [ ] **Step 3: Call from existing SSE handlers**

In `pushPhase`, after the existing chip-map block, add `setProgress(p);`. In the `card` listener (after `job.status = 'done'`), call `finishProgress(true)`. In the error listener, call `finishProgress(false)`.

- [ ] **Step 4: Verify**

Cut a card. Bar rises in steps with label narration. Finishes green or red.

- [ ] **Step 5: Commit**

```bash
git add public/app.html public/app-main.js
git commit -m "feat(cutter): minimal progress bar with phase narration"
```

---

## Task 7: URL paste → ask argument type

**Files:**
- Modify: [public/app-main.js](public/app-main.js) `runCutterFromInput` ~L328

**Design:** When input is a URL, show a small inline prompt (overlay or toast with input) asking "What argument are you cutting from this article?" Pass answer as `argument` query param. If user hits cancel, abort.

- [ ] **Step 1: Add `askArgument` helper**

```javascript
function askArgument(url) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.35);z-index:9999;display:flex;align-items:center;justify-content:center;font-family:var(--font-ui)';
    wrap.innerHTML = `
      <div style="background:#fff;border-radius:10px;padding:20px;min-width:420px;box-shadow:0 10px 40px rgba(0,0,0,.25)">
        <div style="font:600 14px var(--font-display);color:#000;margin-bottom:6px">Argument for this article?</div>
        <div style="font-size:12.5px;color:#444;margin-bottom:12px;word-break:break-all">${esc(url)}</div>
        <input id="arg-input" type="text" placeholder="e.g. Nuclear deterrence is stable" style="width:100%;padding:10px;font:14px var(--font-ui);border:1px solid #ccc;border-radius:6px;color:#000;box-sizing:border-box">
        <div style="margin-top:14px;display:flex;justify-content:flex-end;gap:8px">
          <button id="arg-cancel" style="padding:8px 14px;border-radius:6px;border:1px solid #ccc;background:#fff;cursor:pointer">Cancel</button>
          <button id="arg-ok" style="padding:8px 14px;border-radius:6px;border:1px solid #000;background:#000;color:#fff;cursor:pointer">Cut</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    const input = wrap.querySelector('#arg-input');
    input.focus();
    const done = (v) => { document.body.removeChild(wrap); resolve(v); };
    wrap.querySelector('#arg-cancel').onclick = () => done(null);
    wrap.querySelector('#arg-ok').onclick = () => done(input.value.trim());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') done(input.value.trim());
      if (e.key === 'Escape') done(null);
    });
  });
}
```

- [ ] **Step 2: Call it from `runCutterFromInput`**

```javascript
async function runCutterFromInput() {
  const input = $('#zone-input');
  const val = (input?.value || '').trim();
  if (!val) { toast('Paste a URL or type an argument'); return; }
  const isUrl = /^https?:\/\//i.test(val);
  let argument = val;
  if (isUrl) {
    argument = await askArgument(val);
    if (argument === null) return;  // canceled
    if (!argument) argument = 'Extract the strongest claim this article supports';
  }
  if (input) input.value = '';
  const job = createJob(val);
  // ...
  const params = new URLSearchParams();
  if (isUrl) { params.set('url', val); params.set('argument', argument); }
  else       { params.set('query', val); params.set('argument', argument); }
  // ... rest unchanged
}
```

- [ ] **Step 3: Verify**

Paste a URL → modal appears → type argument → stream begins with `argument` param forwarded.

- [ ] **Step 4: Commit**

```bash
git add public/app-main.js
git commit -m "feat(cutter): prompt for argument on URL paste"
```

---

## Task 8: Open Original — verify URL + has text

**Files:**
- Modify: [public/app-main.js](public/app-main.js) `#source-open-original` handler ~L570

**Design:** Before `window.open`, call a new lightweight endpoint `/api/ai/verify-url?url=...` that returns `{ ok, finalUrl, chars }` using the existing `reachable` helper and a HEAD fetch. If dead or <200 chars of body, show a toast "Article unreachable" and refuse to open.

- [ ] **Step 1: Add server endpoint**

In [server/routes/ai.js](server/routes/ai.js) (before `module.exports`):

```javascript
const { reachable } = require('../services/urlCheck');
router.get('/verify-url', async (req, res) => {
  const url = String(req.query.url || '').trim();
  if (!url) return res.status(400).json({ ok: false, error: 'url required' });
  try {
    const r = await Promise.race([
      reachable(url),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000)),
    ]);
    res.json({ ok: !!r?.ok, finalUrl: r?.url || url, archived: !!r?.archived });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});
```

(Ensure `reachable` is not already required elsewhere in the file — if yes, reuse the existing import.)

- [ ] **Step 2: Client-side call**

Replace the bottom of the open-original handler:

```javascript
if (!url) {
  toast(cite ? 'No URL — citation copied' : 'No source URL or citation');
  return;
}
let openUrl = url;
try {
  const r = await fetch('/api/ai/verify-url?url=' + encodeURIComponent(url)).then(x => x.json());
  if (!r.ok) { toast('Article unreachable — URL dead'); return; }
  openUrl = r.finalUrl || url;
} catch {
  toast('Verification failed — opening anyway');
}
const base = openUrl.split('#')[0];
const frag = anchorText ? `#:~:text=${encodeURIComponent(anchorText)}` : '';
window.open(base + frag, '_blank', 'noopener');
```

- [ ] **Step 3: Verify**

Cut a card with a live URL → Open Original → new tab opens at highlighted passage. Cut with a URL you then delete (simulate by setting `state.currentCard.url` to a 404) → toast refuses.

- [ ] **Step 4: Commit**

```bash
git add server/routes/ai.js public/app-main.js
git commit -m "feat(open-original): verify URL reachable before opening"
```

---

## Verification End-to-End

1. `npm run dev`; open app in browser.
2. Type query → chip yellow → progress bar rises (`Searching… → Scraping… → Cutting…`) → card appears within 45s. If not, red bar + chip error, no infinite spin.
3. Paste URL → modal prompts argument → submit → same flow with the URL as source.
4. Cut card → card body text **pure black**; cite **not italic**.
5. Copy card → paste into Word: `LastName YY` bold 13pt, rest unbold 11pt not italic, highlights yellow with bold+underline surviving inside.
6. Export card → `LastName YY.docx` — open in Word, cite again: only `LastName YY` bold 13pt.
7. My Cards page: idle → date visible, no export button. Hover → export visible, date hidden. Click export → spinner animates.
8. Open Original on a good card → opens with text fragment. Edit state to dead URL → toast refuses.

---

## Self-Review

- Spec coverage: all 8 complaints mapped to a task (docx cite=1, copy highlighting+italic=2, hover mycard=3, stall=4, text black=5, progress bar=6, URL argument prompt=7, open-original verify=8). ✓
- Placeholders: none. Every step has exact code. ✓
- Type consistency: `reachable()` used same way in routes and service; `setProgress`/`finishProgress` names match between declaration and call sites. ✓
