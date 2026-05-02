// public/lib/chatHistory.js
(function(global){
  'use strict';
  const API = global.API;
  let dropdown = null;
  let openAnchor = null;
  async function open(anchor) {
    // Toggle: if the menu is open and the user clicks the same trigger again,
    // just close it instead of re-opening.
    if (dropdown && openAnchor === anchor) { close(); return; }
    close();
    openAnchor = anchor;
    const { threads } = await API.chat.listThreads();
    dropdown = document.createElement('div');
    dropdown.className = 'chat-dropdown';
    const rect = anchor.getBoundingClientRect();
    dropdown.style.left = rect.left + 'px';
    dropdown.style.top  = (rect.bottom + 6 + window.scrollY) + 'px';
    dropdown.innerHTML = '<div style="font:600 11px var(--font-sans);color:#888;padding:4px 10px">Threads</div>';
    threads.forEach(t => {
      const row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = `
        <span class="row-title"></span>
        <button class="row-del" title="Delete thread" aria-label="Delete thread">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
        </button>`;
      row.querySelector('.row-title').textContent = t.title || 'Untitled';
      row.addEventListener('click', (e) => {
        if (e.target.closest('.row-del')) return; // click on trash, don't open
        close();
        global.ChatThread.openThread(t.id);
      });
      row.querySelector('.row-del').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm(`Delete thread "${t.title || 'Untitled'}"? This can't be undone.`)) return;
        try {
          await API.chat.deleteThread(t.id);
          row.remove();
          // If the deleted thread was the open one, clear the chat view.
          if (global.ChatThread && global.ChatThread.currentId && global.ChatThread.currentId() === t.id) {
            global.ChatThread.clear();
          }
        } catch (err) {
          alert('Delete failed: ' + (err.message || 'unknown'));
        }
      });
      dropdown.appendChild(row);
    });
    document.body.appendChild(dropdown);
    setTimeout(() => document.addEventListener('click', outsideClose, true), 0);
  }
  function close() { if (dropdown) { dropdown.remove(); dropdown = null; openAnchor = null; document.removeEventListener('click', outsideClose, true); } }
  function outsideClose(e) {
    // Don't close on a click on the trigger — open() handles toggle.
    if (openAnchor && openAnchor.contains(e.target)) return;
    if (dropdown && !dropdown.contains(e.target)) close();
  }
  global.ChatHistory = { open, close };
})(window);
