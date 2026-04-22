'use strict';
(function () {
  let _event = 'LD';
  let _searchTimer = null;

  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  function initials(name) {
    return String(name || '').split(/\s+/).filter(Boolean).slice(0, 3).map(w => w[0].toUpperCase()).join('') || '—';
  }

  function groupBySchool(rows) {
    const map = new Map();
    for (const r of rows) {
      const key = r.school || '—';
      if (!map.has(key)) map.set(key, { school: key, debaters: [] });
      map.get(key).debaters.push(r);
    }
    return [...map.values()].sort((a, b) => a.school.localeCompare(b.school));
  }

  function debaterLabel(d) {
    return d.fullName && d.fullName !== `${d.school} ${d.code}` ? d.fullName : d.code;
  }

  async function load() {
    const list = $('wk-list');
    const count = $('wk-count');
    const q = encodeURIComponent(($('wk-search')?.value || '').trim());
    list.innerHTML = '<div class="wk-empty">Loading…</div>';
    try {
      const res = await fetch(`/api/wiki/teams?event=${_event}&q=${q}&limit=500`);
      const { teams } = await res.json();
      const schools = groupBySchool(teams || []);
      if (count) count.textContent = `${schools.length} school${schools.length === 1 ? '' : 's'} · ${teams.length} debater${teams.length === 1 ? '' : 's'}`;
      if (!schools.length) {
        list.innerHTML = '<div class="wk-empty">No teams match.</div>';
        return;
      }
      list.innerHTML = schools.map(s => `
        <div class="wk-row" data-school="${esc(s.school)}">
          <div class="wk-row-head">
            <span class="wk-school">${esc(s.school)} <span class="wk-debaters">${s.debaters.length} debater${s.debaters.length === 1 ? '' : 's'}</span></span>
            <svg class="wk-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
          </div>
          <div class="wk-row-body">
            <div class="wk-debater-list">
              ${s.debaters.map(d => `
                <div class="wk-debater" data-id="${esc(d.id)}">
                  <div class="wk-debater-head">
                    <span class="wk-debater-name">${esc(debaterLabel(d))}</span>
                    <svg class="wk-chev wk-chev-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
                  </div>
                  <div class="wk-debater-body"><div class="wk-debater-body-inner" data-loaded="0"></div></div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      `).join('');
      list.querySelectorAll('.wk-row > .wk-row-head').forEach(h => {
        h.addEventListener('click', () => h.parentElement.classList.toggle('open'));
      });
      list.querySelectorAll('.wk-debater-head').forEach(h => {
        h.addEventListener('click', e => { e.stopPropagation(); toggleDebater(h.parentElement); });
      });
    } catch (e) {
      list.innerHTML = `<div class="wk-empty">Failed to load: ${esc(e.message)}</div>`;
    }
  }

  async function toggleDebater(row) {
    const open = row.classList.toggle('open');
    if (!open) return;
    const inner = row.querySelector('.wk-debater-body-inner');
    if (inner.dataset.loaded === '1') return;
    const id = row.dataset.id;
    inner.innerHTML = '<div class="wk-empty" style="padding:8px 0">Loading…</div>';
    try {
      const res = await fetch(`/api/wiki/teams/${encodeURIComponent(id)}/full`);
      const { team, arguments: args } = await res.json();
      inner.dataset.loaded = '1';
      inner.innerHTML = renderArgs(team, args);
    } catch (e) {
      inner.innerHTML = `<div class="wk-empty" style="padding:8px 0">Failed: ${esc(e.message)}</div>`;
    }
  }

  function renderArgs(team, args) {
    const link = team && team.pageUrl ? `<a class="wk-link-out" href="${esc(team.pageUrl)}" target="_blank" rel="noopener">Open wiki page ↗</a>` : '';
    if (!args || !args.length) {
      return `<div class="wk-empty" style="padding:8px 0">No arguments indexed yet.</div>${link}`;
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
