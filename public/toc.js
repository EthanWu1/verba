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
    list.innerHTML = `<div class="toc-list-head"><div>Tournament</div><div>Dates</div><div>Location</div><div style="text-align:right">Events</div></div>`;
    tournaments.forEach(t => {
      const deduped = dedupeEvents(t.events || []);
      const eventBadges = deduped.map(ev => `<span>${esc(ev.abbr)}</span>`).join('');
      const loc = [t.city, t.state].filter(Boolean).join(', ');
      const row = document.createElement('div');
      row.className = 'toc-list-row';
      row.innerHTML = `
        <div class="toc-list-name">${esc(t.name)}</div>
        <div class="toc-list-dates">${esc(t.startDate)} → ${esc(t.endDate)}</div>
        <div class="toc-list-loc">${esc(loc) || '<span class="toc-muted">—</span>'}</div>
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
        opt.textContent = ev.abbr; // just LD / PF / CX in selector
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
      const res = await fetch(`/api/toc/tournaments/${t.tourn_id}/results/${abbr}`);
      const { results, speakers } = await res.json();
      body.innerHTML = renderResultsSubtabs() + renderResultsBody(results, speakers, abbr);
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

  function ordinal(n) {
    const k = Math.abs(n) % 100;
    if (k >= 11 && k <= 13) return `${n}th`;
    switch (k % 10) {
      case 1: return `${n}st`;
      case 2: return `${n}nd`;
      case 3: return `${n}rd`;
      default: return `${n}th`;
    }
  }

  const PLACE_ALIASES = {
    RUNOFF: 'Partials',
    PARTIAL: 'Partials', PARTIALS: 'Partials',
    TRIPLE: 'Triples', TRIPLES: 'Triples', '3X': 'Triples', '1ST TUTORIAL': 'Triples',
    DOUBLE: 'Doubles', DOUBLES: 'Doubles', '2X': 'Doubles', WAU: 'Doubles', DKB: 'Doubles',
    OCTO: 'Octos', OCTOS: 'Octos', OCTA: 'Octos', OCTAS: 'Octos', OCTAFINALS: 'Octos', OCTAFINAL: 'Octos', OF: 'Octos', RKR: 'Octos', '3RD TUTORIAL': 'Octos',
    QUARTER: 'Quarters', QUARTERS: 'Quarters', QUARTE: 'Quarters', QUARTERFINALS: 'Quarters', QF: 'Quarters', PB: 'Quarters', '4TH TUTORIAL': 'Quarters',
    SEMI: 'Semis', SEMIS: 'Semis', S: 'Semis', SEMIFINALS: 'Semis', SEMIFINAL: 'Semis', SF: 'Semis', MD: 'Semis', '5TH TUTORIAL': 'Semis',
    FINAL: 'Finals', FINALS: 'Finals', F: 'Finals', 'PF EXHIBITION': 'Finals',
    CHAMPION: '1st', CHAMP: '1st', WINNER: '1st', '1ST': '1st', FIRST: '1st',
    '2ND': '2nd', SECOND: '2nd',
    '3RD': '3rd', THIRD: '3rd',
  };
  function normalizePlace(raw) {
    const s = String(raw == null ? '' : raw).trim();
    if (!s) return '';
    if (/^prelim/i.test(s)) return '—';
    if (/^\d+$/.test(s)) return ordinal(Number(s));
    const match = s.match(/^(\d+)(st|nd|rd|th)$/i);
    if (match) return match[1] + match[2].toLowerCase();
    const key = s.toUpperCase();
    if (PLACE_ALIASES[key]) return PLACE_ALIASES[key];
    // Fuzzy prefix match (semifina, quarterf, octafina, triplef, etc.)
    if (/^SEMIFINA/.test(key))    return 'Semis';
    if (/^QUARTERF/.test(key))    return 'Quarters';
    if (/^OCTAFINA|^OCTOFINA/.test(key)) return 'Octos';
    if (/^DOUBLEOCT|^DOUBLE-OCT|^DOUBLES/.test(key)) return 'Doubles';
    if (/^TRIPLE/.test(key))      return 'Triples';
    if (/^FINAL/.test(key))       return 'Finals';
    if (/^PARTIAL/.test(key))     return 'Partials';
    return s;
  }

  function normalizeBid(raw) {
    if (!raw) return '';
    const s = String(raw).trim();
    if (/^full/i.test(s))    return 'Full';
    if (/^silver/i.test(s))  return 'Silver';
    if (/^ghost/i.test(s))   return 'Ghost';
    if (/^partial/i.test(s)) return 'Partial';
    return s;
  }
  function bidClass(raw) {
    const b = normalizeBid(raw);
    return 'toc-bid-' + (b.toLowerCase() || 'other');
  }

  function placesTable(results, abbr) {
    const all = (results || []).filter(r => r.place || r.rank);
    if (!all.length) return '<div class="toc-muted" style="padding:24px 0">No final places recorded.</div>';
    const nonPrelim = all.filter(r => !/^prelim/i.test(String(r.place || '')));
    const prelim = all.filter(r => /^prelim/i.test(String(r.place || '')));
    const places = [...nonPrelim, ...prelim];
    const rows = places.map((r, i) => {
      let placeCell;
      if (r.rank === 1) placeCell = '1st';
      else if (r.rank === 2) placeCell = '2nd';
      else if (r.rank === 3) placeCell = '3rd';
      else if (r.place) placeCell = normalizePlace(r.place);
      else if (r.rank) placeCell = ordinal(r.rank);
      else placeCell = ordinal(i + 1);
      const bidTxt = normalizeBid(r.earnedBid);
      const bidHtml = bidTxt
        ? `<span class="toc-bid ${bidClass(r.earnedBid)}">${esc(bidTxt)}</span>`
        : '<span class="toc-muted">—</span>';
      return `<tr data-entry="${r.entryId}">
        <td>${esc(placeCell)}</td>
        <td><strong>${esc(r.displayName || '')}</strong></td>
        <td>${bidHtml}</td>
      </tr>`;
    }).join('');
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

  function attachEntryClicks(root) {
    if (!root) return;
    root.querySelectorAll('tr[data-entry]').forEach(tr => {
      tr.addEventListener('click', () => showPairings(Number(tr.dataset.entry)));
    });
  }

  function roundLabel(p) {
    if (p.depth) return p.depth;
    const n = parseInt(p.roundName, 10);
    if (p.roundType === 'prelim' || p.roundType === 'highlow') {
      return Number.isFinite(n) ? 'R' + n : p.roundName;
    }
    // Elim round without inferred depth — default to Partials rather than "Elim N".
    return 'Partials';
  }

  async function showPairings(entryId) {
    const body = $('toc-detail-body');
    body.innerHTML = '<div class="toc-muted">Loading pairings…</div>';
    const res = await fetch(`/api/toc/entries/${entryId}/pairings`);
    const { entry, pairings } = await res.json();
    const backHTML = `<button class="toc-btn-sm" id="toc-pair-back">← Back</button>`;
    if (!pairings || !pairings.length) {
      body.innerHTML = `${backHTML}<div class="toc-section-title">${esc(entry.displayName || 'Entry')}</div><div class="toc-muted">No pairings recorded.</div>`;
    } else {
      const rows = pairings.map(p => {
        const oppCell = p.opponentEntryId
          ? `<a href="#" class="toc-link" data-opp="${p.opponentEntryId}">${esc(p.opponentName || '#' + p.opponentEntryId)}${p.opponentSchool ? ' <span class="toc-muted">· ' + esc(p.opponentSchool) + '</span>' : ''}</a>`
          : '<span class="toc-muted">bye</span>';
        return `<tr>
          <td><strong>${esc(roundLabel(p))}</strong></td>
          <td>${esc((p.side || '—').toUpperCase())}</td>
          <td>${oppCell}</td>
          <td>${esc(p.judgeName || '—')}</td>
          <td><strong>${esc((p.ballotResults && p.ballotResults.length) ? p.ballotResults.join('') : (p.result || '—'))}</strong></td>
          <td>${p.speakerPoints != null ? p.speakerPoints.toFixed(1) : '—'}</td>
        </tr>`;
      }).join('');
      body.innerHTML = `
        ${backHTML}
        <div class="toc-section-title">${esc(entry.displayName || 'Entry')} · ${esc(entry.eventAbbr || '')}</div>
        <table class="toc-table">
          <thead><tr><th>Round</th><th>Side</th><th>Opponent</th><th>Judge</th><th>Result</th><th>Pts</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`;
      body.querySelectorAll('a[data-opp]').forEach(a => {
        a.addEventListener('click', e => {
          e.preventDefault();
          showPairings(Number(a.dataset.opp));
        });
      });
    }
    document.getElementById('toc-pair-back')?.addEventListener('click', () => {
      if (_currentTourn && _currentEvent) loadEventBody(_currentTourn, _currentEvent);
    });
  }

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
