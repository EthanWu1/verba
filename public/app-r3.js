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
  tournaments:'Tournaments', rankings:'Rankings', team:'Team Profile', settings:'Settings'
};

const state = {
  user:         null,
  history:      [],
  upcoming:     [],
  pastResults:  [],
  pastShown:    10,
  links:        [],
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
  if(!e || e.toDateString()===s.toDateString()) return sm;
  const sameMonth = s.getMonth()===e.getMonth();
  const ed = sameMonth ? e.getDate() : e.toLocaleDateString(undefined,{month:'short',day:'numeric'});
  return `${sm}${sameMonth?'':' '}–${sameMonth?' ':''}${ed}, ${e.getFullYear()}`;
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
  if(p==='library') loadLibrary();
  if(p==='tournaments') loadTournaments();
  if(p==='rankings') loadRankings();
  if(p==='settings') loadSettings();
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

  await loadUser();
  await loadLinks();
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
  const [hist, upcoming, analytics] = await Promise.all([
    fetchJSON('/api/history'),
    fetchJSON('/api/me/tabroom/upcoming'),
    fetchJSON('/api/library/analytics'),
  ]);
  state.history  = (hist && hist.items) || [];
  state.upcoming = (upcoming && upcoming.tournaments) || [];
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
    const cite = it.cite || it.author || it.host || it.kind || '';
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
function renderTopicList(analytics){
  const root = $('topic-list');
  const meta = $('topic-meta');
  const topics = (analytics && analytics.topTopics) || [];
  const total  = (analytics && analytics.totals && analytics.totals.cards) || 0;
  if(!topics.length){
    root.innerHTML = `<div class="empty" style="padding:18px 0;text-align:left"><b>No topics yet</b>Tags appear after you cut cards.</div>`;
    meta.textContent = total ? `${total.toLocaleString()} cards` : '';
    return;
  }
  meta.textContent = `${total ? total.toLocaleString()+' cards across ' : ''}${topics.length} topic${topics.length===1?'':'s'}`;
  root.innerHTML = topics.slice(0,16).map(t => {
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
  const total = (analytics && analytics.totals && analytics.totals.cards) || 0;
  const week  = state.history.filter(h => h.at && (Date.now()-Date.parse(h.at) < 7*86400e3)).length;
  const today = state.history.filter(h => h.at && (Date.now()-Date.parse(h.at) < 86400e3)).length;
  const topics = (analytics && analytics.topTopics || []).length;
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
  $('t-search-q').addEventListener('input', renderPastTournaments);
  $$('#t-fmt-tabs .rank-tab').forEach(b => b.addEventListener('click', ()=>{
    $$('#t-fmt-tabs .rank-tab').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    state.pastShown = 10;
    renderPastTournaments();
  }));
  $('show-more-btn').addEventListener('click', ()=>{
    state.pastShown += 10;
    renderPastTournaments();
  });
  $('t-back').addEventListener('click', (e)=>{ e.preventDefault(); $('t-detail-view').style.display='none'; $('t-list-view').style.display='block'; window.scrollTo(0,0); });
}
async function loadTournaments(){
  const [up, past] = await Promise.all([
    fetchJSON('/api/me/tabroom/upcoming'),
    fetchJSON('/api/me/tabroom/results'),
  ]);
  state.upcoming    = (up && up.tournaments) || [];
  state.pastResults = (past && past.tournaments) || [];
  renderUpcomingGrid();
  renderPastTournaments();
  loadAllTournaments();
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
    const hay = `${t.name||''} ${t.city||''} ${t.state||''} ${(t.events||[]).map(e=>e.eventAbbr||e.eventName||'').join(' ')}`.toLowerCase();
    return hay.includes(q);
  });
  $('all-tourn-lbl').textContent = `Tournaments · ${filtered.length}`;
  if(!filtered.length){
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><b>No tournaments</b>${state.allTourns.length?'No matches for that search.':'Tournament index is empty — set TOC_AUTOSEED=1 or POST /api/toc/reindex.'}</div>`;
    $('all-show-more-row').style.display='none';
    return;
  }
  const visible = filtered.slice(0, state.allShown);
  grid.innerHTML = visible.map(t => {
    const where = [t.city, t.state].filter(Boolean).join(', ');
    const events = [...new Set((t.events||[]).map(e => e.eventAbbr || e.eventName).filter(Boolean))];
    const range = fmtDateRange(t.startDate || t.start_date, t.endDate || t.end_date);
    const isUpcoming = (t.startDate || t.start_date) && (Date.parse(t.startDate||t.start_date) > Date.now());
    return `
      <div class="tcard ${isUpcoming?'upcoming':''}" data-toc-tid="${escapeHTML(String(t.tournId||t.tourn_id||''))}">
        <div class="tcard-head">
          <div>
            <div class="name">${escapeHTML(t.name||'Tournament')}</div>
            <div class="tcard-meta" style="margin-top:6px">
              ${range?`<span><b>${escapeHTML(range)}</b></span>`:''}
              ${where?`<span>${escapeHTML(where)}</span>`:''}
              ${events.length?`<span>${escapeHTML(events.join(' · '))}</span>`:''}
            </div>
          </div>
        </div>
      </div>`;
  }).join('');
  $('all-show-more-row').style.display = filtered.length > state.allShown ? 'flex' : 'none';
}
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
    const bid = inferBid(elimRound, t.name);
    const bidClass = bid==='Gold' ? '' : bid==='Silver' ? 'silver' : 'none';
    return `
      <div class="past-card" data-tid="${escapeHTML(String(t.tournId))}">
        <div class="head">
          <div>
            <div class="name">${escapeHTML(t.name||'Tournament')}</div>
            <div class="meta">${escapeHTML(fmtDateRange(t.startDate, t.endDate))}</div>
          </div>
          <div class="when">${escapeHTML(fmtRel(t.endDate || t.startDate))}</div>
        </div>
        <div class="stats">
          <div class="stat"><div class="lab">Record</div><div class="val">${wins}–${losses}</div></div>
          <div class="stat"><div class="lab">Elim</div><div class="val">${escapeHTML(elimRound||'—')}</div></div>
          <div class="stat bid ${bidClass}"><div class="lab">Bid</div><div class="val">${escapeHTML(bid||'None')}</div></div>
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
function showTournDetail(tid){
  const t = [...state.upcoming, ...state.pastResults].find(x => String(x.tournId)===String(tid));
  if(!t) return;
  $('t-list-view').style.display='none';
  $('t-detail-view').style.display='block';
  window.scrollTo(0,0);
  $('td-title').textContent = t.name || 'Tournament';
  $('td-sub').textContent = `${fmtDateRange(t.startDate, t.endDate)}${(t.entries||[]).length?` · ${(t.entries||[]).length} entr${(t.entries||[]).length===1?'y':'ies'}`:''}`;

  const wins = (t.rounds||[]).filter(roundIsWin).length;
  const losses = (t.rounds||[]).filter(roundIsLoss).length;
  const elim = lastElimRound(t.rounds||[]);
  const bid  = inferBid(elim);
  $('td-stats').innerHTML = `
    <div class="pp-stat"><div class="lab">Record</div><div class="val">${wins}–${losses}</div></div>
    <div class="pp-stat"><div class="lab">Rounds</div><div class="val">${(t.rounds||[]).length}</div></div>
    <div class="pp-stat"><div class="lab">Elim</div><div class="val" style="font-size:16px">${escapeHTML(elim||'—')}</div></div>
    <div class="pp-stat"><div class="lab">Bid</div><div class="val" style="font-size:16px">${escapeHTML(bid||'—')}</div></div>
  `;
  const rounds = (t.rounds||[]);
  if(!rounds.length){
    $('td-rounds').innerHTML = `<div class="empty"><b>No round records</b>Tabroom hasn't published rounds for this tournament yet.</div>`;
    return;
  }
  $('td-rounds').innerHTML = rounds.map(r => {
    const last = (r.scores||[]).slice().reverse().find(s => s && (s.win!=null || s.points!=null)) || {};
    const result = last.win===true||last.win==='W'||last.win===1 ? 'W'
                 : last.win===false||last.win==='L'||last.win===0 ? 'L'
                 : '—';
    return `
      <div class="tr-row">
        <span class="tr-cell b">${escapeHTML(r.event||'')}</span>
        <span class="tr-cell">${escapeHTML(r.round||'')}</span>
        <span class="tr-cell">${escapeHTML(r.side||'')}</span>
        <span class="tr-cell">${escapeHTML(r.judge||'')}</span>
        <span class="tr-cell b">${result}</span>
      </div>`;
  }).join('');
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
}
async function loadRankings(){
  // sync tab state
  $$('#format-tabs .rank-tab').forEach(x => x.classList.toggle('on', x.dataset.fmt===state.rankings.event));
  const seasonsResp = await fetchJSON('/api/rankings/seasons');
  const seasonsList = (seasonsResp && seasonsResp.seasons) || [];
  // listSeasons returns rows like {season, ratedCount}. Pull the string.
  const season = seasonsList.length ? (seasonsList[0].season || seasonsList[0]) : null;
  if(!season){
    $('lb-body').innerHTML = `<div class="empty"><b>No rankings yet</b>Rankings will appear once TOC ratings are computed (POST /api/toc/reindex).</div>`;
    return;
  }
  state.rankings.season = season;
  $('rank-eyebrow').textContent = `National Circuit · ${season} · ${state.rankings.event}`;
  $('lb-body').innerHTML = `<div class="empty"><b>Loading…</b></div>`;
  const data = await fetchJSON(`/api/rankings?event=${encodeURIComponent(state.rankings.event)}&season=${encodeURIComponent(season)}&page=1`);
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
  $('tp-name').textContent = '—';
  $('tp-school').textContent = '';
  $('tp-stats').innerHTML = '';
  const p = await fetchJSON(`/api/rankings/${encodeURIComponent(teamKey)}?event=${state.rankings.event}&season=${encodeURIComponent(state.rankings.season)}`);
  if(!p){
    $('tp-name').textContent = 'Team not found';
    return;
  }
  $('tp-name').textContent = p.displayName || p.shortName || teamKey;
  $('tp-school').textContent = `${p.schoolName||''} · ${state.rankings.event} · ${state.rankings.season}`;
  const elo = p.rating!=null ? Math.round(p.rating) : '—';
  const wins = p.wins||p.w||0, losses = p.losses||p.l||0;
  const tournCount = (p.tournaments && p.tournaments.length) || p.tournamentCount || 0;
  $('tp-stats').innerHTML = `
    <div class="pp-stat"><div class="lab">Elo</div><div class="val">${elo}</div></div>
    <div class="pp-stat"><div class="lab">Record</div><div class="val">${wins}–${losses}</div></div>
    <div class="pp-stat"><div class="lab">Tournaments</div><div class="val">${tournCount}</div></div>
    <div class="pp-stat"><div class="lab">Rank</div><div class="val">${p.rank||'—'}</div></div>
  `;
}

/* ── LIBRARY ────────────────────────────────────────────── */
function bindLibraryControls(){
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
    const cite = c.shortCite || c.cite || '';
    const date = c.createdAt || c.savedAt || c.indexedAt || '';
    const side = sideFromCard(c);
    const sideBadge = side==='aff' ? `<span class="badge aff">Aff</span>`
                    : side==='neg' ? `<span class="badge neg">Neg</span>`
                    : side==='k'   ? `<span class="badge k">K</span>` : '';
    const type = (c.typeLabel && !['aff','neg','k'].includes(c.typeLabel.toLowerCase())) ? `<span class="badge t">${escapeHTML(c.typeLabel)}</span>` : '';
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
  }));
  if(state.libCards[0]) showLibPreview(state.libCards[0]);
}
// Render Verbatim-style body_markdown:
//   ==text==   → highlighted span
//   <u>text</u> already-HTML underline (passes through)
//   __text__   → underline
//   **text**   → bold (warrant)
//   blank line → paragraph break
function renderCardBody(md){
  if(!md) return '';
  // Strip dangerous tags but keep <u>, <strong>, <em>, <span>, <br>, <p>
  let s = String(md);
  // Convert markdown markers BEFORE escaping (we use placeholders)
  const PH = { hl:'', hlEnd:'', u:'', uEnd:'', b:'', bEnd:'' };
  s = s.replace(/==([\s\S]+?)==/g, (_,x)=> PH.hl + x + PH.hlEnd);
  s = s.replace(/<u>/g, PH.u).replace(/<\/u>/g, PH.uEnd);
  s = s.replace(/__([^_]+?)__/g, (_,x)=> PH.u + x + PH.uEnd);
  s = s.replace(/\*\*([^*]+?)\*\*/g, (_,x)=> PH.b + x + PH.bEnd);
  // Now escape everything else
  s = escapeHTML(s);
  // Restore markers
  s = s.replace(new RegExp(PH.hl,'g'),'<span class="hl">')
       .replace(new RegExp(PH.hlEnd,'g'),'</span>')
       .replace(new RegExp(PH.u,'g'),'<span class="u">')
       .replace(new RegExp(PH.uEnd,'g'),'</span>')
       .replace(new RegExp(PH.b,'g'),'<span class="warrant">')
       .replace(new RegExp(PH.bEnd,'g'),'</span>');
  // Paragraphs
  return s.split(/\n{2,}/).map(p => `<p>${p.replace(/\n/g,'<br>')}</p>`).join('');
}
function showLibPreview(card){
  if(!card){ $('lib-pv-body').innerHTML = `<div class="empty"><b>No card selected</b></div>`; return; }
  state.libSelected = card;
  $('lib-pv-meta').textContent = card.shortCite || card.cite || '';
  const md = card.body_markdown || card.body_plain || '';
  const bodyHtml = renderCardBody(md);
  $('lib-pv-body').innerHTML = `
    <div style="border-bottom:1px solid var(--line);padding-bottom:18px;margin-bottom:22px">
      <div style="font:700 22px/1.25 var(--font-display);letter-spacing:-0.02em;color:var(--ink);margin-bottom:8px">${escapeHTML(card.tag||'(untitled)')}</div>
      ${card.cite?`<div style="font:500 13px/1.5 var(--font-display);color:var(--muted)">${escapeHTML(card.cite)}</div>`:''}
    </div>
    ${bodyHtml || '<div class="empty" style="padding:24px 0"><b>No body text</b>This card has no preview content stored.</div>'}
  `;
  const url = card.url || card.sourceUrl;
  if(url){ $('lib-pv-source').style.display=''; $('lib-pv-source').onclick = ()=> window.open(url, '_blank'); }
  else $('lib-pv-source').style.display='none';
  $('lib-pv-copy').onclick = ()=>{
    const text = (card.body_plain || $('lib-pv-body').innerText || '');
    navigator.clipboard.writeText(text).then(()=>showToast('Copied to clipboard'));
  };
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
  document.body.classList.add('density-'+(TWEAKS.density||'comfy'));
  $$('.swatch-row[data-tweak]').forEach(g => {
    const k = g.dataset.tweak;
    g.querySelectorAll('.swatch').forEach(s => s.classList.toggle('on', s.dataset.val===TWEAKS[k]));
  });
  $$('.rank-tabs[data-tweak]').forEach(g => {
    const k = g.dataset.tweak;
    g.querySelectorAll('.rank-tab').forEach(b => b.classList.toggle('on', b.dataset.val===TWEAKS[k]));
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
  $('cmd-trigger').addEventListener('click', ()=>{ bg.classList.add('on'); setTimeout(()=>inp.focus(),20); });
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

/* boot */
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
})();
