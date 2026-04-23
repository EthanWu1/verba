'use strict';
(function () {
  let _event = 'LD', _season = '';
  let _searchTimer = null;

  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  function initials(name) {
    return String(name || '').split(/\s+/).filter(Boolean).slice(0, 3).map(w => w[0].toUpperCase()).join('') || '—';
  }

  async function loadSeasons() {
    try {
      const res = await fetch('/api/rankings/seasons');
      const { seasons } = await res.json();
      const names = (seasons || []).map(s => typeof s === 'string' ? s : s.season).filter(Boolean);
      const sel = $('rk-season');
      sel.innerHTML = names.map(name => `<option value="${esc(name)}">${esc(name)}</option>`).join('');
      _season = names[0] || '';
      if (_season) sel.value = _season;
    } catch {
      _season = '';
    }
  }

  async function load() {
    const tbody = $('rk-rows');
    const meta = $('rk-meta');
    const q = encodeURIComponent(($('rk-search')?.value || '').trim());
    tbody.innerHTML = '<tr><td colspan="4" style="padding:24px;color:var(--muted)">Loading…</td></tr>';
    if (!_season) {
      tbody.innerHTML = '<tr><td colspan="4" style="padding:24px;color:var(--muted)">No season available.</td></tr>';
      return;
    }
    try {
      const res = await fetch(`/api/rankings?season=${encodeURIComponent(_season)}&event=${_event}&q=${q}`);
      const { rows } = await res.json();
      if (meta) meta.textContent = `${rows.length} ranked · season ${_season}`;
      if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="3" style="padding:24px;color:var(--muted)">No ratings yet for this event.</td></tr>';
        return;
      }
      tbody.innerHTML = rows.map(r => {
        const rank = r.rank || '?';
        const cls = rank === 1 ? 'rk-row-1' : rank === 2 ? 'rk-row-2' : rank === 3 ? 'rk-row-3' : (rank <= 10 ? 'rk-row-top10' : '');
        const code = r.displayName || '—';
        const schoolFull = r.schoolName || r.schoolCode || '';
        return `<tr class="${cls}" data-team="${esc(r.teamKey || '')}">
          <td><span class="rk-rank-badge">${rank}</span></td>
          <td>
            <div class="rk-team-text">
              <span class="rk-school-name">${esc(code)}</span>
              <span class="rk-debaters">${esc(schoolFull)}</span>
            </div>
          </td>
          <td class="rk-col-num"><span class="rk-rating">${Math.round(r.rating)}</span></td>
        </tr>`;
      }).join('');
      tbody.querySelectorAll('tr[data-team]').forEach(tr => {
        tr.style.cursor = 'pointer';
        tr.addEventListener('click', () => openProfile(tr.dataset.team));
      });
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="3" style="padding:24px;color:var(--muted)">Failed: ${esc(e.message)}</td></tr>`;
    }
  }

  async function openProfile(teamKey) {
    if (!teamKey) return;
    const main = document.querySelector('.rk-main');
    main.innerHTML = '<div style="padding:24px;color:var(--muted)">Loading profile…</div>';
    try {
      const res = await fetch(`/api/rankings/${encodeURIComponent(teamKey)}?season=${encodeURIComponent(_season)}&event=${_event}`);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const p = await res.json();
      const rating = p.rating || {};
      const record = p.record || {};
      const bids = p.bids || {};
      main.innerHTML = `
        <button class="rk-btn-sm rk-back-btn" id="rk-back-btn">← Back</button>
        <h2 class="rk-profile-title">${esc(p.displayName || '—')}</h2>
        <div class="rk-profile-sub">${esc(p.schoolName || '')}${p.schoolCode ? ' · ' + esc(p.schoolCode) : ''} · ${esc(p.event || _event)} · rank #${rating.rank ?? '?'} of ${rating.outOf ?? '?'}</div>
        <div class="rk-stat-grid">
          <div class="rk-stat-card"><div class="rk-stat-label">Rating</div><div class="rk-stat-value">${Math.round(rating.current || 0)}</div></div>
          <div class="rk-stat-card"><div class="rk-stat-label">Peak</div><div class="rk-stat-value">${Math.round(rating.peak || rating.current || 0)}</div></div>
          <div class="rk-stat-card"><div class="rk-stat-label">Rounds</div><div class="rk-stat-value">${record.roundCount || 0}</div></div>
          <div class="rk-stat-card"><div class="rk-stat-label">Record</div><div class="rk-stat-value">${record.wins || 0}-${record.losses || 0}</div></div>
          ${bids.full != null ? `<div class="rk-stat-card"><div class="rk-stat-label">Bids</div><div class="rk-stat-value">${bids.full}${bids.partial ? ' <span style="font-size:14px;color:var(--muted)">+' + bids.partial + 'P</span>' : ''}</div></div>` : ''}
        </div>`;
      document.getElementById('rk-back-btn')?.addEventListener('click', () => restoreTable());
    } catch (e) {
      main.innerHTML = `<div style="padding:24px;color:var(--muted)">Failed: ${esc(e.message)}</div>`;
    }
  }

  function restoreTable() {
    const main = document.querySelector('.rk-main');
    main.innerHTML = `
      <table class="rk-table">
        <thead>
          <tr>
            <th class="rk-col-rank">#</th>
            <th>Team</th>
            <th class="rk-col-num">Rating</th>
          </tr>
        </thead>
        <tbody id="rk-rows"></tbody>
      </table>`;
    load();
  }

  function bind() {
    document.querySelectorAll('.rk-event-tab').forEach(b => b.addEventListener('click', () => {
      document.querySelectorAll('.rk-event-tab').forEach(x => x.classList.toggle('active', x === b));
      _event = b.dataset.event;
      load();
    }));
    $('rk-season')?.addEventListener('change', e => { _season = e.target.value; load(); });
    $('rk-search')?.addEventListener('input', () => {
      clearTimeout(_searchTimer);
      _searchTimer = setTimeout(load, 300);
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    const page = document.getElementById('page-rankings');
    if (!page) return;
    const observer = new MutationObserver(async () => {
      if (page.classList.contains('active') && !page.dataset.rkInit) {
        page.dataset.rkInit = '1';
        await loadSeasons();
        bind();
        load();
      }
    });
    observer.observe(page, { attributes: true, attributeFilter: ['class'] });
  });
})();
