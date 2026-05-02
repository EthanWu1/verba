/* Verba app shell — Phase 1 (R3 redesign)
 * Wires the rail/today/library/tournaments/rankings/settings to real endpoints.
 * Cutter section is a placeholder that links to /app-legacy.
 */
(function(){
'use strict';

const $  = (id) => document.getElementById(id);
const $$ = (sel, root=document) => root.querySelectorAll(sel);

const NAMES = {
  today:'Today', cutter:'Card Cutter', library:'Library',
  tournaments:'Tournaments', rankings:'Rankings', team:'Team Profile',
  chat:'Assistant', settings:'Settings'
};

const state = {
  user:         null,
  history:      [],
  upcoming:     [],
  pastResults:  [],
  pastShown:    10,
  links:        [],
  linksLoaded:  false,  // true once /api/me/tabroom-link has resolved at least once

  rankings:     { event: (TWEAKS.format||'cx').toUpperCase(), season: '', rows: [] },
  libCards:     [],
  libSelected:  null,
  pageNow:      null,
  allTourns:    [],
  allWhen:      'upcoming',
  allShown:     12,
};

/* ── tiny helpers ───────────────────────────────────────── */
async function fetchJSON(url, opts){
  try{
    const r = await fetch(url, Object.assign({ credentials:'same-origin', headers:{'Accept':'application/json'} }, opts||{}));
    if(!r.ok){
      const text = await r.text().catch(()=>'');
      throw new Error(`${r.status} ${r.statusText}${text?': '+text.slice(0,160):''}`);
    }
    const ct = r.headers.get('content-type')||'';
    return ct.includes('json') ? r.json() : r.text();
  }catch(err){
    console.warn('[fetch]', url, err.message);
    return null;
  }
}
function escapeHTML(s){ return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fmtRel(at){
  if(!at) return '';
  const t = typeof at==='number' ? at : Date.parse(at);
  if(!t || isNaN(t)) return '';
  const diff = Date.now() - t;
  const min = Math.round(diff/60000);
  if(min < 1) return 'now';
  if(min < 60) return min+'m';
  const hr = Math.round(min/60);
  if(hr < 24) return hr+'h';
  const d = Math.round(hr/24);
  if(d < 7) return d+'d';
  const dt = new Date(t);
  return dt.toLocaleDateString(undefined, { month:'short', day:'numeric' });
}
function fmtRelLong(at){
  if(!at) return { big:'—', small:'' };
  const t = typeof at==='number' ? at : Date.parse(at);
  if(!t || isNaN(t)) return { big:'—', small:'' };
  const diff = Date.now() - t;
  const min = Math.round(diff/60000);
  if(min < 60) return { big: min+'m', small: 'ago' };
  const hr = Math.round(min/60);
  if(hr < 24) return { big: hr+'h', small: 'ago' };
  const d = Math.round(hr/24);
  if(d < 7) return { big: d+'d', small: 'ago' };
  const dt = new Date(t);
  return { big: dt.toLocaleDateString(undefined,{month:'short',day:'numeric'}), small: '' };
}
function fmtDateRange(start, end){
  if(!start) return '';
  const s = new Date(start), e = end ? new Date(end) : null;
  const sm = s.toLocaleDateString(undefined,{ month:'short', day:'numeric' });
  if(!e || e.toDateString()===s.toDateString()){
    return `${sm}, ${s.getFullYear()}`;
  }
  const sameMonth = s.getMonth()===e.getMonth() && s.getFullYear()===e.getFullYear();
  const ed = sameMonth ? e.getDate() : e.toLocaleDateString(undefined,{month:'short',day:'numeric'});
  return `${sm} – ${ed}, ${e.getFullYear()}`;
}
function initials(name){
  if(!name) return '··';
  return name.replace(/[^A-Za-z ]/g,'').split(/\s+/).filter(Boolean).slice(0,2).map(s=>s[0].toUpperCase()).join('') || '··';
}
function showToast(msg){
  const t = $('toast'); if(!t) return;
  t.textContent = msg; t.classList.add('on');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(()=>t.classList.remove('on'), 1700);
}

/* ── ROUTING ────────────────────────────────────────────── */
function go(p){
  if(!NAMES[p]) p = 'today';
  $$('.page').forEach(s=>s.classList.toggle('on', s.id==='page-'+p));
  $$('.rail-btn[data-page]').forEach(b=>b.classList.toggle('on', b.dataset.page===p));
  $('crumb').textContent = NAMES[p];
  state.pageNow = p;
  TWEAKS.page = p; persistTweaks();
  if(p==='today') loadToday();
  if(p==='cutter') loadCutter();
  if(p==='library') loadLibrary();
  if(p==='tournaments') loadTournaments();
  if(p==='rankings') loadRankings();
  if(p==='settings') loadSettings();
  if(p==='chat' && window.ChatApp && window.ChatApp.show) window.ChatApp.show();
  // Reset tournaments view when navigating in
  if(p==='tournaments'){ $('t-list-view').style.display='block'; $('t-detail-view').style.display='none'; window.scrollTo(0,0); }
}

/* ── BOOT ───────────────────────────────────────────────── */
async function boot(){
  applyTweaks();
  bindRail();
  bindCommandPalette();
  bindLinkModal();
  bindSettings();
  bindTournamentsControls();
  bindAllTournamentsControls();
  bindRankingsControls();
  bindLibraryControls();
  bindCutterControls();

  await loadUser();
  await loadLinks();
  loadUsage();
  go(TWEAKS.page || 'today');
}

/* ── USER ───────────────────────────────────────────────── */
async function loadUser(){
  const data = await fetchJSON('/api/auth/me');
  if(data && data.user){
    state.user = data.user;
    const name = data.user.displayName || data.user.name || data.user.email || 'You';
    $('rail-avatar').textContent = initials(name);
    $('crumb-team').textContent = name;
    $('profile-name').textContent = name;
    $('profile-pic').textContent = initials(name);
    $('profile-meta').textContent = data.user.email || '';
  }
}

/* ── LINKED DEBATER ─────────────────────────────────────── */
async function loadLinks(){
  const data = await fetchJSON('/api/me/tabroom-link');
  state.links = (data && data.links) || [];
  state.linksLoaded = true;
  renderTeamChip();
}
function renderTeamChip(){
  const chip = $('team-chip');
  const val  = $('team-chip-val');
  if(!state.links.length){
    chip.classList.add('unlinked');
    val.innerHTML = '<span class="team-chip-name">Not linked</span>';
  } else {
    const l = state.links[0];
    chip.classList.remove('unlinked');
    val.innerHTML = `<span class="team-chip-name">${escapeHTML(l.schoolName||l.teamCode)}</span><span class="team-chip-code">${escapeHTML(l.teamCode)}</span>`;
  }
}

/* ── TODAY ──────────────────────────────────────────────── */
async function loadToday(){
  setTodayKicker();
  // Scope counts/topics to the user's own saved cards (user_saved_cards) —
  // the global /api/library/* endpoints reflect the imported corpus, which
  // overstated "your library" by a factor of 1000+ on the Today page.
  const [hist, upcoming, analytics, count] = await Promise.all([
    fetchJSON('/api/history'),
    fetchJSON('/api/me/tabroom/upcoming'),
    fetchJSON('/api/mine/analytics'),
    fetchJSON('/api/mine/count'),
  ]);
  state.history    = (hist && hist.items) || [];
  state.upcoming   = (upcoming && upcoming.tournaments) || [];
  state.cardCount  = (count && count.count) || 0;
  renderTodaySub();
  renderContinueList();
  renderTopicList(analytics);
  renderUpcomingCard();
  renderPulse(analytics);
}
function setTodayKicker(){
  const now = new Date();
  const day = now.toLocaleDateString(undefined,{ weekday:'long' });
  const md  = now.toLocaleDateString(undefined,{ month:'long', day:'numeric' });
  const time = now.toLocaleTimeString(undefined,{ hour:'numeric', minute:'2-digit' });
  $('today-kicker').textContent = `${day} · ${md} · ${time}`;
}
function renderTodaySub(){
  const h1 = $('today-h1');
  const sub = $('today-sub');
  const name = state.user?.displayName || state.user?.name || 'there';
  const first = name.split(' ')[0];
  h1.innerHTML = `<span class="roman">Welcome back, <span class="mark">${escapeHTML(first)}</span>.</span>`;
  const cuts = state.history.filter(h=>h.kind!=='view' && h.kind!=='search').length;
  if(cuts){
    sub.innerHTML = `You've logged <b>${cuts}</b> recent activit${cuts===1?'y':'ies'}.${state.upcoming.length?` Next tournament: <b>${escapeHTML(state.upcoming[0].name)}</b>.`:''}`;
  } else if(state.upcoming.length){
    sub.innerHTML = `Next tournament: <b>${escapeHTML(state.upcoming[0].name)}</b>.`;
  } else {
    sub.textContent = `Cut a card or link your Tabroom team to get started.`;
  }
}
function renderContinueList(){
  const root = $('continue-list');
  const items = state.history.slice(0, 6);
  if(!items.length){
    root.innerHTML = `<div class="empty"><b>No recent activity yet</b>Cut a card and it'll show up here.</div>`;
    return;
  }
  root.innerHTML = items.map(it => {
    const tag = it.tag || it.title || it.query || it.url || '(untitled)';
    const cite = shortCiteFor(it) || it.author || it.host || it.kind || '';
    const sideClass = (it.side||'').toLowerCase()==='aff' ? 'aff' : (it.side||'').toLowerCase()==='neg' ? 'neg' : '';
    const topic = it.topic ? `<span class="badge topic">${escapeHTML(it.topic)}</span>` : '';
    const sideBadge = sideClass ? `<span class="badge ${sideClass}">${sideClass.toUpperCase()}</span>` : '';
    const r = fmtRelLong(it.at);
    return `
      <div class="cont-item" data-cardid="${escapeHTML(it.id||'')}">
        <div class="cont-time"><b>${escapeHTML(r.big)}</b><span>${escapeHTML(r.small)}</span></div>
        <div class="cont-body">
          <div class="head">${sideBadge}${topic}</div>
          <div class="tag">${escapeHTML(tag)}</div>
          ${cite ? `<div class="cite">${escapeHTML(cite)}</div>` : ''}
        </div>
        <button class="cont-act">Open →</button>
      </div>`;
  }).join('');
  $$('.cont-item', root).forEach(el => el.addEventListener('click', ()=> go('library')));
}
// Topic labels we never want to show as a chip (umbrella / catch-all categories).
const TOPIC_BLOCKLIST = new Set(['general ld', 'general', 'misc', 'miscellaneous', 'unknown', 'untagged', 'other']);
function renderTopicList(analytics){
  const root = $('topic-list');
  const meta = $('topic-meta');
  const raw   = (analytics && analytics.topTopics) || [];
  let topics = raw.filter(t => {
    const lab = String(t.label || t.name || '').trim().toLowerCase();
    return lab && !TOPIC_BLOCKLIST.has(lab);
  });
  // Truncate the chip list at "Politics DA" inclusive — anything past it is
  // long-tail noise. Topics are already sorted by frequency DESC.
  const cutIdx = topics.findIndex(t => String(t.label||t.name||'').trim().toLowerCase() === 'politics da');
  if (cutIdx >= 0) topics = topics.slice(0, cutIdx + 1);
  // Prefer the live count from /api/library/count over the cached analytics total.
  const total = state.cardCount || (analytics && analytics.totals && analytics.totals.cards) || 0;
  if(!topics.length){
    root.innerHTML = `<div class="empty" style="padding:18px 0;text-align:left"><b>No topics yet</b>Tags appear after you cut cards.</div>`;
    meta.textContent = total ? `${total.toLocaleString()} cards` : '';
    return;
  }
  meta.textContent = total
    ? `${total.toLocaleString()} card${total===1?'':'s'} · ${topics.length} topic${topics.length===1?'':'s'}`
    : 'Cut a card to populate this list.';
  root.innerHTML = topics.map(t => {
    const label = t.label || t.name || '';
    const count = t.count || 0;
    return `<a class="topic-chip" data-topic="${escapeHTML(label)}">${escapeHTML(label)}${count?` <span class="ct">${Number(count).toLocaleString()}</span>`:''}</a>`;
  }).join('');
  $$('.topic-chip', root).forEach(el => el.addEventListener('click', ()=>{
    const q = el.dataset.topic||'';
    go('library');
    setTimeout(()=>{ const inp = $('lib-q'); if(inp){ inp.value = q; inp.dispatchEvent(new Event('input')); } }, 150);
  }));
}
function renderUpcomingCard(){
  const card = $('next-tourn-card');
  const name = $('next-tourn-name');
  const meta = $('next-tourn-meta');
  const where = $('next-tourn-where');
  const counter = $('next-tourn-counter');
  const cta = $('next-tourn-cta');
  const t = state.upcoming[0];
  if(!t){
    name.textContent = 'No upcoming tournaments';
    meta.textContent = state.links.length ? 'Nothing scheduled.' : 'Link a Tabroom team in the top bar to see your schedule.';
    where.textContent = '—';
    counter.style.display = 'none';
    cta.style.display = 'none';
    return;
  }
  name.textContent = t.name || 'Tournament';
  where.textContent = fmtDateRange(t.startDate, t.endDate);
  const events = (t.entries||[]).map(e=>e.eventAbbr||e.eventName).filter(Boolean);
  meta.textContent = `${fmtDateRange(t.startDate, t.endDate)}${events.length?` · ${[...new Set(events)].join(', ')}`:''}`;
  counter.style.display = 'grid';
  cta.style.display = 'flex';
  startCountdown(t.startDate);
}
let _cdTimer = null;
function startCountdown(startDate){
  if(_cdTimer) clearInterval(_cdTimer);
  if(!startDate) return;
  const target = new Date(startDate).getTime();
  const tick = ()=>{
    let secs = Math.max(0, Math.floor((target - Date.now())/1000));
    const d = Math.floor(secs/86400), h = Math.floor((secs%86400)/3600), m = Math.floor((secs%3600)/60), s = secs%60;
    if($('cd-d')){
      $('cd-d').textContent = d;
      $('cd-h').textContent = String(h).padStart(2,'0');
      $('cd-m').textContent = String(m).padStart(2,'0');
      $('cd-s').textContent = String(s).padStart(2,'0');
    }
  };
  tick();
  _cdTimer = setInterval(tick, 1000);
}
function renderPulse(analytics){
  const root = $('pulse-grid');
  const total = state.cardCount || (analytics && analytics.totals && analytics.totals.cards) || 0;
  const week  = state.history.filter(h => h.at && (Date.now()-Date.parse(h.at) < 7*86400e3)).length;
  const today = state.history.filter(h => h.at && (Date.now()-Date.parse(h.at) < 86400e3)).length;
  const topics = (analytics && analytics.topTopics || []).filter(t => !TOPIC_BLOCKLIST.has(String(t.label||'').toLowerCase())).length;
  $('week-extra').textContent = week ? `+${week} activit${week===1?'y':'ies'}` : '';
  root.innerHTML = `
    <div class="pulse"><div class="lab">Activity · 7d</div><div class="val">${week.toLocaleString()}</div><div class="delta">${today} today</div></div>
    <div class="pulse"><div class="lab">Library size</div><div class="val">${total.toLocaleString()}</div><div class="delta">cards indexed</div></div>
    <div class="pulse"><div class="lab">Topics</div><div class="val">${topics}</div><div class="delta">covered</div></div>
    <div class="pulse"><div class="lab">Upcoming</div><div class="val">${state.upcoming.length}</div><div class="delta">tournaments</div></div>
  `;
}

/* ── TOURNAMENTS ────────────────────────────────────────── */
function bindTournamentsControls(){
  $('t-back').addEventListener('click', (e)=>{
    e.preventDefault();
    $('t-detail-view').style.display='none';
    $('t-pairings-view').style.display='none';
    $('t-list-view').style.display='block';
    window.scrollTo(0,0);
  });
  $('t-pair-back').addEventListener('click', (e)=>{
    e.preventDefault();
    $('t-pairings-view').style.display='none';
    if(state.tocDetail){
      $('t-detail-view').style.display='block';
    } else {
      $('t-list-view').style.display='block';
    }
    window.scrollTo(0,0);
  });
}
async function loadTournaments(){
  const up = await fetchJSON('/api/me/tabroom/upcoming');
  state.upcoming = (up && up.tournaments) || [];
  renderUpcomingGrid();
  loadAllTournaments();
  loadMyTournaments();
}

// "Your tournaments" — past tournaments for the linked Tabroom debater. Each
// row opens the pairings view for that entry, keeping parity with the rest of
// the tournaments page. No-op when no debater is linked.
async function loadMyTournaments(){
  const root = $('my-tourn-list');
  const lbl  = $('my-tourn-lbl');
  if(!root) return;
  // If loadLinks hasn't resolved yet, show a loading state and re-run once it
  // does. Otherwise a fast tab-switch into Tournaments races loadLinks() and
  // shows "No debater linked" even when one is configured.
  if(!state.linksLoaded){
    lbl.textContent = 'Your tournaments';
    root.innerHTML = `<div class="empty"><b>Loading…</b></div>`;
    setTimeout(loadMyTournaments, 200);
    return;
  }
  if(!state.links || !state.links.length){
    lbl.textContent = 'Your tournaments';
    root.innerHTML = `<div class="empty"><b>No debater linked</b>Link a Tabroom team in the top bar to see your tournaments.</div>`;
    return;
  }
  root.innerHTML = `<div class="empty"><b>Loading your tournaments…</b></div>`;
  const data = await fetchJSON('/api/me/tabroom/results');
  const tournaments = (data && data.tournaments) || [];
  if(!tournaments.length){
    lbl.textContent = 'Your tournaments · 0';
    root.innerHTML = `<div class="empty"><b>No past tournaments yet</b>Tabroom hasn't recorded results for the linked debater this season.</div>`;
    return;
  }
  // Sort newest first (server already does, but defensive in case).
  tournaments.sort((a,b) => String(b.startDate||'').localeCompare(String(a.startDate||'')));
  lbl.textContent = `Your tournaments · ${tournaments.length}`;
  // Each tournament can have multiple entries (e.g. linked code competed in LD
  // and PF). Flatten to one row per entry so each pairings view is reachable.
  const rows = [];
  for(const t of tournaments){
    for(const e of (t.entries || [])){
      rows.push({
        tournId:    t.tournId,
        name:       t.name,
        startDate:  t.startDate,
        endDate:    t.endDate,
        eventAbbr:  e.eventAbbr,
        entryId:    e.entryId,
        teamCode:   e.teamCode,
        schoolName: e.schoolName,
      });
    }
  }
  if(!rows.length){
    root.innerHTML = `<div class="empty"><b>No entries</b>The linked debater has no recorded entries.</div>`;
    return;
  }
  root.innerHTML = `
    <div class="tr-head" style="grid-template-columns:1.6fr 100px 110px 80px"><span>Tournament</span><span>Date</span><span>Event</span><span></span></div>
    ${rows.map((r, i) => {
      const range = fmtDateRange(r.startDate, r.endDate);
      return `
        <div class="tr-row" data-myidx="${i}" style="grid-template-columns:1.6fr 100px 110px 80px;cursor:pointer">
          <div class="tr-team"><span class="nm">${escapeHTML(r.name||'Tournament')}</span>${r.teamCode?`<span class="sch">${escapeHTML(r.teamCode)}</span>`:''}</div>
          <span class="tr-cell mono">${escapeHTML(range || '—')}</span>
          <span class="tr-cell mono">${escapeHTML((r.eventAbbr||'').toUpperCase() || '—')}</span>
          <span class="tr-cell" style="color:var(--muted);text-align:right">Pairings →</span>
        </div>`;
    }).join('')}`;
  $$('.tr-row[data-myidx]', root).forEach(el => {
    el.addEventListener('click', () => {
      const r = rows[Number(el.dataset.myidx)];
      if(!r || !r.entryId){ showToast('No pairings available for this entry'); return; }
      // Clear the toc detail context so the pairings "back" button returns to
      // the tournaments list rather than a stale TOC detail view.
      state.tocDetail = null;
      openEntryPairings(r.entryId, r.eventAbbr || '');
    });
  });
}

function bindAllTournamentsControls(){
  $('all-search-q').addEventListener('input', debounce(()=>{
    state.allShown = 12;
    renderAllTournaments();
  }, 200));
  $$('#all-when-tabs .rank-tab').forEach(b => b.addEventListener('click', ()=>{
    $$('#all-when-tabs .rank-tab').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    state.allWhen = b.dataset.when;
    state.allShown = 12;
    loadAllTournaments();
  }));
  $('all-show-more-btn').addEventListener('click', ()=>{
    state.allShown += 12;
    renderAllTournaments();
  });
}
async function loadAllTournaments(){
  $('all-tourn-grid').innerHTML = `<div class="empty" style="grid-column:1/-1"><b>Loading tournaments…</b></div>`;
  const data = await fetchJSON(`/api/toc/tournaments?when=${encodeURIComponent(state.allWhen)}`);
  state.allTourns = (data && data.tournaments) || [];
  renderAllTournaments();
}
function renderAllTournaments(){
  const grid = $('all-tourn-grid');
  const q = ($('all-search-q').value||'').trim().toLowerCase();
  const filtered = !q ? state.allTourns : state.allTourns.filter(t => {
    const hay = `${t.name||''} ${t.city||''} ${t.state||''}`.toLowerCase();
    return hay.includes(q);
  });
  $('all-tourn-lbl').textContent = `Tournaments · ${filtered.length}`;
  const head = `<div class="tt-head"><span>Tournament</span><span>Date</span><span>Location</span><span>Status</span></div>`;
  if(!filtered.length){
    grid.innerHTML = head + `<div class="empty"><b>No tournaments</b>${state.allTourns.length?'No matches for that search.':`No ${state.allWhen} tournaments — try the other tab.`}</div>`;
    $('all-show-more-row').style.display='none';
    return;
  }
  const visible = filtered.slice(0, state.allShown);
  grid.innerHTML = head + visible.map(t => {
    const where = [t.city, t.state].filter(Boolean).join(', ');
    const range = fmtDateRange(t.startDate || t.start_date, t.endDate || t.end_date);
    const tid = t.tournId || t.tourn_id || '';
    const isUp = state.allWhen === 'upcoming';
    return `
      <div class="tt-row" data-toc-tid="${escapeHTML(String(tid))}">
        <div class="tt-name">${escapeHTML(t.name||'Tournament')}</div>
        <div class="tt-date">${escapeHTML(range||'—')}</div>
        <div class="tt-event">${escapeHTML(where||'—')}</div>
        <div class="tt-status${isUp?' up':''}">${isUp?'Upcoming':'Past'}</div>
      </div>`;
  }).join('');
  $$('.tt-row[data-toc-tid]', grid).forEach(r => r.addEventListener('click', ()=> showTocTournDetail(r.dataset.tocTid)));
  $('all-show-more-row').style.display = filtered.length > state.allShown ? 'flex' : 'none';
}

// ── helpers for results/pairings ──────────────────────────────────────
function placeLabel(row){
  // Result rows have either `place` ("1st", "T-9th") or numeric `rank`.
  const r = (row && (row.rank!=null ? row.rank : parseInt(String(row.place||'').replace(/\D/g,''),10))) || null;
  if(!r || isNaN(r)) return 'Prelim';
  if(r === 1) return 'First';
  if(r === 2) return 'Second';
  if(r <= 4) return 'Semis';
  if(r <= 8) return 'Quarters';
  if(r <= 16) return 'Octos';
  if(r <= 32) return 'Doubles';
  if(r <= 64) return 'Triples';
  return 'Prelim';
}
function placeClass(/*row*/){
  // Per-design: place column stays default (black) — no gold/silver/bronze tint.
  return '';
}
// Pairings round label: short single-letter for elims, number for prelims.
// roundType values: prelim, highlow (still prelim), elim, final.
function roundLabel(p){
  const rn = String(p.roundName||'').trim();
  const rt = String(p.roundType||'').toLowerCase();
  const depth = String(p.depth||'').toLowerCase();
  // Prelim-style → return the round number
  if(rt === 'prelim' || rt === 'highlow'){
    return rn.replace(/^round\s*/i,'') || '—';
  }
  // Finals
  if(rt === 'final') return 'F';
  // Elim — disambiguate by `depth` first (e.g. "Doubles", "Octos"), then roundName
  const probe = (depth + ' ' + rn).toLowerCase();
  if(/final|grand/.test(probe)) return 'F';
  if(/semi/.test(probe)) return 'S';
  if(/quarter/.test(probe)) return 'Q';
  if(/octo/.test(probe)) return 'O';
  if(/double/.test(probe)) return 'D';
  if(/triple/.test(probe)) return 'T';
  return rn || '—';
}
// Best-effort debater name display: prefer a `students` array on the row,
// fall back to studentNames JSON, otherwise null.
function debaterNames(row){
  if(!row) return null;
  let s = row.students || row.studentNames || row.entrants;
  if(typeof s === 'string'){ try { s = JSON.parse(s); } catch { return null; } }
  if(!Array.isArray(s) || !s.length) return null;
  return s.map(x => typeof x === 'string' ? x : (x && (x.name || `${x.firstName||''} ${x.lastName||''}`.trim()))).filter(Boolean).join(' & ');
}
function bidLabel(b){
  const v = String(b||'').trim().toLowerCase();
  if(v === 'full' || v === 'gold') return 'FULL';
  if(v === 'silver' || v === 'partial') return 'SILVER';
  if(v === 'ghost') return 'GHOST';
  return '';
}
function bidClass(label){ return label==='FULL'?'full':label==='SILVER'?'silver':label==='GHOST'?'ghost':'none'; }
function renderUpcomingGrid(){
  const grid = $('upcoming-grid');
  $('upcoming-lbl').textContent = `Upcoming · ${state.upcoming.length}`;
  if(!state.upcoming.length){
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><b>No upcoming tournaments</b>${state.links.length?'Nothing scheduled.':'Link a Tabroom debater to populate this list.'}</div>`;
    return;
  }
  grid.innerHTML = state.upcoming.map((t,i) => {
    const events = [...new Set((t.entries||[]).map(e=>e.eventAbbr||e.eventName).filter(Boolean))];
    const days = t.startDate ? Math.max(0, Math.ceil((Date.parse(t.startDate)-Date.now())/86400e3)) : null;
    return `
      <div class="tcard upcoming" data-tid="${escapeHTML(String(t.tournId))}" ${i===0?'style="grid-column:1/-1"':''}>
        <div class="tcard-head">
          <div>
            <div class="name">${escapeHTML(t.name||'Tournament')}</div>
            <div class="tcard-meta" style="margin-top:6px">
              <span><b>${escapeHTML(fmtDateRange(t.startDate, t.endDate))}</b></span>
              ${events.length?`<span>${escapeHTML(events.join(' · '))}</span>`:''}
              <span><b>${(t.entries||[]).length}</b> ${(t.entries||[]).length===1?'entry':'entries'}</span>
            </div>
          </div>
          ${days!=null?`<div class="when"><div style="font:700 22px/1 var(--font-mono);color:var(--ink);font-variant-numeric:tabular-nums;letter-spacing:-0.02em">${days}d</div><div style="margin-top:4px">until R1</div></div>`:''}
        </div>
      </div>`;
  }).join('');
  $$('.tcard[data-tid]', grid).forEach(c => c.addEventListener('click', ()=> showTournDetail(c.dataset.tid)));
}
function renderPastTournaments(){
  const grid = $('past-grid');
  const q = ($('t-search-q').value||'').trim().toLowerCase();
  const fmtTab = document.querySelector('#t-fmt-tabs .rank-tab.on');
  const fmt = (fmtTab?.dataset.tfmt || 'cx').toLowerCase();

  const eventMatch = (entries, fmt)=>{
    if(!entries) return false;
    return entries.some(e => {
      const a = (e.eventAbbr||'').toLowerCase();
      const n = (e.eventName||'').toLowerCase();
      if(fmt==='cx') return a.includes('cx') || a.includes('policy') || n.includes('policy') || a==='vcx' || a==='vpo';
      if(fmt==='ld') return a.includes('ld') || n.includes('lincoln');
      if(fmt==='pf') return a.includes('pf') || n.includes('public forum');
      return true;
    });
  };

  const filtered = state.pastResults.filter(t => {
    if(q){
      const hay = `${t.name||''} ${(t.entries||[]).map(e=>`${e.schoolName||''} ${e.teamCode||''} ${e.eventAbbr||''} ${e.eventName||''}`).join(' ')}`.toLowerCase();
      if(!hay.includes(q)) return false;
    }
    return eventMatch(t.entries, fmt);
  });

  if(!filtered.length){
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><b>No past tournaments</b>${state.pastResults.length?'No results match this filter.':'Past results will appear here once you\'ve competed.'}</div>`;
    $('show-more-row').style.display='none';
    return;
  }
  const visible = filtered.slice(0, state.pastShown);

  grid.innerHTML = visible.map(t => {
    const wins = (t.rounds||[]).filter(r => roundIsWin(r)).length;
    const losses = (t.rounds||[]).filter(r => roundIsLoss(r)).length;
    const elimRound = lastElimRound(t.rounds||[]);
    const inferred = inferBid(elimRound, t.name);
    const bid = bidLabel(inferred);
    const bClass = bidClass(bid);
    const events = [...new Set((t.entries||[]).map(e => e.eventAbbr || e.eventName).filter(Boolean))];
    return `
      <div class="past-card" data-tid="${escapeHTML(String(t.tournId))}">
        <div class="body">
          <div class="name">${escapeHTML(t.name||'Tournament')}</div>
          <div class="meta">${escapeHTML(fmtDateRange(t.startDate, t.endDate))}${events.length?` · ${escapeHTML(events.join(' · '))}`:''}</div>
        </div>
        <div class="rec-block">
          <div class="lab">Record</div>
          <div class="val">${wins}–${losses}</div>
          ${bid?`<div class="bid ${bClass}">${escapeHTML(bid)}</div>`:''}
        </div>
      </div>`;
  }).join('');
  $$('.past-card', grid).forEach(c => c.addEventListener('click', ()=> showTournDetail(c.dataset.tid)));
  $('show-more-row').style.display = filtered.length > state.pastShown ? 'flex' : 'none';
}
function roundIsWin(r){
  const last = (r.scores||[]).slice().reverse().find(s => s && (s.win!=null || s.points!=null));
  if(!last) return false;
  if(last.win===true || last.win==='W' || last.win===1) return true;
  return false;
}
function roundIsLoss(r){
  const last = (r.scores||[]).slice().reverse().find(s => s && (s.win!=null || s.points!=null));
  if(!last) return false;
  if(last.win===false || last.win==='L' || last.win===0) return true;
  return false;
}
function lastElimRound(rounds){
  // rounds may be ordered; pick the last round name that looks like an elim
  const elimRe = /finals?|semis?|quarters?|octos?|doubles|triples|elim/i;
  const elims = (rounds||[]).filter(r => elimRe.test(r.round||''));
  if(elims.length) return elims[elims.length-1].round;
  return null;
}
function inferBid(elim, tournName){
  if(!elim) return null;
  const e = String(elim).toLowerCase();
  // Major TOC bid distinctions
  if(/final/.test(e)) return 'Gold';
  if(/semi/.test(e)) return 'Gold';
  if(/quarter|octos|octofinal/.test(e)) return 'Silver';
  return null;
}
// User's tabroom past tournament (clicked from "Your past tournaments" cards).
// Renders the user's own round records.
function showTournDetail(tid){
  const t = [...state.upcoming, ...state.pastResults].find(x => String(x.tournId)===String(tid));
  if(!t) return;
  $('t-list-view').style.display='none';
  $('t-pairings-view').style.display='none';
  $('t-detail-view').style.display='block';
  window.scrollTo(0,0);
  $('td-title').textContent = t.name || 'Tournament';
  $('td-sub').textContent = `${fmtDateRange(t.startDate, t.endDate)}${(t.entries||[]).length?` · ${(t.entries||[]).length} entr${(t.entries||[]).length===1?'y':'ies'}`:''}`;
  $('td-evt-tabs').innerHTML = '';
  const rounds = (t.rounds||[]);
  if(!rounds.length){
    $('td-content').innerHTML = `<div class="empty"><b>No round records</b>Tabroom hasn't published rounds for this tournament yet.</div>`;
    return;
  }
  $('td-content').innerHTML = `
    <div class="tres-table">
      <div class="tr-head" style="grid-template-columns:80px 1fr 80px 1fr 80px 80px"><span>Event</span><span>Round</span><span>Side</span><span>Judge</span><span>Result</span><span>Speaks</span></div>
      ${rounds.map(r => {
        const last = (r.scores||[]).slice().reverse().find(s => s && (s.win!=null || s.points!=null)) || {};
        const result = last.win===true||last.win==='W'||last.win===1 ? 'W'
                     : last.win===false||last.win==='L'||last.win===0 ? 'L' : '—';
        const cls = result==='W'?'w':result==='L'?'l':'';
        return `
          <div class="tr-row" style="grid-template-columns:80px 1fr 80px 1fr 80px 80px;cursor:default">
            <span class="tr-cell b">${escapeHTML(r.event||'')}</span>
            <span class="tr-cell">${escapeHTML(r.round||'')}</span>
            <span class="tr-cell">${escapeHTML(r.side||'')}</span>
            <span class="tr-cell">${escapeHTML(r.judge||'')}</span>
            <span class="pt-result ${cls}">${result}</span>
            <span class="tr-cell mono">${last.points!=null?escapeHTML(String(last.points)):'—'}</span>
          </div>`;
      }).join('')}
    </div>
  `;
}

// TOC tournament (clicked from the "Tournaments" all-list table). Shows event
// tabs, then results (past) or threats (upcoming) per event.
async function showTocTournDetail(tournId){
  $('t-list-view').style.display='none';
  $('t-pairings-view').style.display='none';
  $('t-detail-view').style.display='block';
  window.scrollTo(0,0);
  $('td-title').textContent = 'Loading…';
  $('td-sub').textContent = '';
  $('td-evt-tabs').innerHTML = '';
  $('td-content').innerHTML = `<div class="empty"><b>Loading tournament…</b></div>`;

  const data = await fetchJSON(`/api/toc/tournaments/${encodeURIComponent(tournId)}`);
  if(!data || !data.tournament){
    $('td-content').innerHTML = `<div class="empty"><b>Not found</b></div>`;
    return;
  }
  const t = data.tournament;
  // Event abbrs we care about
  const events = (data.events || []).filter(e => /^(LD|PF|CX)$/i.test(String(e.abbr||'').trim()));
  state.tocDetail = { tournament: t, events, tournId };
  $('td-title').textContent = t.name || 'Tournament';
  const where = [t.city, t.state].filter(Boolean).join(', ');
  $('td-sub').textContent = `${fmtDateRange(t.startDate, t.endDate)}${where?` · ${where}`:''}`;

  if(!events.length){
    $('td-content').innerHTML = `<div class="empty"><b>No LD/PF/CX events</b>This tournament has no LD, PF, or CX events indexed.</div>`;
    return;
  }
  const order = { CX:0, LD:1, PF:2 };
  events.sort((a,b) => (order[a.abbr.toUpperCase()] ?? 9) - (order[b.abbr.toUpperCase()] ?? 9));
  $('td-evt-tabs').innerHTML = events.map((e,i) =>
    `<button class="rank-tab${i===0?' on':''}" data-evt="${escapeHTML(e.abbr)}">${escapeHTML(e.abbr.toUpperCase())}</button>`
  ).join('');
  $$('#td-evt-tabs .rank-tab').forEach(btn => btn.addEventListener('click', ()=>{
    $$('#td-evt-tabs .rank-tab').forEach(x => x.classList.remove('on'));
    btn.classList.add('on');
    loadTocEventContent(btn.dataset.evt);
  }));
  loadTocEventContent(events[0].abbr);
}

async function loadTocEventContent(eventAbbr){
  const det = state.tocDetail;
  if(!det) return;
  state.tocDetail.currentEvent = eventAbbr;
  $('td-content').innerHTML = `<div class="empty"><b>Loading…</b></div>`;
  const t = det.tournament;
  const isUpcoming = t.endDate && (Date.parse(t.endDate + 'T23:59:59') > Date.now());
  if(isUpcoming){
    const data = await fetchJSON(`/api/toc/tournaments/${encodeURIComponent(det.tournId)}/threats/${encodeURIComponent(eventAbbr)}`);
    renderThreats((data && data.threats) || [], eventAbbr);
  } else {
    const data = await fetchJSON(`/api/toc/tournaments/${encodeURIComponent(det.tournId)}/results/${encodeURIComponent(eventAbbr)}`);
    renderResults((data && data.results) || [], eventAbbr);
  }
}

function renderResults(rows, eventAbbr){
  if(!rows.length){
    $('td-content').innerHTML = `<div class="empty"><b>No results</b>Results aren't published for this event yet.</div>`;
    return;
  }
  const html = `
    <div class="tres-table tres-results">
      <div class="tr-head"><span>Place</span><span>Team</span><span>Prelim</span><span>Elim</span><span>Bid</span></div>
      ${rows.map(r => {
        const place = placeLabel(r);
        const bid   = bidLabel(r.earnedBid);
        const bcls  = bidClass(bid);
        const prelim = (r.prelimWins!=null && r.prelimLosses!=null) ? `${r.prelimWins}–${r.prelimLosses}` : '—';
        const elim   = (r.elimWins!=null && r.elimLosses!=null) ? `${r.elimWins}–${r.elimLosses}` : '—';
        const dbs = debaterNames(r);
        return `
          <div class="tr-row" data-eid="${escapeHTML(String(r.entryId||''))}" data-evt="${escapeHTML(eventAbbr)}">
            <span class="tr-place">${escapeHTML(place)}</span>
            <div class="tr-team"><span class="nm">${escapeHTML(r.displayName||'')}</span>${dbs?`<span class="sch">${escapeHTML(dbs)}</span>`:`<span class="sch">${escapeHTML(r.schoolName||'')}</span>`}</div>
            <span class="tr-cell mono">${prelim}</span>
            <span class="tr-cell mono">${elim}</span>
            <span class="tr-bid ${bcls}">${bid || '—'}</span>
          </div>`;
      }).join('')}
    </div>`;
  $('td-content').innerHTML = html;
  $$('.tr-row[data-eid]', $('td-content')).forEach(r => {
    r.addEventListener('click', ()=> openEntryPairings(r.dataset.eid, eventAbbr));
  });
}

function renderThreats(threats, eventAbbr){
  if(!threats.length){
    $('td-content').innerHTML = `<div class="empty"><b>No threats</b>No qualifying threats indexed for this event yet.</div>`;
    return;
  }
  const html = `
    <div class="tres-table tres-threats">
      <div class="tr-head"><span>Rank</span><span>Team</span><span>Full</span><span>Partial</span><span>Bid</span></div>
      ${threats.map((t, i) => {
        const bid = bidLabel(t.earnedBid || t.maxBidLevel);
        const bcls = bidClass(bid);
        const dbs = debaterNames(t);
        return `
          <div class="tr-row" data-eid="${escapeHTML(String(t.entryId||''))}">
            <span class="tr-cell mono b">#${i+1}</span>
            <div class="tr-team"><span class="nm">${escapeHTML(t.displayName||'')}</span>${dbs?`<span class="sch">${escapeHTML(dbs)}</span>`:`<span class="sch">${escapeHTML(t.schoolName||'')}</span>`}</div>
            <span class="tr-cell mono">${t.seasonFullBids||0}</span>
            <span class="tr-cell mono">${t.seasonPartialBids||0}</span>
            <span class="tr-bid ${bcls}">${bid || '—'}</span>
          </div>`;
      }).join('')}
    </div>`;
  $('td-content').innerHTML = html;
  $$('.tr-row[data-eid]', $('td-content')).forEach(r => {
    r.addEventListener('click', ()=> openEntryPairings(r.dataset.eid, eventAbbr));
  });
}

// ── PAIRINGS (recursive — click an opponent to load their pairings) ──
async function openEntryPairings(entryId, eventAbbr){
  if(!entryId) return;
  $('t-list-view').style.display='none';
  $('t-detail-view').style.display='none';
  $('t-pairings-view').style.display='block';
  window.scrollTo(0,0);
  $('t-pair-name').textContent = 'Loading…';
  $('t-pair-sub').textContent = '';
  $('t-pair-stats').innerHTML = '';
  $('t-pair-rounds').innerHTML = `<div class="empty"><b>Loading pairings…</b></div>`;
  // Back stack lets us return through chained pairings views
  state.pairBack = state.pairBack || [];
  if(state.tocDetail) {
    $('t-pair-back-lbl').textContent = `Back to ${state.tocDetail.tournament.name || 'tournament'}`;
  }

  const data = await fetchJSON(`/api/toc/entries/${encodeURIComponent(entryId)}/pairings`);
  if(!data || !data.entry){
    $('t-pair-name').textContent = 'Entry not found';
    $('t-pair-rounds').innerHTML = `<div class="empty"><b>No data</b></div>`;
    return;
  }
  const e = data.entry;
  // Drop rounds with no opponent unless explicitly a bye.
  const allPairings = data.pairings || [];
  const pairings = allPairings.filter(p => {
    const isBye = /bye/i.test(p.opponentName||'') || p.bye === true;
    if(isBye) return true;
    return !!(p.opponentName || p.opponentEntryId);
  });
  $('t-pair-name').textContent = e.displayName || 'Entry';
  const evtLbl = eventAbbr || e.eventAbbr || '';
  $('t-pair-sub').textContent = `${e.schoolName||''}${evtLbl?` · ${evtLbl}`:''}${e.schoolCode?` · ${e.schoolCode}`:''}`;

  // Stats — toc_ballots stores 4 roundType values:
  //   prelim   = high-high prelim (rounds 1-2)
  //   highlow  = high-low prelim (rounds 3-N) — still prelim, just paired differently
  //   elim     = bracket elim
  //   final    = grand finals
  const isPrelim = (p) => p.roundType === 'prelim' || p.roundType === 'highlow';
  const isElim   = (p) => p.roundType === 'elim'   || p.roundType === 'final';
  const wins = pairings.filter(p => p.result === 'W').length;
  const losses = pairings.filter(p => p.result === 'L').length;
  const prelimW = pairings.filter(p => isPrelim(p) && p.result==='W').length;
  const prelimL = pairings.filter(p => isPrelim(p) && p.result==='L').length;
  const elimW   = pairings.filter(p => isElim(p)   && p.result==='W').length;
  const elimL   = pairings.filter(p => isElim(p)   && p.result==='L').length;
  const avgSpk = (() => {
    const vals = pairings.map(p => p.speakerPoints).filter(v => v != null);
    return vals.length ? (vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(1) : '—';
  })();
  $('t-pair-stats').innerHTML = `
    <div class="pp-stat"><div class="lab">Record</div><div class="val">${wins}–${losses}</div></div>
    <div class="pp-stat"><div class="lab">Prelim</div><div class="val">${prelimW}–${prelimL}</div></div>
    <div class="pp-stat"><div class="lab">Elim</div><div class="val">${elimW}–${elimL}</div></div>
    <div class="pp-stat"><div class="lab">Avg speaks</div><div class="val">${avgSpk}</div></div>
  `;

  if(!pairings.length){
    $('t-pair-rounds').innerHTML = `<div class="empty"><b>No pairings</b>Pairings haven't been crawled for this entry.</div>`;
    return;
  }
  $('t-pair-rounds').innerHTML = `
    <div class="pair-table">
      <div class="pt-head"><span>Round</span><span>Side</span><span>Opponent</span><span>Judge</span><span>Result</span><span>Speaks</span></div>
      ${pairings.map(p => {
        const sideCls = (p.side||'').toLowerCase()==='aff' ? 'aff' : (p.side||'').toLowerCase()==='neg' ? 'neg' : '';
        const resCls  = p.result === 'W' ? 'w' : p.result === 'L' ? 'l' : '';
        const oppDbs  = debaterNames(p);
        // Panel rendering: "WWL" / "LWW" etc. when there's more than one ballot.
        const ballots = Array.isArray(p.ballotResults) ? p.ballotResults : [];
        const resultDisplay = ballots.length > 1
          ? ballots.map(b => String(b||'').toUpperCase().charAt(0) || '—').join('')
          : (p.result || '—');
        return `
          <div class="pt-row">
            <span class="pt-round">${escapeHTML(roundLabel(p))}</span>
            <span class="pt-side ${sideCls}">${escapeHTML(p.side||'—')}</span>
            <div class="pt-opp" data-opp-eid="${escapeHTML(String(p.opponentEntryId||''))}">
              <div class="nm">${escapeHTML(p.opponentName||'—')}</div>
              ${oppDbs?`<div class="sch">${escapeHTML(oppDbs)}</div>`:p.opponentSchool?`<div class="sch">${escapeHTML(p.opponentSchool)}</div>`:''}
            </div>
            <span class="pt-judge">${escapeHTML(p.judgeName||'—')}</span>
            <span class="pt-result ${resCls}">${escapeHTML(resultDisplay)}</span>
            <span class="pt-pts">${p.speakerPoints!=null?escapeHTML(Number(p.speakerPoints).toFixed(1)):'—'}</span>
          </div>`;
      }).join('')}
    </div>
  `;
  $$('.pt-opp[data-opp-eid]', $('t-pair-rounds')).forEach(el => {
    const oid = el.dataset.oppEid;
    if(!oid || oid === '0') return;
    el.addEventListener('click', ()=> openEntryPairings(oid, evtLbl));
  });
}

/* ── RANKINGS ───────────────────────────────────────────── */
function bindRankingsControls(){
  $$('#format-tabs .rank-tab').forEach(b => b.addEventListener('click', ()=>{
    $$('#format-tabs .rank-tab').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    state.rankings.event = b.dataset.fmt;
    TWEAKS.format = b.dataset.fmt.toLowerCase(); persistTweaks();
    loadRankings();
  }));
  const qIn = $('rank-q');
  if(qIn) qIn.addEventListener('input', debounce(()=> loadRankings($('rank-q').value.trim()), 220));
}
async function loadRankings(query){
  // sync tab state
  $$('#format-tabs .rank-tab').forEach(x => x.classList.toggle('on', x.dataset.fmt===state.rankings.event));
  const seasonsResp = await fetchJSON('/api/rankings/seasons');
  const seasonsList = (seasonsResp && seasonsResp.seasons) || [];
  const season = seasonsList.length ? (seasonsList[0].season || seasonsList[0]) : null;
  if(!season){
    $('lb-body').innerHTML = `<div class="empty"><b>No rankings yet</b>Rankings will appear once TOC ratings are computed (POST /api/toc/reindex).</div>`;
    return;
  }
  state.rankings.season = season;
  $('rank-eyebrow').textContent = `National Circuit · ${season} · ${state.rankings.event}`;
  $('lb-body').innerHTML = `<div class="empty"><b>Loading…</b></div>`;
  const q = (query!=null ? query : ($('rank-q')?.value || '')).trim();
  const url = `/api/rankings?event=${encodeURIComponent(state.rankings.event)}&season=${encodeURIComponent(season)}&page=1${q?`&q=${encodeURIComponent(q)}`:''}`;
  const data = await fetchJSON(url);
  state.rankings.rows = (data && data.rows) || [];
  renderRankings();
}
function renderRankings(){
  const body = $('lb-body');
  if(!state.rankings.rows.length){
    body.innerHTML = `<div class="empty"><b>No teams ranked</b>Try a different format or season.</div>`;
    return;
  }
  body.innerHTML = state.rankings.rows.slice(0,50).map((r, i) => {
    const rk = (r.rank!=null ? r.rank : i+1);
    const rkClass = rk===1?'gold':rk===2?'silver':rk===3?'bronze':'';
    const name = r.displayName || r.shortName || r.teamKey || 'Team';
    const school = r.schoolName || '';
    const elo = r.rating!=null ? Math.round(r.rating) : '—';
    const wins = r.wins!=null?r.wins:0;
    const losses = r.losses!=null?r.losses:0;
    const delta = r.delta30d;
    let trendHtml = '<span class="lb-trend">—</span>';
    if(delta != null && delta !== 0){
      const up = delta > 0;
      const arrow = up
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 12l7-7 7 7M12 5v14"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 12l7 7 7-7M12 19V5"/></svg>';
      trendHtml = `<span class="lb-trend${up?'':' down'}">${arrow}${up?'+':''}${delta}</span>`;
    } else if(delta === 0){
      trendHtml = '<span class="lb-trend" style="color:var(--muted)">0</span>';
    }
    return `
      <div class="lb-row" data-team="${escapeHTML(r.teamKey||'')}">
        <span class="lb-rank ${rkClass}">${String(rk).padStart(2,'0')}</span>
        <div class="lb-team"><div><div class="name">${escapeHTML(name)}</div>${school?`<div class="school">${escapeHTML(school)}</div>`:''}</div></div>
        <span class="lb-elo">${escapeHTML(String(elo))}</span>
        ${trendHtml}
        <span class="lb-record">${wins}–${losses}</span>
      </div>`;
  }).join('');
  $$('.lb-row[data-team]', body).forEach(el => el.addEventListener('click', ()=> openTeamProfile(el.dataset.team)));
}
async function openTeamProfile(teamKey){
  if(!teamKey) return;
  go('team');
  $('tp-name').textContent = 'Loading…';
  $('tp-school').textContent = '';
  $('tp-rank').textContent = '—';
  $('tp-stats').innerHTML = '';
  $('tp-tourns').innerHTML = '';
  $('tp-elo-chart').innerHTML = '';
  // Make sure we have a season loaded; the rankings route 400s without it.
  if(!state.rankings.season){
    const seasonsResp = await fetchJSON('/api/rankings/seasons');
    const list = (seasonsResp && seasonsResp.seasons) || [];
    if(list.length) state.rankings.season = list[0].season || list[0];
  }
  if(!state.rankings.season){
    $('tp-name').textContent = 'No rankings season';
    $('tp-school').textContent = 'TOC ratings are not yet computed.';
    return;
  }
  const evt = state.rankings.event;
  const season = state.rankings.season;
  const profileUrl = `/api/rankings/${encodeURIComponent(teamKey)}?event=${encodeURIComponent(evt)}&season=${encodeURIComponent(season)}`;
  const historyUrl = `/api/rankings/${encodeURIComponent(teamKey)}/history?event=${encodeURIComponent(evt)}&season=${encodeURIComponent(season)}`;
  const [p, h] = await Promise.all([ fetchJSON(profileUrl), fetchJSON(historyUrl) ]);
  if(!p || p.error){
    $('tp-name').textContent = 'Team not found';
    $('tp-school').textContent = (p && p.error) || `Couldn't load ${teamKey}.`;
    return;
  }
  // The profile() endpoint returns nested objects:
  //   rating: {current, peak, avgSpeakerPoints, rank, outOf}
  //   bids:   {fullBids, partialBids}
  //   tournaments: [{prelimWins, prelimLosses, elimWins, elimLosses, earnedBid, ...}]
  const rating = p.rating || {};
  const bids   = p.bids   || {};
  $('tp-name').textContent = p.displayName || p.shortName || teamKey;
  $('tp-school').textContent = `${p.schoolName||''} · ${evt} · ${season}`;
  $('tp-tourn-lbl').textContent = `Tournaments · ${season}`;
  $('tp-rank').innerHTML = rating.rank!=null
    ? `#${rating.rank}<span class="of">${rating.outOf?`of ${rating.outOf}`:''}</span>`
    : '—';

  const ts = p.tournaments || [];
  const elo  = (typeof rating.current === 'number') ? Math.round(rating.current) : '—';
  // Derive prelim/elim splits from per-tournament records.
  let prelimW = 0, prelimL = 0, elimW = 0, elimL = 0;
  for(const t of ts){
    prelimW += t.prelimWins   || 0;
    prelimL += t.prelimLosses || 0;
    elimW   += t.elimWins     || 0;
    elimL   += t.elimLosses   || 0;
  }
  const fullBids    = bids.fullBids    || 0;
  const partialBids = bids.partialBids || 0;
  const avgSpeaks   = (typeof rating.avgSpeakerPoints === 'number')
    ? rating.avgSpeakerPoints.toFixed(1) : '—';

  $('tp-stats').classList.remove('eight');
  $('tp-stats').classList.add('six');
  $('tp-stats').innerHTML = `
    <div class="pp-stat"><div class="lab">Elo</div><div class="val">${elo}</div></div>
    <div class="pp-stat"><div class="lab">Prelim</div><div class="val">${prelimW}–${prelimL}</div></div>
    <div class="pp-stat"><div class="lab">Elim</div><div class="val">${elimW}–${elimL}</div></div>
    <div class="pp-stat"><div class="lab">Tournaments</div><div class="val">${ts.length}</div></div>
    <div class="pp-stat"><div class="lab">Avg speaks</div><div class="val">${avgSpeaks}</div></div>
    <div class="pp-stat"><div class="lab">Bids</div><div class="val">${fullBids+partialBids}<span style="font:500 11px/1 var(--font-mono);color:var(--muted);margin-left:4px">${fullBids}F·${partialBids}P</span></div></div>
  `;

  // Elo chart from history
  renderEloChart((h && h.history) || []);

  // Tournament history table — no Date column
  if(!ts.length){
    $('tp-tourns').innerHTML = `<div class="empty"><b>No tournaments</b>This team has no tournament records for the current season.</div>`;
    return;
  }
  $('tp-tourns').innerHTML = `
    <div class="tres-table">
      <div class="tr-head" style="grid-template-columns:1.6fr 90px 90px 100px 70px"><span>Tournament</span><span>Prelim</span><span>Elim</span><span>Place</span><span>Bid</span></div>
      ${ts.map(t => {
        const place = placeLabel(t);
        const bid   = bidLabel(t.earnedBid);
        const bcls  = bidClass(bid);
        return `
          <div class="tr-row" style="grid-template-columns:1.6fr 90px 90px 100px 70px;cursor:default">
            <div class="tr-team"><span class="nm">${escapeHTML(t.name||t.tournamentName||'—')}</span></div>
            <span class="tr-cell mono">${(t.prelimWins!=null && t.prelimLosses!=null)?`${t.prelimWins}–${t.prelimLosses}`:'—'}</span>
            <span class="tr-cell mono">${(t.elimWins!=null && t.elimLosses!=null)?`${t.elimWins}–${t.elimLosses}`:'—'}</span>
            <span class="tr-place">${escapeHTML(place)}</span>
            <span class="tr-bid ${bcls}">${bid || '—'}</span>
          </div>`;
      }).join('')}
    </div>
  `;
}

function renderEloChart(history){
  const root = $('tp-elo-chart');
  if(!history || !history.length){
    root.innerHTML = `<div class="empty" style="padding:30px 0"><b>No Elo history</b>History will appear once rounds are crawled.</div>`;
    return;
  }
  const pts = history.filter(h => h.ratingAfter!=null).map(h => Number(h.ratingAfter));
  if(pts.length < 2){
    root.innerHTML = `<div class="empty" style="padding:30px 0"><b>Not enough history</b>Need at least 2 rated rounds.</div>`;
    return;
  }
  const W = 800, H = 130;
  const min = Math.min(...pts), max = Math.max(...pts);
  const span = Math.max(1, max - min);
  const xs = pts.map((_,i) => (i/(pts.length-1)) * W);
  const ys = pts.map(p => H - ((p - min)/span) * (H-10) - 5);
  const linePath = xs.map((x,i)=> `${i===0?'M':'L'}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L${W},${H} L0,${H} Z`;
  const lastX = xs[xs.length-1], lastY = ys[ys.length-1];
  root.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <path class="area" d="${areaPath}"/>
      <path class="line" d="${linePath}"/>
      <circle class="dot" cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="3.5"/>
    </svg>
  `;
}

/* ── LIBRARY ────────────────────────────────────────────── */
function bindLibraryControls(){
  // Close button on the mobile preview overlay
  const closeBtn = $('lib-pv-close');
  if (closeBtn) closeBtn.addEventListener('click', () => {
    const pane = document.querySelector('.lib-preview');
    if (pane) pane.classList.remove('is-active', 'snap-full');
  });

  // Drag handle: bottom-sheet snap behavior on mobile.
  //   start: half (translateY 50%) | drag up → full (0%) | drag down → close (100%)
  bindLibSheetDrag();

  $('lib-q').addEventListener('input', debounce(()=>{
    const q = $('lib-q').value.trim();
    if(q.length===0) loadLibrary();
    else searchLibrary(q);
  }, 250));
}
function debounce(fn, ms){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; }
async function loadLibrary(){
  const data = await fetchJSON('/api/library/cards?limit=80&hasHighlight=1');
  const items = (data && (data.items||data.cards||data.results)) || [];
  const total = (data && data.total) || items.length;
  state.libCards = items;
  renderLibList();
  $('lib-sub').textContent = `${total.toLocaleString()} card${total===1?'':'s'}`;
}
async function searchLibrary(q){
  $('lib-list').innerHTML = `<div class="empty"><b>Searching…</b></div>`;
  // Library cards endpoint accepts q directly and returns the same shape
  const data = await fetchJSON(`/api/library/cards?q=${encodeURIComponent(q)}&limit=80`);
  const items = (data && (data.items||data.cards||data.results)) || [];
  state.libCards = items;
  renderLibList();
  const total = (data && data.total) || items.length;
  $('lib-sub').textContent = `${total.toLocaleString()} match${total===1?'':'es'}`;
}
// Extract "Last 'YY" from a card's cite. Tries (in order):
//   1. card.shortCite if explicitly set
//   2. Everything before the "[" in cite (Verbatim convention: Last 'YY [Full Name; ...])
//   3. Author-token followed by year ("Smith '24", "Smith 2024", "Mahbubani 2024 —", etc.)
//   4. First chunk before any em-dash, comma, or "writes at"
//   5. First 40 chars
function shortCiteFor(card){
  if(!card) return '';
  if(card.shortCite) return String(card.shortCite).trim();
  const cite = String(card.cite || '').trim();
  if(!cite) return '';

  // 2. before "["
  const bracket = cite.match(/^([^\[]+?)\s*\[/);
  if(bracket) return bracket[1].trim();

  // 3. author + year (handles "Smith '24", "Smith 2024", quoted/unquoted)
  const yearForm = cite.match(/^([A-Z][\w'’.-]*(?:\s+(?:de|van|von|der|et al\.?|[A-Z][\w'’.-]*)){0,3})\s+(?:and|&|,)?\s*(?:in\s+)?['‘’"]?(\d{2,4})\b/);
  if(yearForm){
    const yy = yearForm[2].length === 4 ? `'${yearForm[2].slice(-2)}` : `'${yearForm[2]}`;
    return `${yearForm[1].trim()} ${yy}`;
  }

  // 4. first segment before em-dash / "writes at" / comma
  const segment = cite.split(/[—–-]|\bwrites\s+at\b|\bin\s+the\b|,/i)[0];
  if(segment && segment.length < 60) return segment.trim();

  return cite.slice(0, 40);
}

// Render a full cite with the "Last 'YY" prefix in Verbatim's "Cite" style
// (14pt bold Calibri inline) and the rest at 11pt regular.
//
// Detection works for any cite format, including those without brackets, by
// finding the FIRST year token (2- or 4-digit, optionally apostrophed) within
// the first ~50 chars. Everything up to and including that year is the
// "Last 'YY" prefix and gets bolded. Examples:
//   "Saaliq '25 [Sheikh Saaliq, AP News, …]"   → bolds "Saaliq '25"
//   "Smith 2024, NYT, 3/12/24 …"               → bolds "Smith 2024"
//   "Mahbubani 2024 — Foreign Affairs …"       → bolds "Mahbubani 2024"
//   "[No Author] 25 …"                          → bolds "[No Author] 25"
const CITE_PREFIX_STYLE = 'font-family:Calibri,sans-serif;font-size:14pt;font-weight:700';
function citeWithBoldPrefix(full /*, short*/){
  const fullStr = String(full || '').trim();
  if(!fullStr) return '';
  // Find the first year token within the leading 60 chars.
  const m = fullStr.match(/^([\s\S]{0,60}?[‘’']?\d{2,4}\b)/);
  if(m){
    const prefix = m[1];
    return `<span style="${CITE_PREFIX_STYLE}">${escapeHTML(prefix)}</span>${escapeHTML(fullStr.slice(prefix.length))}`;
  }
  return escapeHTML(fullStr);
}

function sideFromCard(c){
  // Prefer typeLabel ("Aff"/"Neg"/"K"/"DA"/...). Fallback to scope/side fields.
  const t = String(c.typeLabel||c.scope||c.side||'').toLowerCase();
  if(t.includes('aff')) return 'aff';
  if(t.includes('neg')) return 'neg';
  if(t==='k' || t.includes('kritik')) return 'k';
  return '';
}
function renderLibList(){
  const list = $('lib-list');
  if(!state.libCards.length){
    list.innerHTML = `<div class="empty"><b>No cards</b>Try a different search or cut some cards first.</div>`;
    $('lib-pv-body').innerHTML = `<div class="empty"><b>No card selected</b></div>`;
    $('lib-pv-meta').textContent = '';
    return;
  }
  list.innerHTML = state.libCards.map((c, i) => {
    const tag  = c.tag || '(untitled)';
    // List rows show ONLY the short author cite (Author 'YY). The full cite
    // appears in the preview pane.
    const cite = shortCiteFor(c);
    const date = c.createdAt || c.savedAt || c.indexedAt || '';
    const side = sideFromCard(c);
    const sideBadge = side==='aff' ? `<span class="badge aff">Aff</span>`
                    : side==='neg' ? `<span class="badge neg">Neg</span>`
                    : side==='k'   ? `<span class="badge k">K</span>` : '';
    const type = (c.typeLabel && !['aff','neg','k'].includes(c.typeLabel.toLowerCase()))
      ? `<span class="badge t" data-tag-type="${escapeHTML(c.typeLabel)}">${escapeHTML(c.typeLabel)}</span>`
      : '';
    const topic = c.topicLabel ? `<span class="badge topic">${escapeHTML(c.topicLabel)}</span>` : '';
    return `
      <div class="lib-row${i===0?' on':''}" data-idx="${i}">
        <div class="head">${sideBadge}${type}${topic}${date?`<span class="date">${escapeHTML(fmtRel(date))}</span>`:''}</div>
        <div class="tag">${escapeHTML(tag)}</div>
        ${cite?`<div class="cite">${escapeHTML(cite)}</div>`:''}
      </div>`;
  }).join('');
  $$('.lib-row', list).forEach(r => r.addEventListener('click', ()=>{
    $$('.lib-row', list).forEach(x => x.classList.remove('on'));
    r.classList.add('on');
    showLibPreview(state.libCards[Number(r.dataset.idx)]);
    // On mobile, surface the preview as a fullscreen overlay.
    if (window.matchMedia('(max-width: 767px)').matches) {
      const pane = document.querySelector('.lib-preview');
      if (pane) pane.classList.add('is-active');
    }
  }));
  if(state.libCards[0]) showLibPreview(state.libCards[0]);
}
// Render Verbatim-style body_markdown:
//   ==text==   → highlighted span
//   <u>text</u> already-HTML underline (passes through)
//   __text__   → underline
//   **text**   → bold (warrant)
//   blank line → paragraph break
// Convert Verbatim-style body_markdown to clipboard-ready HTML with INLINE
// styles so Word/Verbatim/Google Docs preserve the highlight + underline + bold
// formatting on paste. Tag is rendered as a heading. Cite below in bold.
function cardToHtml(card){
  const tag  = (card && (card.tag || card.title)) || '';
  const cite = (card && (card.cite || card.shortCite)) || '';
  const md   = (card && (card.body_markdown || card.body_plain || card.bodyText)) || '';

  const HO = String.fromCharCode(1), HC = String.fromCharCode(2);
  const UO = String.fromCharCode(3), UC = String.fromCharCode(4);
  const BO = String.fromCharCode(5), BC = String.fromCharCode(6);

  let s = String(md);
  s = s.replace(/\*\*([\s\S]+?)\*\*/g, function(_, x){ return BO + x + BC; });
  s = s.replace(/==([\s\S]+?)==/g,    function(_, x){ return HO + x + HC; });
  s = s.replace(/<u>/gi, UO).replace(/<\/u>/gi, UC);
  s = s.replace(/__([^_]+?)__/g,      function(_, x){ return UO + x + UC; });
  // HTML-escape everything else
  s = s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  // Restore real tags. mso-highlight is Word's *actual* highlighter directive
  // (the marker pen), not just paragraph shading. Without it Word imports as
  // background shading which behaves differently from highlights.
  s = s.split(HO).join('<span style="background:yellow;mso-highlight:yellow">').split(HC).join('</span>')
       .split(UO).join('<u>').split(UC).join('</u>')
       .split(BO).join('<strong>').split(BC).join('</strong>');
  const paragraphs = s.split(/\n{2,}/).map(function(p){
    return '<p style="font-family:Calibri, Arial, sans-serif; font-size:11pt; line-height:1.4; margin:0 0 8pt 0">' + p.replace(/\n/g, '<br>') + '</p>';
  }).join('');

  const escapeAttr = function(t){ return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); };
  // Verbatim convention:
  //   Tag       — Heading 4: Calibri 13pt bold
  //   Cite      — Calibri 11pt; the "Last 'YY" prefix is bold, rest normal weight, single paragraph
  //   Body      — Calibri 11pt regular
  const short = (function(){
    if(card && card.shortCite) return card.shortCite;
    const c = (card && card.cite) || '';
    const m = c.match(/^([^\[]+?)\s*\[/);
    return m ? m[1].trim() : c;
  })();
  const full = (card && card.cite) || short;
  let citeInner = '';
  if (full) {
    // Find first year token in the leading chars; everything up to it is the
    // "Last 'YY" prefix and gets the Cite character style (14pt bold).
    const ym = full.match(/^([\s\S]{0,60}?[‘’']?\d{2,4}\b)/);
    if (ym) {
      citeInner = '<span style="font-family:Calibri,Arial,sans-serif;font-size:14pt;font-weight:700">' +
                  escapeAttr(ym[1]) +
                  '</span>' + escapeAttr(full.slice(ym[1].length));
    } else {
      citeInner = escapeAttr(full);
    }
  }
  // Tag = Heading 4: Calibri 13pt bold. Cite = paragraph base 11pt regular Calibri,
  // with the "Last 'YY" prefix at 14pt bold via the inline span above.
  const tagHtml  = tag  ? '<h4 style="font-family:Calibri,Arial,sans-serif;font-size:13pt;font-weight:700;margin:0 0 2pt 0">' + escapeAttr(tag) + '</h4>' : '';
  const citeHtml = citeInner ? '<p style="font-family:Calibri,Arial,sans-serif;font-size:11pt;margin:0 0 8pt 0">' + citeInner + '</p>' : '';
  return tagHtml + citeHtml + paragraphs;
}

// Plain-text version for the text/plain clipboard slot.
function cardToPlain(card){
  const tag  = (card && (card.tag || card.title)) || '';
  const cite = (card && (card.cite || card.shortCite)) || '';
  const md   = (card && (card.body_markdown || card.body_plain || card.bodyText)) || '';
  const stripped = String(md)
    .replace(/<\/?u>/gi,'')
    .replace(/__([^_]+?)__/g,'$1')
    .replace(/\*\*([\s\S]+?)\*\*/g,'$1')
    .replace(/==([\s\S]+?)==/g,'$1');
  return [tag, cite, '', stripped].filter(Boolean).join('\n');
}

async function writeCardToClipboard(card){
  const html  = cardToHtml(card);
  const plain = cardToPlain(card);
  // Modern path: ClipboardItem with both MIME slots so Word picks up HTML.
  if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
    try {
      const item = new ClipboardItem({
        'text/html':  new Blob([html],  { type: 'text/html' }),
        'text/plain': new Blob([plain], { type: 'text/plain' }),
      });
      await navigator.clipboard.write([item]);
      return true;
    } catch (err) {
      console.warn('[clipboard] ClipboardItem failed, falling back:', err.message);
    }
  }
  // Fallback: render HTML into a hidden contenteditable and use execCommand('copy').
  try {
    const div = document.createElement('div');
    div.contentEditable = 'true';
    div.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    div.innerHTML = html;
    document.body.appendChild(div);
    const range = document.createRange();
    range.selectNodeContents(div);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand('copy');
    sel.removeAllRanges();
    div.remove();
    return true;
  } catch (err) {
    // Last-ditch plain-text fallback
    try { await navigator.clipboard.writeText(plain); return true; } catch {}
    return false;
  }
}

function renderCardBody(md){
  if(!md) return '';
  // Unique sentinel placeholders so markup survives HTML escaping.
  const HO = String.fromCharCode(1), HC = String.fromCharCode(2);
  const UO = String.fromCharCode(3), UC = String.fromCharCode(4);
  const BO = String.fromCharCode(5), BC = String.fromCharCode(6);
  let s = String(md);
  s = s.replace(/\*\*([\s\S]+?)\*\*/g, function(_, x){ return BO + x + BC; });
  s = s.replace(/==([\s\S]+?)==/g,    function(_, x){ return HO + x + HC; });
  s = s.replace(/<u>/gi, UO).replace(/<\/u>/gi, UC);
  s = s.replace(/__([^_]+?)__/g,      function(_, x){ return UO + x + UC; });
  s = escapeHTML(s);
  s = s.split(HO).join('<span class="hl">').split(HC).join('</span>')
       .split(UO).join('<span class="u">').split(UC).join('</span>')
       .split(BO).join('<span class="warrant">').split(BC).join('</span>');
  return s.split(/\n{2,}/).map(function(p){ return '<p>' + p.replace(/\n/g, '<br>') + '</p>'; }).join('');
}
async function showLibPreview(card){
  if(!card){ $('lib-pv-body').innerHTML = `<div class="empty"><b>No card selected</b></div>`; return; }
  state.libSelected = card;
  // Top meta line shows the SHORT cite — full cite goes inside the body.
  $('lib-pv-meta').textContent = shortCiteFor(card);
  // Header always renders immediately; body text is paginated separately.
  const _short = shortCiteFor(card);
  const _full  = card.cite || '';
  $('lib-pv-body').innerHTML = `
    <div style="border-bottom:1px solid var(--line);padding-bottom:14px;margin-bottom:22px">
      <h4 style="font-family:var(--font-ui);font-size:13pt;font-weight:700;color:var(--ink);margin:0 0 4px 0;line-height:1.25">${escapeHTML(card.tag||'(untitled)')}</h4>
      <div style="font-family:var(--font-ui);font-size:11pt;color:var(--ink-2);line-height:1.45">${citeWithBoldPrefix(_full || _short, _short)}</div>
    </div>
    <div id="lib-pv-loading" class="empty" style="padding:24px 0"><b>Loading body…</b></div>
  `;
  // Lite list rows don't include body_markdown — fetch the full card by id.
  let full = card;
  if(!card.body_markdown && card.id){
    const detail = await fetchJSON(`/api/library/cards/${encodeURIComponent(card.id)}`);
    if(detail && detail.card) full = detail.card;
  }
  const md = full.body_markdown || full.body_plain || '';
  const bodyHtml = renderCardBody(md);
  const loading = $('lib-pv-loading');
  if(loading){
    if(bodyHtml) loading.outerHTML = bodyHtml;
    else loading.outerHTML = '<div class="empty" style="padding:24px 0"><b>No body text</b>This card has no preview content stored.</div>';
  }
  const url = full.url || full.sourceUrl;
  if(url){ $('lib-pv-source').style.display=''; $('lib-pv-source').onclick = ()=> window.open(url, '_blank'); }
  else $('lib-pv-source').style.display='none';
  // Use the animated copy-btn helper — preserves the icon swap structure.
  // We re-wire each time showLibPreview runs so the copyFn closes over the
  // current `full` card. Mark as not-yet-wired to allow re-binding.
  const lpCopy = $('lib-pv-copy');
  lpCopy.__wired = false;
  // Replace any stale inline onclick from a previous render
  lpCopy.onclick = null;
  wireCopyBtn(lpCopy, async () => {
    const ok = await writeCardToClipboard(full);
    if (!ok) { showToast('Copy failed'); throw new Error('Copy failed'); }
  });
}

/* ── SETTINGS ───────────────────────────────────────────── */
function bindSettings(){
  $$('#set-nav button').forEach(b => b.addEventListener('click', ()=>{
    $$('#set-nav button').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    const sec = document.querySelector(`.set-section[data-sec="${b.dataset.sec}"]`);
    if(sec) sec.scrollIntoView({behavior:'smooth', block:'start'});
  }));
  $('set-link-debater').addEventListener('click', openLinkModal);
  $('signout-btn').addEventListener('click', async ()=>{
    await fetchJSON('/api/auth/logout', { method:'POST' });
    window.location.href = '/signin';
  });

  // appearance tweaks
  $$('.swatch-row[data-tweak] .swatch').forEach(s => s.addEventListener('click', ()=>{
    const k = s.parentElement.dataset.tweak;
    TWEAKS[k] = s.dataset.val;
    persistTweaks(); applyTweaks();
  }));
  $$('.rank-tabs[data-tweak] .rank-tab').forEach(b => b.addEventListener('click', ()=>{
    const k = b.parentElement.dataset.tweak;
    TWEAKS[k] = b.dataset.val;
    persistTweaks(); applyTweaks();
  }));
}
function loadSettings(){
  // already wired via loadUser/loadLinks; nothing async to do
  applyTweaks();
}
function applyTweaks(){
  document.body.className = '';
  document.body.classList.add('hl-'+(TWEAKS.highlight||'yellow'));
  $$('.swatch-row[data-tweak]').forEach(g => {
    const k = g.dataset.tweak;
    g.querySelectorAll('.swatch').forEach(s => s.classList.toggle('on', s.dataset.val===TWEAKS[k]));
  });
  $$('.rank-tabs[data-tweak]').forEach(g => {
    const k = g.dataset.tweak;
    g.querySelectorAll('.rank-tab').forEach(b => b.classList.toggle('on', b.dataset.val===TWEAKS[k]));
  });
}

/* ── LIBRARY BOTTOM-SHEET DRAG ──────────────────────────── */
function bindLibSheetDrag(){
  const pane = document.querySelector('.lib-preview');
  const handle = document.getElementById('lib-pv-handle');
  if (!pane || !handle) return;

  // Snap targets — translateY percentage of pane height. closed=100, half=50, full=0.
  let dragging = false;
  let startY = 0;
  let startPct = 50;
  let lastY = 0, lastT = 0, vy = 0;

  const currentPct = () => {
    const t = pane.style.transform;
    const m = t.match(/translateY\(([^%]+)%\)/);
    if (m) return parseFloat(m[1]);
    if (pane.classList.contains('snap-full')) return 0;
    if (pane.classList.contains('is-active')) return 50;
    return 100;
  };

  const setState = (state) => {
    // Always clear inline transform first so the class transition fires.
    pane.style.transform = '';
    pane.classList.remove('dragging');
    if (state === 'closed') {
      pane.classList.remove('is-active', 'snap-full');
    } else if (state === 'half') {
      pane.classList.add('is-active');
      pane.classList.remove('snap-full');
    } else {
      pane.classList.add('is-active', 'snap-full');
    }
  };

  const snap = (pct, velocity = 0) => {
    let target;
    if (velocity > 0.5) target = 'closed';        // fling down
    else if (velocity < -0.5) target = 'full';     // fling up
    else if (pct >= 75) target = 'closed';
    else if (pct >= 25) target = 'half';
    else target = 'full';
    setState(target);
  };

  const onDown = (e) => {
    // Drag only starts when the sheet is at least open at half — otherwise nothing to drag.
    if (!pane.classList.contains('is-active')) return;
    dragging = true;
    pane.classList.add('dragging');
    startY = (e.touches ? e.touches[0].clientY : e.clientY);
    lastY = startY; lastT = performance.now(); vy = 0;
    startPct = currentPct();
    if (e.cancelable) e.preventDefault();
  };
  const onMove = (e) => {
    if (!dragging) return;
    const y = (e.touches ? e.touches[0].clientY : e.clientY);
    const dy = y - startY;
    const dPct = (dy / window.innerHeight) * 100;
    const next = Math.max(0, Math.min(100, startPct + dPct));
    pane.style.transform = `translateY(${next}%)`;
    const now = performance.now();
    const dt = Math.max(1, now - lastT);
    vy = (y - lastY) / dt;
    lastY = y; lastT = now;
    if (e.cancelable) e.preventDefault();
  };
  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    snap(currentPct(), vy);
  };

  // Bind pointer events on the handle area (whole 24px-tall element including
  // the visual pill — generous tap target).
  handle.addEventListener('pointerdown', (e) => {
    try { handle.setPointerCapture(e.pointerId); } catch {}
    onDown(e);
  });
  handle.addEventListener('pointermove', onMove);
  const releaseUp = (e) => {
    try { handle.releasePointerCapture(e.pointerId); } catch {}
    onUp();
  };
  handle.addEventListener('pointerup', releaseUp);
  handle.addEventListener('pointercancel', releaseUp);

  // Tap-to-toggle on the handle (no drag): if user taps the handle while half-open,
  // expand to full; if full, collapse to half.
  let pressedAt = 0, pressedY = 0;
  handle.addEventListener('pointerdown', (e) => { pressedAt = Date.now(); pressedY = e.clientY; });
  handle.addEventListener('click', (e) => {
    const elapsed = Date.now() - pressedAt;
    const moved = Math.abs(e.clientY - pressedY);
    if (elapsed < 250 && moved < 6) {
      setState(pane.classList.contains('snap-full') ? 'half' : 'full');
    }
  });

  // Expose a single global helper so other places (close button, esc key) can
  // dismiss cleanly.
  window.LibSheet = { open: () => setState('half'), close: () => setState('closed'), full: () => setState('full') };
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && pane.classList.contains('is-active')) setState('closed');
  });
}

/* ── Animated Copy → Check button helper ────────────────── */
// Wires any .copy-btn so its onclick handler can return/await a copy action;
// the check icon swaps in for 1.6s then reverts.
function wireCopyBtn(btn, copyFn){
  if (!btn || btn.__wired) return;
  btn.__wired = true;
  btn.addEventListener('click', async () => {
    if (btn.classList.contains('copied')) return;
    try { await copyFn(); } catch (e) { /* leave button neutral */ return; }
    btn.classList.add('copied');
    clearTimeout(btn.__copiedT);
    btn.__copiedT = setTimeout(() => btn.classList.remove('copied'), 1600);
  });
}

/* ── LINK MODAL ─────────────────────────────────────────── */
function bindLinkModal(){
  $('team-chip').addEventListener('click', openLinkModal);
  $('lnk-close').addEventListener('click', closeLinkModal);
  $('lnk-bg').addEventListener('click', e => { if(e.target.id==='lnk-bg') closeLinkModal(); });
  $('lnk-q').addEventListener('input', debounce(searchTabroom, 280));
  $('lnk-unlink').addEventListener('click', async ()=>{
    if(!state.links[0]) return;
    await fetchJSON(`/api/me/tabroom-link/${state.links[0].id}`, { method:'DELETE' });
    state.links = [];
    renderTeamChip();
    renderLinkCurrent();
    showToast('Unlinked');
    if(state.pageNow==='today') loadToday();
    if(state.pageNow==='tournaments') loadTournaments();
  });
  document.addEventListener('keydown', e => { if(e.key==='Escape' && $('lnk-bg').classList.contains('on')) closeLinkModal(); });
}
function openLinkModal(){
  $('lnk-bg').classList.add('on');
  $('lnk-q').value = '';
  $('lnk-list').innerHTML = `<div class="lnk-empty">Type a team code to search Tabroom.</div>`;
  renderLinkCurrent();
  setTimeout(()=>$('lnk-q').focus(), 30);
}
function closeLinkModal(){ $('lnk-bg').classList.remove('on'); }
function renderLinkCurrent(){
  const wrap = $('lnk-current-wrap');
  const cur = state.links[0];
  if(cur){
    wrap.style.display='flex';
    $('lnk-cur-nm').textContent = `${cur.teamCode}${cur.schoolName?' · '+cur.schoolName:''}`;
    $('lnk-cur-sc').textContent = `Linked ${fmtRel(cur.createdAt)}`;
  } else {
    wrap.style.display='none';
  }
}
async function searchTabroom(){
  const q = $('lnk-q').value.trim();
  if(q.length < 1){
    $('lnk-list').innerHTML = `<div class="lnk-empty">Type a team code or school name.</div>`;
    return;
  }
  $('lnk-list').innerHTML = `<div class="lnk-empty">Searching…</div>`;
  // Server matches against teamCode OR schoolName when only one field is given
  const data = await fetchJSON('/api/me/tabroom-link', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ teamCode: q }) });
  const matches = (data && data.matches) || [];
  if(!matches.length){
    $('lnk-list').innerHTML = `<div class="lnk-empty">No matches for <b>${escapeHTML(q)}</b>.</div>`;
    return;
  }
  $('lnk-list').innerHTML = matches.slice(0,50).map((m, i) => `
    <div class="lnk-row" data-i="${i}">
      <span class="av">${escapeHTML(initials(m.schoolName||m.teamCode))}</span>
      <div>
        <div class="nm">${escapeHTML(m.teamCode)}${m.schoolName?` <span style="color:var(--muted);font-weight:500;font-size:11px">· ${escapeHTML(m.schoolName)}</span>`:''}</div>
        <div class="sc">${escapeHTML((m.events||[]).map(e=>e.abbr||e.name).join(' · '))}</div>
      </div>
      <div class="meta"><b>Link</b></div>
    </div>
  `).join('');
  $$('.lnk-row', $('lnk-list')).forEach(row => row.addEventListener('click', async ()=>{
    const m = matches[Number(row.dataset.i)];
    const r = await fetchJSON('/api/me/tabroom-link/confirm', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ teamCode: m.teamCode, schoolName: m.schoolName }) });
    if(r && r.link){
      state.links = [r.link];
      renderTeamChip();
      showToast('Linked '+m.teamCode);
      closeLinkModal();
      if(state.pageNow==='today') loadToday();
      if(state.pageNow==='tournaments') loadTournaments();
    }
  }));
}

/* ── COMMAND PALETTE ────────────────────────────────────── */
function bindCommandPalette(){
  const bg = $('cmd-bg'), inp = $('cmd-in'), list = $('cmd-list');
  const items = ()=> [...list.querySelectorAll('.cmd-item:not([hidden])')];
  const trig = $('cmd-trigger');
  if (trig) trig.addEventListener('click', ()=>{ bg.classList.add('on'); setTimeout(()=>inp.focus(),20); });
  bg.addEventListener('click', e => { if(e.target===bg) bg.classList.remove('on'); });
  document.addEventListener('keydown', e => {
    if((e.metaKey||e.ctrlKey) && e.key.toLowerCase()==='k'){ e.preventDefault(); bg.classList.toggle('on'); if(bg.classList.contains('on')) setTimeout(()=>inp.focus(),20); }
    if(e.key==='Escape') bg.classList.remove('on');
    if(bg.classList.contains('on')){
      const li = items(); let i = li.findIndex(x => x.classList.contains('sel'));
      if(e.key==='ArrowDown'){ e.preventDefault(); li.forEach(x=>x.classList.remove('sel')); li[Math.min(i+1, li.length-1)]?.classList.add('sel'); }
      if(e.key==='ArrowUp'){ e.preventDefault(); li.forEach(x=>x.classList.remove('sel')); li[Math.max(i-1,0)]?.classList.add('sel'); }
      if(e.key==='Enter'){ e.preventDefault(); const s = li[i] || li[0]; if(s && s.dataset.go){ go(s.dataset.go); bg.classList.remove('on'); } }
    }
  });
  inp.addEventListener('input', ()=>{
    const q = inp.value.toLowerCase().trim();
    list.querySelectorAll('.cmd-item').forEach(it => { it.hidden = q && !it.textContent.toLowerCase().includes(q); it.classList.remove('sel'); });
    items()[0]?.classList.add('sel');
  });
  list.querySelectorAll('.cmd-item').forEach(it => it.addEventListener('click', ()=>{ if(it.dataset.go){ go(it.dataset.go); bg.classList.remove('on'); } }));
}

/* ── RAIL + GO LINKS ────────────────────────────────────── */
function bindRail(){
  $$('.rail-btn[data-page]').forEach(b => b.addEventListener('click', ()=> go(b.dataset.page)));
  document.body.addEventListener('click', e => {
    const t = e.target.closest('[data-go]');
    if(t){ e.preventDefault(); go(t.dataset.go); }
  });
  $('tp-back').addEventListener('click', e => { e.preventDefault(); go('rankings'); });
}

/* ── CUTTER ───────────────────────────────────────────── */
function bindCutterControls(){
  $$('.cut-mode').forEach(b => b.addEventListener('click', ()=>{
    $$('.cut-mode').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    const m = b.dataset.mode;
    const inp = $('cut-q');
    if(m === 'url') inp.placeholder = 'Paste a URL — Verba scrapes it…';
    else if(m === 'pdf') inp.placeholder = 'Click upload, or drop a PDF here…';
  }));
  $('cut-go').addEventListener('click', runCutterScrape);
  $('cut-q').addEventListener('keydown', e => {
    if(e.key === 'Enter'){ e.preventDefault(); runCutterScrape(); }
  });
  $('cut-upload').addEventListener('click', ()=> $('cut-file').click());
  $('cut-file').addEventListener('change', e => {
    const file = e.target.files && e.target.files[0];
    if(file) runCutterFile(file);
  });
  $('cut-paste-go').addEventListener('click', runCutterPaste);
  $('cut-paste-cancel').addEventListener('click', ()=>{
    $('cut-paste').classList.remove('on');
    $('cut-paste-text').value = '';
    $('cut-paste-cite').value = '';
  });

  // Toolbar buttons + keyboard shortcuts
  $('cut-tool-hl').addEventListener('click', ()=> applyCutMarkup('hl'));
  $('cut-tool-u').addEventListener('click',  ()=> applyCutMarkup('u'));
  $('cut-tool-b').addEventListener('click',  ()=> applyCutMarkup('b'));
  // Verbatim-style shortcuts: Ctrl+B (bold warrant), Ctrl+U (underline),
  // Ctrl+Alt+H (highlight). These match the legacy cutter's bindings.
  document.addEventListener('keydown', (e)=>{
    if(state.pageNow !== 'cutter') return;
    const tag = (e.target && e.target.tagName) || '';
    if(tag === 'INPUT' || tag === 'TEXTAREA') return;
    const k = e.key.toLowerCase();
    const ctrl = e.ctrlKey || e.metaKey;
    if(!ctrl) return;
    if(e.altKey && k === 'h'){ e.preventDefault(); applyCutMarkup('hl'); }
    else if(!e.altKey && k === 'u'){ e.preventDefault(); applyCutMarkup('u'); }
    else if(!e.altKey && k === 'b'){ e.preventDefault(); applyCutMarkup('b'); }
  });
}

// ── Selection → body_markdown wrapping ──────────────────────────────────
// Walks the rendered DOM and the source markdown in parallel, mapping plain-text
// character offsets back to markdown indices so we can wrap the selection
// regardless of where existing ==, <u>, **, __ marks already sit.
function plainToMarkdownOffset(md, plainOffset){
  let i = 0, p = 0;
  const len = md.length;
  while(i < len && p < plainOffset){
    if(md.charCodeAt(i) === 0x3D && md.charCodeAt(i+1) === 0x3D){ i += 2; continue; } // ==
    if(md.charCodeAt(i) === 0x2A && md.charCodeAt(i+1) === 0x2A){ i += 2; continue; } // **
    if(md.charCodeAt(i) === 0x5F && md.charCodeAt(i+1) === 0x5F){ i += 2; continue; } // __
    if(md.startsWith('<u>', i))  { i += 3; continue; }
    if(md.startsWith('</u>', i)) { i += 4; continue; }
    if(md.startsWith('<U>', i))  { i += 3; continue; }
    if(md.startsWith('</U>', i)) { i += 4; continue; }
    p++;
    i++;
  }
  return i;
}
function stripMarkupForSearch(md){
  return md
    .replace(/==/g, '')
    .replace(/\*\*/g, '')
    .replace(/__/g, '')
    .replace(/<\/?u>/gi, '');
}
// Walk ONLY the body-paragraph siblings of #cut-body (skip the cite block) and
// compute the plain-text offset of (container, offset). Inserts "\n\n" between
// paragraphs so offsets line up with body_markdown paragraph breaks.
function bodyParaOffset(body, container, offset){
  const paras = [...body.children].filter(el => el.tagName === 'P');
  let plain = 0;
  let found = false;
  for (let i = 0; i < paras.length; i++) {
    if (i > 0) plain += 2; // "\n\n" between paragraphs
    const walker = document.createTreeWalker(paras[i], NodeFilter.SHOW_TEXT, null);
    let n;
    while ((n = walker.nextNode())) {
      if (n === container) { plain += offset; found = true; return { plain, found }; }
      plain += n.textContent.length;
    }
  }
  return { plain, found };
}
function applyCutMarkup(kind){
  if(!state.cutCard || !state.cutCard.body_markdown){ showToast('Run a cut first'); return; }
  const sel = window.getSelection();
  if(!sel || sel.rangeCount === 0 || sel.isCollapsed){ return; }
  const range = sel.getRangeAt(0);
  const body = $('cut-body');
  if(!body.contains(range.commonAncestorContainer)) return;
  // Bail if the selection is inside the cite-block (don't let the user wrap
  // their tag/cite by accident).
  const citeBlock = body.querySelector('.cite-block');
  if(citeBlock && citeBlock.contains(range.commonAncestorContainer)) return;

  const trimmed = sel.toString().trim();
  if(!trimmed) return;

  // Plain-text offset relative to body paragraphs only.
  const startInfo = bodyParaOffset(body, range.startContainer, range.startOffset);
  const endInfo   = bodyParaOffset(body, range.endContainer,   range.endOffset);
  if(!startInfo.found || !endInfo.found) return;
  const sP = startInfo.plain;
  const eP = endInfo.plain;
  if(eP <= sP) return;

  const md = state.cutCard.body_markdown;
  const mdStart = plainToMarkdownOffset(md, sP);
  const mdEnd   = plainToMarkdownOffset(md, eP);
  if(mdEnd <= mdStart){ showToast('Could not locate selection'); return; }

  const open  = kind === 'hl' ? '==' : kind === 'u' ? '<u>' : '**';
  const close = kind === 'hl' ? '==' : kind === 'u' ? '</u>' : '**';

  // If the selection crosses an existing markup tag boundary, the output may
  // have malformed nesting. Clean up by collapsing duplicate same-tag adjacencies
  // that can occur after wrapping (e.g. ==a== inside ==b== → ==a====b==).
  let next = md.slice(0, mdStart) + open + md.slice(mdStart, mdEnd) + close + md.slice(mdEnd);
  next = next
    .replace(/====/g, '')              // ==X== adjacent to ==Y== → drop the seam
    .replace(/\*\*\*\*/g, '')          // same for bold
    .replace(/<\/u><u>/gi, '')         // <u>X</u><u>Y</u> → <u>XY</u>
    .replace(/====<\/u>/gi, '</u>');   // tail-cleanup edge

  state.cutCard.body_markdown = next;
  rerenderCutBody();

  const btn = kind === 'hl' ? $('cut-tool-hl') : kind === 'u' ? $('cut-tool-u') : $('cut-tool-b');
  if(btn){ btn.classList.add('cut-tool-flash'); setTimeout(()=>btn.classList.remove('cut-tool-flash'), 280); }

  // Re-select the just-wrapped span so a second toolbar press (e.g. Highlight
  // then Bold) doesn't require re-selecting. Walk ONLY the body paragraphs.
  try {
    const sel = window.getSelection();
    sel.removeAllRanges();
    const paras = [...body.children].filter(el => el.tagName === 'P');
    let plain = 0, startNode = null, startOff = 0, endNode = null, endOff = 0;
    for (let i = 0; i < paras.length && !endNode; i++) {
      if (i > 0) plain += 2;
      const walker = document.createTreeWalker(paras[i], NodeFilter.SHOW_TEXT, null);
      let n;
      while ((n = walker.nextNode())) {
        const len = n.textContent.length;
        if (startNode === null && plain + len > sP) { startNode = n; startOff = sP - plain; }
        if (plain + len >= eP) { endNode = n; endOff = eP - plain; break; }
        plain += len;
      }
    }
    if (startNode && endNode) {
      const range = document.createRange();
      range.setStart(startNode, Math.max(0, Math.min(startOff, startNode.textContent.length)));
      range.setEnd(endNode, Math.max(0, Math.min(endOff, endNode.textContent.length)));
      sel.addRange(range);
    }
  } catch { /* selection restore best-effort */ }
}
function rerenderCutBody(){
  if(!state.cutCard) return;
  const body = $('cut-body');
  const cite = body.querySelector('.cite-block');
  const html = renderCardBody(state.cutCard.body_markdown || '');
  if(cite){
    while(cite.nextSibling) cite.nextSibling.remove();
    cite.insertAdjacentHTML('afterend', html);
  } else {
    body.innerHTML = html;
  }
}

function showPasteFallback(url){
  const msg = url
    ? `${new URL(url).host.replace(/^www\./,'')} blocked the scraper. Paste the article text below and Verba will run the LLM cut on it.`
    : 'Paste the article text below and Verba will run the LLM cut on it.';
  $('cut-paste-msg').textContent = msg;
  $('cut-paste-cite').value = '';
  $('cut-paste-text').value = '';
  $('cut-paste').classList.add('on');
  $('cut-paste-text').focus();
  // Stash the URL so we can attach it to the card meta after the manual cut.
  state.pasteUrl = url || '';
}

async function runCutterPaste(){
  const bodyText = $('cut-paste-text').value.trim();
  if(bodyText.length < 50){ showToast('Paste at least 50 characters'); return; }
  const cite = $('cut-paste-cite').value.trim();
  const url = state.pasteUrl || '';
  const argument = ($('cut-arg') && $('cut-arg').value || '').trim();

  termOpen('verba cut · pasted text');
  termLine('$', 'verba cut · ' + bodyText.length.toLocaleString() + ' chars');
  if (argument) termLine('→', 'argument · ' + argument.slice(0, 120));
  termLine('→', 'cut-card · selecting strongest passage');
  const cut = await runCutLLM({ argument, bodyText, cite, meta: { url, source: url ? new URL(url).host : 'pasted' } });
  if(!cut) return;
  setTimeout(termClose, 1200);
  $('cut-paste').classList.remove('on');
  showCutResult({ url, cite, bodyText, ...cut });
}

function loadCutter(){
  // Recent cuts come from /api/history (already loaded into state.history when
  // Today is visited; refresh here too in case user lands on Cutter first).
  fetchJSON('/api/history').then(data => {
    state.history = (data && data.items) || [];
    renderCutterRecent();
  });
  // Refresh the free-plan usage pill so it reflects the latest count
  // (e.g. if the user just cut from another tab/session).
  loadUsage();
}

function renderCutterRecent(){
  const root = $('cut-recent');
  const meta = $('cut-recent-meta');
  const items = (state.history || []).filter(h => h.kind === 'cut').slice(0, 8);
  if(!items.length){
    root.innerHTML = `<div class="empty" style="grid-column:1/-1"><b>No recent cuts</b>Paste a URL above to get started.</div>`;
    meta.textContent = '';
    return;
  }
  meta.textContent = `${items.length} recent`;
  root.innerHTML = items.map((it, i) => {
    const tag  = it.tag || it.title || it.query || it.url || '(untitled)';
    const cite = shortCiteFor(it) || it.author || it.host || '';
    return `
      <div class="recent-card" data-recent-idx="${i}" role="button" tabindex="0">
        <div class="head">
          <span class="when">${escapeHTML(fmtRel(it.at))}</span>
        </div>
        <div class="tag">${escapeHTML(tag)}</div>
        ${cite ? `<div class="cite">${escapeHTML(cite)}</div>` : ''}
      </div>`;
  }).join('');
  $$('.recent-card[data-recent-idx]', root).forEach(el => {
    const open = () => openRecentCut(items[Number(el.dataset.recentIdx)]);
    el.addEventListener('click', open);
    el.addEventListener('keydown', (e)=>{ if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); open(); } });
  });
}

// Open a card from the "Recently cut" rail. Prefers the saved card id (which
// lives in user_saved_cards via /api/library/cards/:id), falling back to the
// raw history entry so even pre-cardId rows still preview something.
async function openRecentCut(entry){
  if(!entry) return;
  let card = null;
  if (entry.cardId){
    try {
      const detail = await fetchJSON(`/api/library/cards/${encodeURIComponent(entry.cardId)}`);
      if (detail && detail.card) card = detail.card;
    } catch {}
  }
  if (!card){
    // Synthesize a minimal card from the history entry.
    card = {
      tag: entry.tag || entry.title || '(untitled)',
      cite: entry.cite || '',
      url: entry.url || '',
      body_markdown: '',
    };
  }
  showCutResult({ card, url: card.url || entry.url || '', cite: card.cite || entry.cite || '' });
  const cardEl = $('cut-card');
  if (cardEl) cardEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function termOpen(label){
  $('cut-term-label').textContent = label || 'verba scrape';
  $('cut-term-body').innerHTML = '';
  $('cut-term').classList.add('on');
}
function termLine(pfx, body, status){
  const line = document.createElement('div');
  line.className = 'term-line';
  const okClass = status === 'err' ? 'err' : 'ok';
  line.innerHTML = `<span class="pfx">${escapeHTML(pfx)}</span><span class="dim">${escapeHTML(body)}</span>${status?`<span class="${okClass}">${escapeHTML(status==='err'?status:'ok')}</span>`:''}`;
  $('cut-term-body').appendChild(line);
  $('cut-term-body').scrollTop = $('cut-term-body').scrollHeight;
}
function termClose(){ setTimeout(()=> $('cut-term').classList.remove('on'), 600); }

async function runCutterScrape(){
  const url = $('cut-q').value.trim();
  if(!url){ $('cut-q').focus(); return; }
  if(!/^https?:\/\//i.test(url)){ showToast('Paste a full http(s) URL'); return; }
  const argument = ($('cut-arg') && $('cut-arg').value || '').trim();

  let host = url;
  try { host = new URL(url).host.replace(/^www\./,''); } catch {}
  termOpen('verba cut · ' + host);
  await new Promise(r => setTimeout(r, 60));
  termLine('$', 'verba scrape ' + host);
  if (argument) termLine('→', 'argument · ' + argument.slice(0, 120));
  termLine('→', 'GET ' + url);

  let scraped;
  try {
    const r = await fetch('/api/scrape', {
      method:'POST',
      credentials:'same-origin',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ url }),
    });
    if(!r.ok){
      const t = await r.text().catch(()=> '');
      let parsed = {}; try { parsed = JSON.parse(t); } catch {}
      const errMsg = parsed.error || t.slice(0,200) || `HTTP ${r.status}`;
      termLine('!', errMsg, 'err');
      // Sites that block scraping → offer manual paste fallback
      if (/access denied|403|forbidden|blocked|cloudflare|paywall/i.test(errMsg) || r.status === 422 || r.status === 403) {
        termLine('→', 'falling back to manual paste');
        termClose();
        showPasteFallback(url);
        return;
      }
      showToast('Scrape failed');
      return;
    }
    scraped = await r.json();
  } catch (err) {
    termLine('!', err.message || 'scrape failed', 'err');
    termClose();
    showPasteFallback(url);
    return;
  }
  termLine('✓', 'fetched ' + (scraped.title || 'article'));
  if(scraped.author) termLine('✓', 'author · ' + scraped.author);
  if(scraped.date)   termLine('✓', 'date · ' + scraped.date);
  termLine('✓', `body · ${(scraped.bodyText||'').length.toLocaleString()} chars`);
  termLine('→', 'cut-card · selecting strongest passage');

  // Chain to LLM cut
  const cut = await runCutLLM({
    argument,
    bodyText: scraped.bodyText || '',
    cite:     scraped.cite     || '',
    meta:     {
      title:  scraped.title,
      author: scraped.author,
      date:   scraped.date,
      source: scraped.source,
      url:    scraped.url,
    },
  });
  if(!cut){ return; }
  // Hold the terminal open a beat longer so the user can read the cut summary.
  setTimeout(termClose, 1200);
  showCutResult({ ...scraped, ...cut });
}

async function runCutLLM({ bodyText, cite, meta, argument = '' }){
  if(!bodyText || bodyText.length < 50){
    termLine('!', 'body too short for LLM cut', 'err');
    showToast('Body too short to cut');
    return null;
  }
  let resp;
  try {
    resp = await fetch('/api/cut-card', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ argument, bodyText, meta, cite }),
    });
  } catch (err) {
    termLine('!', 'cut-card request failed', 'err');
    return null;
  }
  if(!resp.ok){
    const t = await resp.text().catch(()=>'');
    let msg = `${resp.status}`;
    try { const j = JSON.parse(t); msg = j.error || j.hint || msg; } catch { msg = t.slice(0,140) || msg; }
    if (resp.status === 429) {
      termLine('!', 'free plan limit reached · upgrade to keep cutting', 'err');
      showToast('Free plan: 10 cards / month reached');
      loadUsage();
      return null;
    }
    termLine('!', 'cut failed · ' + msg, 'err');
    showToast('LLM cut failed');
    return null;
  }
  const data = await resp.json();
  if(!data.card){
    termLine('!', 'no card returned', 'err');
    return null;
  }
  // Per-step lines so the user actually sees what the LLM produced.
  const tag = (data.card.tag || '').trim();
  const cardCite = (data.card.cite || data.card.shortCite || cite || '').trim();
  const md = String(data.card.body_markdown || '');
  const paras = md.split(/\n{2,}/).filter(Boolean).length;
  const wordCount = md.replace(/<\/?u>|==|\*\*/g, ' ').split(/\s+/).filter(Boolean).length;
  const hlMatch = md.match(/==[\s\S]+?==/g) || [];
  const hlWords = hlMatch.reduce((n, h) => n + h.replace(/=+/g, '').split(/\s+/).filter(Boolean).length, 0);
  const hlPct = wordCount ? Math.round((hlWords / wordCount) * 100) : 0;

  if (tag) termLine('✓', 'tag · ' + tag.slice(0, 90));
  if (cardCite) termLine('✓', 'cite · ' + cardCite.replace(/\s+/g, ' ').slice(0, 120));
  termLine('✓', `highlight · ${hlPct}% read-aloud across ${paras} paragraph${paras===1?'':'s'} (${wordCount} words)`);
  if(data.fidelity) termLine('✓', `fidelity · ${(data.fidelity.matchRate || data.fidelity.score || 0).toFixed(2)} verbatim`);
  if(data.saved && data.saved.duplicate) termLine('✓', 'duplicate · already in your library', 'done');
  else termLine('✓', 'saved to your library', 'done');
  return data;
}

async function runCutterFile(file){
  const argument = ($('cut-arg') && $('cut-arg').value || '').trim();
  termOpen('verba cut · ' + (file.name||'file'));
  termLine('$', 'verba parse ' + file.name);
  if (argument) termLine('→', 'argument · ' + argument.slice(0, 120));

  // /api/scrape/file returns a token + preview + chars; the full body is held
  // in a server-side cache and exposed via the streaming /research-source-stream
  // endpoint. For Phase 2 we use the preview text as the body for the LLM cut.
  const fd = new FormData();
  fd.append('file', file);
  let parsed;
  try {
    parsed = await fetch('/api/scrape/file', {
      method:'POST',
      credentials:'same-origin',
      body: fd,
    }).then(async r => {
      if(!r.ok){ const t = await r.text().catch(()=>''); throw new Error(`${r.status} ${t.slice(0,160)}`); }
      return r.json();
    });
  } catch (err) {
    termLine('!', err.message || 'parse failed', 'err');
    showToast('Could not read file');
    return;
  }
  termLine('✓', `parsed · ${parsed.chars?.toLocaleString()||'?'} chars`);
  termLine('✓', 'cite · ' + (parsed.cite || ''));
  termLine('→', 'cut-card · selecting strongest passage');

  const cut = await runCutLLM({
    argument,
    bodyText: parsed.preview || '',
    cite:     parsed.cite || '',
    meta:     { title: parsed.title, source: parsed.filename },
  });
  if(!cut) return;
  setTimeout(termClose, 1200);
  showCutResult({
    title:    parsed.title,
    cite:     parsed.cite,
    bodyText: parsed.preview || '',
    isPdf:    true,
    ...cut,
  });
}

function showCutResult(data){
  // A successful cut just consumed one free-plan credit on the server side.
  loadUsage();

  const card = $('cut-card');
  const body = $('cut-body');
  // LLM cut returns `card: { tag, cite, body_markdown, ... }`. Pre-cut scrape
  // returns `bodyText`. Prefer the cut output.
  const cutCard = data.card || null;
  // Stash the live card so the toolbar can mutate body_markdown.
  state.cutCard = cutCard ? { ...cutCard } : null;
  const tag   = (cutCard && cutCard.tag) || data.title || '(untitled)';
  const cite  = (cutCard && cutCard.cite) || data.cite || '';
  const url   = data.url || (cutCard && cutCard.url);
  const md    = (cutCard && (cutCard.body_markdown || cutCard.body_plain)) || '';
  const plainBody = String(data.bodyText || '').trim();

  let bodyHtml;
  if (md) {
    bodyHtml = renderCardBody(md);
  } else if (plainBody) {
    bodyHtml = plainBody.split(/\n\s*\n/).slice(0, 12).map(p => `<p>${escapeHTML(p.trim())}</p>`).join('');
  } else {
    bodyHtml = '<div class="empty" style="padding:20px 0"><b>No body text</b></div>';
  }

  // Verbatim header: tag (h4 13pt bold) → cite line (11pt with the "Last 'YY"
  // prefix in bold, rest in normal weight — single line, not two).
  const _short = shortCiteFor(cutCard || { cite });
  const _full  = cite || '';
  body.innerHTML = `
    <div class="cite-block">
      <h4 style="font-family:var(--font-ui);font-size:13pt;font-weight:700;color:var(--ink);margin:0 0 4px 0;line-height:1.25">${escapeHTML(tag)}</h4>
      <div style="font-family:var(--font-ui);font-size:11pt;color:var(--ink-2);line-height:1.45">${citeWithBoldPrefix(_full || _short, _short)}</div>
      ${data.fidelity ? `<div style="margin-top:8px;font:500 11px/1 var(--font-mono);color:var(--muted)">Fidelity ${(data.fidelity.matchRate || data.fidelity.score || 0).toFixed(2)}${data.saved?.duplicate ? ' · duplicate' : ''}</div>` : ''}
    </div>
    ${bodyHtml}
  `;
  card.classList.add('on');

  $('cut-source').onclick = url ? (()=> window.open(url, '_blank')) : null;
  $('cut-source').style.display = url ? '' : 'none';

  // Copy: write rich HTML so Verbatim/Word preserves highlight + underline + bold.
  // Animated icon swap via wireCopyBtn — preserves the SVG copy/check structure.
  const ctcBtn = $('cut-copy');
  ctcBtn.__wired = false;       // allow re-binding on each cut
  ctcBtn.onclick = null;
  wireCopyBtn(ctcBtn, async () => {
    const live = state.cutCard;
    const payload = live
      ? { tag: live.tag || tag, cite: live.cite || cite, body_markdown: live.body_markdown, body_plain: live.body_plain }
      : { tag, cite, body_plain: plainBody };
    const ok = await writeCardToClipboard(payload);
    if (!ok) { showToast('Copy failed'); throw new Error('Copy failed'); }
  });

  // Log to history (server already saved the card via saveCutCardForUser).
  fetchJSON('/api/history', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ entry: { kind:'cut', tag, cite, url, cardId: data.saved?.id, host: (function(){ try{return new URL(url||'').host}catch{return ''} })() } }),
  }).then(()=> loadCutter());

  card.scrollIntoView({ behavior:'smooth', block:'nearest' });
}

/* ── FREE-PLAN USAGE INDICATORS ─────────────────────────── */
async function loadUsage() {
  const u = await fetchJSON('/api/auth/usage');
  if (!u) return;
  applyUsagePill('usage-cutter', u.cutCard, u.tier);
  applyUsagePill('usage-chat',   u.chat,    u.tier);
}
function applyUsagePill(id, kind, tier) {
  const pill = document.getElementById(id);
  if (!pill) return;
  if (tier && tier !== 'free') {
    pill.dataset.tier = 'paid';   // hidden via CSS
    return;
  }
  delete pill.dataset.tier;
  const used = Number(kind?.used || 0);
  const limit = Number(kind?.limit || 0);
  const remaining = Math.max(0, limit - used);
  const numEl = pill.querySelector('.num');
  if (numEl) numEl.textContent = `${used} / ${limit}`;
  pill.dataset.state =
    remaining === 0 ? 'full' :
    remaining <= Math.max(2, Math.floor(limit * 0.2)) ? 'warn' :
    'ok';
}

/* Expose helpers needed by other files (chatSplitView.js etc.) */
window.wireCopyBtn = wireCopyBtn;
window.refreshUsage = loadUsage;

/* boot */
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
})();
