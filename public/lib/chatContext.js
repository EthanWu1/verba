// public/lib/chatContext.js
(function(global){
  'use strict';
  const API = global.API;
  let dropdown = null;
  async function open(anchor) {
    close();
    const { context } = await API.chat.listContext();
    dropdown = document.createElement('div');
    dropdown.className = 'chat-dropdown';
    const rect = anchor.getBoundingClientRect();
    dropdown.style.left = rect.left + 'px';
    dropdown.style.top  = (rect.bottom + 6 + window.scrollY) + 'px';
    dropdown.innerHTML = '<div style="font:600 11px var(--font-sans);color:#888;padding:4px 10px">Context (universal)</div>';
    const upload = document.createElement('input');
    upload.type = 'file'; upload.accept = '.docx';
    upload.style.display = 'none';
    upload.addEventListener('change', async () => {
      if (!upload.files?.[0]) return;
      try { await API.chat.uploadContext(upload.files[0]); close(); open(anchor); } catch (e) { alert(e.message); }
    });
    const add = document.createElement('div');
    add.className = 'row'; add.textContent = '+ Import docx';
    add.addEventListener('click', () => upload.click());
    dropdown.appendChild(add);
    dropdown.appendChild(upload);
    context.forEach(c => {
      const row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = `${c.name} <span style="color:#999;margin-left:8px">${c.wordCount} words</span> <button style="float:right;border:none;background:transparent;cursor:pointer" data-id="${c.id}">✕</button>`;
      row.querySelector('button').addEventListener('click', async (ev) => {
        ev.stopPropagation();
        await API.chat.deleteContext(c.id); close(); open(anchor);
      });
      dropdown.appendChild(row);
    });
    document.body.appendChild(dropdown);
    setTimeout(() => document.addEventListener('click', outsideClose, true), 0);
  }
  function close() { if (dropdown) { dropdown.remove(); dropdown = null; document.removeEventListener('click', outsideClose, true); } }
  function outsideClose(e) { if (dropdown && !dropdown.contains(e.target)) close(); }
  global.ChatContext = { open, close };
})(window);
