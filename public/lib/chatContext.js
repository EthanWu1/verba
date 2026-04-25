// public/lib/chatContext.js
(function(global){
  'use strict';
  const API = global.API;
  const STORAGE_KEY = 'verba.chatContext.selected';
  const INIT_KEY = 'verba.chatContext.initialized';

  // Module-level selection state
  const selected = new Set(loadSelected());
  let initialized = localStorage.getItem(INIT_KEY) === '1';
  let modal, listEl, emptyEl, dropEl, fileInput, pasteEl, libEl, libResults, libQ, countEl, hintEl;
  let lastTrigger = null;

  function loadSelected() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
    catch { return []; }
  }
  function saveSelected() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(selected))); } catch {}
  }

  function $(id){ return document.getElementById(id); }

  function ensureWired() {
    modal = $('chat-context-modal'); if (!modal || modal.__wired) return;
    listEl = $('cc-list'); emptyEl = $('cc-empty'); dropEl = $('cc-drop');
    fileInput = $('cc-file-input'); pasteEl = $('cc-paste'); libEl = $('cc-library');
    libResults = $('cc-library-results'); libQ = $('cc-library-q');
    countEl = $('cc-list-count'); hintEl = $('cc-foot-hint');

    // Close handlers
    $('cc-close').addEventListener('click', close);
    $('cc-done').addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal.classList.contains('open')) close();
    });

    // Drop zone
    dropEl.addEventListener('click', () => fileInput.click());
    dropEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
    });
    ['dragenter','dragover'].forEach(ev => dropEl.addEventListener(ev, (e) => {
      e.preventDefault(); e.stopPropagation(); dropEl.classList.add('is-drag');
    }));
    ['dragleave','drop'].forEach(ev => dropEl.addEventListener(ev, (e) => {
      e.preventDefault(); e.stopPropagation(); dropEl.classList.remove('is-drag');
    }));
    dropEl.addEventListener('drop', (e) => {
      const files = Array.from(e.dataTransfer?.files || []);
      uploadFiles(files);
    });
    fileInput.addEventListener('change', () => {
      uploadFiles(Array.from(fileInput.files || []));
      fileInput.value = '';
    });

    // Pills
    modal.querySelectorAll('.cc-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        const a = btn.dataset.action;
        if (a === 'upload') fileInput.click();
        else if (a === 'paste') togglePaste(true);
        else if (a === 'library') toggleLibrary(true);
      });
    });

    // Paste sub-panel
    $('cc-paste-cancel').addEventListener('click', () => togglePaste(false));
    $('cc-paste-add').addEventListener('click', addPasted);

    // Library sub-panel
    let libT;
    libQ.addEventListener('input', () => {
      clearTimeout(libT);
      libT = setTimeout(() => searchLibrary(libQ.value.trim()), 220);
    });

    modal.__wired = true;
  }

  async function open(anchor) {
    lastTrigger = anchor || document.activeElement;
    ensureWired();
    togglePaste(false); toggleLibrary(false);
    modal.classList.add('open');
    await refreshList();
    setTimeout(() => $('cc-done')?.focus(), 60);
  }

  function close() {
    if (!modal) return;
    modal.classList.remove('open');
    saveSelected();
    if (lastTrigger && typeof lastTrigger.focus === 'function') {
      try { lastTrigger.focus(); } catch {}
    }
  }

  async function refreshList() {
    let context = [];
    try { ({ context } = await API.chat.listContext()); } catch (e) { context = []; }

    // Prune selection of removed items
    const ids = new Set(context.map(c => String(c.id)));
    let pruned = false;
    for (const id of Array.from(selected)) {
      if (!ids.has(String(id))) { selected.delete(id); pruned = true; }
    }
    if (pruned) saveSelected();

    // First-ever load: default all items to checked (NotebookLM behavior)
    if (!initialized && context.length) {
      context.forEach(c => selected.add(String(c.id)));
      initialized = true;
      try { localStorage.setItem(INIT_KEY, '1'); } catch {}
      saveSelected();
    }

    listEl.innerHTML = '';
    if (!context.length) {
      listEl.appendChild(emptyEl);
    } else {
      context.forEach(c => listEl.appendChild(renderRow(c)));
    }
    updateCount(context.length);
  }

  function updateCount(total) {
    const n = selected.size;
    countEl.textContent = total ? `${n}/${total} selected` : '';
    hintEl.textContent = n ? `${n} source${n === 1 ? '' : 's'} active for next message` : 'No sources active';
  }

  function renderRow(c) {
    const id = String(c.id);
    const row = document.createElement('div');
    row.className = 'cc-row';
    row.setAttribute('role', 'listitem');
    const isChecked = selected.has(id);

    row.innerHTML = `
      <span class="cc-row-icon" aria-hidden="true">${iconFor(c.kind)}</span>
      <div class="cc-row-meta">
        <div class="cc-row-name" title="${escapeHtml(c.name)}">${escapeHtml(c.name)}</div>
        <div class="cc-row-sub">${(c.wordCount||0).toLocaleString()} words${c.kind ? ' · ' + escapeHtml(c.kind) : ''}</div>
      </div>
      <button class="cc-row-del" type="button" aria-label="Remove source" data-id="${id}">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"></path></svg>
      </button>
      <label class="cc-check" aria-label="Include in next message">
        <input type="checkbox" ${isChecked ? 'checked' : ''}>
        <span class="cc-check-box" aria-hidden="true">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"><path d="M5 12l5 5L20 7"></path></svg>
        </span>
      </label>`;

    const cb = row.querySelector('input[type=checkbox]');
    const setChecked = (v) => {
      cb.checked = v;
      if (v) selected.add(id); else selected.delete(id);
      saveSelected();
      updateCount(listEl.querySelectorAll('.cc-row').length);
    };

    row.addEventListener('click', (e) => {
      if (e.target.closest('.cc-row-del') || e.target.closest('.cc-check')) return;
      setChecked(!cb.checked);
    });
    cb.addEventListener('change', () => setChecked(cb.checked));
    row.querySelector('.cc-row-del').addEventListener('click', async (e) => {
      e.stopPropagation();
      try { await API.chat.deleteContext(id); selected.delete(id); saveSelected(); await refreshList(); }
      catch (err) { alert(err.message || 'delete failed'); }
    });
    return row;
  }

  function iconFor(kind) {
    if (kind === 'pdf') return '📕';
    if (kind === 'txt' || kind === 'text') return '📄';
    if (kind === 'paste') return '📝';
    if (kind === 'library') return '📚';
    return '📘';
  }

  async function uploadFiles(files) {
    if (!files || !files.length) return;
    for (const f of files) {
      try {
        const { context } = await API.chat.uploadContext(f);
        if (context && context.id) selected.add(String(context.id)); // newly uploaded → checked by default
      } catch (e) { alert(`Upload failed for ${f.name}: ${e.message || e}`); }
    }
    saveSelected();
    await refreshList();
  }

  function togglePaste(on) {
    if (!pasteEl) return;
    pasteEl.hidden = !on;
    if (on) { toggleLibrary(false); setTimeout(() => $('cc-paste-text')?.focus(), 30); }
  }
  async function addPasted() {
    const text = $('cc-paste-text').value.trim();
    if (!text) return;
    const name = ($('cc-paste-name').value.trim() || 'Pasted text') + '.txt';
    const blob = new Blob([text], { type: 'text/plain' });
    const file = new File([blob], name, { type: 'text/plain' });
    try { await API.chat.uploadContext(file); $('cc-paste-text').value = ''; $('cc-paste-name').value = ''; togglePaste(false); await refreshList(); }
    catch (e) { alert(e.message || 'paste failed'); }
  }

  function toggleLibrary(on) {
    if (!libEl) return;
    libEl.hidden = !on;
    if (on) { togglePaste(false); libQ.value = ''; libResults.innerHTML = ''; setTimeout(() => libQ.focus(), 30); }
  }
  async function searchLibrary(q) {
    if (!q) { libResults.innerHTML = ''; return; }
    try {
      const data = await API.librarySearch(q, 20);
      const cards = (data.cards || data.results || []).slice(0, 20);
      if (!cards.length) { libResults.innerHTML = '<div class="cc-lib-empty">No results.</div>'; return; }
      libResults.innerHTML = '';
      cards.forEach(card => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'cc-lib-item';
        const title = card.shortCite || card.tag || card.title || 'Card';
        const sub = (card.body || card.text || '').slice(0, 120);
        item.innerHTML = `<div class="cc-lib-title">${escapeHtml(title)}</div><div class="cc-lib-sub">${escapeHtml(sub)}</div>`;
        item.addEventListener('click', async () => {
          const text = [title, card.body || card.text || ''].filter(Boolean).join('\n\n');
          const file = new File([new Blob([text], { type:'text/plain' })], `${title.slice(0,60)}.txt`, { type:'text/plain' });
          try { await API.chat.uploadContext(file); toggleLibrary(false); await refreshList(); }
          catch (e) { alert(e.message || 'add failed'); }
        });
        libResults.appendChild(item);
      });
    } catch (e) {
      libResults.innerHTML = `<div class="cc-lib-empty">${escapeHtml(e.message || 'search failed')}</div>`;
    }
  }

  function escapeHtml(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c])); }

  function getSelectedIds() { return new Set(selected); }

  global.ChatContext = { open, close, getSelectedIds };
})(window);
