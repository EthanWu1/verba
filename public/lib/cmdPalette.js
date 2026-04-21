/**
 * cmdPalette.js — global ⌘K action search, vanilla port of action-search-bar.tsx
 * Self-contained: injects CSS + DOM on DOMContentLoaded, binds Ctrl/Cmd+K.
 */
(function () {
  'use strict';

  const SVG = {
    search:  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>',
    send:    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>',
    plane:   '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 10h4a2 2 0 0 1 0 4h-4l-4 7h-3l2-7H5l-2 2H1l2-5-2-5h2l2 2h6L8 3h3Z"/></svg>',
    bars:    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" x2="18" y1="20" y2="10"/><line x1="12" x2="12" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="14"/></svg>',
    video:   '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 8-6 4 6 4V8Z"/><rect width="14" height="12" x="2" y="6" rx="2" ry="2"/></svg>',
    audio:   '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 10v3"/><path d="M6 6v11"/><path d="M10 3v18"/><path d="M14 8v7"/><path d="M18 5v13"/><path d="M22 10v3"/></svg>',
    globe:   '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>',
    upload:  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>',
    settings:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>',
    logout:  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/></svg>',
  };

  const ACTIONS = [
    { id:'cut',     label:'Cut a card',       icon:SVG.plane,    description:'start cutter', short:'', end:'Cutter',
      run: () => { document.querySelector('[data-page="home"]')?.click(); setTimeout(() => document.querySelector('.research-bar input,.research-bar textarea')?.focus(), 120); } },
    { id:'mine',    label:'My Library',       icon:SVG.bars,     description:'saved cards',  short:'', end:'Library',
      run: () => document.querySelector('[data-page="library"][data-lib-go="mine"]')?.click() },
    { id:'evd',     label:'Evidence Sets',    icon:SVG.video,    description:'grouped cards', short:'', end:'Library',
      run: () => document.querySelector('[data-page="library"][data-lib-go="evidence"]')?.click() },
    { id:'hist',    label:'Cut History',      icon:SVG.audio,    description:'recent',        short:'', end:'Library',
      run: () => document.querySelector('[data-page="library"][data-lib-go="history"]')?.click() },
    { id:'upload',  label:'Upload PDF or TXT',icon:SVG.upload,   description:'attach file',   short:'', end:'Action',
      run: () => { document.querySelector('[data-page="home"]')?.click(); setTimeout(() => document.getElementById('attach-btn')?.click(), 120); } },
    { id:'sett',    label:'Settings',         icon:SVG.settings, description:'preferences',   short:'', end:'Page',
      run: () => document.querySelector('[data-page="settings"]')?.click() },
    { id:'out',     label:'Log out',          icon:SVG.logout,   description:'end session',   short:'', end:'Account',
      run: () => document.querySelector('[data-act="logout"]')?.click() },
  ];

  const CSS = `
  .cmdp-backdrop{position:fixed;inset:0;z-index:9999;background:rgba(20,18,30,.42);backdrop-filter:blur(6px);display:none;opacity:0;transition:opacity .18s ease}
  .cmdp-backdrop.open{display:block;opacity:1}
  .cmdp-wrap{position:fixed;top:14vh;left:50%;transform:translateX(-50%) translateY(-8px);width:min(560px,92vw);z-index:10000;pointer-events:none;opacity:0;transition:opacity .2s ease,transform .2s ease}
  .cmdp-backdrop.open + .cmdp-wrap{opacity:1;transform:translateX(-50%) translateY(0);pointer-events:auto}
  .cmdp-label{font:500 11px/1 Inter,system-ui;color:#6b7280;margin:0 0 6px 2px;letter-spacing:.02em}
  .cmdp-input-wrap{position:relative}
  .cmdp-input{width:100%;height:40px;padding:0 36px 0 14px;border-radius:10px;border:1px solid rgba(0,0,0,.12);background:#fff;color:#111;font:500 14px Inter,system-ui;outline:none;box-shadow:0 8px 28px rgba(20,18,30,.12),0 1px 0 rgba(255,255,255,.6) inset;transition:border-color .15s,box-shadow .15s}
  .cmdp-input:focus{border-color:rgba(0,0,0,.35);box-shadow:0 0 0 3px rgba(0,0,0,.08),0 8px 28px rgba(20,18,30,.14)}
  .cmdp-ico{position:absolute;right:12px;top:50%;transform:translateY(-50%);width:16px;height:16px;color:#9ca3af;pointer-events:none}
  .cmdp-ico svg{width:16px;height:16px;display:block}
  .cmdp-ico .s1,.cmdp-ico .s2{position:absolute;inset:0;transition:transform .2s ease,opacity .2s ease}
  .cmdp-ico.q .s1{opacity:0;transform:translateY(20px)}
  .cmdp-ico.q .s2{opacity:1;transform:translateY(0)}
  .cmdp-ico .s1{opacity:1;transform:translateY(0)}
  .cmdp-ico .s2{opacity:0;transform:translateY(-20px)}
  .cmdp-panel{margin-top:8px;background:#fff;border:1px solid rgba(0,0,0,.08);border-radius:10px;overflow:hidden;box-shadow:0 18px 44px rgba(20,18,30,.16);max-height:0;opacity:0;transition:max-height .32s ease,opacity .2s ease}
  .cmdp-panel.show{max-height:420px;opacity:1}
  .cmdp-list{list-style:none;margin:0;padding:6px}
  .cmdp-item{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 10px;border-radius:8px;cursor:pointer;opacity:0;transform:translateY(10px);transition:background .12s,opacity .25s ease,transform .25s ease}
  .cmdp-panel.show .cmdp-item{opacity:1;transform:translateY(0)}
  .cmdp-panel.show .cmdp-item:nth-child(1){transition-delay:.00s}
  .cmdp-panel.show .cmdp-item:nth-child(2){transition-delay:.04s}
  .cmdp-panel.show .cmdp-item:nth-child(3){transition-delay:.08s}
  .cmdp-panel.show .cmdp-item:nth-child(4){transition-delay:.12s}
  .cmdp-panel.show .cmdp-item:nth-child(5){transition-delay:.16s}
  .cmdp-panel.show .cmdp-item:nth-child(6){transition-delay:.20s}
  .cmdp-panel.show .cmdp-item:nth-child(7){transition-delay:.24s}
  .cmdp-item:hover,.cmdp-item.active{background:#f3f4f6}
  .cmdp-left{display:flex;align-items:center;gap:10px;min-width:0}
  .cmdp-item-ico{width:16px;height:16px;flex:0 0 16px;color:#6b7280}
  .cmdp-item-ico svg{width:16px;height:16px;display:block}
  .cmdp-item.active .cmdp-item-ico,.cmdp-item:hover .cmdp-item-ico{color:#111827}
  .cmdp-item-label{font:600 13px Inter,system-ui;color:#111827;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .cmdp-item-desc{font:400 12px Inter,system-ui;color:#9ca3af}
  .cmdp-right{display:flex;align-items:center;gap:10px;flex:0 0 auto}
  .cmdp-item-short,.cmdp-item-end{font:500 11px Inter,system-ui;color:#9ca3af}
  .cmdp-foot{padding:8px 12px;border-top:1px solid #f3f4f6;display:flex;justify-content:space-between;font:500 11px Inter,system-ui;color:#6b7280}
  .cmdp-empty{padding:18px;text-align:center;font:500 12px Inter,system-ui;color:#9ca3af}
  @media (max-width:768px){ .cmdp-wrap{top:8vh;width:94vw} .cmdp-panel.show{max-height:60vh} }
  `;

  function mount() {
    if (document.getElementById('cmdp-root')) return;

    const style = document.createElement('style');
    style.id = 'cmdp-style';
    style.textContent = CSS;
    document.head.appendChild(style);

    const root = document.createElement('div');
    root.id = 'cmdp-root';
    root.innerHTML = `
      <div class="cmdp-backdrop" id="cmdp-backdrop"></div>
      <div class="cmdp-wrap" id="cmdp-wrap" role="dialog" aria-modal="true" aria-label="Command palette">
        <div class="cmdp-input-wrap">
          <input id="cmdp-input" class="cmdp-input" type="text" placeholder="What's up?" autocomplete="off" />
          <div id="cmdp-ico" class="cmdp-ico"><span class="s1">${SVG.search}</span><span class="s2">${SVG.send}</span></div>
        </div>
        <div id="cmdp-panel" class="cmdp-panel">
          <ul id="cmdp-list" class="cmdp-list"></ul>
          <div class="cmdp-foot"><span>Press Ctrl+K to open commands</span><span>ESC to cancel</span></div>
        </div>
      </div>`;
    document.body.appendChild(root);

    const backdrop = root.querySelector('#cmdp-backdrop');
    const wrap     = root.querySelector('#cmdp-wrap');
    const input    = root.querySelector('#cmdp-input');
    const icoBox   = root.querySelector('#cmdp-ico');
    const panel    = root.querySelector('#cmdp-panel');
    const list     = root.querySelector('#cmdp-list');

    let open = false;
    let query = '';
    let debouncedQuery = '';
    let debounceTimer = null;
    let activeIdx = 0;
    let filtered = ACTIONS.slice();

    function render() {
      const q = debouncedQuery.trim().toLowerCase();
      filtered = q ? ACTIONS.filter(a => a.label.toLowerCase().includes(q)) : ACTIONS.slice();
      if (activeIdx >= filtered.length) activeIdx = Math.max(0, filtered.length - 1);

      if (!filtered.length) {
        list.innerHTML = `<li class="cmdp-empty">No matches.</li>`;
      } else {
        list.innerHTML = filtered.map((a, i) => `
          <li class="cmdp-item${i === activeIdx ? ' active' : ''}" data-id="${a.id}" data-i="${i}">
            <div class="cmdp-left">
              <span class="cmdp-item-ico">${a.icon}</span>
              <span class="cmdp-item-label">${a.label}</span>
              <span class="cmdp-item-desc">${a.description || ''}</span>
            </div>
            <div class="cmdp-right">
              <span class="cmdp-item-short">${a.short || ''}</span>
              <span class="cmdp-item-end">${a.end || ''}</span>
            </div>
          </li>`).join('');
      }
    }

    function show() {
      if (open) return;
      open = true;
      backdrop.classList.add('open');
      query = ''; input.value = ''; debouncedQuery = '';
      activeIdx = 0;
      render();
      requestAnimationFrame(() => {
        panel.classList.add('show');
        input.focus();
      });
      icoBox.classList.remove('q');
    }

    function hide() {
      if (!open) return;
      open = false;
      backdrop.classList.remove('open');
      panel.classList.remove('show');
      input.blur();
    }

    function runSelected() {
      const a = filtered[activeIdx];
      if (!a) return;
      hide();
      setTimeout(() => { try { a.run(); } catch (e) { console.warn('[cmdp]', e); } }, 80);
    }

    input.addEventListener('input', e => {
      query = e.target.value;
      icoBox.classList.toggle('q', query.length > 0);
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => { debouncedQuery = query; render(); }, 160);
    });

    input.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); hide(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); if (filtered.length){ activeIdx = (activeIdx + 1) % filtered.length; render(); } }
      else if (e.key === 'ArrowUp')   { e.preventDefault(); if (filtered.length){ activeIdx = (activeIdx - 1 + filtered.length) % filtered.length; render(); } }
      else if (e.key === 'Enter')     { e.preventDefault(); runSelected(); }
    });

    list.addEventListener('click', e => {
      const li = e.target.closest('.cmdp-item');
      if (!li) return;
      activeIdx = parseInt(li.dataset.i, 10) || 0;
      runSelected();
    });
    list.addEventListener('mousemove', e => {
      const li = e.target.closest('.cmdp-item');
      if (!li) return;
      const i = parseInt(li.dataset.i, 10);
      if (i !== activeIdx) { activeIdx = i; render(); }
    });

    backdrop.addEventListener('click', hide);

    document.addEventListener('keydown', e => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        open ? hide() : show();
      }
    });

    window.VerbaCmdPalette = { open: show, close: hide, toggle: () => (open ? hide() : show()) };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
