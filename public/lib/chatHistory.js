// public/lib/chatHistory.js
(function(global){
  'use strict';
  const API = global.API;
  let dropdown = null;
  async function open(anchor) {
    close();
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
      row.textContent = t.title;
      row.addEventListener('click', () => { close(); global.ChatThread.openThread(t.id); });
      dropdown.appendChild(row);
    });
    document.body.appendChild(dropdown);
    setTimeout(() => document.addEventListener('click', outsideClose, true), 0);
  }
  function close() { if (dropdown) { dropdown.remove(); dropdown = null; document.removeEventListener('click', outsideClose, true); } }
  function outsideClose(e) { if (dropdown && !dropdown.contains(e.target)) close(); }
  global.ChatHistory = { open, close };
})(window);
