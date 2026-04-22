'use strict';
(function () {
  let _event = 'LD';
  let _searchTimer = null;

  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  function initials(name) {
    return String(name || '').split(/\s+/).filter(Boolean).slice(0, 3).map(w => w[0].toUpperCase()).join('') || '—';
  }

  function dedupe(rows) {
    const map = new Map();
    for (const r of rows) {
      const key = `${r.school}|${r.code}|${r.event}`;
      if (!map.has(key)) map.set(key, { ...r, debaters: [] });
      const cur = map.get(key);
      if (r.fullName && !cur.debaters.includes(r.fullName)) cur.debaters.push(r.fullName);
    }
    return [...map.values()];
  }

  async function load() {
    const list = $('wk-list');
    const count = $('wk-count');
    const q = encodeURIComponent(($('wk-search')?.value || '').trim());
    list.innerHTML = '<div class="wk-empty">Loading…</div>';
    try {
      const res = await fetch(`/api/wiki/teams?event=${_event}&q=${q}&limit=300`);
      const { teams } = await res.json();
      const rows = dedupe(teams || []);
      if (count) count.textContent = `${rows.length} team${rows.length === 1 ? '' : 's'}`;
      if (!rows.length) {
        list.innerHTML = '<div class="wk-empty">No teams match.</div>';
        return;
      }
      list.innerHTML = rows.map(r => `
        <div class="wk-row" data-id="${esc(r.id)}">
          <div class="wk-row-head">
            <span class="wk-initials">${esc(initials(r.school))}</span>
            <span class="wk-school">${esc(r.school || '—')} <span class="wk-debaters">${esc(r.code || '')}${r.debaters.length ? ' · ' + esc(r.debaters.join(', ')) : ''}</span></span>
            <svg class="wk-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
          </div>
          <div class="wk-row-body"><div class="wk-row-body-inner" data-loaded="0">Loading…</div></div>
        </div>
      `).join('');
      list.querySelectorAll('.wk-row').forEach(row => {
        row.querySelector('.wk-row-head').addEventListener('click', () => toggle(row));
      });
    } catch (e) {
      list.innerHTML = `<div class="wk-empty">Failed to load: ${esc(e.message)}</div>`;
    }
  }

  async function toggle(row) {
    const open = row.classList.toggle('open');
    if (!open) return;
    const inner = row.querySelector('.wk-row-body-inner');
    if (inner.dataset.loaded === '1') return;
    const id = row.dataset.id;
    try {
      const res = await fetch(`/api/wiki/teams/${encodeURIComponent(id)}/full`);
      const { team, arguments: args } = await res.json();
      inner.dataset.loaded = '1';
      inner.innerHTML = renderArgs(team, args);
    } catch (e) {
      inner.innerHTML = `<div class="wk-empty">Failed: ${esc(e.message)}</div>`;
    }
  }

  function renderArgs(team, args) {
    const link = team && team.pageUrl ? `<a class="wk-link-out" href="${esc(team.pageUrl)}" target="_blank" rel="noopener">Open wiki page ↗</a>` : '';
    if (!args || !args.length) {
      return `<div class="wk-empty" style="padding:8px 0">No arguments indexed for this team yet.</div>${link}`;
    }
    const items = args.map(a => `
      <div class="wk-arg">
        <div><span class="wk-arg-name">${esc(a.name || 'Untitled')}</span>${a.side ? `<span class="wk-arg-side">${esc(a.side)}</span>` : ''}</div>
        ${a.fullText ? `<div class="wk-arg-snippet">${esc(String(a.fullText).slice(0, 240))}${a.fullText.length > 240 ? '…' : ''}</div>` : ''}
      </div>
    `).join('');
    return items + link;
  }

  function bind() {
    document.querySelectorAll('.wk-event-tab').forEach(b => {
      b.addEventListener('click', () => {
        document.querySelectorAll('.wk-event-tab').forEach(x => x.classList.toggle('active', x === b));
        _event = b.dataset.event;
        load();
      });
    });
    const s = $('wk-search');
    if (s) s.addEventListener('input', () => {
      clearTimeout(_searchTimer);
      _searchTimer = setTimeout(load, 300);
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    const page = document.getElementById('page-teams');
    if (!page) return;
    const observer = new MutationObserver(() => {
      if (page.classList.contains('active') && !page.dataset.wikiInit) {
        page.dataset.wikiInit = '1';
        bind();
        load();
      }
    });
    observer.observe(page, { attributes: true, attributeFilter: ['class'] });
  });
})();
