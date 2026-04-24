// public/lib/chatSplitView.js
(function(global){
  'use strict';
  let openCard = null;

  function renderBlockHtml(block) {
    const picked = (block.pickedCardIds || []).map(id => (block.candidateCards || []).find(c => c.id === id)).filter(Boolean);
    const esc = (s) => String(s || '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
    const parts = [];
    if (block.analyticBefore) parts.push(`<p>${esc(block.analyticBefore)}</p>`);
    picked.forEach((c, i) => {
      parts.push(`<h4 style="font:700 13pt/1.3 Calibri">${esc(block.tag || c.tag)}</h4>`);
      parts.push(`<p><b>${esc(c.shortCite || '')}</b></p>`);
      parts.push(`<p>${esc(c.body_plain || '')}</p>`);
      if ((block.glueBetween || [])[i]) parts.push(`<p>${esc(block.glueBetween[i])}</p>`);
    });
    if (block.analyticAfter) parts.push(`<p>${esc(block.analyticAfter)}</p>`);
    return parts.join('\n');
  }

  function toggle(cardEl, block) {
    const pane = document.getElementById('chat-split');
    if (openCard === cardEl) { close(); return; }
    openCard = cardEl;
    document.querySelectorAll('.chat-file-card').forEach(c => c.classList.toggle('is-open', c === cardEl));
    document.getElementById('chat-split-body').innerHTML = renderBlockHtml(block);
    document.getElementById('chat-split-title').textContent = (block.tag || 'Block').slice(0, 60);
    pane.hidden = false;
    const copyBtn = document.getElementById('chat-split-copy');
    copyBtn.onclick = () => {
      const body = document.getElementById('chat-split-body');
      const html = (global.Clipboard && global.Clipboard.serializeSelectionHtmlFromString)
        ? global.Clipboard.serializeSelectionHtmlFromString(body.innerHTML, { entire: true })
        : body.innerHTML;
      navigator.clipboard.writeText(body.innerText);
      try {
        const item = new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([body.innerText], { type: 'text/plain' }),
        });
        navigator.clipboard.write([item]);
      } catch {}
    };
    document.getElementById('chat-split-close').onclick = close;
  }
  function close() {
    const pane = document.getElementById('chat-split'); pane.hidden = true;
    if (openCard) openCard.classList.remove('is-open');
    openCard = null;
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

  global.ChatSplitView = { toggle, close };
})(window);
