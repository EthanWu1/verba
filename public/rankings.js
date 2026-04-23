'use strict';
(function () {
  let _event = 'LD', _season = '';
  let _searchTimer = null;
  let _page = 1, _allRows = [], _totalCount = 0, _hasMore = false;

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

  function renderRows() {
    const tbody = $('rk-rows');
    const meta = $('rk-meta');
    if (meta) meta.textContent = `${_allRows.length} of ${_totalCount} · season ${_season}`;
    if (!_allRows.length) {
      tbody.innerHTML = '<tr><td colspan="3" style="padding:24px;color:var(--muted)">No ratings yet for this event.</td></tr>';
      return;
    }
    const rowsHtml = _allRows.map(r => {
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
    const moreBtn = _hasMore
      ? `<tr><td colspan="3" style="text-align:center;padding:12px 0"><button class="rk-btn-sm" id="rk-more-btn">Show more</button></td></tr>`
      : '';
    tbody.innerHTML = rowsHtml + moreBtn;
    tbody.querySelectorAll('tr[data-team]').forEach(tr => {
      tr.style.cursor = 'pointer';
      tr.addEventListener('click', () => openProfile(tr.dataset.team));
    });
    document.getElementById('rk-more-btn')?.addEventListener('click', () => { _page++; load({ append: true }); });
  }

  async function load(opts) {
    const append = opts && opts.append;
    const tbody = $('rk-rows');
    const q = encodeURIComponent(($('rk-search')?.value || '').trim());
    if (!append) {
      _page = 1;
      _allRows = [];
      tbody.innerHTML = '<tr><td colspan="3" style="padding:24px;color:var(--muted)">Loading…</td></tr>';
    }
    if (!_season) {
      tbody.innerHTML = '<tr><td colspan="3" style="padding:24px;color:var(--muted)">No season available.</td></tr>';
      return;
    }
    try {
      const res = await fetch(`/api/rankings?season=${encodeURIComponent(_season)}&event=${_event}&q=${q}&page=${_page}`);
      const data = await res.json();
      _totalCount = data.totalCount || (data.rows || []).length;
      _hasMore = !!data.hasMore;
      _allRows = _allRows.concat(data.rows || []);
      renderRows();
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="3" style="padding:24px;color:var(--muted)">Failed: ${esc(e.message)}</td></tr>`;
    }
  }

  async function openProfile(teamKey) {
    if (!teamKey) return;
    const main = document.querySelector('.rk-main');
    main.innerHTML = '<div style="padding:24px;color:var(--muted)">Loading profile…</div>';
    try {
      const [pRes, hRes] = await Promise.all([
        fetch(`/api/rankings/${encodeURIComponent(teamKey)}?season=${encodeURIComponent(_season)}&event=${_event}`),
        fetch(`/api/rankings/${encodeURIComponent(teamKey)}/history?season=${encodeURIComponent(_season)}&event=${_event}`),
      ]);
      if (!pRes.ok) throw new Error('HTTP ' + pRes.status);
      const p = await pRes.json();
      const h = hRes.ok ? await hRes.json() : { history: [] };
      const rating = p.rating || {};
      const record = p.record || {};
      const bids = p.bids || { fullBids: 0, partialBids: 0 };
      const tournaments = p.tournaments || [];
      const topArg = (p.topArguments || [])[0] || null;

      const chart = renderEloChart(h.history || []);
      const isPrelim = (s) => /^prelim/i.test(String(s || ''));
      const shortBid = (b) => {
        if (!b) return '';
        const s = String(b);
        if (/^full/i.test(s)) return 'Full';
        if (/^silver/i.test(s)) return 'Silver';
        if (/^ghost/i.test(s)) return 'Ghost';
        if (/^partial/i.test(s)) return 'Partial';
        return s;
      };
      const bidCls = (b) => 'toc-bid toc-bid-' + (shortBid(b).toLowerCase() || 'other');
      const tournRows = tournaments.map(t => {
        const placeCell = (!t.place || isPrelim(t.place)) ? '<span class="rk-muted">—</span>' : esc(t.place);
        const bidCell = t.earnedBid ? `<span class="${bidCls(t.earnedBid)}">${esc(shortBid(t.earnedBid))}</span>` : '<span class="rk-muted">—</span>';
        return `<tr>
          <td>${esc(t.name || '')}</td>
          <td>${esc(t.startDate || '')}</td>
          <td>${t.wins || 0}-${t.losses || 0}</td>
          <td>${placeCell}</td>
          <td>${bidCell}</td>
        </tr>`;
      }).join('') || `<tr><td colspan="5" style="padding:16px;color:var(--muted)">No tournaments yet.</td></tr>`;

      const favBlock = topArg
        ? `<div class="rk-stat-card rk-arg-card">
             <div class="rk-stat-label">Favorite Argument</div>
             <div class="rk-arg-name">${esc(topArg.name || '—')}</div>
             <div class="rk-arg-meta">${esc(topArg.side || '')} · read ${topArg.readCount || 0}×</div>
             ${p.wikiTeamId ? `<a class="rk-wiki-link" href="https://opencaselist.com/#/team/${esc(p.wikiTeamId)}" target="_blank" rel="noopener">Open wiki ↗</a>` : ''}
           </div>`
        : (p.wikiTeamId
           ? `<div class="rk-stat-card rk-arg-card">
                <div class="rk-stat-label">Wiki</div>
                <a class="rk-wiki-link" href="https://opencaselist.com/#/team/${esc(p.wikiTeamId)}" target="_blank" rel="noopener">Open caselist ↗</a>
              </div>`
           : '');

      main.innerHTML = `
        <div class="rk-profile-wrap">
          <button class="rk-btn-sm rk-back-btn" id="rk-back-btn">← Back</button>
          <div class="rk-profile-head">
            <div class="rk-profile-rank">#${rating.rank ?? '?'}</div>
            <div>
              <h2 class="rk-profile-title">${esc(p.displayName || '—')}</h2>
              <div class="rk-profile-sub">${esc(p.schoolName || '')} · ${esc(p.event || _event)} · ${rating.outOf ? 'of ' + rating.outOf : ''}</div>
            </div>
          </div>
          <div class="rk-stat-grid">
            <div class="rk-stat-card"><div class="rk-stat-label">Elo</div><div class="rk-stat-value">${Math.round(rating.current || 0)}</div></div>
            <div class="rk-stat-card"><div class="rk-stat-label">Peak</div><div class="rk-stat-value">${Math.round(rating.peak || rating.current || 0)}</div></div>
            <div class="rk-stat-card"><div class="rk-stat-label">Rounds</div><div class="rk-stat-value">${record.roundCount || 0}</div></div>
            <div class="rk-stat-card"><div class="rk-stat-label">Record</div><div class="rk-stat-value">${record.wins || 0}-${record.losses || 0}</div></div>
            <div class="rk-stat-card"><div class="rk-stat-label">Bids</div><div class="rk-stat-value">${bids.fullBids || 0}${(bids.partialBids || 0) > 0 ? ` <span class="rk-muted">+${bids.partialBids}P</span>` : ''}</div></div>
            ${favBlock}
          </div>
          <div class="rk-section-title">Elo over season</div>
          <div class="rk-chart">${chart}</div>
          <div class="rk-section-title">Season record</div>
          <table class="rk-inner-table">
            <thead><tr><th>Tournament</th><th>Date</th><th>W-L</th><th>Place</th><th>Bid</th></tr></thead>
            <tbody>${tournRows}</tbody>
          </table>
        </div>`;
      document.getElementById('rk-back-btn')?.addEventListener('click', () => restoreTable());
    } catch (e) {
      main.innerHTML = `<div style="padding:24px;color:var(--muted)">Failed: ${esc(e.message)}</div>`;
    }
  }

  function renderEloChart(history) {
    if (!history || !history.length) {
      return '<div class="rk-muted" style="padding:24px 0">No rating history yet.</div>';
    }
    const pts = history.map(h => Number(h.ratingAfter)).filter(n => Number.isFinite(n));
    if (!pts.length) return '<div class="rk-muted">No data.</div>';
    const W = 720, H = 200, P = 24;
    const min = Math.min(...pts), max = Math.max(...pts);
    const span = Math.max(1, max - min);
    const xs = pts.map((_, i) => P + (i / Math.max(1, pts.length - 1)) * (W - 2 * P));
    const ys = pts.map(v => H - P - ((v - min) / span) * (H - 2 * P));
    const d = xs.map((x, i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${ys[i].toFixed(1)}`).join(' ');
    const dots = xs.map((x, i) => `<circle cx="${x.toFixed(1)}" cy="${ys[i].toFixed(1)}" r="2.5" fill="var(--lilac-3,#a78bfa)"/>`).join('');
    return `<svg viewBox="0 0 ${W} ${H}" class="rk-svg" preserveAspectRatio="none">
      <path d="${d}" fill="none" stroke="var(--lilac-3,#a78bfa)" stroke-width="2"/>
      ${dots}
      <text x="${P}" y="${P - 6}" font-size="11" fill="var(--muted)">${Math.round(max)}</text>
      <text x="${P}" y="${H - 4}" font-size="11" fill="var(--muted)">${Math.round(min)}</text>
    </svg>`;
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
