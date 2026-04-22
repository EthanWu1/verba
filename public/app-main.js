/* Verba app-main.js — 2-page SPA: Card Cutter + Library (Evidence/Cards/History).
   Runs AFTER the inline IIFE; overrides any leftover handlers. */
(function () {
  'use strict';
  const API = window.VerbaAPI;
  if (!API) { console.error('VerbaAPI missing'); return; }
  window.__verba = window.__verba || {};

  const HL_COLORS = { yellow: '#FFFF00', cyan: '#00FFFF', green: '#00FF00', lilac: '#C7B7F1' };
  function currentHlColor() {
    const t = (typeof TWEAKS !== 'undefined' && TWEAKS) ? TWEAKS : (window.TWEAKS || {});
    return HL_COLORS[t.highlight] || '#FFFF00';
  }

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
      const u = who && who.user;
      if (!u || !u.email) {
        try { await API.auth.logout(); } catch {}
        location.href = '/signin';
        return;
      }
      window.__verbaUser = u;
      window.__verba = window.__verba || {};
      paintAccount(u);
    } catch {
      location.href = '/signin';
    }
  })();

  const $  = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (msg, opts) => {
    if (window.VerbaAlert && window.VerbaAlert.push) {
      if (typeof msg === 'object' && msg) return window.VerbaAlert.push(msg);
      return window.VerbaAlert.push(Object.assign({ description: String(msg || '') }, opts || {}));
    }
    const t = document.getElementById('toast'); if (!t) return;
    t.textContent = typeof msg === 'string' ? msg : (msg && msg.description) || '';
    t.classList.add('show');
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
  const PAGES = ['home', 'library', 'tournament', 'teams', 'rankings'];
  const LEGACY = {
    community: 'library', saved: 'library', history: 'library', mine: 'library',
    research: 'home', chatbot: 'home', assistant: 'library',
    contentions: 'library', projects: 'library',
  };

  function applyRoute(page, libTab) {
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
    return page;
  }
  function go(page, libTab, fromPop) {
    const resolved = applyRoute(page, libTab);
    if (!fromPop) {
      const cur = history.state || {};
      const next = { verba: true, page: resolved, libTab: libTab || null };
      if (cur.verba && cur.page === next.page && cur.libTab === next.libTab) {
        history.replaceState(next, '');
      } else {
        history.pushState(next, '');
      }
    }
  }
  window.addEventListener('popstate', (e) => {
    const s = e.state;
    if (s && s.verba) {
      applyRoute(s.page, s.libTab);
    } else {
      try {
        const saved = localStorage.getItem('verba.page');
        applyRoute(saved || 'home');
      } catch { applyRoute('home'); }
      history.replaceState({ verba: true, page: 'home', libTab: null }, '');
    }
  });
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
      const collapsed = document.querySelector('.shell')?.classList.contains('sb-collapsed');
      const width = collapsed ? 260 : r.width;
      menu.style.left = r.left + 'px';
      menu.style.bottom = (window.innerHeight - r.top + 6) + 'px';
      menu.style.width = width + 'px';
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
      if (!menu.classList.contains('open')) return;
      menu.classList.remove('open');
      menu.classList.add('closing');
      menu.setAttribute('aria-hidden', 'true');
      row.setAttribute('aria-expanded', 'false');
      setTimeout(() => menu.classList.remove('closing'), 260);
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

    // ⌘B bold, ⌘U underline, ⌘⌥H highlight.
    document.addEventListener('keydown', (e) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.altKey && (e.key === 'h' || e.key === 'H' || e.code === 'KeyH')) {
        e.preventDefault();
        toggleHighlight();
        return;
      }
      if (e.altKey) return;
      const body = $('#wb-body .body') || $('#wb-body');
      if (e.key === 'b' || e.key === 'B' || e.code === 'KeyB') {
        if (!selectionInside(body)) return;
        e.preventDefault();
        document.execCommand('styleWithCSS', false, true);
        document.execCommand('bold');
        syncCardFromDom();
      } else if (e.key === 'u' || e.key === 'U' || e.code === 'KeyU') {
        if (!selectionInside(body)) return;
        e.preventDefault();
        document.execCommand('styleWithCSS', false, true);
        document.execCommand('underline');
        syncCardFromDom();
      }
    });
  })();

  try {
    const saved = localStorage.getItem('verba.page');
    const initial = saved || 'home';
    const initState = { verba: true, page: initial, libTab: null };
    history.replaceState(initState, '');
    applyRoute(initial);
    history.pushState(initState, '');
  } catch { applyRoute('home'); }

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
  const state = { currentSource: null, currentCard: null, evidenceCards: [], activeType: 'all', evSearch: '', evShown: 50, evFiltered: [], evPage: 1, evSeed: 0, evLoading: false, evDone: false };

  const Carousel = window.VerbaCarousel;
  if (!Carousel) { console.error('VerbaCarousel not loaded'); return; }

  const LS_KEY = 'verba.cutter.carousel.v1';
  let carouselState = Carousel.hydrate(localStorage.getItem(LS_KEY));
  let saveTimer = null;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(LS_KEY, Carousel.serialize(carouselState)); } catch (_) {}
    }, 400);
  }
  function applyState(next) {
    carouselState = next;
    renderCarousel();
    scheduleSave();
  }
  function activeItem() {
    return carouselState.items[carouselState.activeIndex] || null;
  }

  Object.defineProperty(state, 'currentCard', {
    get() { return activeItem() || null; },
    set(_v) { /* no-op: carousel owns active card; wb-trash calls removeItem instead */ },
    configurable: true
  });

  function renderCarousel() {
    const wbBody = document.getElementById('wb-body');
    const empty = document.getElementById('carousel-empty');
    const prevBtn = document.querySelector('.carousel-prev');
    const nextBtn = document.querySelector('.carousel-next');
    const dots = document.getElementById('carousel-dots');
    const sourceLink = document.getElementById('wb-source-link');
    if (!wbBody) return;

    const items = carouselState.items;
    const item = items[carouselState.activeIndex];

    if (empty) empty.hidden = items.length !== 0;
    if (wbBody) wbBody.hidden = items.length === 0;
    if (prevBtn) prevBtn.hidden = carouselState.activeIndex <= 0;
    if (nextBtn) nextBtn.hidden = carouselState.activeIndex >= items.length - 1;

    if (sourceLink) {
      if (item && item.sourceUrl) {
        sourceLink.href = item.sourceUrl;
        sourceLink.hidden = false;
      } else {
        sourceLink.hidden = true;
      }
    }

    if (dots) {
      dots.innerHTML = '';
      if (items.length > 1) {
        items.forEach((_, i) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'dot' + (i === carouselState.activeIndex ? ' is-active' : '');
          b.addEventListener('click', () => applyState(Carousel.setActive(carouselState, i)));
          dots.appendChild(b);
        });
      }
    }

    if (!item) {
      wbBody.innerHTML = '';
      return;
    }

    if (item.status === 'cutting') {
      wbBody.innerHTML = renderCuttingBody(item);
    } else if (item.status === 'error') {
      wbBody.innerHTML = renderErrorBody(item);
    } else {
      wbBody.innerHTML = renderEditorBody(item);
    }
  }

  function renderCuttingBody(item) {
    const pct = Math.min(95, (item.phaseHistory.length / 5) * 100);
    const logLines = item.phaseHistory.slice(-5).map((p, i, arr) => {
      const cls = i === arr.length - 1 ? 'current' : '';
      return `<div class="${cls}">${i === arr.length - 1 ? '→' : '✓'} ${escapeHtml(p)}</div>`;
    }).join('');
    return `
      <div class="cut-progress"><div class="cut-progress-bar" style="width:${pct}%"></div></div>
      <div class="cut-status">Cutting · stage ${item.phaseHistory.length} of 5</div>
      <div class="cut-log">${logLines || '<div class="pending">○ starting…</div>'}</div>
    `;
  }

  function renderErrorBody(item) {
    return `<div class="cut-error">${escapeHtml(item.error || 'Cut failed')}</div>`;
  }

  function renderEditorBody(item) {
    return `
      <div class="cite-block">
        <div class="tag" contenteditable="true" data-field="tag" data-placeholder="Tag will appear here after you cut a card">${escapeHtml(item.tag || '')}</div>
        <div class="meta" contenteditable="true" data-field="cite" data-placeholder="Cite will appear here">${escapeHtml(item.cite || '')}</div>
      </div>
      <div class="body" contenteditable="true" data-field="body" data-placeholder="Body will appear here after a cut. You can edit inline, then Copy or Add to a project.">${item.body_html || '<p><br></p>'}</div>
    `;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function handleTrash(id) {
    const item = carouselState.items.find(i => i.id === id);
    if (!item) return;
    const prevIndex = carouselState.items.findIndex(i => i.id === id);
    applyState(Carousel.removeItem(carouselState, id));
    if (item.id && window.API && API.mine && typeof API.mine.remove === 'function') {
      API.mine.remove(item.id).catch(() => {});
    }
    showUndoToast(item, prevIndex);
  }

  function showUndoToast(item, prevIndex) {
    const el = document.createElement('div');
    el.className = 'toast-undo';
    el.innerHTML = 'Card removed <button>Undo</button>';
    el.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#0d0d12;color:#fff;padding:10px 16px;border-radius:10px;display:flex;gap:12px;align-items:center;z-index:9999;box-shadow:0 6px 20px rgba(0,0,0,0.25);font:500 13px var(--font-display,system-ui)';
    document.body.appendChild(el);
    const remove = () => el.remove();
    const t = setTimeout(remove, 4000);
    el.querySelector('button').addEventListener('click', () => {
      clearTimeout(t);
      const items = carouselState.items.slice();
      items.splice(Math.min(prevIndex, items.length), 0, item);
      applyState({ items, activeIndex: prevIndex });
      remove();
    });
  }

  function filterEvidenceClient(cards, q) {
    const needle = String(q || '').trim().toLowerCase();
    if (!needle) return cards.slice();
    return cards.filter((c) => {
      const hay = [c.tag, c.cite, c.shortCite, c.body_plain, c.body_markdown, c.topic, c.topicLabel]
        .filter(Boolean).join(' ').toLowerCase();
      return hay.includes(needle);
    });
  }

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
      p = p.replace(/==([\s\S]*?)==/g, '<span class="fmt-highlight"><mark>$1</mark></span>');
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

  /* Inject inline styles so Word honors nested mark/b/u on paste. */
  const inlineStyleBody = (window.VerbaClipboard && window.VerbaClipboard.flattenInlineStyles)
    || ((html) => String(html || ''));

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

  /* renderCardGhost / renderCardInPane — replaced by carousel state in Task 11.
     Kept as no-ops so legacy callers (evidence open, library open) don't throw.
     Those callers still work: renderCardInPane is re-mapped below to push a
     carousel item when called from legacy paths. */
  function renderCardGhost(_card) { /* no-op: streaming handled via carouselState */ }

  function renderCardInPane(card) {
    // Legacy callers (ev-open, library open) push card into carousel instead
    // of mutating #wb-body directly.
    if (!card) return;
    const id = card.id || ('legacy_' + Date.now());
    const existing = carouselState.items.find(i => i.id === id);
    if (existing) {
      applyState(Carousel.setActive(carouselState, carouselState.items.indexOf(existing)));
    } else {
      applyState(Carousel.pushItem(carouselState, {
        id,
        status: 'done',
        sourceUrl: card.url || null,
        createdAt: Date.now(),
        tag: card.tag || '',
        cite: card.cite || '',
        body_html: card.body_html || (card.body_markdown ? markdownCardToHtml(card.body_markdown) : ''),
        body_plain: card.body_plain || card.body || '',
        body_markdown: card.body_markdown || '',
      }));
    }
  }

  function startCut(input, opts = {}) {
    const id = (crypto.randomUUID && crypto.randomUUID()) || ('c_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8));
    const sourceUrl = /^https?:\/\//i.test(input) ? input : null;
    applyState(Carousel.pushItem(carouselState, {
      id, status: 'cutting', sourceUrl, createdAt: Date.now(),
    }));
    openCutStream({ input, length: currentLength(), density: 'standard' }, id);
  }

  function currentLength() {
    const active = document.querySelector('.length-opt.is-active');
    return active ? active.dataset.length : 'long';
  }

  function openCutStream(body, id) {
    const isUrl = /^https?:\/\//i.test(body.input);
    const params = new URLSearchParams();
    if (isUrl) {
      params.set('url', body.input);
      params.set('argument', body.input); // argument pre-filled for carousel flow
    } else {
      params.set('query', body.input);
      params.set('argument', body.input);
    }
    params.set('density', body.density || 'standard');
    params.set('length', body.length || 'long');

    const es = new EventSource('/api/research-source-stream?' + params.toString());
    // Track cite from source event for card merge
    let streamCite = '';

    const watchdog = setTimeout(() => {
      applyState(Carousel.updateItem(carouselState, id, { status: 'error', error: 'Timed out' }));
      finishProgress(false);
      toast({ variant: 'destructive', title: 'Cutter timed out', description: 'Try again', duration: 4000 });
      try { es.close(); } catch {}
    }, 100000);

    es.addEventListener('phase', (e) => {
      try {
        const p = JSON.parse(e.data);
        const { text } = describePhase(p);
        const cur = carouselState.items.find(i => i.id === id);
        const prev = cur ? (cur.phaseHistory || []) : [];
        applyState(Carousel.updateItem(carouselState, id, {
          phase: text,
          phaseHistory: [...prev.slice(-4), text],
        }));
        setProgress(p);
      } catch {}
    });

    es.addEventListener('source', (e) => {
      try {
        const s = JSON.parse(e.data);
        streamCite = s.cite || '';
        if (s.lowConfidence) toast({ variant: 'warning', title: 'Low-confidence match', description: 'Review source carefully', duration: 4000 });
      } catch {}
    });

    es.addEventListener('card_delta', (e) => {
      try {
        const { acc } = JSON.parse(e.data);
        const partial = extractPartialCard(acc);
        if (!partial.body && !partial.tag && !partial.cite) return;
        applyState(Carousel.updateItem(carouselState, id, {
          status: 'cutting',
          tag: partial.tag || '',
          cite: partial.cite || streamCite || '',
          body_markdown: partial.body || '',
          body_html: partial.body ? markdownCardToHtml(partial.body) : '',
        }));
      } catch {}
    });

    es.addEventListener('card', (e) => {
      try {
        const c = JSON.parse(e.data);
        const card = { ...c.card, cite: c.card.cite || streamCite };
        clearTimeout(watchdog);
        applyState(Carousel.updateItem(carouselState, id, {
          status: 'done',
          tag: card.tag || '',
          cite: card.cite || '',
          body_html: card.body_html || (card.body_markdown ? markdownCardToHtml(card.body_markdown) : ''),
          body_plain: card.body_plain || card.body || '',
          body_markdown: card.body_markdown || '',
        }));
        finishProgress(true);
        API.mine.save(card).catch(() => {});
        API.history.push({ type: 'cut', tag: card.tag, cite: card.cite, model: c.model }).catch(() => {});
        try { window.__refreshUsage?.(); } catch {}
        if (c.fidelity && c.fidelity.ok === false) {
          toast({ variant: 'warning', title: 'Fidelity warning', description: `${c.fidelity.missing.length} paraphrased span(s) — review`, duration: 5000 });
        } else {
          toast({ variant: 'success', title: 'Card cut', description: card.tag || card.cite || 'Ready in editor', duration: 3200 });
        }
      } catch {}
    });

    es.addEventListener('error', (e) => {
      clearTimeout(watchdog);
      try {
        const d = e.data ? JSON.parse(e.data) : null;
        if (d?.error) {
          applyState(Carousel.updateItem(carouselState, id, { status: 'error', error: d.error }));
          finishProgress(false);
          toast({ variant: 'destructive', title: 'Cut failed', description: d.error, duration: 5000 });
        }
      } catch {}
    });

    es.addEventListener('done', () => { clearTimeout(watchdog); es.close(); });
  }

  // (cutter-strip removed — #zone-enter is the only input; length defaults to 'long')

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

  function updateChipLabel(job) {
    // no-op: chip UI removed; kept so SSE event handlers don't throw
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
      job.status = phaseMap.status;
    }
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
    const attached = window.__verbaAttachedFile || null;
    if (!val && !attached) { toast('Paste a URL, type an argument, or attach a file'); return; }
    if (input) input.value = '';
    if (attached) {
      try {
        const fd = new FormData();
        fd.append('file', attached);
        const res = await fetch('/api/scrape/file', { method: 'POST', body: fd, credentials: 'include' });
        if (!res.ok) throw new Error('upload failed');
        const data = await res.json();
        window.__verbaAttachedFile = null;
        if (typeof renderAttachTray === 'function') renderAttachTray();
        startCut(data.title || attached.name);
      } catch (err) { console.error(err); toast({ variant: 'destructive', title: 'Upload failed', description: err.message || String(err), duration: 4000 }); }
      return;
    }
    startCut(val);
  }

  function syncActiveFromDom() {
    const shell = document.getElementById('wb-body');
    if (!shell) return;
    const item = activeItem();
    if (!item) return;
    const tagEl = shell.querySelector('[data-field="tag"]');
    const citeEl = shell.querySelector('[data-field="cite"]');
    const bodyEl = shell.querySelector('[data-field="body"]');
    const patch = {};
    if (tagEl) patch.tag = tagEl.textContent.trim();
    if (citeEl) patch.cite = citeEl.textContent.trim();
    if (bodyEl) {
      patch.body_html = bodyEl.innerHTML;
      patch.body_plain = bodyEl.textContent;
    }
    applyState(Carousel.updateItem(carouselState, item.id, patch));
  }
  function syncCardFromDom() { syncActiveFromDom(); }

  function normalizeUnderlineTags(root) {
    if (!root || !root.querySelectorAll) return;
    const us = root.querySelectorAll('u');
    for (const u of us) {
      const existing = u.getAttribute('style') || '';
      if (!/text-decoration\s*:\s*underline/i.test(existing)) {
        const sep = existing && !existing.trim().endsWith(';') ? ';' : '';
        u.setAttribute('style', existing + sep + 'text-decoration:underline');
      }
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

  function snapSelectionToWords() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) return;
    const snap = window.VerbaWordSnap && window.VerbaWordSnap.snapToWordBoundaries;
    if (!snap) return;
    try {
      const r = sel.getRangeAt(0);
      if (r.startContainer.nodeType === 3) {
        const txt = r.startContainer.nodeValue || '';
        if (txt.length) {
          const s = snap(txt, r.startOffset, txt.length).start;
          r.setStart(r.startContainer, Math.min(s, txt.length));
        }
      }
      if (r.endContainer.nodeType === 3) {
        const txt = r.endContainer.nodeValue || '';
        if (txt.length) {
          const e = snap(txt, 0, r.endOffset).end;
          r.setEnd(r.endContainer, Math.min(e, txt.length));
        }
      }
      if (!r.collapsed) { sel.removeAllRanges(); sel.addRange(r); }
    } catch (_) {}
  }

  function toggleHighlight() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) { toast('Select text first'); return; }
    snapSelectionToWords();
    const hit = selectionOverlapsHighlight(sel);
    if (hit) {
      unwrapElement(hit);
      return;
    }
    document.execCommand('styleWithCSS', false, true);
    document.execCommand('hiliteColor', false, currentHlColor());
  }

  (function initCutter() {
    const input = $('#zone-input'), btn = $('#zone-enter');
    if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') runCutterFromInput(); });
    if (btn) btn.addEventListener('click', runCutterFromInput);

    function renderAttachTray() {
      const tray = $('#attach-tray');
      if (!tray) return;
      const a = window.__verbaAttachedFile;
      if (!a) { tray.innerHTML = ''; tray.hidden = true; return; }
      tray.hidden = false;
      const icon = `<span class="icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg></span>`;
      const kb = a.chars ? `${Math.max(1, Math.round(a.chars/1000))}k chars` : (a.uploading ? 'Uploading…' : '');
      tray.innerHTML = `<div class="attach-chip ${a.uploading ? 'loading' : ''}">${icon}<span class="meta"><span class="name">${escHtml(a.filename || 'file')}</span>${kb ? `<span class="sub">${kb}</span>` : ''}</span><button class="rm" id="attach-remove" title="Remove"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M18 6L6 18M6 6l12 12"/></svg></button></div>`;
      const rm = document.getElementById('attach-remove');
      if (rm) rm.onclick = () => { window.__verbaAttachedFile = null; renderAttachTray(); };
    }
    function escHtml(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

    // File attach
    const attachBtn = $('#attach-btn'), attachFile = $('#attach-file');
    if (attachBtn && attachFile) {
      attachBtn.addEventListener('click', () => attachFile.click());
      attachFile.addEventListener('change', async (e) => {
        const f = e.target.files && e.target.files[0];
        if (!f) return;
        window.__verbaAttachedFile = { uploading: true, filename: f.name, chars: 0 };
        renderAttachTray();
        try {
          const fd = new FormData();
          fd.append('file', f);
          const res = await fetch('/api/scrape/file', { method: 'POST', body: fd, credentials: 'same-origin' });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Upload failed');
          window.__verbaAttachedFile = { token: data.token, filename: data.filename, chars: data.chars, preview: data.preview };
        } catch (err) {
          toast(err.message || 'Upload failed');
          window.__verbaAttachedFile = null;
        }
        attachFile.value = '';
        renderAttachTray();
      });
    }

    // Seed state from static demo DOM (no-op now — carousel owns the editor state)
    // #wb-body input handler replaced by document-level delegation in Task 10

    // Formatting toolbar — Underline/Bold native toggle, Highlight latched mode
    let highlightMode = false;
    function setHighlightMode(on) {
      highlightMode = on;
      document.body.classList.toggle('highlight-mode', on);
      $$('.pane-fmt-tools .tool-btn[data-fmt="highlight"], .pane-foot .tool-btn[data-fmt="highlight"], .pane-foot-tools .tool-btn[data-fmt="highlight"]').forEach(b => b.classList.toggle('active', on));
    }

    function applyHighlightToSelection() {
      const body = $('#wb-body .body') || $('#wb-body');
      if (!selectionInside(body)) return;
      snapSelectionToWords();
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
        document.execCommand('hiliteColor', false, currentHlColor());
      }
      syncCardFromDom();
      const sel = window.getSelection();
      if (sel && sel.rangeCount) sel.removeAllRanges();
    }

    $$('.pane-fmt-tools .tool-btn[data-fmt], .pane-foot .tool-btn[data-fmt], .pane-foot-tools .tool-btn[data-fmt]').forEach((b) => {
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

    // Double-click word toggles highlight (browser auto-selects word on dblclick)
    document.addEventListener('dblclick', (e) => {
      const body = $('#wb-body .body') || $('#wb-body');
      if (!body || !body.contains(e.target)) return;
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount || sel.isCollapsed) return;
      const hit = selectionOverlapsHighlight(sel);
      if (hit) {
        const parent = hit.parentNode;
        while (hit.firstChild) parent.insertBefore(hit.firstChild, hit);
        parent.removeChild(hit);
        syncCardFromDom();
        sel.removeAllRanges();
      } else {
        applyHighlightToSelection();
      }
    });

    // Copy button — handled by event delegation at document level (button lives inside card-shell)

    // Native Ctrl+C / Cmd+C — route through same serializer as copy button
    document.addEventListener('copy', (e) => {
      const VC = window.VerbaClipboard;
      if (!VC) return;
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
      const range = sel.getRangeAt(0);
      const container = range.commonAncestorContainer;
      const node = container.nodeType === 1 ? container : container.parentElement;
      if (!node || !node.closest) return;
      // Widen guard to catch cross-region selections (e.g. cite-block through wb-body) where
      // commonAncestorContainer resolves to a parent wrapper rather than the content elements.
      // Mixed-context selections route through card-body branch (flattenInlineStyles); cite prefix
      // splitting is intentionally skipped for cross-block selections.
      const cardScope = node.closest('#workbench, .wb-body, .card-preview, .cite-block, [data-field="body"], [data-field="tag"], [data-field="cite"], [contenteditable="true"], .pane, .pane-body, .card, .doc, .ev-body-render, .card-body');
      if (!cardScope) return;
      const { html, plain } = VC.serializeSelectionHtml(range);
      if (!html) return;
      e.clipboardData.setData('text/html', html);
      e.clipboardData.setData('text/plain', plain);
      e.preventDefault();
    });

    // Add to… button — popover
    $('#wb-addto')?.addEventListener('click', (e) => {
      e.stopPropagation();
      syncCardFromDom();
      if (!state.currentCard || !state.currentCard.tag) { toast('No card to add'); return; }
      openAddToPopover($('#wb-addto'), state.currentCard);
    });

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
      toast({ title: 'Cleared', variant: 'success', duration: 1800 });
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
      <div class="pop-head">Add</div>
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
    if (tab === 'evidence') {
      if (!state.evidenceCards.length) loadEvidence();
      else { renderEvidence(); if (state.evidenceCards[0]) renderEvidenceDetail(state.evidenceCards[0]); }
    }
    if (tab === 'mine') { loadProjects(); renderMyCards(); }
    if (tab === 'history') renderHistory();
  }
  window.VerbaSwitchLibTab = switchLibTab;
  $$('.lib-tab').forEach((b) => b.addEventListener('click', () => switchLibTab(b.dataset.lib)));

  /* Evidence */
  async function loadEvidence() {
    const list = $('#ev-list');
    if (list) list.innerHTML = '<div style="padding:24px;color:var(--muted);font-size:13px">Loading library…</div>';
    state.evPage = 1;
    state.evShown = 50;
    state.evDone = false;
    try {
      const params = { limit: 50, page: 1, sort: 'relevance' };
      if (state.activeType && state.activeType !== 'all') params.type = state.activeType;
      const data = await API.libraryCards(params);
      state.evidenceCards = data.items || data.results || [];
      state.evidenceTotal = data.total || 0;
      if (!state.evidenceCards.length) state.evDone = true;
      if (list) renderEvidence();
      if (list && state.evidenceCards[0]) renderEvidenceDetail(state.evidenceCards[0]);
      if (!state.evDone) setTimeout(() => loadMoreEvidence(), 400);
    } catch (err) {
      if (list) list.innerHTML = `<div style="padding:24px;color:#c33;font-size:13px">Error: ${esc(err.message)}</div>`;
    }
  }

  function preloadEvidenceBackground() {
    if (state.evidenceCards.length || state.evLoading || state._evPreloadStarted) return;
    state._evPreloadStarted = true;
    setTimeout(() => { loadEvidence().catch(() => {}); }, 800);
  }
  window.__preloadEvidence = preloadEvidenceBackground;
  if (typeof document !== 'undefined') {
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      preloadEvidenceBackground();
    } else {
      document.addEventListener('DOMContentLoaded', preloadEvidenceBackground, { once: true });
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

  function normalizeTagKey(tag) {
    return String(tag || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function dedupeByTag(arr) {
    const seen = new Map();
    const out = [];
    for (const c of arr) {
      const key = normalizeTagKey(c.tag);
      if (!key) { out.push(c); continue; }
      if (!seen.has(key)) { seen.set(key, { card: c, idx: out.length }); out.push(c); }
      else {
        const entry = seen.get(key);
        const prev = entry.card;
        const better = (c.isCanonical && !prev.isCanonical) ||
          (!c.isCanonical && !prev.isCanonical && (c.highlightWordCount || 0) > (prev.highlightWordCount || 0));
        if (better) { out[entry.idx] = c; entry.card = c; }
      }
    }
    return out;
  }

  function shortCiteDisplay(c) {
    if (c.shortCite) return c.shortCite;
    const s = String(c.cite || '');
    const b = s.indexOf('[');
    return (b > 0 ? s.slice(0, b) : s).trim();
  }

  function renderEvidence() {
    const list = $('#ev-list'); if (!list) return;
    const searching = !!(state.evSearch && Array.isArray(state.evSearchResults));
    const sourceArr = searching ? state.evSearchResults : state.evidenceCards;
    const baseArr = dedupeByTag(sourceArr.filter(c => !isGeneralLd(c)));
    const filtered = searching ? baseArr : filterEvidenceClient(baseArr, state.evSearch);
    state.evFiltered = filtered;
    $('#ev-count').textContent = String(filtered.length);
    if (!filtered.length) {
      list.innerHTML = state.evSearch
        ? `<div style="padding:24px;color:var(--muted);font-size:13px">No cards match "${esc(state.evSearch)}".</div>`
        : '<div style="padding:24px;color:var(--muted);font-size:13px">No cards in library yet.</div>';
      return;
    }
    const shown = filtered.slice(0, state.evShown || 50);
    const needSentinel = !state.evDone && state.evidenceCards.length > 0 && !state.evSearch;
    list.innerHTML = shown.map((c, i) => evItemHTML(c, i === 0)).join('')
      + (needSentinel ? `<div id="ev-sentinel" style="height:40px"></div>` : '');
    list.querySelectorAll('.ev-item').forEach((el, idx) => {
      el.addEventListener('click', async (e) => {
        const btn = e.target.closest('button[data-act]');
        if (btn && btn.dataset.act === 'copy-ev') {
          e.stopPropagation();
          const c = shown[idx];
          btn.classList.add('busy');
          try {
            if (!c.body_markdown && !c.body_plain && !c.body_html && c.id) {
              try { const full = await API.libraryCard(c.id); if (full?.card) Object.assign(c, full.card); } catch {}
            }
            const bodyHtml = inlineStyleBody(c.body_html || markdownCardToHtml(c.body_markdown || c.body_plain || ''));
            const buildHtml = (window.VerbaClipboard && window.VerbaClipboard.buildCopyHtml) || null;
            const buildPlain = (window.VerbaClipboard && window.VerbaClipboard.buildCopyPlain) || null;
            const plain = buildPlain ? buildPlain(c) : `${c.tag || ''}\n${c.cite || ''}\n\n${c.body_plain || c.body_markdown || ''}`;
            const html = buildHtml
              ? buildHtml({ ...c, body_html: bodyHtml })
              : `<div style="font-family:Calibri,Arial,sans-serif;color:#000"><p style="font-weight:700">${esc(c.tag || '')}</p><p>${esc(c.cite || '')}</p>${bodyHtml}</div>`;
            if (window.ClipboardItem && navigator.clipboard?.write) {
              await navigator.clipboard.write([new ClipboardItem({
                'text/html': new Blob([html], { type: 'text/html' }),
                'text/plain': new Blob([plain], { type: 'text/plain' }),
              })]);
            } else {
              await navigator.clipboard.writeText(plain);
            }
            btn.classList.remove('busy');
            btn.classList.add('copied');
            setTimeout(() => btn.classList.remove('copied'), 1400);
            toast({ title: 'Copied', description: 'Card copied to clipboard', variant: 'success', duration: 1800 });
          } catch (err) { toast({ title: 'Copy failed', description: err.message, variant: 'destructive' }); }
          finally { btn.classList.remove('busy'); }
          return;
        }
        list.querySelectorAll('.ev-item').forEach((e2) => e2.classList.remove('active'));
        el.classList.add('active');
        renderEvidenceDetail(shown[idx]);
      });
    });
    maybeInstallEvIntersectionObserver();
  }

  async function loadMoreEvidence() {
    if (state.evLoading || state.evDone || state.evSearch) return;
    state.evLoading = true;
    try {
      const next = state.evPage + 1;
      const params = { limit: 50, page: next, sort: 'relevance' };
      if (state.activeType && state.activeType !== 'all') params.type = state.activeType;
      const data = await API.libraryCards(params);
      const have = new Set(state.evidenceCards.map(c => c.id));
      const fresh = (data.items || []).filter(c => !have.has(c.id));
      if (!fresh.length) { state.evDone = true; renderEvidence(); return; }
      state.evidenceCards.push(...fresh);
      state.evPage = next;
      state.evShown += fresh.length;
      renderEvidence();
    } finally { state.evLoading = false; }
  }

  function maybeInstallEvIntersectionObserver() {
    const sentinel = document.getElementById('ev-sentinel');
    if (!sentinel) return;
    if (state.evObserver) state.evObserver.disconnect();
    state.evObserver = new IntersectionObserver((entries) => {
      if (entries.some(e => e.isIntersecting)) loadMoreEvidence();
    }, { root: $('#ev-list'), rootMargin: '1200px' });
    state.evObserver.observe(sentinel);
  }

  function evItemHTML(c, active) {
    const cat = cardType(c);
    const catLabel = cat ? cat.toUpperCase() : '';
    const topic = c.topicLabel || c.topic || '';
    const date = c.createdAt ? new Date(c.createdAt).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }) : '';
    return `
      <div class="ev-item ${active ? 'active' : ''}" data-card-id="${esc(c.id || '')}" style="position:relative">
        <button class="ev-export-btn" data-act="copy-ev" title="Copy" style="position:absolute;top:10px;right:10px;width:24px;height:24px;border-radius:5px;background:#fff;border:1px solid var(--line);color:var(--muted);cursor:pointer;display:flex;align-items:center;justify-content:center"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
        <div class="tag">${esc(c.tag || '(untagged)')}</div>
        <div class="cite">${esc(shortCiteDisplay(c))}</div>
        <div class="head" style="margin-top:6px">
          <div class="badges" style="display:flex;gap:4px">
            ${catLabel ? `<span class="badge cat cat-${cat}">${esc(catLabel)}</span>` : ''}
            ${topic ? `<span class="badge topic">${esc(topic)}</span>` : ''}
          </div>
          <span class="date" style="margin-left:auto">${esc(date)}</span>
        </div>
      </div>`;
  }

  async function renderEvidenceDetail(card) {
    state.currentEvidence = card;
    const t = $('#ev-detail-title'); if (t) t.textContent = 'Preview';
    const body = $('#ev-detail-body'); if (!body) return;
    if (!card.body_html && !card.body_markdown && !card.body_plain && card.id) {
      body.innerHTML = '<div style="padding:16px;color:var(--muted);font-size:13px">Loading card…</div>';
      try {
        const full = await API.libraryCard(card.id);
        if (full && full.card) {
          Object.assign(card, full.card);
          if (state.currentEvidence !== card) return;
        }
      } catch { /* render whatever we have */ }
    }
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
    const bodyHtml = c.body_html || markdownCardToHtml(c.body_markdown || c.body_plain || '');
    const buildHtml = (window.VerbaClipboard && window.VerbaClipboard.buildCopyHtml) || null;
    const buildPlain = (window.VerbaClipboard && window.VerbaClipboard.buildCopyPlain) || null;
    const plain = buildPlain ? buildPlain(c) : `${c.tag || ''}\n${c.cite || ''}\n\n${c.body_plain || c.body_markdown || ''}`;
    const html = buildHtml ? buildHtml({ ...c, body_html: bodyHtml }) : `<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#111"><p><b>${esc(c.tag || '')}</b></p><p><i>${esc(c.cite || '')}</i></p>${bodyHtml}</div>`;
    try {
      if (window.ClipboardItem && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([plain], { type: 'text/plain' }),
        })]);
      } else await navigator.clipboard.writeText(plain);
      const b = $('#ev-copy'); if (b) { b.classList.add('copied'); setTimeout(()=>b.classList.remove('copied'), 1400); }
      toast({ title: 'Copied', description: 'Card copied to clipboard', variant: 'success', duration: 1800 });
    } catch (err) { toast({ title: 'Copy blocked', description: err.message || 'Clipboard permission denied', variant: 'destructive' }); }
  });

  function rankByKeyword(cards, q) {
    const needle = String(q || '').trim().toLowerCase();
    if (!needle) return cards;
    const tokens = needle.split(/\s+/).filter(Boolean);
    const score = (c) => {
      const tag = String(c.tag || '').toLowerCase();
      const cite = String(c.cite || c.shortCite || '').toLowerCase();
      const body = String(c.body_plain || c.body_markdown || '').toLowerCase();
      let s = 0;
      for (const t of tokens) {
        if (tag.includes(t)) s += 100;
        if (tag.startsWith(t)) s += 50;
        if (cite.includes(t)) s += 20;
        if (body.includes(t)) s += 5;
      }
      if (tag.includes(needle)) s += 200;
      return s;
    };
    return cards.map((c, i) => ({ c, i, s: score(c) }))
      .sort((a, b) => b.s - a.s || a.i - b.i)
      .map((x) => x.c);
  }

  let evSearchTok = 0;
  async function runEvidenceSearch(q) {
    const myTok = ++evSearchTok;
    state.evSearch = q;
    state.evShown = 50;
    if (!q) { state.evSearchResults = null; renderEvidence(); return; }
    try {
      const data = await API.libraryCards({ q, limit: 200, sort: 'relevance' });
      if (myTok !== evSearchTok) return;
      const raw = data.items || data.results || [];
      state.evSearchResults = rankByKeyword(raw, q);
    } catch (err) {
      if (myTok !== evSearchTok) return;
      console.error('[library search error]', err);
      state.evSearchResults = [];
    }
    renderEvidence();
  }
  $('#ev-search')?.addEventListener('input', (e) => {
    const q = e.target.value.trim();
    clearTimeout(runEvidenceSearch._t);
    runEvidenceSearch._t = setTimeout(() => runEvidenceSearch(q), 180);
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
      filtered = rankByKeyword(filtered, q);
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
          <button class="mc-copy-btn" data-act="copy-mine" title="Copy"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
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
        API.history.push({ type: 'export', tag: item.tag, filename }).catch(() => {});
        toast({ title: 'Exported', description: filename, variant: 'success', duration: 2200 });
      } catch (err) { toast({ title: 'Export failed', description: err.message, variant: 'destructive' }); }
      finally { btn?.classList.remove('busy'); }
      return;
    }
    if (act === 'copy-mine') {
      const btn = e.target.closest('button.mc-copy-btn');
      btn?.classList.add('busy');
      try {
        const full = !item.body_markdown && !item.body_plain && !item.body_html && item.id
          ? await API.libraryCard(item.id).catch(() => null)
          : null;
        const c = full?.card ? Object.assign({}, item, full.card) : item;
        const bodyHtml = inlineStyleBody(c.body_html || markdownCardToHtml(c.body_markdown || c.body_plain || ''));
        const buildHtml  = (window.VerbaClipboard && window.VerbaClipboard.buildCopyHtml)  || null;
        const buildPlain = (window.VerbaClipboard && window.VerbaClipboard.buildCopyPlain) || null;
        const plain = buildPlain ? buildPlain(c) : `${c.tag || ''}\n${c.cite || ''}\n\n${c.body_plain || c.body_markdown || ''}`;
        const html  = buildHtml
          ? buildHtml({ ...c, body_html: bodyHtml })
          : `<div style="font-family:Calibri,Arial,sans-serif;color:#000"><p style="font-weight:700">${esc(c.tag || '')}</p><p>${esc(c.cite || '')}</p>${bodyHtml}</div>`;
        if (window.ClipboardItem && navigator.clipboard?.write) {
          await navigator.clipboard.write([new ClipboardItem({
            'text/html':  new Blob([html],  { type: 'text/html' }),
            'text/plain': new Blob([plain], { type: 'text/plain' }),
          })]);
        } else {
          await navigator.clipboard.writeText(plain);
        }
        btn?.classList.remove('busy');
        btn?.classList.add('copied');
        setTimeout(() => btn?.classList.remove('copied'), 1400);
        toast({ title: 'Copied', description: 'Card copied to clipboard', variant: 'success', duration: 1800 });
      } catch (err) {
        toast({ title: 'Copy failed', description: err.message, variant: 'destructive' });
      } finally {
        btn?.classList.remove('busy');
      }
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

    window.openAssistantWithContext = function(contextText) {
      open();
      setTimeout(() => {
        const input = document.getElementById('assistant-input');
        if (input) {
          input.value = contextText;
          input.dispatchEvent(new Event('input'));
        }
      }, 250);
    };

    btn.addEventListener('click', () => panel.classList.contains('open') ? close() : open());
    closeBtn?.addEventListener('click', close);

    /* Click outside panel closes it. Use mousedown so selections/drags are safe,
       and pointer-down-on-trigger is handled by the button's own toggle above. */
    document.addEventListener('mousedown', (e) => {
      if (!panel.classList.contains('open')) return;
      if (panel.contains(e.target)) return;
      if (btn.contains(e.target)) return;
      close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && panel.classList.contains('open')) close();
    });

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
      async function doSave() {
        const full = lastChatCards.get(id);
        if (!full) { toast('Card not found'); return false; }
        const card = {
          tag: full.tag || tag,
          cite: full.cite || cite,
          shortCite: full.shortCite || cite,
          body_plain: full.body_plain || full.body_markdown || '',
          body_markdown: full.body_markdown || full.body_plain || '',
          body_html: full.body_html || '',
        };
        const r = await API.mine.save(card);
        if (r && r.duplicate) { toast('Already saved'); return false; }
        chip.classList.add('saved');
        const savedEl = chip.querySelector('.ap-cc-saved');
        if (savedEl) savedEl.textContent = 'Saved ✓';
        toast('Saved full card to My Cards ✓');
        return true;
      }
      chip.addEventListener('click', async () => {
        if (window.matchMedia('(max-width:768px)').matches && window.__verba && window.__verba.openCardPreview) {
          const full = lastChatCards.get(id) || {};
          window.__verba.openCardPreview({
            title: full.tag || tag,
            cite: full.cite || cite,
            html: full.body_html || '',
            text: full.body_plain || full.body_markdown || '',
            onSave: doSave,
          });
          return;
        }
        doSave();
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
      'weighing turn vs. non-unique…',
      'pulling impact calc…',
      'checking link chain…',
      'scanning 2NR-viable cards…',
      'testing uniqueness…',
      'lining up author quals…',
      'matching stance to tag…',
      'comparing warrants side-by-side…',
      'tightening the underline…',
      'hunting counterinterps…',
      'stress-testing the perm…',
      'checking solvency deficit…',
      'ranking offense…',
      'sharpening tag lines…',
      'pruning filler warrants…',
      'spotchecking author credentials…',
      'cross-applying framework…',
      'looking for terminal impact…',
      'weighing magnitude vs. probability…',
      'flipping the aff into a turn…',
      'reading the underviews…',
      'checking theory voters…',
      'calibrating brevity…',
      'double-checking cite dates…',
      'listening for the warrant…',
      'pulling out the spike…',
      'running perm tests…',
      'counting link chains…',
      'refining the overview…',
      'stacking offense vs. defense…',
      'looking for missing links…',
      'lining up impact turns…',
      'choosing between cards…',
      'sizing up the strat…',
    ];
    function showThinking() {
      const el = document.createElement('div');
      el.className = 'ap-think';
      el.innerHTML = '<span class="ap-think-dot"></span><span class="ap-think-line"></span>';
      msgs.appendChild(el);
      msgs.scrollTop = msgs.scrollHeight;
      const line = el.querySelector('.ap-think-line');
      let last = -1;
      function pick() {
        let i; do { i = Math.floor(Math.random() * THINK_LINES.length); } while (i === last && THINK_LINES.length > 1);
        last = i; return THINK_LINES[i];
      }
      let iv;
      function schedule() {
        iv = setTimeout(() => {
          line.classList.add('fade-out');
          setTimeout(() => {
            line.textContent = pick();
            line.classList.remove('fade-out');
            line.classList.add('fade-in');
            setTimeout(() => line.classList.remove('fade-in'), 360);
            schedule();
          }, 320);
        }, 1600 + Math.random() * 900);
      }
      line.textContent = pick();
      schedule();
      return { el, stop: () => { clearTimeout(iv); el.remove(); } };
    }

    /* ── Slash commands + suggestions ── */
    const COMMANDS = [
      { cmd: '/clear',   desc: 'Clear chat' },
      { cmd: '/find',    arg: '<query>', desc: 'Search My Cards' },
      { cmd: '/block',   arg: '<topic>', desc: 'Draft a block — cards or analytics as fits' },
      { cmd: '/explain', arg: '<what>',  desc: 'Explain a card or argument' },
    ];

    function expandCommandLocal(name, rawArg) {
      const arg = String(rawArg || '').trim();
      switch (name) {
        case '/clear': return { action: 'clear' };
        case '/find':  return { action: 'find', arg };
        case '/block':
          if (!arg) return null;
          return {
            action: 'send',
            display: `/block ${arg}`,
            send: `${arg}\n\n[HIDDEN: write a block on this. Use cards only if they help; otherwise analytics, warrants, framing. Pick card count by usefulness, not a fixed number.]`,
          };
        case '/explain':
          if (!arg) return null;
          return {
            action: 'send',
            display: `/explain ${arg}`,
            send: `${arg}\n\n[HIDDEN: explain this. State warrants, impact, and a response to the most likely answer.]`,
          };
        default: return null;
      }
    }

    function handleSlashIntent() {
      const v = (input.value || '').trim();
      if (!v.startsWith('/')) return null;
      const sp = v.indexOf(' ');
      const name = (sp === -1 ? v : v.slice(0, sp)).toLowerCase();
      const arg  = sp === -1 ? '' : v.slice(sp + 1);
      if (!COMMANDS.some(c => c.cmd === name)) return null;
      return expandCommandLocal(name, arg);
    }

    let slashSel = 0;
    function shouldKeepSlashOpenLocal(v, cmds) {
      if (!v.startsWith('/')) return false;
      if (!cmds || !cmds.length) return false;
      if (v.includes(' ')) return false;
      if (cmds.length === 1 && cmds[0] === v) return false;
      return true;
    }
    function refreshSlashPop() {
      if (!slashPop) return;
      const v = input.value || '';
      const first = v.startsWith('/') ? v.slice(1).split(' ')[0].toLowerCase() : '';
      const matches = v.startsWith('/') ? COMMANDS.filter(c => c.cmd.slice(1).startsWith(first)) : [];
      if (!shouldKeepSlashOpenLocal(v, matches.map(m => m.cmd))) { slashPop.classList.remove('open'); return; }
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
        doSend();
      }));
    }
    renderEmpty();

    async function doSend(opts) {
      let display, send;
      if (opts && opts.send) {
        display = opts.display || opts.send;
        send = opts.send;
      } else {
        const text = (input.value || '').trim();
        if (!text) return;
        if (text.startsWith('/')) {
          const intent = handleSlashIntent();
          if (intent) {
            input.value = ''; autosize();
            slashPop?.classList.remove('open');
            if (intent.action === 'clear') { convo.length = 0; lastChatCards.clear(); msgs.innerHTML = ''; renderEmpty(); return; }
            if (intent.action === 'find') {
              const s = $('#mine-search');
              if (s) { s.value = intent.arg; s.dispatchEvent(new Event('input')); }
              try { go('library', 'mine'); } catch {}
              toast(intent.arg ? `Searching cards: "${intent.arg}"` : 'Opened My Cards');
              return;
            }
            if (intent.action === 'prefill') { input.value = intent.prefill; autosize(); input.focus(); return; }
            if (intent.action === 'send') { display = intent.display; send = intent.send; }
          } else {
            display = text; send = text;
          }
        } else {
          display = text; send = text;
        }
      }
      if (!send) return;
      input.value = ''; autosize();
      convo.push({ role: 'user', content: send });
      appendUser(display);
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
        if (e.key === 'Enter' && !e.shiftKey) {
          // Enter sends current text as-is — never rewrite the input.
          slashPop.classList.remove('open');
          // Fall through to normal Enter/send path.
        }
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

  /* --- Settings v2 controller --- */
  (function initSettingsV2() {
    const back = document.getElementById('settings-v2');
    if (!back) return;
    const closeBtn = document.getElementById('settings-v2-close');
    const tabs = back.querySelectorAll('.stab');
    const panes = back.querySelectorAll('.spane');

    function open(tab) {
      back.classList.add('open');
      back.setAttribute('aria-hidden', 'false');
      activate(tab || 'general');
      hydrateGeneral();
      if (tab === 'account' || !tab) hydrateAccount();
      if (tab === 'billing') hydrateBilling();
    }
    function close() {
      back.classList.remove('open');
      back.setAttribute('aria-hidden', 'true');
    }
    function activate(name) {
      tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === name));
      panes.forEach(p => p.classList.toggle('on', p.dataset.pane === name));
      if (name === 'account') hydrateAccount();
      if (name === 'billing') hydrateBilling();
    }

    closeBtn.addEventListener('click', close);
    back.addEventListener('click', (e) => { if (e.target === back) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && back.classList.contains('open')) close(); });
    tabs.forEach(t => t.addEventListener('click', () => activate(t.dataset.tab)));

    // General: profile name + font cards + highlight cards
    function hydrateGeneral() {
      const u = window.__verbaUser || {};
      const nameInput = document.getElementById('profile-name');
      const emailEl = document.getElementById('profile-email');
      const saveBtn = document.getElementById('profile-name-save');
      const hint = document.getElementById('name-cooldown-hint');
      const err = document.getElementById('profile-name-err');
      if (nameInput) nameInput.value = u.name || '';
      if (emailEl) emailEl.textContent = u.email || '—';
      err.style.display = 'none';
      saveBtn.disabled = true;
      const last = u.nameUpdatedAt ? new Date(u.nameUpdatedAt).getTime() : 0;
      const nextAllowed = last + 24 * 60 * 60 * 1000;
      if (last && Date.now() < nextAllowed) {
        const hrs = Math.ceil((nextAllowed - Date.now()) / 3600000);
        hint.textContent = `Can change again in ~${hrs}h`;
        nameInput.disabled = true;
      } else {
        hint.textContent = '';
        nameInput.disabled = false;
      }
      nameInput.oninput = () => { saveBtn.disabled = !nameInput.value.trim() || nameInput.value.trim() === (u.name || ''); };
      saveBtn.onclick = async () => {
        err.style.display = 'none';
        saveBtn.disabled = true;
        try {
          const res = await API.auth.updateProfile({ name: nameInput.value.trim() });
          window.__verbaUser = res.user;
          paintAccount(res.user);
          hydrateGeneral();
        } catch (e) {
          err.textContent = e.body?.error || e.message || 'Failed to save';
          err.style.display = 'block';
          saveBtn.disabled = false;
        }
      };

      const applyT = () => {
        try { if (typeof window.applyTweaks === 'function') window.applyTweaks(TWEAKS); } catch(_) {}
      };
      const saveT = () => {
        try { if (typeof persistTweaks === 'function') persistTweaks(); }
        catch(_) { try { localStorage.setItem('verba.tweaks', JSON.stringify(TWEAKS)); } catch(_) {} }
      };
      const _isDirty = (window.VerbaIsDirty && window.VerbaIsDirty.isDirty) || ((a,b)=>JSON.stringify(a)!==JSON.stringify(b));
      let _savedSnap = JSON.parse(JSON.stringify(TWEAKS || {}));
      const refreshDirty = () => {};
      // Font cards
      TWEAKS.font = TWEAKS.font || 'calibri';
      document.querySelectorAll('#font-cards .font-card').forEach(card => {
        card.classList.toggle('on', card.dataset.val === TWEAKS.font);
        card.onclick = () => {
          TWEAKS.font = card.dataset.val;
          applyT();
          document.querySelectorAll('#font-cards .font-card').forEach(x => x.classList.toggle('on', x === card));
          refreshDirty();
        };
      });
      // Highlight cards
      TWEAKS.highlight = TWEAKS.highlight || 'yellow';
      document.querySelectorAll('#hl-cards .hl-card').forEach(card => {
        card.classList.toggle('on', card.dataset.val === TWEAKS.highlight);
        card.onclick = () => {
          TWEAKS.highlight = card.dataset.val;
          applyT();
          document.querySelectorAll('#hl-cards .hl-card').forEach(x => x.classList.toggle('on', x === card));
          refreshDirty();
        };
      });
      applyT();
      refreshDirty();
      // Cutter length custom menu
      const cutLenMenu = document.getElementById('cut-length-menu');
      if (cutLenMenu) {
        const trigger = cutLenMenu.querySelector('.sfield-menu-trigger');
        const list = cutLenMenu.querySelector('.sfield-menu-list');
        const labelEl = cutLenMenu.querySelector('[data-slot="label"]');
        const items = Array.from(cutLenMenu.querySelectorAll('.sfield-menu-item'));
        const setValue = (v) => {
          TWEAKS.cutterLength = v;
          items.forEach((it) => it.setAttribute('aria-selected', String(it.dataset.val === v)));
          const sel = items.find((it) => it.dataset.val === v) || items[1];
          if (labelEl && sel) labelEl.textContent = sel.querySelector('.mi-title')?.textContent || v;
          persistTweaks();
        };
        setValue(TWEAKS.cutterLength || 'medium');
        const close = () => {
          cutLenMenu.setAttribute('data-open', 'false');
          trigger.setAttribute('aria-expanded', 'false');
        };
        const open = () => {
          cutLenMenu.setAttribute('data-open', 'true');
          trigger.setAttribute('aria-expanded', 'true');
        };
        trigger.addEventListener('click', (e) => {
          e.stopPropagation();
          cutLenMenu.getAttribute('data-open') === 'true' ? close() : open();
        });
        items.forEach((it) => it.addEventListener('click', (e) => {
          e.stopPropagation();
          setValue(it.dataset.val);
          close();
          trigger.focus();
        }));
        document.addEventListener('click', (e) => {
          if (!cutLenMenu.contains(e.target)) close();
        });
        trigger.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
            e.preventDefault();
            open();
            items[0]?.focus?.();
          } else if (e.key === 'Escape') {
            close();
          }
        });
      }
      // Cutter density cards
      document.querySelectorAll('#cut-density-cards .hl-card').forEach(card => {
        card.classList.toggle('on', card.dataset.val === (TWEAKS.cutterDensity || 'standard'));
        card.onclick = () => {
          TWEAKS.cutterDensity = card.dataset.val;
          persistTweaks();
          document.querySelectorAll('#cut-density-cards .hl-card').forEach(x => x.classList.toggle('on', x === card));
        };
      });
    }

    // Account: sessions + log out all
    async function hydrateAccount() {
      const body = document.getElementById('sess-tbody');
      body.innerHTML = '<tr><td colspan="5" class="sess-empty">Loading…</td></tr>';
      try {
        const { sessions } = await API.auth.listSessions();
        if (!sessions.length) {
          body.innerHTML = '<tr><td colspan="5" class="sess-empty">No sessions</td></tr>';
          return;
        }
        body.innerHTML = sessions.map(s => {
          const ua = parseUA(s.userAgent);
          const loc = s.ip || '—';
          return `<tr>
            <td>${esc(ua)}${s.current ? '<span class="badge-current">Current</span>' : ''}</td>
            <td>${esc(loc)}</td>
            <td>${fmtDate(s.createdAt)}</td>
            <td>${fmtDate(s.lastSeenAt)}</td>
            <td>${s.current ? '' : `<button class="sess-revoke" data-id="${esc(s.id)}" title="Revoke">Revoke</button>`}</td>
          </tr>`;
        }).join('');
        body.querySelectorAll('.sess-revoke').forEach(btn => btn.onclick = async () => {
          btn.disabled = true;
          try { await API.auth.revokeSession(btn.dataset.id); hydrateAccount(); }
          catch { btn.disabled = false; }
        });
      } catch {
        body.innerHTML = '<tr><td colspan="5" class="sess-empty">Failed to load</td></tr>';
      }
    }
    document.getElementById('logout-all-btn').onclick = async () => {
      if (!confirm('Log out of every device? You will need to sign in again.')) return;
      try { await API.auth.revokeAllSessions(); } catch {}
      location.href = '/signin';
    };

    function hydrateBilling() {
      const u = window.__verbaUser || {};
      const tier = (u.tier || 'free').toLowerCase();
      document.getElementById('plan-tier').textContent = tier === 'pro' ? 'Pro plan' : 'Free plan';
      document.getElementById('plan-sub').textContent = tier === 'pro' ? 'Higher limits and priority access' : 'Basic usage limits';
      document.getElementById('plan-renew').textContent = tier === 'pro' ? 'Renews on the 1st of each month' : '';
      document.getElementById('plan-adjust').onclick = () => window.__verba.openPricing();
      document.getElementById('pay-update').onclick = () => window.__verba.openPayment();
    }

    function parseUA(ua) {
      if (!ua) return 'Unknown device';
      const s = ua.toLowerCase();
      const browser = s.includes('chrome') ? 'Chrome' : s.includes('safari') ? 'Safari' : s.includes('firefox') ? 'Firefox' : 'Browser';
      const os = s.includes('windows') ? 'Windows' : s.includes('mac os') ? 'Mac' : s.includes('android') ? 'Android' : s.includes('iphone') ? 'iOS' : 'Unknown';
      return `${browser} (${os})`;
    }
    function fmtDate(iso) {
      if (!iso) return '—';
      const d = new Date(iso);
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) +
             ', ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }

    window.__verba.openSettings = open;
  })();

  /* --- Pricing overlay --- */
  (function initPricing() {
    const ov = document.getElementById('pricing-overlay');
    if (!ov) return;
    const back = document.getElementById('pricing-back');
    let cycle = 'monthly';
    const priceEl = document.getElementById('pp-squad-price');
    const toggle = document.getElementById('pp-billing-toggle');
    function renderPrice(){
      if (!priceEl) return;
      priceEl.innerHTML = cycle === 'yearly'
        ? '$90<small>/ yr</small>'
        : '$9<small>/ mo</small>';
    }
    if (toggle) {
      toggle.querySelectorAll('[data-cycle]').forEach(el => {
        el.addEventListener('click', () => {
          cycle = el.dataset.cycle;
          toggle.querySelectorAll('[data-cycle]').forEach(x => x.classList.toggle('on', x === el));
          renderPrice();
        });
      });
    }
    renderPrice();
    function open() { ov.classList.add('open'); ov.setAttribute('aria-hidden','false'); }
    function close(){ ov.classList.remove('open'); ov.setAttribute('aria-hidden','true'); }
    back.addEventListener('click', close);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && ov.classList.contains('open')) close(); });
    document.getElementById('pp-squad-cta').addEventListener('click', () => {
      close();
      window.__verba.openPayment(cycle);
    });
    window.__verba.openPricing = open;
  })();

  /* --- Payment overlay (mock) --- */
  (function initPayment() {
    const ov = document.getElementById('pay-overlay');
    if (!ov) return;
    const agree = document.getElementById('pay-agree');
    const submit = document.getElementById('pay-submit');
    const tiers = ov.querySelectorAll('.pay-tier');
    const cycles = ov.querySelectorAll('.pay-cycle');
    const cycleRow = document.getElementById('pay-cycle-row');
    const planName = document.getElementById('pay-plan-name');
    const planAmt = document.getElementById('pay-plan-amount');
    const taxEl = document.getElementById('pay-tax');
    const totalEl = document.getElementById('pay-total');
    let tier = 'squad';
    let cycle = 'monthly';
    function render(){
      if (cycleRow) cycleRow.style.display = tier === 'squad' ? '' : 'none';
      if (tier === 'solo') {
        planName.textContent = 'FREE plan';
        planAmt.textContent = '$0.00';
        taxEl.textContent = '$0.00';
        totalEl.textContent = '$0.00';
        submit.textContent = 'Stay on FREE';
        return;
      }
      const base = cycle === 'yearly' ? 90 : 9;
      const tax = +(base * 0.07).toFixed(2);
      planName.textContent = 'PRO · ' + (cycle === 'yearly' ? 'Yearly' : 'Monthly');
      planAmt.textContent = '$' + base.toFixed(2);
      taxEl.textContent = '$' + tax.toFixed(2);
      totalEl.textContent = '$' + (base + tax).toFixed(2);
      submit.textContent = 'Upgrade to PRO';
    }
    tiers.forEach(t => t.addEventListener('click', () => {
      tiers.forEach(x => x.classList.toggle('on', x === t));
      tier = t.dataset.tier || 'squad';
      render();
    }));
    cycles.forEach(c => c.addEventListener('click', () => {
      cycles.forEach(x => x.classList.toggle('on', x === c));
      cycle = c.dataset.cycle || 'monthly';
      render();
    }));
    agree.addEventListener('change', () => { submit.disabled = !agree.checked; });
    submit.addEventListener('click', () => {
      submit.disabled = true;
      submit.textContent = 'Processing…';
      setTimeout(() => {
        submit.textContent = 'Demo — no charge made';
        setTimeout(close, 900);
      }, 600);
    });
    document.getElementById('pay-close').addEventListener('click', close);
    ov.addEventListener('click', e => { if (e.target === ov) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && ov.classList.contains('open')) close(); });
    function open(preCycle){
      if (preCycle === 'monthly' || preCycle === 'yearly') {
        cycle = preCycle;
        cycles.forEach(x => x.classList.toggle('on', x.dataset.cycle === cycle));
      }
      tier = 'squad';
      tiers.forEach(x => x.classList.toggle('on', x.dataset.tier === 'squad'));
      render();
      ov.classList.add('open');
      ov.setAttribute('aria-hidden','false');
      submit.disabled = true;
      agree.checked = false;
    }
    function close(){ ov.classList.remove('open'); ov.setAttribute('aria-hidden','true'); }
    window.__verba.openPayment = open;
  })();

  (function initShortcuts() {
    const m = document.getElementById('ks-modal');
    if (!m) return;
    document.getElementById('ks-close').onclick = () => m.classList.remove('open');
    m.addEventListener('click', e => { if (e.target === m) m.classList.remove('open'); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && m.classList.contains('open')) m.classList.remove('open'); });
    window.__verba.openShortcuts = () => m.classList.add('open');
  })();

  (function initCardPreview() {
    const m = document.getElementById('card-preview-modal');
    if (!m) return;
    const titleEl = document.getElementById('cpm-title');
    const bodyEl = document.getElementById('cpm-body');
    const closeBtn = document.getElementById('cpm-close');
    const cancelBtn = document.getElementById('cpm-cancel');
    const saveBtn = document.getElementById('cpm-save');
    let pending = null;
    function close(){ m.classList.remove('open'); pending = null; }
    function open(opts){
      pending = opts || {};
      titleEl.textContent = pending.title || 'Card';
      const cite = pending.cite ? `<div style="font:12px/1.4 var(--font-mono);color:var(--muted);margin-bottom:10px">${escapeHTML(pending.cite)}</div>` : '';
      const body = pending.html ? pending.html : `<div style="white-space:pre-wrap">${escapeHTML(pending.text || '')}</div>`;
      bodyEl.innerHTML = cite + body;
      saveBtn.style.display = pending.onSave ? '' : 'none';
      m.classList.add('open');
    }
    function escapeHTML(s){ return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
    closeBtn.addEventListener('click', close);
    cancelBtn.addEventListener('click', close);
    m.addEventListener('click', e => { if (e.target === m) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && m.classList.contains('open')) close(); });
    saveBtn.addEventListener('click', async () => {
      if (pending && typeof pending.onSave === 'function') {
        try { await pending.onSave(); } catch(_){}
      }
      close();
    });
    window.__verba.openCardPreview = open;
  })();

  (function initSidebarCollapse() {
    const shell = document.querySelector('.shell');
    const toggle = document.getElementById('sb-toggle');
    if (!shell) return;
    const T = (typeof TWEAKS !== 'undefined' && TWEAKS) ? TWEAKS : (window.TWEAKS = window.TWEAKS || {});
    const save = (typeof persistTweaks === 'function') ? persistTweaks : () => {
      try { localStorage.setItem('verba.tweaks', JSON.stringify(T)); } catch {}
    };
    function apply() { shell.classList.toggle('sb-collapsed', !!T.sidebarCollapsed); }
    function flip(e) {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      T.sidebarCollapsed = !T.sidebarCollapsed;
      save();
      apply();
    }
    apply();
    if (toggle) {
      toggle.addEventListener('click', flip);
      toggle.addEventListener('pointerdown', (e) => e.stopPropagation());
    }
    document.addEventListener('keydown', e => {
      if ((e.metaKey || e.ctrlKey) && e.key === '.') { e.preventDefault(); flip(); }
    });
    window.__verba.toggleSidebar = flip;
  })();

  // Task 9 Step 2 — carousel navigation handlers
  const _prevBtn = document.querySelector('.carousel-prev');
  const _nextBtn = document.querySelector('.carousel-next');
  if (_prevBtn) _prevBtn.addEventListener('click', () => {
    applyState(Carousel.setActive(carouselState, carouselState.activeIndex - 1));
  });
  if (_nextBtn) _nextBtn.addEventListener('click', () => {
    applyState(Carousel.setActive(carouselState, carouselState.activeIndex + 1));
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const ae = document.activeElement;
    if (!ae) return;
    const tag = ae.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || ae.isContentEditable) return;
    if (e.key === 'ArrowLeft')  applyState(Carousel.setActive(carouselState, carouselState.activeIndex - 1));
    if (e.key === 'ArrowRight') applyState(Carousel.setActive(carouselState, carouselState.activeIndex + 1));
  });

  // Direction-aware transition on #wb-body
  let lastActiveIndex = -1;
  const _baseRenderCarousel = renderCarousel;
  renderCarousel = function () {
    const wbBody = document.getElementById('wb-body');
    if (!wbBody) return _baseRenderCarousel();
    const nextIdx = carouselState.activeIndex;
    if (lastActiveIndex !== -1 && lastActiveIndex !== nextIdx && carouselState.items.length > 0) {
      const dir = nextIdx < lastActiveIndex ? 'right' : 'left';
      wbBody.classList.add('leaving-' + dir);
      setTimeout(() => {
        wbBody.classList.remove('leaving-left', 'leaving-right');
        _baseRenderCarousel();
        lastActiveIndex = nextIdx;
      }, 220);
      return;
    }
    _baseRenderCarousel();
    lastActiveIndex = nextIdx;
  };

  // Task 9 Step 3 — initial render
  renderCarousel();

  // Task 10 Step 4 — copy button via event delegation (button lives inside card-shell)
  document.addEventListener('click', async (e) => {
    const btn = e.target && e.target.closest && e.target.closest('#wb-copy');
    if (!btn) return;
    syncActiveFromDom();
    const c = activeItem();
    if (!c || (!c.tag && !c.body_html)) { toast('Nothing to copy'); return; }
    const VC = window.VerbaClipboard;
    if (!VC) { toast('Clipboard module missing'); return; }
    const card = { ...c, body_html: c.body_html || (c.body_markdown && typeof markdownCardToHtml === 'function' ? markdownCardToHtml(c.body_markdown) : c.body_html) };
    const html = VC.buildCopyHtml(card);
    const plain = VC.buildCopyPlain(card);
    try {
      if (window.ClipboardItem && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([plain], { type: 'text/plain' }),
        })]);
      } else {
        await navigator.clipboard.writeText(plain);
      }
      btn.classList.add('copied'); setTimeout(() => btn.classList.remove('copied'), 1400);
    } catch (err) { console.error(err); toast('Copy blocked'); }
  });

  // Editor input delegation — syncs active carousel item
  document.addEventListener('input', (e) => {
    if (e.target && e.target.closest && e.target.closest('#wb-body [data-field]')) {
      syncActiveFromDom();
      if (typeof normalizeUnderlineTags === 'function') normalizeUnderlineTags(e.target);
    }
  });

  // PDF drop on research-bar
  const bar = document.querySelector('.research-bar');
  if (bar) {
    bar.addEventListener('dragover', (e) => { e.preventDefault(); bar.classList.add('is-drop'); });
    bar.addEventListener('dragleave', () => bar.classList.remove('is-drop'));
    bar.addEventListener('drop', async (e) => {
      e.preventDefault();
      bar.classList.remove('is-drop');
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!file || !/\.pdf$/i.test(file.name)) return;
      if (typeof uploadPdfAndCut === 'function') { uploadPdfAndCut(file); return; }
      try {
        const fd = new FormData();
        fd.append('file', file);
        const res = await fetch('/api/scrape/file', { method: 'POST', body: fd, credentials: 'include' });
        if (!res.ok) throw new Error('upload failed');
        const data = await res.json();
        if (data && data.token) startCut(data.title || file.name);
        else toast('PDF extracted but empty');
      } catch (err) { console.error(err); toast('PDF upload failed'); }
    });
  }

})();

// Mobile drawer toggle
(function(){
  var shell = document.querySelector('.shell');
  var openBtn = document.getElementById('sb-open-fab');
  if (!shell || !openBtn) return;

  function close(){ shell.classList.remove('sb-open'); }

  openBtn.addEventListener('click', function(e){
    e.stopPropagation();
    shell.classList.toggle('sb-open');
  });

  document.addEventListener('click', function(e){
    if (!shell.classList.contains('sb-open')) return;
    var sidebar = shell.querySelector('.sidebar');
    if (sidebar && !sidebar.contains(e.target) && e.target !== openBtn) close();
  });

  shell.querySelectorAll('.sidebar .nav-item').forEach(function(el){
    el.addEventListener('click', close);
  });

  document.addEventListener('keydown', function(e){
    if (e.key === 'Escape') close();
  });
})();
