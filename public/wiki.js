/* public/wiki.js — Wiki Teams page */
'use strict';

(function () {
  const CRAWL_MSGS = ['Fetching cases…', 'Parsing round reports…', 'Indexing arguments…'];
  let _msgIdx = 0, _msgTimer = null;
  let _activeTeamId = null, _activeArgId = null, _pollTimer = null;

  const $  = id => document.getElementById(id);

  window.initWikiPage = async function () {
    await loadTeams('');
    $('wiki-search').addEventListener('input', debounce(e => loadTeams(e.target.value), 150));
    $('wiki-reindex-btn').addEventListener('click', reindex);
    $('wiki-refresh-btn').addEventListener('click', () => _activeTeamId && refreshTeam(_activeTeamId));
    $('wiki-refresh-detail-btn').addEventListener('click', () => _activeTeamId && refreshTeam(_activeTeamId));
    $('wiki-retry-btn').addEventListener('click', () => _activeTeamId && selectTeam(_activeTeamId));
    $('wiki-download-all-btn').addEventListener('click', downloadAll);
    $('wiki-export-arg-btn').addEventListener('click', downloadArg);
    $('wiki-copy-btn').addEventListener('click', copyArg);
    $('wiki-ask-btn').addEventListener('click', askArg);

    // Deep-link: #teams?team=X (from tournament threat list)
    const m = String(location.hash || '').match(/team=([^&]+)/);
    if (m) {
      const teamId = decodeURIComponent(m[1]);
      selectTeam(teamId);
    }
  };

  async function loadTeams(q) {
    const res = await fetch(`/api/wiki/teams?q=${encodeURIComponent(q)}&limit=200`);
    const { teams, total } = await res.json();
    $('wiki-skeleton').classList.add('hidden');
    $('wiki-team-count').textContent = `${total.toLocaleString()} teams`;
    renderTeams(teams);
  }

  function renderTeams(teams) {
    const list = $('wiki-team-list');
    list.innerHTML = '';
    teams.forEach(t => {
      const row = document.createElement('div');
      row.className = 'wiki-team-row' + (t.id === _activeTeamId ? ' active' : '');
      row.dataset.id = t.id;
      row.innerHTML = `<span style="flex:1;font-weight:600">${esc(t.fullName)}</span><span class="wiki-badge">${esc(t.event || '?')}</span>`;
      row.addEventListener('click', () => selectTeam(t.id));
      list.appendChild(row);
    });
  }

  async function selectTeam(id) {
    _activeTeamId = id;
    _activeArgId = null;
    document.querySelectorAll('.wiki-team-row').forEach(r => r.classList.toggle('active', r.dataset.id === id));

    $('wiki-panel-args').classList.remove('hidden');
    $('wiki-panel-detail').classList.remove('visible');
    showArgLoading();

    await fetchAndRenderTeam(id);
    pollIfCrawling(id);
  }

  async function fetchAndRenderTeam(id) {
    try {
      const res = await fetch(`/api/wiki/teams/${encodeURIComponent(id)}`);
      const { team, arguments: args } = await res.json();

      $('wiki-team-title').textContent = team.fullName;
      $('wiki-team-meta').textContent = `${(team.event || '').toUpperCase()} · ${team.lastCrawled ? relTime(team.lastCrawled) : 'Not yet crawled'}`;

      if (team.crawlStatus === 'crawling') {
        showArgLoading();
        return;
      }
      if (team.crawlStatus === 'error') {
        showArgError();
        return;
      }
      renderArgs(args);
    } catch {
      showArgError();
    }
  }

  function renderArgs(args) {
    hideArgLoading();
    const list = $('wiki-arg-list');
    list.innerHTML = '';
    args.forEach((a, i) => {
      const row = document.createElement('div');
      row.className = 'wiki-arg-row';
      row.style.animationDelay = `${i * 30}ms`;
      row.dataset.id = a.id;
      row.innerHTML = `
        <span class="wiki-arg-name">${esc(a.name)}</span>
        <span class="wiki-side-${a.side}">${a.side.toUpperCase()}</span>
        <span class="wiki-read-count">${a.readCount}×</span>`;
      row.addEventListener('click', () => selectArg(a.id, a));
      list.appendChild(row);
    });
  }

  function pollIfCrawling(id) {
    clearInterval(_pollTimer);
    _pollTimer = setInterval(async () => {
      const res = await fetch(`/api/wiki/teams/${encodeURIComponent(id)}`);
      const { team, arguments: args } = await res.json();
      if (team.crawlStatus !== 'crawling') {
        clearInterval(_pollTimer);
        rotateCrawlMsg(false);
        renderArgs(args);
      } else {
        rotateCrawlMsg(true);
      }
    }, 2000);
  }

  function showArgLoading() {
    $('wiki-arg-list').innerHTML = '';
    $('wiki-crawl-status').classList.remove('hidden');
    $('wiki-arg-error').classList.add('hidden');
    rotateCrawlMsg(true);
  }
  function hideArgLoading() {
    $('wiki-crawl-status').classList.add('hidden');
    rotateCrawlMsg(false);
  }
  function showArgError() {
    hideArgLoading();
    $('wiki-arg-error').classList.remove('hidden');
  }
  function rotateCrawlMsg(active) {
    clearInterval(_msgTimer);
    if (!active) return;
    $('wiki-crawl-msg').textContent = CRAWL_MSGS[0];
    _msgTimer = setInterval(() => {
      _msgIdx = (_msgIdx + 1) % CRAWL_MSGS.length;
      $('wiki-crawl-msg').textContent = CRAWL_MSGS[_msgIdx];
    }, 1600);
  }

  function selectArg(id, arg) {
    _activeArgId = id;
    document.querySelectorAll('.wiki-arg-row').forEach(r => r.classList.toggle('active', r.dataset.id === id));

    const detail = $('wiki-panel-detail');
    detail.classList.add('visible');

    $('wiki-arg-title').innerHTML = `${esc(arg.name)} <span class="wiki-side-${arg.side}">${arg.side.toUpperCase()}</span> <span class="wiki-read-count">${arg.readCount}×</span>`;
    $('wiki-detail-body').textContent = arg.fullText;
  }

  async function refreshTeam(id) {
    await fetch(`/api/wiki/teams/${encodeURIComponent(id)}/refresh`);
    showArgLoading();
    await fetchAndRenderTeam(id);
    pollIfCrawling(id);
  }

  async function reindex() {
    await fetch('/api/wiki/reindex', { method: 'POST' });
    await loadTeams($('wiki-search').value);
  }

  function downloadAll() {
    if (!_activeTeamId) return;
    window.location = `/api/wiki/teams/${encodeURIComponent(_activeTeamId)}/export`;
  }

  function downloadArg() {
    if (!_activeArgId) return;
    window.location = `/api/wiki/arguments/${encodeURIComponent(_activeArgId)}/export`;
  }

  async function copyArg() {
    if (!_activeArgId) return;
    const res = await fetch(`/api/wiki/arguments/${encodeURIComponent(_activeArgId)}`);
    const { argument } = await res.json();
    await navigator.clipboard.writeText(argument.fullText);
    showToast('Copied!');
  }

  function askArg() {
    if (!_activeArgId) return;
    fetch(`/api/wiki/arguments/${encodeURIComponent(_activeArgId)}`)
      .then(r => r.json())
      .then(({ argument }) => {
        const team = $('wiki-team-title').textContent;
        const ref = `[Reference: ${argument.name} — ${team} (${argument.side.toUpperCase()})]\n${argument.fullText}`;
        if (window.openAssistantWithContext) {
          window.openAssistantWithContext(ref);
        } else {
          const btn = document.getElementById('assistant-btn');
          if (btn) btn.click();
          setTimeout(() => {
            const input = document.getElementById('assistant-input');
            if (input) input.value = ref;
          }, 300);
        }
      });
  }

  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function relTime(iso) {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  function showToast(msg) {
    if (window.toast) { window.toast(msg); return; }
    const el = document.createElement('div');
    el.textContent = msg;
    el.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#111;color:#fff;padding:7px 16px;border-radius:6px;font:13px var(--font-ui);z-index:9999;pointer-events:none';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1500);
  }

  // Trigger init when Teams page becomes active (class "active" on #page-teams)
  document.addEventListener('DOMContentLoaded', () => {
    const page = document.getElementById('page-teams');
    if (!page) return;
    const observer = new MutationObserver(() => {
      if (page.classList.contains('active') && !page.dataset.wikiInit) {
        page.dataset.wikiInit = '1';
        window.initWikiPage();
      }
    });
    observer.observe(page, { attributes: true, attributeFilter: ['class'] });
  });
})();
