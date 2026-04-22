/* public/toc.js — Tournament page */
'use strict';

(function () {
  let _season = null, _when = 'upcoming';
  let _currentTourn = null, _currentEvent = null, _currentView = 'results';

  const $ = id => document.getElementById(id);

  window.initTocPage = async function () {
    await loadSeasons();
    bindStatic();
    await loadGrid();
  };

  function bindStatic() {
    $('toc-season').addEventListener('change', async e => {
      _season = e.target.value;
      await loadGrid();
    });
    document.querySelectorAll('.toc-tab').forEach(b => b.addEventListener('click', async () => {
      document.querySelectorAll('.toc-tab').forEach(x => x.classList.toggle('active', x === b));
      _when = b.dataset.tocTab;
      await loadGrid();
    }));
    $('toc-reindex-btn').addEventListener('click', async () => {
      $('toc-reindex-btn').textContent = 'Reindexing…';
      $('toc-reindex-btn').disabled = true;
      await fetch('/api/toc/reindex', { method: 'POST' });
      setTimeout(() => { $('toc-reindex-btn').textContent = 'Re-index'; $('toc-reindex-btn').disabled = false; loadGrid(); }, 1500);
    });
    $('toc-back-btn').addEventListener('click', showGrid);
    $('toc-modal-close').addEventListener('click', closeModal);
    $('toc-modal').addEventListener('click', e => { if (e.target === $('toc-modal')) closeModal(); });
    let _searchTimer = null;
    const searchEl = $('toc-search');
    if (searchEl) {
      searchEl.addEventListener('input', () => {
        clearTimeout(_searchTimer);
        _searchTimer = setTimeout(() => loadGrid(), 300);
      });
    }
  }

  async function loadSeasons() {
    const res = await fetch('/api/toc/seasons');
    const { seasons } = await res.json();
    const sel = $('toc-season');
    sel.innerHTML = '';
    seasons.forEach(s => {
      const o = document.createElement('option');
      o.value = s.season;
      o.textContent = `${s.season} (${s.tournamentCount})`;
      sel.appendChild(o);
    });
    _season = seasons[0]?.season || null;
    if (_season) sel.value = _season;
  }

  async function loadGrid() {
    showGrid();
    const grid = $('toc-grid');
    $('toc-skeleton').classList.remove('hidden');
    if (!_season) { grid.innerHTML = '<div class="toc-muted" style="padding:12px">No seasons indexed yet.</div>'; return; }
    try {
      const search = encodeURIComponent(($('toc-search')?.value || '').trim());
      const res = await fetch(`/api/toc/tournaments?season=${encodeURIComponent(_season)}&when=${_when}&search=${search}`);
      const { tournaments } = await res.json();
      renderGrid(tournaments);
    } catch {
      grid.innerHTML = '<div class="toc-muted" style="padding:12px">Failed to load.</div>';
    }
  }

  function renderGrid(tournaments) {
    const grid = $('toc-grid');
    grid.innerHTML = '';
    if (!tournaments.length) {
      grid.innerHTML = `<div class="toc-muted" style="padding:12px">No ${_when} tournaments for ${esc(_season)}.</div>`;
      return;
    }
    tournaments.forEach((t, i) => {
      const card = document.createElement('div');
      card.className = 'toc-card';
      card.style.animationDelay = `${i * 20}ms`;
      const events = (t.events || []).map(ev => `<span class="toc-badge-${ev.abbr.toLowerCase()}">${esc(ev.abbr)}${ev.bidLevel ? ' · ' + esc(ev.bidLevel) : ''}</span>`).join('');
      card.innerHTML = `
        <div class="toc-card-name">${esc(t.name)}</div>
        <div class="toc-card-dates">${esc(t.startDate)} → ${esc(t.endDate)}</div>
        <div class="toc-card-loc">${esc([t.city, t.state].filter(Boolean).join(', ')) || '&nbsp;'}</div>
        <div class="toc-card-events">${events}</div>`;
      card.addEventListener('click', () => openDetail(t));
      grid.appendChild(card);
    });
  }

  function showGrid() {
    $('toc-grid').classList.remove('hidden');
    $('toc-detail').classList.add('hidden');
  }

  async function openDetail(t) {
    _currentTourn = t;
    $('toc-grid').classList.add('hidden');
    $('toc-detail').classList.remove('hidden');
    $('toc-detail-title').textContent = t.name;
    $('toc-detail-meta').textContent = `${t.startDate} → ${t.endDate} · ${[t.city, t.state].filter(Boolean).join(', ')}`;

    const events = t.events || [];
    const tabsEl = $('toc-event-tabs');
    tabsEl.innerHTML = '';
    events.forEach((ev, i) => {
      const b = document.createElement('button');
      b.className = 'toc-event-tab' + (i === 0 ? ' active' : '');
      b.textContent = ev.bidLevel ? `${ev.abbr} · ${ev.bidLevel}` : ev.abbr;
      b.addEventListener('click', () => {
        tabsEl.querySelectorAll('.toc-event-tab').forEach(x => x.classList.toggle('active', x === b));
        loadEventBody(t, ev.abbr);
      });
      tabsEl.appendChild(b);
    });
    _currentView = 'results';
    if (events.length) loadEventBody(t, events[0].abbr);
    else $('toc-detail-body').innerHTML = '<div class="toc-muted">No LD/PF/CX events indexed.</div>';
  }

  function renderViewTabs() {
    const isUpcoming = _currentTourn && new Date(_currentTourn.endDate) >= new Date();
    return `<div class="toc-view-tabs">
      <button class="toc-view-tab ${_currentView === 'results' ? 'active' : ''}" data-view="results">Results</button>
      <button class="toc-view-tab ${_currentView === 'threats' ? 'active' : ''}" data-view="threats">${isUpcoming ? 'Threats' : 'Field'}</button>
    </div>`;
  }

  async function loadEventBody(t, abbr) {
    _currentEvent = abbr;
    const body = $('toc-detail-body');
    body.innerHTML = '<div class="toc-muted">Loading…</div>';
    if (_currentView === 'threats') {
      const res = await fetch(`/api/toc/tournaments/${t.tourn_id}/threats/${abbr}`);
      const { threats } = await res.json();
      body.innerHTML = renderViewTabs() + renderThreats(threats, abbr);
    } else {
      const res = await fetch(`/api/toc/tournaments/${t.tourn_id}/results/${abbr}`);
      const { results, speakers } = await res.json();
      body.innerHTML = renderViewTabs() + renderResults(results, speakers, abbr);
    }
    body.querySelectorAll('.toc-view-tab').forEach(b => b.addEventListener('click', () => {
      _currentView = b.dataset.view;
      loadEventBody(t, abbr);
    }));
    attachEntryClicks(body);
  }

  function renderThreats(rows, abbr) {
    if (!rows.length) return '<div class="toc-muted">No entries in this event yet.</div>';
    const body = rows.map((r, i) => {
      const wikiAttr = r.wikiTeamId ? `href="${esc('#teams?team=' + encodeURIComponent(r.wikiTeamId))}" class="toc-link"` : 'class="toc-link disabled"';
      return `<tr data-entry="${r.entryId}">
        <td>${i + 1}</td>
        <td><strong>${esc(r.displayName)}</strong></td>
        <td>${r.seasonFullBids}${r.seasonPartialBids ? ' <span class="toc-muted">+' + r.seasonPartialBids + 'P</span>' : ''}</td>
        <td><a ${wikiAttr} onclick="event.stopPropagation()">Wiki ↗</a></td>
      </tr>`;
    }).join('');
    return `<table class="toc-table"><thead><tr><th>#</th><th>Team</th><th>Season Bids (${esc(abbr)})</th><th>Wiki</th></tr></thead><tbody>${body}</tbody></table>`;
  }

  function renderResults(results, speakers, abbr) {
    if (!results.length && !speakers.length) {
      return '<div class="toc-muted" style="padding:24px 0">No results recorded yet for this event.</div>';
    }
    const bidders = results.filter(r => r.earnedBid);
    const places = results.filter(r => r.place || r.rank);
    const placeRows = places.map((r, i) => `<tr data-entry="${r.entryId}">
      <td>${esc(r.place || (i + 1))}</td>
      <td><strong>${esc(r.displayName || '')}</strong></td>
      <td>${r.earnedBid ? `<span class="toc-badge-${abbr.toLowerCase()}">${esc(r.earnedBid)}</span>` : '<span class="toc-muted">—</span>'}</td>
    </tr>`).join('');
    const bidderRows = bidders.map(r => `<tr data-entry="${r.entryId}">
      <td><strong>${esc(r.displayName || '')}</strong></td>
      <td><span class="toc-badge-${abbr.toLowerCase()}">${esc(r.earnedBid)}</span></td>
    </tr>`).join('');
    const spkRows = speakers.map(s => `<tr data-entry="${s.entryId}">
      <td>${s.speakerRank}</td>
      <td><strong>${esc(s.displayName || '')}</strong></td>
      <td>${s.speakerPoints != null ? s.speakerPoints.toFixed(2) : '—'}</td>
    </tr>`).join('');
    return `
      ${places.length ? `
        <div class="toc-section-title">Final Places</div>
        <table class="toc-table"><thead><tr><th>Place</th><th>Team</th><th>Bid</th></tr></thead><tbody>${placeRows}</tbody></table>
      ` : ''}
      ${bidders.length ? `
        <div class="toc-section-title">Bidders</div>
        <table class="toc-table"><thead><tr><th>Team</th><th>Bid</th></tr></thead><tbody>${bidderRows}</tbody></table>
      ` : ''}
      ${speakers.length ? `
        <div class="toc-section-title">Speaker Awards</div>
        <table class="toc-table"><thead><tr><th>#</th><th>Speaker</th><th>Points</th></tr></thead><tbody>${spkRows}</tbody></table>
      ` : ''}
    `;
  }

  function attachEntryClicks(root) {
    root.querySelectorAll('tr[data-entry]').forEach(tr => {
      tr.addEventListener('click', () => openPairings(Number(tr.dataset.entry)));
    });
  }

  async function openPairings(entryId) {
    $('toc-modal-title').textContent = 'Loading…';
    $('toc-modal-body').innerHTML = '';
    $('toc-modal').classList.remove('hidden');
    const res = await fetch(`/api/toc/entries/${entryId}/pairings`);
    const { entry, pairings } = await res.json();
    $('toc-modal-title').textContent = `${entry.displayName || 'Entry'} — ${entry.eventAbbr}`;
    if (!pairings.length) {
      $('toc-modal-body').innerHTML = '<div class="toc-muted">No pairings recorded.</div>';
      return;
    }
    const rows = pairings.map(p => `<tr>
      <td>${esc(p.roundType === 'elim' ? p.roundName : 'R' + p.roundName)}</td>
      <td>${esc((p.side || '—').toUpperCase())}</td>
      <td>${p.opponentEntryId || '<span class="toc-muted">bye</span>'}</td>
      <td>${esc(p.judgeName || '—')}</td>
      <td><strong>${esc(p.result || '—')}</strong></td>
      <td>${p.speakerPoints != null ? p.speakerPoints.toFixed(1) : '—'}</td>
    </tr>`).join('');
    $('toc-modal-body').innerHTML = `<table class="toc-table"><thead><tr><th>Round</th><th>Side</th><th>Opp</th><th>Judge</th><th>Result</th><th>Pts</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  function closeModal() { $('toc-modal').classList.add('hidden'); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  document.addEventListener('DOMContentLoaded', () => {
    const page = document.getElementById('page-tournament');
    if (!page) return;
    const observer = new MutationObserver(() => {
      if (page.classList.contains('active') && !page.dataset.tocInit) {
        page.dataset.tocInit = '1';
        window.initTocPage();
      }
    });
    observer.observe(page, { attributes: true, attributeFilter: ['class'] });
  });
})();
