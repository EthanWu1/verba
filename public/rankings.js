/* public/rankings.js — Rankings page */
'use strict';

(function () {
  let _season = null, _event = 'LD', _page = 1, _q = '';

  const $ = id => document.getElementById(id);

  window.initRankingsPage = async function () {
    await loadSeasons();
    bindStatic();
    await loadBoard();
  };

  function bindStatic() {
    $('rk-season').addEventListener('change', async e => {
      _season = e.target.value; _page = 1;
      await loadBoard();
    });
    document.querySelectorAll('.rk-event-tab').forEach(b => b.addEventListener('click', async () => {
      document.querySelectorAll('.rk-event-tab').forEach(x => x.classList.toggle('active', x === b));
      _event = b.dataset.rkEvent; _page = 1;
      await loadBoard();
    }));
    let debounceTimer;
    $('rk-search').addEventListener('input', e => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => { _q = e.target.value; _page = 1; loadBoard(); }, 200);
    });
    $('rk-back-btn').addEventListener('click', showBoard);
  }

  async function loadSeasons() {
    const res = await fetch('/api/rankings/seasons');
    const { seasons } = await res.json();
    const sel = $('rk-season');
    sel.innerHTML = '';
    seasons.forEach(s => {
      const o = document.createElement('option');
      o.value = s.season;
      o.textContent = `${s.season} (${s.ratedCount})`;
      sel.appendChild(o);
    });
    _season = seasons[0]?.season || null;
    if (_season) sel.value = _season;
  }

  async function loadBoard() {
    showBoard();
    const board = $('rk-board');
    $('rk-skeleton').classList.remove('hidden');
    if (!_season) { board.innerHTML = '<div class="rk-muted" style="padding:12px">No seasons indexed yet.</div>'; return; }
    try {
      const url = `/api/rankings?season=${encodeURIComponent(_season)}&event=${encodeURIComponent(_event)}&page=${_page}&q=${encodeURIComponent(_q)}`;
      const res = await fetch(url);
      const data = await res.json();
      renderBoard(data);
    } catch {
      board.innerHTML = '<div class="rk-muted" style="padding:12px">Failed to load.</div>';
    }
  }

  function renderBoard(data) {
    const board = $('rk-board');
    const { rows, totalCount, page, pageSize } = data;
    if (!rows.length) {
      board.innerHTML = `<div class="rk-muted" style="padding:12px">No ranked teams in ${esc(_event)} for ${esc(_season)}${_q ? ' matching "' + esc(_q) + '"' : ''}.</div>`;
      return;
    }
    const body = rows.map(r => `
      <tr data-team="${esc(r.teamKey)}">
        <td class="rk-rank-cell">${r.rank}</td>
        <td><strong>${esc(r.displayName || '—')}</strong></td>
        <td>${esc(r.schoolName || '')} ${r.schoolCode ? '<span class="rk-muted">(' + esc(r.schoolCode) + ')</span>' : ''}</td>
        <td class="rk-rating-cell">${Math.round(r.rating)}</td>
      </tr>`).join('');
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    board.innerHTML = `
      <table class="rk-table">
        <thead><tr><th>#</th><th>Team</th><th>School</th><th>Rating</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
      <div class="rk-pagination">
        <button class="rk-btn-sm" id="rk-prev" ${page <= 1 ? 'disabled' : ''}>← Prev</button>
        <span>Page ${page} of ${totalPages}</span>
        <button class="rk-btn-sm" id="rk-next" ${page >= totalPages ? 'disabled' : ''}>Next →</button>
        <span style="margin-left:auto">${totalCount.toLocaleString()} ranked ${esc(_event)}</span>
      </div>`;
    board.querySelectorAll('tr[data-team]').forEach(tr => {
      tr.addEventListener('click', () => openProfile(tr.dataset.team));
    });
    const prev = $('rk-prev'); if (prev) prev.addEventListener('click', () => { _page = Math.max(1, page - 1); loadBoard(); });
    const next = $('rk-next'); if (next) next.addEventListener('click', () => { _page = page + 1; loadBoard(); });
  }

  function showBoard() {
    $('rk-board').classList.remove('hidden');
    $('rk-profile').classList.add('hidden');
  }

  async function openProfile(teamKey) {
    $('rk-board').classList.add('hidden');
    $('rk-profile').classList.remove('hidden');
    $('rk-profile-title').textContent = 'Loading…';
    $('rk-profile-sub').textContent = '';
    $('rk-stat-grid').innerHTML = '';
    $('rk-chart-wrap').innerHTML = '';
    $('rk-tourns').innerHTML = '';
    $('rk-args-wrap').innerHTML = '';

    const qs = `?season=${encodeURIComponent(_season)}&event=${encodeURIComponent(_event)}`;
    const [profRes, histRes] = await Promise.all([
      fetch(`/api/rankings/${encodeURIComponent(teamKey)}${qs}`),
      fetch(`/api/rankings/${encodeURIComponent(teamKey)}/history${qs}`),
    ]);
    if (profRes.status === 404) {
      $('rk-profile-title').textContent = 'Not found';
      return;
    }
    const p = await profRes.json();
    const { history } = await histRes.json();
    renderProfile(p, history);
  }

  function renderProfile(p, history) {
    $('rk-profile-title').textContent = p.displayName || p.teamKey;
    $('rk-profile-sub').textContent = `${p.schoolName || ''} · ${p.event} · ${p.season}`;

    const pctStr = (p.record.winPct * 100).toFixed(0) + '% win';
    $('rk-stat-grid').innerHTML = `
      <div class="rk-stat-card">
        <div class="rk-stat-label">Rating</div>
        <div class="rk-stat-value">${Math.round(p.rating.current)}</div>
        <div class="rk-stat-sub">Peak ${Math.round(p.rating.peak)}</div>
      </div>
      <div class="rk-stat-card">
        <div class="rk-stat-label">Record</div>
        <div class="rk-stat-value">${p.record.wins}-${p.record.losses}</div>
        <div class="rk-stat-sub">${pctStr}</div>
      </div>
      <div class="rk-stat-card">
        <div class="rk-stat-label">Bids</div>
        <div class="rk-stat-value">${p.bids.fullBids ?? 0}F</div>
        <div class="rk-stat-sub">${p.bids.partialBids ? '+' + p.bids.partialBids + 'P' : 'no partials'}</div>
      </div>
      <div class="rk-stat-card">
        <div class="rk-stat-label">Rank</div>
        <div class="rk-stat-value">${p.rating.rank ? '#' + p.rating.rank : '—'}</div>
        <div class="rk-stat-sub">of ${p.rating.outOf} ${p.event}</div>
      </div>`;

    $('rk-chart-wrap').innerHTML = renderChart(history);

    if (!p.tournaments.length) {
      $('rk-tourns').innerHTML = '<div class="rk-muted">No tournament history yet.</div>';
    } else {
      const rows = p.tournaments.map(t => `
        <tr data-tourn="${t.tournId}">
          <td><strong>${esc(t.name)}</strong></td>
          <td>${esc(t.startDate || '')}</td>
          <td>${t.wins}-${t.losses}</td>
          <td>${t.earnedBid ? esc(t.earnedBid) : '<span class="rk-muted">—</span>'}</td>
          <td>${esc(t.place || '—')}</td>
        </tr>`).join('');
      $('rk-tourns').innerHTML = `<table class="rk-table"><thead><tr><th>Tournament</th><th>Dates</th><th>Record</th><th>Bid</th><th>Place</th></tr></thead><tbody>${rows}</tbody></table>`;
      $('rk-tourns').querySelectorAll('tr[data-tourn]').forEach(tr => {
        tr.addEventListener('click', () => {
          location.hash = `#tournament?id=${tr.dataset.tourn}`;
        });
      });
    }

    if (p.wikiTeamId) {
      const argRows = p.topArguments.length ? p.topArguments.map(a => `
        <tr>
          <td><strong>${esc(a.name)}</strong></td>
          <td>${esc((a.side || '').toUpperCase())}</td>
          <td>${a.readCount}×</td>
        </tr>`).join('') : '<tr><td colspan=3 class="rk-muted">No arguments indexed.</td></tr>';
      $('rk-args-wrap').innerHTML = `
        <div class="rk-section-title">Top Arguments <span class="rk-muted" style="font-weight:400">(via opencaselist wiki)</span></div>
        <table class="rk-table"><thead><tr><th>Argument</th><th>Side</th><th>Reads</th></tr></thead><tbody>${argRows}</tbody></table>
        <div style="margin-top:10px"><a class="rk-btn-sm" href="#teams?team=${esc(encodeURIComponent(p.wikiTeamId))}">↗ Open Wiki Page</a></div>`;
    } else {
      $('rk-args-wrap').innerHTML = '';
    }
  }

  function renderChart(history) {
    if (!history.length) return '<div class="rk-muted" style="padding:16px">No rating history yet.</div>';
    const W = 960, H = 180, PAD = 20;
    const ratings = history.map(h => h.ratingAfter);
    const minR = Math.min(...ratings) - 30;
    const maxR = Math.max(...ratings) + 30;
    const n = history.length;
    const xAt = i => PAD + (n > 1 ? i * (W - 2 * PAD) / (n - 1) : (W - 2 * PAD) / 2);
    const yAt = r => PAD + (maxR - r) / (maxR - minR) * (H - 2 * PAD);
    const pts = history.map((h, i) => `${xAt(i).toFixed(1)},${yAt(h.ratingAfter).toFixed(1)}`).join(' ');
    const yTicks = [];
    for (let t = 0; t <= 3; t++) {
      const r = minR + (maxR - minR) * (t / 3);
      yTicks.push(`<line x1="${PAD}" y1="${yAt(r).toFixed(1)}" x2="${W - PAD}" y2="${yAt(r).toFixed(1)}" stroke="var(--border, #e5e5e5)" stroke-width="1"/><text x="${PAD - 4}" y="${(yAt(r) + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="var(--muted)">${Math.round(r)}</text>`);
    }
    return `
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:180px;display:block">
        ${yTicks.join('')}
        <polyline points="${pts}" fill="none" stroke="#2563eb" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      </svg>`;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  document.addEventListener('DOMContentLoaded', () => {
    const page = document.getElementById('page-rankings');
    if (!page) return;
    const observer = new MutationObserver(() => {
      if (page.classList.contains('active') && !page.dataset.rkInit) {
        page.dataset.rkInit = '1';
        window.initRankingsPage();
      }
    });
    observer.observe(page, { attributes: true, attributeFilter: ['class'] });
  });
})();
