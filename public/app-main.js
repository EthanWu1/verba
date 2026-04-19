/* Verba app-main.js — 2-page SPA: Card Cutter + Library (Evidence/Cards/History).
   Runs AFTER the inline IIFE; overrides any leftover handlers. */
(function () {
  'use strict';
  const API = window.VerbaAPI;
  if (!API) { console.error('VerbaAPI missing'); return; }

  function computeInitials(name, email) {
    const n = String(name || '').trim();
    if (n) {
      const parts = n.split(/\s+/).filter(Boolean);
      if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
      if (parts[0].length >= 2) return (parts[0][0] + parts[0][1]).toUpperCase();
      return parts[0][0].toUpperCase();
    }
    const e = String(email || '').trim();
    if (!e) return '··';
    const local = e.split('@')[0] || '';
    if (local.length >= 2) return (local[0] + local[1]).toUpperCase();
    return (local[0] || e[0] || '·').toUpperCase();
  }

  function paintAccount(user) {
    const av = document.getElementById('side-avatar');
    const nm = document.getElementById('side-name');
    const em = document.getElementById('side-email');
    if (av) av.textContent = computeInitials(user.name, user.email);
    if (nm) nm.textContent = user.name || (user.email ? user.email.split('@')[0] : 'Account');
    if (em) em.textContent = user.email || '';
  }

  (async () => {
    try {
      const who = await API.auth.me();
      window.__verbaUser = who.user;
      window.__verba = window.__verba || {};
      paintAccount(who.user);
    } catch {
      location.href = '/signin';
    }
  })();

  const $  = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (msg) => {
    const t = document.getElementById('toast'); if (!t) return;
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2000);
  };

  function handleLimitError(err) {
    if (err && err.status === 429) {
      const b = err.body || {};
      toast(`Monthly ${b.kind === 'cutCard' ? 'card-cut' : 'assistant-message'} limit (${b.limit}) reached. Resets on the 1st (UTC).`);
      return true;
    }
    return false;
  }
  window.__handleLimitError = handleLimitError;

  /* ──────────────────────────────────────────
     ROUTER — 2 pages: home (Card Cutter), library
     ────────────────────────────────────────── */
  const PAGES = ['home', 'library'];
  const LEGACY = {
    community: 'library', saved: 'library', history: 'library', mine: 'library',
    research: 'home', chatbot: 'home', assistant: 'library',
    contentions: 'library', projects: 'library',
  };

  function go(page, libTab) {
    if (LEGACY[page]) page = LEGACY[page];
    if (!PAGES.includes(page)) page = 'home';
    $$('.page').forEach((p) => p.classList.toggle('active', p.id === 'page-' + page));
    $$('.nav-item[data-page]').forEach((n) => {
      const isActive = n.dataset.page === page && (!libTab || n.dataset.libGo === libTab || (!n.dataset.libGo && page !== 'library'));
      n.classList.toggle('active', isActive);
    });
    try { localStorage.setItem('verba.page', page); } catch {}
    const crumb = $('#crumb-page');
    if (page === 'home' && crumb) crumb.textContent = 'Cutter';
    if (page === 'library') {
      loadLibrary();
      if (libTab) switchLibTab(libTab);
    }
  }
  $$('.nav-item[data-page]').forEach((n) => n.addEventListener('click', () => go(n.dataset.page, n.dataset.libGo)));
  $$('.cmd-item[data-go]').forEach((c) => c.addEventListener('click', () => go(c.dataset.go)));
  window.VerbaGo = go;

  $('#new-card-btn')?.addEventListener('click', () => go('home'));
  (function initUserMenu() {
    const row = document.getElementById('side-account-row');
    const menu = document.getElementById('user-menu');
    if (!row || !menu) return;

    function positionMenu() {
      const r = row.getBoundingClientRect();
      menu.style.left = r.left + 'px';
      menu.style.bottom = (window.innerHeight - r.top + 6) + 'px';
      menu.style.width = r.width + 'px';
    }
    function openMenu() {
      const u = window.__verbaUser || {};
      const emEl = document.getElementById('user-menu-email');
      if (emEl) emEl.textContent = u.email || '';
      positionMenu();
      menu.classList.add('open');
      menu.setAttribute('aria-hidden', 'false');
      row.setAttribute('aria-expanded', 'true');
    }
    function closeMenu() {
      menu.classList.remove('open');
      menu.setAttribute('aria-hidden', 'true');
      row.setAttribute('aria-expanded', 'false');
    }
    row.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.classList.contains('open') ? closeMenu() : openMenu();
    });
    document.addEventListener('click', (e) => {
      if (!menu.contains(e.target) && e.target !== row) closeMenu();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeMenu();
    });
    window.addEventListener('resize', () => { if (menu.classList.contains('open')) positionMenu(); });

    menu.addEventListener('click', async (e) => {
      const btn = e.target.closest('.user-menu-item');
      if (!btn) return;
      closeMenu();
      const act = btn.dataset.act;
      if (act === 'settings')   window.__verba.openSettings('general');
      if (act === 'upgrade')    window.__verba.openPricing();
      if (act === 'shortcuts')  window.__verba.openShortcuts();
      if (act === 'logout') {
        try { await API.auth.logout(); } catch {}
        location.href = '/signin';
      }
    });

    // ⌘, opens settings; ⌘/ opens shortcuts.
    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ',') { e.preventDefault(); window.__verba.openSettings('general'); }
      if ((e.metaKey || e.ctrlKey) && e.key === '/') { e.preventDefault(); window.__verba.openShortcuts(); }
    });
  })();

  try {
    const saved = localStorage.getItem('verba.page');
    go(saved || 'home');
  } catch { go('home'); }

  /* ──────────────────────────────────────────
     NAV COUNTS
     ────────────────────────────────────────── */
  async function refreshNavCounts() {
    try {
      const analytics = await API.libraryAnalytics().catch(() => null);
      if (analytics?.totals?.cards != null) {
        const el = $('#nav-ev-count'); if (el) el.textContent = analytics.totals.cards.toLocaleString();
      }
    } catch {}
  }

  /* ──────────────────────────────────────────
     CARD CUTTER (home)
     ────────────────────────────────────────── */
  const state = { currentSource: null, currentCard: null, evidenceCards: [], activeType: 'all', evSearch: '' };

  /* Convert AI output markdown-ish markers to real HTML spans.
     Input markers:
       **<u>...</u>**   → verbatimize (bold + underline, big font)
       <u>...</u>       → underline
       ==...==          → yellow highlight
     Paragraph splits on blank lines. */
  function markdownCardToHtml(body) {
    if (!body) return '<p><br></p>';
    const paragraphs = String(body).split(/\n\n+/).map((s) => s.trim()).filter(Boolean);
    const out = paragraphs.map((para) => {
      if (para === '[FIGURE OMITTED]') {
        return '<p class="figure-omitted" contenteditable="false">[FIGURE OMITTED]</p>';
      }
      let p = esc(para);
      p = p.replace(/&lt;u&gt;/g, '<u>').replace(/&lt;\/u&gt;/g, '</u>');
      // Bold-underline (loudest phrase) — must run BEFORE plain underline/bold passes
      p = p.replace(/\*\*<u>([\s\S]*?)<\/u>\*\*/g, '<span class="fmt-verbatimize"><b><u>$1</u></b></span>');
      p = p.replace(/<u>\*\*([\s\S]*?)\*\*<\/u>/g, '<span class="fmt-verbatimize"><b><u>$1</u></b></span>');
      // Plain underline
      p = p.replace(/<u>([\s\S]*?)<\/u>/g, '<span class="fmt-underline"><u>$1</u></span>');
      // Stray bold (**text**) — render as bold instead of leaking literal asterisks
      p = p.replace(/\*\*([\s\S]+?)\*\*/g, '<b>$1</b>');
      // Highlight
      p = p.replace(/==([\s\S]*?)==/g, '<span class="fmt-highlight"><mark style="background:#FFFF00;padding:0 1px">$1</mark></span>');
      // Cleanup: remove any orphan ** that survived
      p = p.replace(/\*\*/g, '');
      p = p.replace(/\[FIGURE OMITTED\]/g, '<span class="figure-omitted">[FIGURE OMITTED]</span>');
      p = p.replace(/\n/g, '<br>');
      return '<p>' + p + '</p>';
    }).join('');
    return out || '<p><br></p>';
  }

  function cardBodyHTML(card) {
    if (card.body_html) return card.body_html;
    return markdownCardToHtml(card.body_markdown || card.body_plain || '');
  }

  /* Split cite into ("LastName YY", " [rest…]") for Word-copy sizing. */
  function splitCiteForCopy(cite) {
    const s = String(cite || '').trim();
    if (!s) return { lastYY: '', rest: '' };
    const m = s.match(/^(\S+(?:\s+\S+){0,2}?\s+'?\d{2,4})(.*)$/s);
    if (!m) return { lastYY: s, rest: '' };
    return { lastYY: m[1].trim(), rest: m[2] || '' };
  }

  /* Inject inline styles on mark/b/u/span tags so Word honors them on paste. */
  function inlineStyleBody(html) {
    let out = String(html || '');
    out = out.replace(/<mark(\s[^>]*)?>/gi, '<span style="background-color:#ffff00;color:#000;font-style:normal">');
    out = out.replace(/<\/mark>/gi, '</span>');
    out = out.replace(/<u(\s[^>]*)?>/gi, '<span style="text-decoration:underline;color:#000;font-style:normal">');
    out = out.replace(/<\/u>/gi, '</span>');
    out = out.replace(/<(b|strong)(\s[^>]*)?>/gi, '<span style="font-weight:700;color:#000;font-style:normal">');
    out = out.replace(/<\/(b|strong)>/gi, '</span>');
    return out;
  }

  /* Pull partial tag/cite/body from streaming JSON (may be mid-string). */
  function extractPartialCard(acc) {
    const out = { tag: '', cite: '', body: '' };
    if (!acc) return out;
    const grab = (key) => {
      const re = new RegExp('"' + key + '"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)', 's');
      const m = acc.match(re);
      if (!m) return '';
      return m[1]
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
    };
    out.tag = grab('tag');
    out.cite = grab('cite');
    out.body = grab('body_markdown');
    return out;
  }

  /* Render a mid-stream card with a ghost caret on the last paragraph. */
  function renderCardGhost(card) {
    const paneBody = $('#wb-body');
    if (!paneBody) return;
    state.currentCard = card;
    const bodyHtml = markdownCardToHtml(card.body_markdown || '');
    const withCaret = bodyHtml.replace(/<\/p>\s*$/, '<span class="ghost-caret"></span></p>') || bodyHtml + '<span class="ghost-caret"></span>';
    paneBody.innerHTML = `
      <div class="cite-block">
        <div class="tag" contenteditable="false" data-field="tag">${esc(card.tag || '')}</div>
        <div class="meta" contenteditable="false" data-field="cite">${esc(card.cite || '')}</div>
      </div>
      <div class="body" contenteditable="false" data-field="body">${withCaret}</div>
    `;
  }

  function renderCardInPane(card) {
    const paneBody = $('#wb-body');
    if (!paneBody) return;
    state.currentCard = card;
    paneBody.innerHTML = `
      <div class="cite-block">
        <div class="tag" contenteditable="true" data-field="tag">${esc(card.tag || '')}</div>
        <div class="meta" contenteditable="true" data-field="cite">${esc(card.cite || '')}</div>
      </div>
      <div class="body" contenteditable="true" data-field="body">${cardBodyHTML(card)}</div>
    `;
  }

  function renderSourceInPane(article) {
    const body = $('#pane-source .pane-body');
    const titleEl = $('#pane-source .pane-title');
    if (!body) return;
    state.currentSource = article;
    if (titleEl) titleEl.innerHTML = `<span class="pip"></span>Source · ${esc(article.source || article.url || 'Pasted text')}`;
    const head = article.author || article.date ? `<p class="shrink">${esc(article.author || '')}${article.date ? ' · ' + esc(article.date) : ''}</p>` : '';
    const paragraphs = Array.isArray(article.paragraphs) && article.paragraphs.length
      ? article.paragraphs
      : String(article.bodyText || '').split(/\n\n+/).map((t, i) => ({ text: t, anchor: `p-${i}` }));
    const paras = paragraphs.slice(0, 120).map((p) => {
      if (p.isFigure || p.text === '[FIGURE OMITTED]') {
        return `<p class="figure-omitted" id="${esc(p.anchor || '')}">[FIGURE OMITTED]</p>`;
      }
      return `<p id="${esc(p.anchor || '')}">${esc(p.text)}</p>`;
    }).join('');
    body.innerHTML = head + paras;
  }

  /* ── Queue manager: multi-job research with live phase updates and switchable chips ── */
  const QUEUE_MAX_CHIPS = 6;
  const queues = []; // { id, label, mode, input, chip, article, card, phaseLog, status, es }

  function renderPhaseLog(job) {
    const body = $('#pane-source .pane-body');
    const titleEl = $('#pane-source .pane-title');
    if (!body) return;
    if (titleEl) titleEl.innerHTML = `<span class="pip"></span>Source · ${esc(job.label)}`;
    const rows = job.phaseLog.slice(-200).map((p) => {
      const cls = p.level === 'err' ? 'phase-err' : p.level === 'ok' ? 'phase-ok' : 'phase-run';
      return `<div class="phase-row ${cls}">${esc(p.text)}</div>`;
    }).join('');
    const hint = job.status !== 'done' && job.status !== 'error'
      ? '<div class="phase-row phase-run" style="opacity:.7;margin-top:6px">live — updating as sources return</div>'
      : '';
    let log = body.querySelector('.phase-log');
    if (!log) {
      body.innerHTML = `<div class="phase-log"></div>`;
      log = body.querySelector('.phase-log');
    }
    log.innerHTML = rows + hint;
    log.scrollTop = log.scrollHeight;
  }

  function describePhase(p) {
    switch (p.type) {
      case 'mode':                return { text: p.mode === 'url' ? `Scraping ${p.url}…` : `Researching "${p.query}"…`, level: 'run' };
      case 'search_start':        return { text: `Checking ${p.sources.length} sources…`, level: 'run' };
      case 'search_adapter_start':return { text: `Querying ${p.source}…`, level: 'run' };
      case 'search_adapter_done': return { text: `${p.source} returned ${p.count} hits`, level: 'ok' };
      case 'search_adapter_error':return { text: `${p.source} failed: ${p.error}`, level: 'err' };
      case 'scrape_phase_start':  return { text: `Reading top ${p.count} candidates…`, level: 'run' };
      case 'scrape_start':        return { text: `Reading ${p.url.slice(0,80)}`, level: 'run' };
      case 'scrape_retry':        return { text: `Retrying via Jina…`, level: 'run' };
      case 'scrape_done':         return { text: `Got ${p.chars} chars${p.via ? ' (jina)' : ''}`, level: 'ok' };
      case 'rank_start':          return { text: `Ranking ${p.candidates} articles…`, level: 'run' };
      case 'rank_done':           return { text: 'Ranking complete', level: 'ok' };
      case 'pick_start':          return { text: `Picked: ${p.title || p.source || p.url}`, level: 'ok' };
      case 'pick_done':           return { text: 'Picking best passage', level: 'ok' };
      case 'cut_start':           return { text: 'Cutting card…', level: 'run' };
      case 'cut_retry':           return { text: 'Refining cut…', level: 'run' };
      default:                    return { text: p.type, level: 'run' };
    }
  }

  function activateJob(job) {
    queues.forEach((j) => j.chip?.classList.toggle('active', j === job));
    if (job.card) renderCardInPane(job.card);
    if (job.article) renderSourceInPane(job.article);
    else renderPhaseLog(job);
  }

  function updateChipLabel(job) {
    if (!job.chip) return;
    job.chip._gen = (job.chip._gen || 0) + 1;
    const icon = job.status === 'done' ? '✓ ' : job.status === 'error' ? '✗ ' : '● ';
    job.chip.textContent = icon + job.label;
    job.chip.className = 'stage-chip stage-' + job.status + (queues.find((j) => j.chip?.classList.contains('active')) === job ? ' active' : '');
  }

  function trimChipOverflow() {
    const stg = $('#staging'); if (!stg) return;
    while (queues.length > QUEUE_MAX_CHIPS) {
      // Evict oldest terminal (done/error) chip. If none, evict oldest.
      let evictIdx = queues.findIndex((j) => j.status === 'done' || j.status === 'error');
      if (evictIdx < 0) evictIdx = 0;
      const [victim] = queues.splice(evictIdx, 1);
      victim.es?.close?.();
      victim.chip?.remove();
    }
  }

  function createJob(input) {
    const isUrl = /^https?:\/\//i.test(input);
    const mode = isUrl ? 'url' : 'query';
    const label = mode === 'url' ? new URL(input).hostname : input.slice(0, 40);
    const chip = document.createElement('span');
    chip.className = 'stage-chip stage-pending';
    chip.title = 'Click to switch to this job';
    const stg = $('#staging');
    if (stg) stg.appendChild(chip);
    const job = { id: Math.random().toString(36).slice(2, 9), label, mode, input, chip, article: null, card: null, phaseLog: [], status: 'pending', es: null };
    queues.push(job);
    trimChipOverflow();
    chip.addEventListener('click', () => activateJob(job));
    updateChipLabel(job);
    return job;
  }

  /* Map SSE phase → chip status + typewriter label. */
  const PHASE_CHIP_MAP = {
    search_start:        { status: 'pending', label: 'Searching' },
    search_adapter_start:{ status: 'pending', label: 'Searching' },
    scrape_phase_start:  { status: 'pending', label: 'Scraping' },
    scrape_start:        { status: 'pending', label: 'Scraping' },
    scrape_retry:        { status: 'pending', label: 'Scraping' },
    rank_start:          { status: 'pending', label: 'Ranking' },
    pick_start:          { status: 'pending', label: 'Picking passage' },
    cut_start:           { status: 'running', label: 'Cutting' },
  };
  function typewriteChip(chip, icon, label) {
    if (!chip) return;
    chip._gen = (chip._gen || 0) + 1;
    const gen = chip._gen;
    chip.textContent = icon;
    let i = 0;
    const step = () => {
      if (chip._gen !== gen) return;
      if (i > label.length) return;
      chip.textContent = icon + label.slice(0, i) + (i < label.length ? '…' : '');
      i++;
      setTimeout(step, 28);
    };
    step();
  }
  function pushPhase(job, p) {
    const { text, level } = describePhase(p);
    job.phaseLog.push({ text, level });
    const phaseMap = PHASE_CHIP_MAP[p.type];
    if (phaseMap && job.status !== 'done' && job.status !== 'error') {
      if (job.status !== phaseMap.status) {
        job.status = phaseMap.status;
        job.chip.className = 'stage-chip stage-' + phaseMap.status
          + (queues.find((j) => j.chip?.classList.contains('active')) === job ? ' active' : '');
      }
      typewriteChip(job.chip, '● ', phaseMap.label);
    }
    const activeJob = queues.find((j) => j.chip?.classList.contains('active')) || queues[queues.length - 1];
    if (activeJob === job && !job.article) renderPhaseLog(job);
    setProgress(p);
  }

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

  async function runCutterFromInput() {
    const input = $('#zone-input');
    const val = (input?.value || '').trim();
    if (!val) { toast('Paste a URL or type an argument'); return; }
    const isUrl = /^https?:\/\//i.test(val);
    let argument = val;
    if (isUrl) {
      const asked = await askArgument(val);
      if (asked === null) return;
      argument = asked || 'Extract the strongest claim this article supports';
    }
    if (input) input.value = '';

    const job = createJob(val);
    activateJob(job);
    pushPhase(job, { type: 'mode', mode: job.mode, query: val, url: val });

    const params = new URLSearchParams();
    if (isUrl) { params.set('url', val); params.set('argument', argument); }
    else       { params.set('query', val); params.set('argument', argument); }

    const es = new EventSource('/api/research-source-stream?' + params.toString());
    job.es = es;

    const watchdog = setTimeout(() => {
      if (job.status === 'pending' || job.status === 'running') {
        job.status = 'error';
        job.label = 'Timed out';
        updateChipLabel(job);
        toast('Cutter timed out — try again');
        try { es.close(); } catch {}
      }
    }, 100000);

    es.addEventListener('phase', (e) => {
      try { pushPhase(job, JSON.parse(e.data)); } catch {}
    });
    es.addEventListener('source', (e) => {
      try {
        const s = JSON.parse(e.data);
        const article = { ...s.article, paragraphs: s.paragraphs || s.article.paragraphs || [] };
        job.article = article;
        job.cite = s.cite;
        job.lowConfidence = s.lowConfidence;
        const activeJob = queues.find((j) => j.chip?.classList.contains('active')) || job;
        if (activeJob === job) renderSourceInPane(article);
        if (s.lowConfidence) toast('Low-confidence match — review source carefully');
      } catch {}
    });
    es.addEventListener('card_delta', (e) => {
      try {
        const { acc } = JSON.parse(e.data);
        const partial = extractPartialCard(acc);
        if (!partial.body && !partial.tag && !partial.cite) return;
        const ghost = { tag: partial.tag, cite: partial.cite, body_markdown: partial.body, body_html: '' };
        const activeJob = queues.find((j) => j.chip?.classList.contains('active')) || job;
        if (activeJob === job) renderCardGhost(ghost);
      } catch {}
    });
    es.addEventListener('card', (e) => {
      try {
        const c = JSON.parse(e.data);
        const card = { ...c.card, cite: c.card.cite || job.cite };
        job.card = card;
        job.status = 'done';
        job.label = (card.tag || job.label).slice(0, 48);
        updateChipLabel(job);
        finishProgress(true);
        const activeJob = queues.find((j) => j.chip?.classList.contains('active')) || job;
        if (activeJob === job) renderCardInPane(card);
        API.history.push({ type: 'cut', tag: card.tag, cite: card.cite, model: c.model }).catch(() => {});
        try { window.__refreshUsage?.(); } catch {}
        if (c.fidelity && c.fidelity.ok === false) {
          toast(`Fidelity: ${c.fidelity.missing.length} paraphrased span(s) — review`);
        } else {
          toast('Card cut ✓');
        }
      } catch {}
    });
    es.addEventListener('error', (e) => {
      clearTimeout(watchdog);
      // Only mark error if the stream itself ends with one
      try {
        const d = e.data ? JSON.parse(e.data) : null;
        if (d?.error) {
          job.status = 'error';
          job.label = d.error.slice(0, 56);
          updateChipLabel(job);
          finishProgress(false);
          toast('Cut failed: ' + d.error);
        }
      } catch {}
    });
    es.addEventListener('done', () => { clearTimeout(watchdog); es.close(); });
  }

  function syncCardFromDom() {
    const tagEl = $('#wb-body [data-field="tag"]');
    const citeEl = $('#wb-body [data-field="cite"]');
    const bodyEl = $('#wb-body [data-field="body"]');
    if (!tagEl && !bodyEl) return;
    state.currentCard = state.currentCard || {};
    if (tagEl) state.currentCard.tag = tagEl.textContent.trim();
    if (citeEl) state.currentCard.cite = citeEl.textContent.trim();
    if (bodyEl) {
      state.currentCard.body_html = bodyEl.innerHTML;
      state.currentCard.body_plain = bodyEl.textContent;
    }
  }

  function selectionInside(el) {
    const sel = window.getSelection(); if (!sel || sel.rangeCount === 0) return false;
    return el.contains(sel.anchorNode) && el.contains(sel.focusNode);
  }

  function isYellow(color) {
    if (!color) return false;
    const c = color.toLowerCase().replace(/\s+/g, '');
    return c === '#ffff00' || c === '#ff0' || c === 'rgb(255,255,0)' || c === 'yellow';
  }

  function selectionOverlapsHighlight(sel) {
    if (!sel || sel.rangeCount === 0) return false;
    const range = sel.getRangeAt(0);
    // Check ancestors of both endpoints
    for (const node of [range.startContainer, range.endContainer, range.commonAncestorContainer]) {
      let el = node.nodeType === 1 ? node : node.parentElement;
      while (el) {
        if (el.tagName === 'MARK') return el;
        if (el.style && isYellow(el.style.backgroundColor)) return el;
        el = el.parentElement;
      }
    }
    // Check descendants of common ancestor within range
    const container = range.commonAncestorContainer.nodeType === 1
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;
    if (container) {
      const marks = container.querySelectorAll('mark, [style*="background"]');
      for (const m of marks) {
        if (range.intersectsNode(m) && (m.tagName === 'MARK' || isYellow(m.style.backgroundColor))) return m;
      }
    }
    return null;
  }

  function unwrapElement(el) {
    const parent = el.parentNode;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
  }

  function toggleHighlight() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) { toast('Select text first'); return; }
    const hit = selectionOverlapsHighlight(sel);
    if (hit) {
      unwrapElement(hit);
      return;
    }
    document.execCommand('styleWithCSS', false, true);
    document.execCommand('hiliteColor', false, '#FFFF00');
  }

  (function initCutter() {
    const input = $('#zone-input'), btn = $('#zone-enter');
    if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') runCutterFromInput(); });
    if (btn) btn.addEventListener('click', runCutterFromInput);

    // Seed state from static demo DOM
    syncCardFromDom();
    const wbBody = $('#wb-body');
    if (wbBody) wbBody.addEventListener('input', syncCardFromDom);

    // Formatting toolbar — Underline/Bold native toggle, Highlight latched mode
    let highlightMode = false;
    function setHighlightMode(on) {
      highlightMode = on;
      document.body.classList.toggle('highlight-mode', on);
      $$('.pane-fmt-tools .tool-btn[data-fmt="highlight"], .pane-foot .tool-btn[data-fmt="highlight"]').forEach(b => b.classList.toggle('active', on));
    }

    function applyHighlightToSelection() {
      const body = $('#wb-body .body') || $('#wb-body');
      if (!selectionInside(body)) return;
      document.execCommand('styleWithCSS', false, true);
      const existing = selectionOverlapsHighlight(window.getSelection());
      if (existing) {
        document.execCommand('hiliteColor', false, 'transparent');
        if (existing.tagName === 'MARK') {
          const parent = existing.parentNode;
          while (existing.firstChild) parent.insertBefore(existing.firstChild, existing);
          parent.removeChild(existing);
        }
      } else {
        document.execCommand('hiliteColor', false, '#FFFF00');
      }
      syncCardFromDom();
      const sel = window.getSelection();
      if (sel && sel.rangeCount) sel.removeAllRanges();
    }

    $$('.pane-fmt-tools .tool-btn[data-fmt], .pane-foot .tool-btn[data-fmt]').forEach((b) => {
      b.addEventListener('mousedown', (e) => {
        e.preventDefault(); // preserve selection
        const fmt = b.dataset.fmt;
        const body = $('#wb-body .body') || $('#wb-body');

        if (fmt === 'highlight') {
          setHighlightMode(!highlightMode);
          if (highlightMode && selectionInside(body) && !window.getSelection().isCollapsed) {
            applyHighlightToSelection();
          }
          return;
        }

        if (!selectionInside(body)) { toast('Select text in the card first'); return; }
        document.execCommand('styleWithCSS', false, true);
        if (fmt === 'underline') {
          document.execCommand('underline');
        } else if (fmt === 'bold') {
          document.execCommand('bold');
        }
        syncCardFromDom();
      });
    });

    // While highlight mode is on, auto-toggle highlight on any selection made in the card body
    document.addEventListener('mouseup', () => {
      if (!highlightMode) return;
      const body = $('#wb-body .body') || $('#wb-body');
      if (!body || !selectionInside(body)) return;
      if (window.getSelection().isCollapsed) return;
      applyHighlightToSelection();
    });

    // Copy button — preserve formatting
    $('#wb-copy')?.addEventListener('click', async () => {
      syncCardFromDom();
      const c = state.currentCard; if (!c || (!c.tag && !c.body_html)) { toast('Nothing to copy'); return; }
      const plain = `${c.tag || ''}\n${c.cite || ''}\n\n${c.body_plain || c.body_markdown || ''}`;
      const bodyHtml = inlineStyleBody(c.body_html || markdownCardToHtml(c.body_markdown || c.body_plain || ''));
      const { lastYY, rest } = splitCiteForCopy(c.cite || '');
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
      try {
        if (window.ClipboardItem && navigator.clipboard?.write) {
          await navigator.clipboard.write([new ClipboardItem({
            'text/html': new Blob([html], { type: 'text/html' }),
            'text/plain': new Blob([plain], { type: 'text/plain' }),
          })]);
        } else {
          await navigator.clipboard.writeText(plain);
        }
        toast('Copied with formatting ✓');
      } catch (err) { console.error(err); toast('Copy blocked'); }
    });

    // Add to… button — popover
    $('#wb-addto')?.addEventListener('click', (e) => {
      e.stopPropagation();
      syncCardFromDom();
      if (!state.currentCard || !state.currentCard.tag) { toast('No card to add'); return; }
      openAddToPopover($('#wb-addto'), state.currentCard);
    });

    // Source close — trigger expand animation
    const srcClose = $('#source-close'), wb = $('#workbench'),
          srcHandle = $('#source-handle'), srcReopen = $('#source-reopen');
    function updateSourceReopen() {
      if (srcReopen) srcReopen.style.display = wb?.classList.contains('source-hidden') ? 'inline-flex' : 'none';
    }
    function showSource() { wb?.classList.remove('source-hidden'); updateSourceReopen(); }
    function hideSource() {
      wb?.classList.add('source-hidden');
      const card = wb?.querySelector('.pane:not(.source)');
      if (card) { card.style.animation = 'none'; void card.offsetWidth; card.style.animation = ''; }
      updateSourceReopen();
    }
    srcClose?.addEventListener('click', hideSource);
    srcHandle?.addEventListener('click', showSource);
    srcReopen?.addEventListener('click', showSource);
    updateSourceReopen();

    // Trashcan — clear card + source, reset state
    $('#wb-trash')?.addEventListener('click', () => {
      state.currentCard = null;
      state.currentSource = null;
      const paneBody = $('#wb-body');
      if (paneBody) paneBody.innerHTML = `
        <div class="cite-block">
          <div class="tag" contenteditable="true" data-field="tag" data-placeholder="Tag will appear here after you cut a card"></div>
          <div class="meta" contenteditable="true" data-field="cite" data-placeholder="Cite will appear here"></div>
        </div>
        <div class="body" contenteditable="true" data-field="body" data-placeholder="Body will appear here after a cut."><p><br></p></div>`;
      const src = $('#pane-source .pane-body');
      if (src) src.innerHTML = '<p class="shrink" style="color:var(--muted)">No source loaded. Paste a URL above to scrape, or submit a query to research.</p>';
      const title = $('#pane-source .pane-title');
      if (title) title.innerHTML = '<span class="pip"></span>Source';
      toast('Cleared');
    });

    // Open original — opens the source URL and copies the citation to clipboard.
    // Uses Scroll-to-Text Fragment so the browser jumps to the highlighted passage.
    $('#source-open-original')?.addEventListener('click', async () => {
      const article = state.currentSource;
      const card = state.currentCard;
      const cite = card?.cite || article?.cite || '';
      let url = article?.url || '';
      if (!url && Array.isArray(article?.candidates) && article.candidates[0]?.url) url = article.candidates[0].url;

      // Build text-fragment anchor from the first highlighted run (verbatim, so it will match)
      let anchorText = '';
      const body = card?.body_markdown || card?.body_plain || '';
      const hl = body.match(/==([^=]{8,})==/);
      const un = body.match(/<u>([^<]{8,})<\/u>/);
      const excerpt = String(article?.bodyText || '').split(/\s+/).slice(0, 7).join(' ');
      if (hl) anchorText = hl[1];
      else if (un) anchorText = un[1];
      else anchorText = excerpt;
      anchorText = anchorText.replace(/\*\*<u>|<\/u>\*\*|<u>|<\/u>|==|[*_`]/g, '').trim().split(/\s+/).slice(0, 10).join(' ');

      // Copy a citable block to clipboard (MLA-ish + short cite + URL)
      const citeBlock = [cite, url].filter(Boolean).join('\n');
      try {
        if (citeBlock && navigator.clipboard?.writeText) await navigator.clipboard.writeText(citeBlock);
      } catch {}

      if (!url) {
        toast(cite ? 'No URL — citation copied' : 'No source URL or citation');
        return;
      }
      let openUrl = url;
      try {
        const ctl = new AbortController();
        const tm = setTimeout(() => ctl.abort(), 3500);
        const r = await fetch('/api/verify-url?url=' + encodeURIComponent(url), { signal: ctl.signal }).then(x => x.json());
        clearTimeout(tm);
        if (r && r.ok === false) { toast('Article unreachable — URL dead'); return; }
        openUrl = (r && r.finalUrl) || url;
      } catch {
        // timeout/network — fall through and open original URL
      }
      const base = openUrl.split('#')[0];
      const frag = anchorText ? `#:~:text=${encodeURIComponent(anchorText)}` : '';
      window.open(base + frag, '_blank', 'noopener,noreferrer');
      toast(cite ? 'Opened source · citation copied' : 'Opened source');
    });
  })();

  /* ──────────────────────────────────────────
     ADD-TO POPOVER (project picker)
     ────────────────────────────────────────── */
  let addToPop = null;
  function ensureAddToPop() {
    if (addToPop) return addToPop;
    addToPop = document.createElement('div');
    addToPop.className = 'addto-pop';
    document.body.appendChild(addToPop);
    document.addEventListener('click', (e) => {
      if (!addToPop.classList.contains('open')) return;
      if (e.target.closest('.addto-pop') || e.target.closest('#wb-addto')) return;
      addToPop.classList.remove('open');
    });
    return addToPop;
  }

  async function openAddToPopover(anchor, card) {
    const pop = ensureAddToPop();
    let projects = [];
    try { const r = await API.projects(); projects = r.items || []; } catch {}

    // If no projects — auto-save to All ("My Cards"/mine localStorage)
    if (!projects.length) {
      const r = await API.mine.save(card);
      if (r.duplicate) { toast('Already saved'); return; }
      API.history.push({ type: 'save', tag: card.tag, cite: card.cite }).catch(() => {});
      toast('Added to All');
      return;
    }

    const rows = projects.map((p) => `
      <button class="addto-row" data-pid="${esc(p.id)}">
        <span class="sw" style="background:${esc(p.color || '#6B7280')}"></span>
        <span>${esc(p.name)}</span>
        <span class="ct">${(p.cards || []).length}</span>
      </button>`).join('');
    pop.innerHTML = `
      <div class="pop-head">Add to project</div>
      ${rows}
      <div class="addto-new-input">
        <input id="addto-new-name" placeholder="New project name" maxlength="40">
        <button id="addto-new-go">Add</button>
      </div>
    `;

    pop.querySelectorAll('.addto-row').forEach((row) => row.addEventListener('click', async () => {
      const pid = row.dataset.pid;
      try {
        await API.addProjectCard(pid, card);
        const r = await API.mine.save(card);
        if (r.duplicate) { toast('Already saved'); }
        else { API.history.push({ type: 'save', tag: card.tag, cite: card.cite }).catch(() => {}); toast('Added ✓'); }
      } catch (err) { toast('Add failed: ' + err.message); }
      pop.classList.remove('open');
    }));
    pop.querySelector('#addto-new-go')?.addEventListener('click', async () => {
      const name = pop.querySelector('#addto-new-name')?.value.trim();
      if (!name) return;
      try {
        const { project } = await API.createProject(name, '#6B7280');
        await API.addProjectCard(project.id, card);
        const r = await API.mine.save(card);
        toast(r.duplicate ? 'Already saved · added to ' + name : 'Added to ' + name);
      } catch (err) { toast('Create failed: ' + err.message); }
      pop.classList.remove('open');
    });

    const rect = anchor.getBoundingClientRect();
    pop.style.position = 'fixed';
    pop.style.top = (rect.bottom + 6) + 'px';
    pop.style.left = Math.max(8, rect.right - 240) + 'px';
    pop.classList.add('open');
  }

  /* ──────────────────────────────────────────
     LIBRARY
     ────────────────────────────────────────── */
  function loadLibrary() {
    const activeTab = $('.lib-tab.active')?.dataset.lib || 'evidence';
    switchLibTab(activeTab);
  }
  function switchLibTab(tab) {
    $$('.lib-tab').forEach((b) => b.classList.toggle('active', b.dataset.lib === tab));
    $$('.lib-pane').forEach((p) => p.classList.toggle('hidden', p.dataset.libPane !== tab));
    const titles = {
      evidence: { t: 'Evidence', s: 'Community backfile — search, preview, and cut from any card.' },
      mine: { t: 'Cards', s: 'Your saved cards, organized into projects.' },
      history: { t: 'History', s: 'Recent cuts, edits, saves, and exports.' },
    };
    const meta = titles[tab] || titles.mine;
    const titleEl = $('#lib-page-title'), subEl = $('#lib-page-sub'), crumb = $('#crumb-page');
    if (titleEl) titleEl.textContent = meta.t;
    if (subEl) subEl.textContent = meta.s;
    if (crumb) crumb.textContent = meta.t;
    if (tab === 'evidence') { if (!state.evidenceCards.length) loadEvidence(); }
    if (tab === 'mine') { loadProjects(); renderMyCards(); }
    if (tab === 'history') renderHistory();
  }
  window.VerbaSwitchLibTab = switchLibTab;
  $$('.lib-tab').forEach((b) => b.addEventListener('click', () => switchLibTab(b.dataset.lib)));

  /* Evidence */
  async function loadEvidence() {
    const list = $('#ev-list'); if (!list) return;
    list.innerHTML = '<div style="padding:24px;color:var(--muted);font-size:13px">Loading library…</div>';
    try {
      const params = { limit: 200 };
      if (state.evSearch) params.q = state.evSearch;
      if (state.activeType && state.activeType !== 'all') params.type = state.activeType;
      const data = await API.libraryCards(params);
      state.evidenceCards = data.items || data.results || [];
      state.evidenceTotal = data.total || 0;
      renderEvidence();
      if (state.evidenceCards[0]) renderEvidenceDetail(state.evidenceCards[0]);
    } catch (err) {
      list.innerHTML = `<div style="padding:24px;color:#c33;font-size:13px">Error: ${esc(err.message)}</div>`;
    }
  }

  function cardType(c) {
    const t = String(c.typeLabel || c.type || '').toLowerCase();
    if (t === 'k' || t.includes('kritik')) return 'k';
    if (t.includes('policy')) return 'policy';
    if (t.includes('phil')) return 'phil';
    if (t.includes('tricks') || t === 'trick') return 'tricks';
    if (t.includes('theory') || t === 't' || t.includes('topicality')) return 'theory';
    return '';
  }

  function isGeneralLd(c) {
    const hay = [c.topicLabel, c.topic, c.tag].join(' ').toLowerCase();
    return /general\s*ld/.test(hay);
  }

  function renderEvidence() {
    const list = $('#ev-list'); if (!list) return;
    const filtered = state.evidenceCards.filter((c) => !isGeneralLd(c));
    $('#ev-count').textContent = String(state.evidenceTotal ?? filtered.length);
    if (!filtered.length) {
      list.innerHTML = '<div style="padding:24px;color:var(--muted);font-size:13px">No cards match.</div>';
      return;
    }
    list.innerHTML = filtered.map((c, i) => evItemHTML(c, i === 0)).join('');
    list.querySelectorAll('.ev-item').forEach((el, idx) => {
      el.addEventListener('click', async (e) => {
        const btn = e.target.closest('button[data-act]');
        if (btn && btn.dataset.act === 'export-ev') {
          e.stopPropagation();
          const c = filtered[idx];
          btn.classList.add('busy');
          try {
            const { blob, filename } = await API.exportDocx(c);
            const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click();
            API.history.push({ type: 'export', tag: c.tag, filename }).catch(() => {}); toast('Exported ' + filename);
          } catch (err) { toast('Export failed: ' + err.message); }
          finally { btn.classList.remove('busy'); }
          return;
        }
        list.querySelectorAll('.ev-item').forEach((e2) => e2.classList.remove('active'));
        el.classList.add('active');
        renderEvidenceDetail(filtered[idx]);
      });
    });
  }

  function evItemHTML(c, active) {
    const cat = cardType(c);
    const catLabel = cat ? cat.toUpperCase() : '';
    const topic = c.topicLabel || c.topic || '';
    const date = c.createdAt ? new Date(c.createdAt).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }) : '';
    return `
      <div class="ev-item ${active ? 'active' : ''}" data-card-id="${esc(c.id || '')}" style="position:relative">
        <button class="ev-export-btn" data-act="export-ev" title="Export" style="position:absolute;top:10px;right:10px;width:24px;height:24px;border-radius:5px;background:#fff;border:1px solid var(--line);color:var(--muted);cursor:pointer;display:flex;align-items:center;justify-content:center"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3v12"/><path d="M7 8l5-5 5 5"/><path d="M5 21h14"/></svg></button>
        <div class="tag">${esc(c.tag || '(untagged)')}</div>
        <div class="cite">${esc(c.shortCite || c.cite || '')}</div>
        <div class="head" style="margin-top:6px">
          <div class="badges" style="display:flex;gap:4px">
            ${catLabel ? `<span class="badge cat cat-${cat}">${esc(catLabel)}</span>` : ''}
            ${topic ? `<span class="badge topic">${esc(topic)}</span>` : ''}
          </div>
          <span class="date" style="margin-left:auto">${esc(date)}</span>
        </div>
      </div>`;
  }

  function renderEvidenceDetail(card) {
    state.currentEvidence = card;
    const t = $('#ev-detail-title'); if (t) t.textContent = 'Preview';
    const body = $('#ev-detail-body'); if (!body) return;
    const bodyHtml = card.body_html || markdownCardToHtml(card.body_markdown || card.body_plain || '');
    body.innerHTML = `
      <p style="font-weight:700;font-size:14.5px;margin:0 0 8px">${esc(card.tag || '')}</p>
      <p style="font:12px/1.4 var(--font-mono);color:var(--muted);margin:0 0 10px">${esc(card.cite || card.shortCite || '')}</p>
      <div class="ev-body-render" style="font-size:13px;line-height:1.6">${bodyHtml}</div>`;
  }

  // Evidence preview actions
  $('#ev-open')?.addEventListener('click', () => {
    const c = state.currentEvidence; if (!c) { toast('No card selected'); return; }
    renderCardInPane(c);
    go('home');
    $('#wb-body')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    toast('Opened in cutter');
  });
  $('#ev-addto')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const c = state.currentEvidence; if (!c) { toast('No card selected'); return; }
    openAddToPopover($('#ev-addto'), c);
  });
  $('#ev-copy')?.addEventListener('click', async () => {
    const c = state.currentEvidence; if (!c) { toast('No card selected'); return; }
    const plain = `${c.tag || ''}\n${c.cite || ''}\n\n${c.body_plain || c.body_markdown || ''}`;
    const bodyHtml = c.body_html || markdownCardToHtml(c.body_markdown || c.body_plain || '');
    const html = `<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#111"><p><b>${esc(c.tag || '')}</b></p><p><i>${esc(c.cite || '')}</i></p>${bodyHtml}</div>`;
    try {
      if (window.ClipboardItem && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([plain], { type: 'text/plain' }),
        })]);
      } else await navigator.clipboard.writeText(plain);
      toast('Copied ✓');
    } catch (err) { toast('Copy blocked'); }
  });

  $('#ev-search')?.addEventListener('input', (e) => {
    state.evSearch = e.target.value.trim();
    clearTimeout(loadEvidence._t);
    loadEvidence._t = setTimeout(loadEvidence, 250);
  });

  /* My Cards + Projects rail */
  const projState = { list: [], selected: 'all', pickingColor: '#B91C1C' };

  async function loadProjects() {
    try {
      const data = await API.projects();
      projState.list = data.items || [];
    } catch { projState.list = []; }
    renderProjectRail();
  }

  async function renderProjectRail() {
    const items = $('#proj-items'); if (!items) return;
    const mine = await API.mine.get();
    const countFor = (pid) => pid === 'all' ? mine.length : (projState.list.find((p) => p.id === pid)?.cards || []).length;
    const rows = ['all', ...projState.list.map((p) => p.id)].map((pid) => {
      if (pid === 'all') {
        return `<button class="proj-item ${projState.selected === 'all' ? 'active' : ''}" data-pid="all"><span class="sw" style="background:#111"></span>All<span class="ct">${countFor('all')}</span></button>`;
      }
      const p = projState.list.find((x) => x.id === pid);
      return `<button class="proj-item ${projState.selected === pid ? 'active' : ''}" data-pid="${esc(pid)}"><span class="sw" style="background:${esc(p.color || '#6B7280')}"></span>${esc(p.name)}<span class="proj-kebab" title="Project menu">⋯</span><span class="ct">${countFor(pid)}</span></button>`;
    }).join('');
    items.innerHTML = rows;
    items.querySelectorAll('.proj-item').forEach((el) => {
      el.addEventListener('click', (e) => {
        if (e.target.classList.contains('proj-kebab')) {
          e.stopPropagation();
          const pid = el.dataset.pid; if (pid === 'all') return;
          openProjMenu(pid, e.target);
          return;
        }
        projState.selected = el.dataset.pid;
        renderProjectRail(); renderMyCards();
      });
      if (el.dataset.pid !== 'all') {
        el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('drag-over'); });
        el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
        el.addEventListener('drop', async (e) => {
          e.preventDefault(); el.classList.remove('drag-over');
          const cardId = e.dataTransfer.getData('text/verba-card');
          if (!cardId) return;
          const card = (await API.mine.get()).find((c) => c.id === cardId); if (!card) return;
          try {
            await API.addProjectCard(el.dataset.pid, card);
            await loadProjects();
            toast('Added to project');
          } catch (err) { toast('Drop failed: ' + err.message); }
        });
      }
    });
  }

  /* Project kebab menu (replaces native prompt/confirm) */
  let projMenu = null;
  function ensureProjMenu() {
    if (projMenu) return projMenu;
    projMenu = document.createElement('div');
    projMenu.className = 'proj-menu';
    document.body.appendChild(projMenu);
    document.addEventListener('click', (e) => {
      if (!projMenu.classList.contains('open')) return;
      if (e.target.closest('.proj-menu') || e.target.classList.contains('proj-kebab')) return;
      projMenu.classList.remove('open');
    });
    return projMenu;
  }

  function openProjMenu(pid, anchorEl) {
    const p = projState.list.find((x) => x.id === pid); if (!p) return;
    const m = ensureProjMenu();
    m.innerHTML = `
      <button class="proj-menu-btn" data-act="rename">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4z"/></svg>
        Rename
      </button>
      <button class="proj-menu-btn" data-act="export">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Export .docx
      </button>
      <button class="proj-menu-btn danger" data-act="delete">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
        Delete
      </button>
    `;
    const rect = anchorEl.getBoundingClientRect();
    m.style.position = 'fixed';
    m.style.top = (rect.bottom + 4) + 'px';
    m.style.left = Math.max(8, rect.left - 120) + 'px';
    m.classList.add('open');

    m.querySelectorAll('.proj-menu-btn').forEach((btn) => btn.addEventListener('click', () => {
      const act = btn.dataset.act;
      m.classList.remove('open');
      if (act === 'rename') openInlineInput({ title: 'Rename project', value: p.name, placeholder: 'Project name' }, async (name) => {
        try { await API.renameProject(pid, { name }); await loadProjects(); toast('Renamed'); }
        catch (err) { toast('Rename failed: ' + err.message); }
      });
      else if (act === 'delete') openConfirm({ title: 'Delete "' + p.name + '"?', body: 'This removes the project and its card references. Your individual cards stay in All.' }, async () => {
        const snapshot = projState.list;
        projState.list = projState.list.filter((x) => x.id !== pid);
        if (projState.selected === pid) projState.selected = 'all';
        renderProjectRail(); renderMyCards(); toast('Deleted');
        try { await API.deleteProject(pid); }
        catch (err) {
          projState.list = snapshot;
          renderProjectRail(); renderMyCards();
          toast('Delete failed: ' + err.message);
        }
      });
      else if (act === 'export') exportProjectDocx(pid, p.name);
    }));
  }

  async function exportProjectDocx(pid, name) {
    toast('Exporting project…');
    try {
      const res = await fetch('/api/export/project', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: pid }),
      });
      if (!res.ok) throw new Error(await res.text() || 'export failed');
      const blob = await res.blob();
      const filename = (res.headers.get('content-disposition') || '').match(/filename="?([^";]+)/)?.[1] || `${name || 'project'}.docx`;
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click();
      API.history.push({ type: 'export', tag: 'Project: ' + (name || pid), filename }).catch(() => {});
      toast('Exported ' + filename);
    } catch (err) { toast('Export failed: ' + err.message); }
  }

  /* Inline modal helpers (replace native prompt/confirm) */
  function ensureInlineModal() {
    let m = document.getElementById('inline-modal');
    if (m) return m;
    m = document.createElement('div'); m.id = 'inline-modal'; m.className = 'inline-modal';
    m.innerHTML = `<div class="inline-modal-box"><h4 id="im-title"></h4><div id="im-body"></div><div class="row"><button class="cancel" id="im-cancel">Cancel</button><button class="ok" id="im-ok">OK</button></div></div>`;
    document.body.appendChild(m);
    m.addEventListener('click', (e) => { if (e.target === m) m.classList.remove('open'); });
    return m;
  }
  function openInlineInput({ title, value = '', placeholder = '' }, onOk) {
    const m = ensureInlineModal();
    m.querySelector('#im-title').textContent = title;
    m.querySelector('#im-body').innerHTML = `<input id="im-input" placeholder="${esc(placeholder)}" value="${esc(value)}">`;
    m.classList.add('open');
    const inp = m.querySelector('#im-input'); setTimeout(() => inp.focus(), 20);
    const close = () => m.classList.remove('open');
    const ok = () => { const v = inp.value.trim(); if (!v) return; close(); onOk(v); };
    m.querySelector('#im-cancel').onclick = close;
    m.querySelector('#im-ok').onclick = ok;
    inp.onkeydown = (e) => { if (e.key === 'Enter') ok(); if (e.key === 'Escape') close(); };
  }
  function openConfirm({ title, body = '' }, onOk) {
    const m = ensureInlineModal();
    m.querySelector('#im-title').textContent = title;
    m.querySelector('#im-body').innerHTML = body ? `<p style="margin:0 0 10px;color:var(--muted);font-size:13px;line-height:1.45">${esc(body)}</p>` : '';
    m.classList.add('open');
    const close = () => m.classList.remove('open');
    m.querySelector('#im-cancel').onclick = close;
    m.querySelector('#im-ok').onclick = () => { close(); onOk(); };
  }

  // Project create modal
  function openProjModal() { $('#proj-create-modal')?.classList.add('open'); setTimeout(() => $('#proj-name-input')?.focus(), 60); }
  function closeProjModal() { $('#proj-create-modal')?.classList.remove('open'); const el = $('#proj-name-input'); if (el) el.value = ''; }

  $('#proj-add')?.addEventListener('click', openProjModal);
  $('#proj-cancel')?.addEventListener('click', closeProjModal);
  $('#proj-create-modal')?.addEventListener('click', (e) => { if (e.target === $('#proj-create-modal')) closeProjModal(); });
  $$('#proj-swatches .sw-opt').forEach((sw) => sw.addEventListener('click', () => {
    $$('#proj-swatches .sw-opt').forEach((o) => o.classList.remove('active'));
    sw.classList.add('active');
    projState.pickingColor = sw.dataset.color;
  }));
  let _projSaving = false;
  $('#proj-save')?.addEventListener('click', async () => {
    if (_projSaving) return;
    const name = ($('#proj-name-input')?.value || '').trim();
    if (!name) { toast('Name required'); return; }
    const btn = $('#proj-save');
    _projSaving = true;
    if (btn) { btn.disabled = true; btn.style.opacity = '.6'; btn.style.pointerEvents = 'none'; }
    const optimistic = { id: 'tmp_' + Date.now(), name, color: projState.pickingColor, cards: [] };
    projState.list = [optimistic, ...projState.list];
    closeProjModal();
    renderProjectRail();
    try {
      const { project } = await API.createProject(name, projState.pickingColor);
      projState.list = projState.list.map((x) => x.id === optimistic.id ? project : x);
      renderProjectRail();
      toast('Project created');
    } catch (err) {
      projState.list = projState.list.filter((x) => x.id !== optimistic.id);
      renderProjectRail();
      toast('Create failed: ' + err.message);
    }
    finally {
      _projSaving = false;
      if (btn) { btn.disabled = false; btn.style.opacity = ''; btn.style.pointerEvents = ''; }
    }
  });
  $('#proj-name-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#proj-save')?.click();
    if (e.key === 'Escape') closeProjModal();
  });

  function formatRelDate(iso) {
    if (!iso) return '';
    const d = new Date(iso); if (isNaN(d)) return '';
    const now = new Date();
    const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diffDays = Math.round((startOf(now) - startOf(d)) / 86400000);
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    const sameYear = d.getFullYear() === now.getFullYear();
    return d.toLocaleDateString('en-US', sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function shortCite(cite) {
    if (!cite) return '';
    const s = String(cite).trim();
    const nameMatch = s.match(/^([A-Z][A-Za-z'\-]+)/);
    const yearMatch = s.match(/'?(\d{2})(?!\d)/) || s.match(/(\d{4})/);
    if (!nameMatch) return s.slice(0, 30);
    const name = nameMatch[1];
    let yr = '';
    if (yearMatch) {
      const raw = yearMatch[1];
      yr = raw.length === 4 ? raw.slice(-2) : raw;
    }
    return yr ? `${name} '${yr}` : name;
  }

  async function renderMyCards() {
    const grid = $('#mine-grid'); if (!grid) return;
    const mine = await API.mine.get();
    const q = ($('#mine-search')?.value || '').toLowerCase().trim();
    let filtered = mine;
    if (projState.selected !== 'all') {
      const p = projState.list.find((x) => x.id === projState.selected);
      const ids = new Set((p?.cards || []).map((c) => c.id));
      filtered = mine.filter((c) => ids.has(c.id));
    }
    if (q) {
      filtered = filtered.filter((c) => [c.tag, c.cite, c.topic, c.body_plain].join(' ').toLowerCase().includes(q));
    }
    if (!filtered.length) {
      grid.innerHTML = '<div style="grid-column:1/-1;padding:32px;color:var(--muted);font-size:13px">No cards here yet.</div>';
      return;
    }
    grid.innerHTML = filtered.map((c) => {
      const cat = cardType(c);
      const catLabel = cat ? cat.toUpperCase() : '';
      const topic = c.topicLabel || c.topic || '';
      const preview = String(c.body_plain || c.body_markdown || '').slice(0, 320);
      const words = String(c.body_plain || c.body_markdown || '').split(/\s+/).filter(Boolean).length;
      return `
        <div class="mycard" data-mid="${esc(c.id)}" draggable="true">
          <span class="date">${esc(formatRelDate(c.savedAt))}</span>
          <button class="export-btn" data-act="export-mine" title="Export"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 3v12"/><path d="M7 8l5-5 5 5"/><path d="M5 21h14"/></svg></button>
          <div class="head">
            <div class="badges" style="display:flex;gap:4px">
              ${catLabel ? `<span class="badge cat cat-${cat}">${esc(catLabel)}</span>` : ''}
              ${topic ? `<span class="badge topic">${esc(topic)}</span>` : ''}
            </div>
          </div>
          <div class="tag">${esc(c.tag || '(untagged)')}</div>
          <div class="cite">${esc(shortCite(c.cite || c.shortCite || ''))}</div>
          <div class="preview">${esc(preview)}</div>
          <div class="foot"><span class="meta">${words} words</span><button class="meta right" data-act="del-mine" style="background:none;border:0;cursor:pointer;color:var(--muted)">Remove</button></div>
        </div>`;
    }).join('');

    grid.querySelectorAll('.mycard').forEach((el) => {
      el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/verba-card', el.dataset.mid); el.classList.add('dragging'); });
      el.addEventListener('dragend', () => el.classList.remove('dragging'));
    });
  }

  $('#mine-search')?.addEventListener('input', () => {
    clearTimeout(renderMyCards._t);
    renderMyCards._t = setTimeout(renderMyCards, 120);
  });

  document.addEventListener('click', async (e) => {
    const card = e.target.closest('#mine-grid .mycard'); if (!card) return;
    const id = card.dataset.mid;
    const item = (await API.mine.get()).find((c) => c.id === id); if (!item) return;
    const btn = e.target.closest('button');
    const act = btn?.dataset.act;
    if (btn) e.stopPropagation();
    if (act === 'del-mine') {
      openConfirm({ title: 'Remove this card?', body: 'It will be removed from My Cards. Project references stay intact.' }, async () => {
        await API.mine.remove(id); renderMyCards(); renderProjectRail(); toast('Removed');
      });
      return;
    }
    if (act === 'export-mine') {
      const btn = e.target.closest('button.export-btn');
      btn?.classList.add('busy');
      try {
        const { blob, filename } = await API.exportDocx(item);
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click();
        API.history.push({ type: 'export', tag: item.tag, filename }).catch(() => {}); toast('Exported ' + filename);
      } catch (err) { toast('Export failed: ' + err.message); }
      finally { btn?.classList.remove('busy'); }
      return;
    }
    if (!act) { renderCardInPane(item); go('home'); }
  });

  /* History */
  const HIST_ICONS = {
    cut: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M7 17L7 7M7 7l-3 3M7 7l3 3M17 7l0 10M17 17l-3-3M17 17l3-3"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4z"/></svg>',
    export: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 3v12"/><path d="M7 8l5-5 5 5"/><path d="M5 21h14"/></svg>',
    save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg>',
    restore: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
    retag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4z"/></svg>',
    condense: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4z"/></svg>',
  };

  function parseCiteMeta(cite) {
    if (!cite) return { lastName: '', source: '' };
    const shortMatch = String(cite).match(/^([^[\n]+?)(?:\s*\[|$)/);
    const shortCite = (shortMatch ? shortMatch[1] : cite).trim();
    const lastName = shortCite.split(/\s*'/)[0].trim();
    let source = '';
    const bracket = String(cite).match(/\[([^\]]+)\]/);
    if (bracket) {
      const urlMatch = bracket[1].match(/https?:\/\/([^\s;\]]+)/);
      if (urlMatch) source = urlMatch[1].replace(/^www\./, '').split('/')[0];
      if (!source) {
        const parts = bracket[1].split(';').map((s) => s.trim());
        source = parts.find((p) => /\.(com|org|net|edu|gov|io|co)/i.test(p)) || parts[2] || '';
      }
    }
    return { lastName, source };
  }

  function histLabel(e) {
    const tag = e.tag ? `“${e.tag}”` : '';
    const { lastName, source } = parseCiteMeta(e.cite || '');
    const bits = [];
    if (source) bits.push(esc(source));
    if (lastName && lastName !== '[No Author]') bits.push(esc(lastName));
    const meta = bits.length ? ` <span class="meta">· ${bits.join(' · ')}</span>` : '';
    const fileMeta = e.filename ? ` <span class="meta">→ ${esc(e.filename)}</span>` : '';
    switch (e.type) {
      case 'cut': return `<b>Cut</b> ${esc(tag)}${meta}`;
      case 'edit': return `<b>Edited</b> ${esc(e.subject || e.tag || '')}${meta}`;
      case 'export': return `<b>Exported</b> ${esc(e.tag || e.label || 'card')}${meta}${fileMeta}`;
      case 'save': return `<b>Saved</b> ${esc(tag)}${meta}`;
      case 'restore': return `<b>Restored</b> ${esc(e.subject || e.tag || '')}${meta}`;
      case 'retag': return `<b>Re-tagged</b> ${esc(e.oldTag || '')} → ${esc(e.tag || '')}`;
      case 'condense': return `<b>Condensed</b> ${esc(e.tag || e.subject || '')} <span class="meta">· ${esc(e.from || '')} → ${esc(e.to || '')} words</span>`;
      default: return `<b>${esc(e.type)}</b> ${esc(e.tag || e.filename || '')}`;
    }
  }

  function histDayHeading(iso) {
    const d = new Date(iso); const now = new Date();
    const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((startOf(now) - startOf(d)) / 86400000);
    const datePart = d.toLocaleDateString('en-US', { month: 'short', day: '2-digit' }).toUpperCase();
    if (diff === 0) return `TODAY · ${datePart}`;
    if (diff === 1) return `YESTERDAY · ${datePart}`;
    return datePart;
  }

  async function renderHistory() {
    const wrap = $('#hist-list'); if (!wrap) return;
    const items = await API.history.get();
    const activeFilter = $('.hist-filter.on')?.dataset.hf || 'all';
    const ct = { all: items.length, cut: 0, save: 0, export: 0, edit: 0 };
    items.forEach((e) => { if (ct[e.type] != null) ct[e.type]++; });
    Object.entries(ct).forEach(([k, v]) => { const el = $('#hf-' + k); if (el) el.textContent = String(v); });
    const filtered = activeFilter === 'all' ? items : items.filter((e) => e.type === activeFilter);
    if (!filtered.length) { wrap.innerHTML = '<div style="padding:32px;color:var(--muted)">No activity yet.</div>'; return; }
    const byDay = new Map();
    filtered.forEach((e) => {
      const d = new Date(e.at); const key = new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(e);
    });
    const html = [];
    for (const [key, list] of byDay) {
      html.push(`<div class="hist-group"><h3 class="hist-group-h">${esc(histDayHeading(key))}</h3>`);
      list.forEach((e) => {
        const icon = HIST_ICONS[e.type] || '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="4"/></svg>';
        html.push(`
          <div class="hist-row" data-ht="${esc(e.type)}">
            <span class="hist-time">${esc(new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }))}</span>
            <span class="hist-ico ${esc(e.type)}">${icon}</span>
            <div class="hist-text">${histLabel(e)}</div>
          </div>`);
      });
      html.push('</div>');
    }
    wrap.innerHTML = html.join('');
  }

  $$('.hist-filter').forEach((b) => b.addEventListener('click', () => {
    $$('.hist-filter').forEach((x) => x.classList.toggle('on', x === b));
    renderHistory();
  }));

  /* ──────────────────────────────────────────
     ASSISTANT PANEL
     ────────────────────────────────────────── */
  (function initAssistant() {
    const panel = $('#assistant-panel'), btn = $('#assistant-btn'), closeBtn = $('#assistant-close');
    const msgs = $('#assistant-messages'), input = $('#assistant-input'), send = $('#assistant-send');
    const slashPop = $('#ap-slash-pop');
    if (!panel || !btn) return;
    const convo = [];
    const lastChatCards = new Map();

    function open() { panel.classList.add('open'); panel.setAttribute('aria-hidden', 'false'); setTimeout(() => input?.focus(), 200); }
    function close() { panel.classList.remove('open'); panel.setAttribute('aria-hidden', 'true'); }
    btn.addEventListener('click', () => panel.classList.contains('open') ? close() : open());
    closeBtn?.addEventListener('click', close);

    // Auto-grow textarea
    function autosize() {
      if (!input) return;
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 140) + 'px';
    }
    input?.addEventListener('input', autosize);

    function clearEmpty() {
      const e = msgs.querySelector('.ap-empty');
      if (e) e.remove();
    }

    function appendUser(text) {
      clearEmpty();
      const el = document.createElement('div');
      el.className = 'ap-msg user';
      el.textContent = text;
      msgs.appendChild(el);
      msgs.scrollTop = msgs.scrollHeight;
      return el;
    }

    // Strip markdown formatting the model may slip through
    function stripFmt(s) {
      return String(s || '')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/__([^_]+)__/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/<\/?u>/g, '')
        .replace(/==([^=]+)==/g, '$1');
    }

    // Parse [[CARD|cite|qual|preview]] tokens → chip nodes; regular text → <p>
    const CARD_RE = /\[\[CARD\|([^|\]]*)\|([^|\]]*)\|([^|\]]*)\|([^\]]*)\]\]/g;
    function renderBot(text) {
      const wrap = document.createElement('div');
      wrap.className = 'ap-msg bot';
      const label = document.createElement('div');
      label.className = 'ap-bot-label';
      label.textContent = 'ASSISTANT';
      wrap.appendChild(label);
      const clean = stripFmt(text);
      const paragraphs = clean.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
      paragraphs.forEach((para) => {
        let last = 0;
        CARD_RE.lastIndex = 0;
        const frag = document.createDocumentFragment();
        let m;
        let hasCard = false;
        while ((m = CARD_RE.exec(para)) !== null) {
          const id = m[1].trim();
          const full = lastChatCards.get(id);
          if (!full || !/==[^=]+==/.test(full.body_markdown || '')) {
            // Skip chips for cards without actual highlights — just drop them
            last = m.index + m[0].length;
            continue;
          }
          hasCard = true;
          if (m.index > last) {
            const p = document.createElement('p');
            p.textContent = para.slice(last, m.index).trim();
            if (p.textContent) frag.appendChild(p);
          }
          frag.appendChild(buildCardChip(id, m[2].trim(), m[3].trim(), m[4].trim()));
          last = m.index + m[0].length;
        }
        if (last < para.length) {
          const tail = para.slice(last).trim();
          if (tail) {
            const p = document.createElement('p');
            p.textContent = tail;
            frag.appendChild(p);
          }
        }
        if (!hasCard) {
          const p = document.createElement('p');
          p.textContent = para;
          wrap.appendChild(p);
        } else {
          wrap.appendChild(frag);
        }
      });
      msgs.appendChild(wrap);
      msgs.scrollTop = msgs.scrollHeight;
    }

    function buildCardChip(id, cite, qual, preview) {
      const chip = document.createElement('div');
      chip.className = 'ap-card-chip';
      chip.title = 'Click to save to My Cards';
      chip.dataset.cardId = id;
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
      chip.addEventListener('click', async () => {
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
        const r = await API.mine.save(card);
        if (r && r.duplicate) { toast('Already saved'); return; }
        chip.classList.add('saved');
        const savedEl = chip.querySelector('.ap-cc-saved');
        if (savedEl) savedEl.textContent = 'Saved ✓';
        toast('Saved full card to My Cards ✓');
      });
      return chip;
    }

    // Rotating thinking status — Claude-style
    const THINK_LINES = [
      'reading your question…',
      'framing the argument…',
      'checking response labels…',
      'picking warrants…',
      'checking library for backfile…',
      'drafting block…',
    ];
    function showThinking() {
      const el = document.createElement('div');
      el.className = 'ap-think';
      el.innerHTML = '<span class="ap-think-dot"></span><span class="ap-think-line"></span>';
      msgs.appendChild(el);
      msgs.scrollTop = msgs.scrollHeight;
      const line = el.querySelector('.ap-think-line');
      let i = 0;
      line.textContent = THINK_LINES[0];
      const iv = setInterval(() => {
        i = (i + 1) % THINK_LINES.length;
        line.classList.add('fade-out');
        setTimeout(() => {
          line.textContent = THINK_LINES[i];
          line.classList.remove('fade-out');
          line.classList.add('fade-in');
          setTimeout(() => line.classList.remove('fade-in'), 360);
        }, 320);
      }, 1800);
      return { el, stop: () => { clearInterval(iv); el.remove(); } };
    }

    /* ── Slash commands + suggestions ── */
    const COMMANDS = [
      { cmd: '/clear',   desc: 'Clear chat' },
      { cmd: '/find',    arg: '<query>', desc: 'Search My Cards' },
      { cmd: '/block',   arg: '<topic>', desc: 'Draft a block — cards or analytics as fits' },
      { cmd: '/explain', arg: '<what>',  desc: 'Explain a card or argument' },
    ];

    function runCommand(name, arg) {
      arg = (arg || '').trim();
      switch (name) {
        case '/clear':
          convo.length = 0; lastChatCards.clear(); msgs.innerHTML = ''; renderEmpty(); return;
        case '/find': {
          const s = $('#mine-search');
          if (s) { s.value = arg; s.dispatchEvent(new Event('input')); }
          try { go('library', 'mine'); } catch {}
          toast(arg ? `Searching cards: "${arg}"` : 'Opened My Cards'); return;
        }
        case '/block': {
          if (!arg) { input.value = '/block '; autosize(); input.focus(); return; }
          input.value = `Write a block on: ${arg}. Use cards only if they actually help; otherwise give analytics, warrants, and framing. Choose the number of cards based on what's useful — not a fixed count.`;
          autosize(); doSend(); return;
        }
        case '/explain': {
          if (!arg) { input.value = '/explain '; autosize(); input.focus(); return; }
          input.value = `Explain: ${arg}. State warrants, impact, and a response to the most likely answer.`;
          autosize(); doSend(); return;
        }
      }
    }

    function handleSlashSubmit() {
      const v = (input.value || '').trim();
      if (!v.startsWith('/')) return false;
      const sp = v.indexOf(' ');
      const name = (sp === -1 ? v : v.slice(0, sp)).toLowerCase();
      const arg  = sp === -1 ? '' : v.slice(sp + 1);
      if (!COMMANDS.some(c => c.cmd === name)) return false;
      input.value = ''; autosize();
      slashPop?.classList.remove('open');
      runCommand(name, arg);
      return true;
    }

    let slashSel = 0;
    function refreshSlashPop() {
      if (!slashPop) return;
      const v = input.value || '';
      if (!v.startsWith('/')) { slashPop.classList.remove('open'); return; }
      const first = v.slice(1).split(' ')[0].toLowerCase();
      const matches = COMMANDS.filter(c => c.cmd.slice(1).startsWith(first));
      if (!matches.length) { slashPop.classList.remove('open'); return; }
      slashSel = Math.min(slashSel, matches.length - 1);
      slashPop.innerHTML = matches.map((c, i) =>
        `<div class="ap-slash-row${i === slashSel ? ' sel' : ''}" data-i="${i}">
          <span class="cmd">${esc(c.cmd)}</span>
          <span>${esc(c.desc)}</span>
          ${c.arg ? `<span class="desc">${esc(c.arg)}</span>` : ''}
        </div>`).join('');
      slashPop._matches = matches;
      slashPop.classList.add('open');
      slashPop.querySelectorAll('.ap-slash-row').forEach((row, i) => {
        row.addEventListener('mouseenter', () => { slashSel = i; refreshSlashHighlight(); });
        row.addEventListener('click', () => selectSlash(i));
      });
    }
    function refreshSlashHighlight() {
      slashPop?.querySelectorAll('.ap-slash-row').forEach((r, i) => r.classList.toggle('sel', i === slashSel));
    }
    function selectSlash(i) {
      const m = slashPop?._matches; if (!m || !m[i]) return;
      const c = m[i];
      input.value = c.arg ? c.cmd + ' ' : c.cmd;
      autosize(); input.focus();
      slashPop.classList.remove('open');
      const n = input.value.length; input.setSelectionRange(n, n);
    }

    input?.addEventListener('input', refreshSlashPop);
    input?.addEventListener('blur', () => setTimeout(() => slashPop?.classList.remove('open'), 150));

    function renderEmpty() {
      msgs.innerHTML = `
        <div class="ap-empty">
          <div>
            <h4>What's on your mind?</h4>
            <p>Ask for blocks, warrants, or evidence. Type <kbd>/</kbd> for commands.</p>
          </div>
          <div class="ap-suggestions">
            <button class="ap-sugg" data-s="Write a block on AI regulation"><span class="ap-sugg-h">Block</span><span class="ap-sugg-s">on AI regulation</span></button>
            <button class="ap-sugg" data-s="Give me the strongest warrant against deterrence theory"><span class="ap-sugg-h">Counter-warrant</span><span class="ap-sugg-s">against deterrence</span></button>
            <button class="ap-sugg" data-s="Summarize my last saved card in 2 sentences"><span class="ap-sugg-h">Summarize</span><span class="ap-sugg-s">last saved card</span></button>
            <button class="ap-sugg" data-s="Outline an affirmative case on climate adaptation"><span class="ap-sugg-h">Case outline</span><span class="ap-sugg-s">climate adaptation aff</span></button>
          </div>
        </div>`;
      msgs.querySelectorAll('.ap-sugg').forEach(b => b.addEventListener('click', () => {
        input.value = b.dataset.s; autosize();
        if (b.dataset.s.startsWith('/')) handleSlashSubmit();
        else doSend();
      }));
    }
    renderEmpty();

    async function doSend() {
      const text = (input.value || '').trim();
      if (!text) return;
      if (text.startsWith('/') && handleSlashSubmit()) return;
      input.value = ''; autosize();
      convo.push({ role: 'user', content: text });
      appendUser(text);
      const thinking = showThinking();
      try {
        const r = await API.chat({ messages: convo });
        thinking.stop();
        refreshUsage();
        const reply = r.reply || r.message || r.content || (typeof r === 'string' ? r : JSON.stringify(r));
        if (Array.isArray(r.cards)) {
          lastChatCards.clear();
          r.cards.forEach(c => { if (c?.id) lastChatCards.set(c.id, c); });
        }
        convo.push({ role: 'assistant', content: reply });
        renderBot(reply);
      } catch (err) {
        thinking.stop();
        if (handleLimitError(err)) return;
        const el = document.createElement('div');
        el.className = 'ap-msg bot';
        el.style.color = 'var(--danger)';
        el.textContent = 'Error: ' + err.message;
        msgs.appendChild(el);
      }
    }
    send?.addEventListener('click', doSend);
    input?.addEventListener('keydown', (e) => {
      if (slashPop && slashPop.classList.contains('open')) {
        const m = slashPop._matches || [];
        if (e.key === 'ArrowDown') { e.preventDefault(); slashSel = (slashSel + 1) % m.length; refreshSlashHighlight(); return; }
        if (e.key === 'ArrowUp')   { e.preventDefault(); slashSel = (slashSel - 1 + m.length) % m.length; refreshSlashHighlight(); return; }
        if (e.key === 'Tab')       { e.preventDefault(); selectSlash(slashSel); return; }
        if (e.key === 'Escape')    { e.preventDefault(); slashPop.classList.remove('open'); return; }
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); selectSlash(slashSel); return; }
      }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); }
    });
  })();

  /* ──────────────────────────────────────────
     Usage pill (free tier)
     ────────────────────────────────────────── */
  async function refreshUsage() {
    const cutEl = document.getElementById('cutter-usage');
    const chatEl = document.getElementById('assistant-usage');
    if (!cutEl && !chatEl) return;
    try {
      const u = await API.usage();
      if (!u || u.tier !== 'free') {
        cutEl && (cutEl.hidden = true);
        chatEl && (chatEl.hidden = true);
        return;
      }
      const resetStr = u.resetAt
        ? new Date(u.resetAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
        : '';
      const fmt = (k) => {
        const used = k.used || 0, lim = k.limit || 0, left = Math.max(0, lim - used);
        return { text: `${left}/${lim} left · resets ${resetStr}`, warn: left <= Math.max(1, Math.floor(lim * 0.2)) };
      };
      if (cutEl) {
        const f = fmt(u.cutCard || {});
        cutEl.textContent = `Cuts: ${f.text}`;
        cutEl.classList.toggle('warn', f.warn);
        cutEl.hidden = false;
      }
      if (chatEl) {
        const f = fmt(u.chat || {});
        chatEl.textContent = `Messages: ${f.text}`;
        chatEl.classList.toggle('warn', f.warn);
        chatEl.hidden = false;
      }
    } catch {}
  }
  window.__refreshUsage = refreshUsage;
  refreshUsage();

  /* ──────────────────────────────────────────
     Bootstrap
     ────────────────────────────────────────── */
  refreshNavCounts();
  API.health?.().then((h) => console.log('[Verba] backend ok:', h?.model)).catch(() => console.warn('[Verba] backend unreachable'));
})();
