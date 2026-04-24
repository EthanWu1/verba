// public/lib/filesOutline.js
(function(global){
  'use strict';
  function render(rootEl, onJump) {
    const pane = document.getElementById('files-outline');
    if (!pane) return;
    pane.innerHTML = '';
    const headings = Array.from(rootEl.querySelectorAll('h1,h2,h3,h4'));
    if (!headings.length) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:8px;color:#888;font:500 11px/1.3 var(--font-sans)';
      empty.textContent = 'No headings yet.';
      pane.appendChild(empty);
      return;
    }
    headings.forEach(h => {
      const level = Number(h.tagName[1]);
      const item = document.createElement('div');
      item.className = 'files-outline-item lvl-' + level;
      item.textContent = h.textContent || '(empty)';
      item.style.paddingLeft = ((level - 1) * 12 + 6) + 'px';
      item.style.cursor = 'pointer';
      item.addEventListener('click', () => onJump(h));
      pane.appendChild(item);
    });
  }
  global.FilesOutline = { render };
})(window);
