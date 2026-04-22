'use strict';
(function () {
  let _event = 'LD', _season = '', _sort = 'rating';
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
      const sel = $('rk-season');
      sel.innerHTML = (seasons || []).map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
      _season = seasons?.[0] || '';
      if (_season) sel.value = _season;
    } catch {
      _season = '';
    }
  }

  async function load() {
    const tbody = $('rk-rows');
    const meta = $('rk-meta');
    const q = encodeURIComponent(($('rk-search')?.value || '').trim());
    tbody.innerHTML = '<tr><td colspan="5" style="padding:24px;color:var(--muted)">Loading…</td></tr>';
    try {
      const res = await fetch(`/api/rankings?season=${encodeURIComponent(_season)}&event=${_event}&sort=${_sort}&q=${q}`);
      const { rows } = await res.json();
      if (meta) meta.textContent = `${rows.length} ranked · season ${_season}`;
      if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="5" style="padding:24px;color:var(--muted)">No ratings yet for this event.</td></tr>';
        return;
      }
      tbody.innerHTML = rows.map((r, i) => {
        const rank = i + 1;
        const cls = rank <= 3 ? `rk-row-${rank}` : (rank <= 10 ? 'rk-row-top10' : '');
        return `<tr class="${cls}">
          <td><span class="rk-rank-badge">${rank}</span></td>
          <td>
            <div class="rk-team-line">
              <span class="rk-team-initials">${esc(initials(r.schoolName || r.schoolCode))}</span>
              <span class="rk-team-text">
                <span class="rk-school-name">${esc(r.schoolName || r.schoolCode || '—')}</span>
                <span class="rk-debaters">${esc(r.displayName || r.teamKey || '')}</span>
              </span>
            </div>
          </td>
          <td class="rk-col-num"><span class="rk-rating">${Math.round(r.rating)}</span></td>
          <td class="rk-col-num">${r.wins || 0}-${r.losses || 0}</td>
          <td class="rk-col-num">${Math.round(r.peakRating || r.rating)}</td>
        </tr>`;
      }).join('');
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="5" style="padding:24px;color:var(--muted)">Failed: ${esc(e.message)}</td></tr>`;
    }
  }

  function bind() {
    document.querySelectorAll('.rk-event-tab').forEach(b => b.addEventListener('click', () => {
      document.querySelectorAll('.rk-event-tab').forEach(x => x.classList.toggle('active', x === b));
      _event = b.dataset.event;
      load();
    }));
    $('rk-season')?.addEventListener('change', e => { _season = e.target.value; load(); });
    $('rk-sort')?.addEventListener('change', e => { _sort = e.target.value; load(); });
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
