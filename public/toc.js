/* public/toc.js — Tournament page */
'use strict';

(function () {
  let _season = null, _when = 'past';
  let _currentTourn = null, _currentEvent = null, _currentView = 'results';
  let _resultsSubview = 'places';

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

  const BID_RANK = { Finals: 6, Semis: 5, Quarters: 4, Octas: 3, Doubles: 2, Triples: 1 };

  function dedupeEvents(events) {
    const byAbbr = new Map();
    for (const ev of (events || [])) {
      if (!['LD', 'PF', 'CX'].includes(ev.abbr)) continue;
      const cur = byAbbr.get(ev.abbr);
      const curRank = cur && cur.bidLevel ? (BID_RANK[cur.bidLevel] || 0) : 0;
      const newRank = ev.bidLevel ? (BID_RANK[ev.bidLevel] || 0) : 0;
      if (!cur || newRank > curRank) byAbbr.set(ev.abbr, { abbr: ev.abbr, bidLevel: ev.bidLevel || null });
    }
    const EV_ORDER = { LD: 0, PF: 1, CX: 2 };
    return [...byAbbr.values()].sort((a, b) => (EV_ORDER[a.abbr] ?? 9) - (EV_ORDER[b.abbr] ?? 9));
  }

  function eventLabel(ev) {
    return ev.bidLevel ? `${ev.abbr} · ${ev.bidLevel}` : ev.abbr;
  }

  function renderGrid(tournaments) {
    const grid = $('toc-grid');
    grid.innerHTML = '';
    if (!tournaments.length) {
      grid.innerHTML = `<div class="toc-muted" style="padding:12px">No ${_when} tournaments for ${esc(_season)}.</div>`;
      return;
    }
    const list = document.createElement('div');
    list.className = 'toc-list';
    tournaments.forEach(t => {
      const deduped = dedupeEvents(t.events || []);
      const eventBadges = deduped.map(ev => `<span>${esc(eventLabel(ev))}</span>`).join('');
      const loc = [t.city, t.state].filter(Boolean).join(', ');
      const row = document.createElement('div');
      row.className = 'toc-list-row';
      row.innerHTML = `
        <div class="toc-list-main">
          <div class="toc-list-name">${esc(t.name)}</div>
          <div class="toc-list-meta">${esc(t.startDate)} → ${esc(t.endDate)}${loc ? ' · ' + esc(loc) : ''}</div>
        </div>
        <div class="toc-list-events">${eventBadges}</div>`;
      row.addEventListener('click', () => openDetail(t));
      list.appendChild(row);
    });
    grid.appendChild(list);
  }

  function showGrid() {
    $('toc-grid').classList.remove('hidden');
    $('toc-detail').classList.add('hidden');
    $('toc-topbar')?.classList.remove('hidden');
  }

  async function openDetail(t) {
    _currentTourn = t;
    $('toc-grid').classList.add('hidden');
    $('toc-detail').classList.remove('hidden');
    $('toc-topbar')?.classList.add('hidden');
    $('toc-detail-title').textContent = t.name;
    $('toc-detail-meta').textContent = `${t.startDate} → ${t.endDate} · ${[t.city, t.state].filter(Boolean).join(', ')}`;

    const events = dedupeEvents(t.events || []);
    const tabsEl = $('toc-event-tabs');
    tabsEl.innerHTML = '';
    if (events.length) {
      const select = document.createElement('select');
      select.className = 'toc-event-select';
      events.forEach(ev => {
        const opt = document.createElement('option');
        opt.value = ev.abbr;
        opt.textContent = eventLabel(ev);
        select.appendChild(opt);
      });
      select.addEventListener('change', () => loadEventBody(t, select.value));
      tabsEl.appendChild(select);
    }
    _currentView = 'results';
    _resultsSubview = 'places';
    if (events.length) loadEventBody(t, events[0].abbr);
    else $('toc-detail-body').innerHTML = '<div class="toc-muted">No events indexed.</div>';
  }

  function isPastTournament(t) {
    if (!t || !t.endDate) return false;
    return new Date(t.endDate) < new Date();
  }

  async function loadEventBody(t, abbr) {
    _currentEvent = abbr;
    const body = $('toc-detail-body');
    body.innerHTML = '<div class="toc-muted">Loading…</div>';
    const past = isPastTournament(t);
    _currentView = past ? 'results' : 'threats';
    if (_currentView === 'threats') {
      const res = await fetch(`/api/toc/tournaments/${t.tourn_id}/threats/${abbr}`);
      const { threats } = await res.json();
      body.innerHTML = renderThreats(threats, abbr);
    } else {
      const [resultsRes, bracketRes] = await Promise.all([
        fetch(`/api/toc/tournaments/${t.tourn_id}/results/${abbr}`),
        fetch(`/api/toc/tournaments/${t.tourn_id}/bracket/${abbr}`),
      ]);
      const { results, speakers } = await resultsRes.json();
      const { rounds } = await bracketRes.json();
      body.innerHTML = renderResultsSubtabs() + renderResultsBody(results, speakers, abbr) + renderBracket(rounds);
      body.querySelectorAll('.toc-sub-tab').forEach(b => b.addEventListener('click', () => {
        _resultsSubview = b.dataset.sub;
        body.querySelectorAll('.toc-sub-tab').forEach(x => x.classList.toggle('active', x === b));
        const pane = body.querySelector('.toc-results-pane');
        if (pane) pane.innerHTML = _resultsSubview === 'places' ? placesTable(results, abbr) : speakersTable(speakers);
        attachEntryClicks(pane);
      }));
    }
    attachEntryClicks(body);
  }

  function renderResultsSubtabs() {
    return `<div class="toc-sub-tabs">
      <button class="toc-sub-tab ${_resultsSubview === 'places' ? 'active' : ''}" data-sub="places">Final Places</button>
      <button class="toc-sub-tab ${_resultsSubview === 'speakers' ? 'active' : ''}" data-sub="speakers">Speaker Awards</button>
    </div>`;
  }

  function renderResultsBody(results, speakers, abbr) {
    const pane = _resultsSubview === 'places' ? placesTable(results, abbr) : speakersTable(speakers);
    return `<div class="toc-results-pane">${pane}</div>`;
  }

  function placesTable(results, abbr) {
    const places = (results || []).filter(r => r.place || r.rank);
    if (!places.length) return '<div class="toc-muted" style="padding:24px 0">No final places recorded.</div>';
    const rows = places.map((r, i) => `<tr data-entry="${r.entryId}">
      <td>${esc(r.place || (i + 1))}</td>
      <td><strong>${esc(r.displayName || '')}</strong></td>
      <td>${r.earnedBid ? `<span class="toc-badge-${abbr.toLowerCase()}">${esc(r.earnedBid)}</span>` : '<span class="toc-muted">—</span>'}</td>
    </tr>`).join('');
    return `<table class="toc-table"><thead><tr><th>Place</th><th>Team</th><th>Bid</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  function speakersTable(speakers) {
    if (!speakers || !speakers.length) return '<div class="toc-muted" style="padding:24px 0">No speaker awards recorded.</div>';
    const rows = speakers.map(s => `<tr data-entry="${s.entryId}">
      <td>${s.speakerRank}</td>
      <td><strong>${esc(s.displayName || '')}</strong></td>
      <td>${s.speakerPoints != null ? s.speakerPoints.toFixed(2) : '—'}</td>
    </tr>`).join('');
    return `<table class="toc-table"><thead><tr><th>#</th><th>Speaker</th><th>Points</th></tr></thead><tbody>${rows}</tbody></table>`;
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

  function renderBracket(rounds) {
    if (!rounds || !rounds.length) return '';
    const cols = rounds.map(r => {
      const winners = (r.ballots || []).filter(b => b.result === 'W');
      const items = winners.map(w => `
        <div class="bracket-cell">
          <div class="bracket-name">${esc(w.displayName || '—')}</div>
          <div class="bracket-school">${esc(w.schoolCode || '')}</div>
        </div>
      `).join('');
      return `<div class="bracket-col">
        <div class="bracket-col-head">${esc(r.name)}</div>
        ${items || '<div class="toc-muted">—</div>'}
      </div>`;
    }).join('');
    return `<div class="toc-section-title">Bracket</div><div class="bracket-grid">${cols}</div>`;
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
