// public/lib/filesEditor.js
(function(global){
  'use strict';
  const API = global.API;
  let quill = null;
  let currentId = null;
  let saveTimer = null;
  let statusEl = null;

  function mkBtn(label, onclick, title) {
    const b = document.createElement('button');
    b.textContent = label;
    if (title) b.title = title;
    b.addEventListener('click', onclick);
    return b;
  }

  function buildToolbar(onBack) {
    const bar = document.getElementById('files-topbar');
    bar.innerHTML = '';
    bar.appendChild(mkBtn('← Files', () => { flushSave(); onBack(); }, 'Back to tree'));
    ['bold','italic','underline'].forEach(fmt => {
      bar.appendChild(mkBtn(fmt.charAt(0).toUpperCase(), () => {
        const cur = quill.getFormat();
        quill.format(fmt, !cur[fmt]);
      }, fmt));
    });
    const hlBtn = mkBtn('HL', () => {
      const cur = quill.getFormat();
      quill.format('background', cur.background ? false : '#00ffff');
    }, 'Highlight (cyan)');
    bar.appendChild(hlBtn);
    [1,2,3,4].forEach(h => {
      const labels = ['Pocket','Hat','Block','Tag'];
      bar.appendChild(mkBtn(labels[h-1], () => quill.format('header', h), 'H' + h));
    });
    bar.appendChild(mkBtn('•', () => quill.format('list', 'bullet'), 'Bullet list'));
    bar.appendChild(mkBtn('1.', () => quill.format('list', 'ordered'), 'Numbered list'));
    bar.appendChild(mkBtn('↶', () => quill.history.undo(), 'Undo'));
    bar.appendChild(mkBtn('↷', () => quill.history.redo(), 'Redo'));
    bar.appendChild(mkBtn('Export .docx', async () => {
      await flushSave();
      try {
        const blob = await API.docsExport(currentId);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = 'doc.docx'; a.click();
        URL.revokeObjectURL(url);
      } catch (e) { alert('Export failed: ' + e.message); }
    }, 'Export as .docx'));
    bar.appendChild(mkBtn('Copy all', () => {
      if (global.FilesClipboard && global.FilesClipboard.copyAll) {
        global.FilesClipboard.copyAll(quill.root);
      } else {
        // Fallback — select all + execCommand copy
        const sel = window.getSelection(); sel.removeAllRanges();
        const range = document.createRange(); range.selectNodeContents(quill.root);
        sel.addRange(range); document.execCommand('copy'); sel.removeAllRanges();
      }
    }, 'Copy full document'));
    statusEl = document.createElement('span');
    statusEl.className = 'files-save-status';
    statusEl.textContent = '✓ saved';
    bar.appendChild(statusEl);
  }

  function setStatus(text) { if (statusEl) statusEl.textContent = text; }

  async function open(id, onBack) {
    currentId = id;
    let data;
    try { data = await API.docsGet(id); }
    catch (e) { alert('Failed to load: ' + e.message); return; }
    buildToolbar(onBack);
    if (!quill) {
      // Register custom card-embed blot (once, on first Quill instantiation)
      if (!global.Quill.imports['formats/card-embed']) {
        const BlockEmbed = global.Quill.import('blots/block/embed');
        class CardEmbed extends BlockEmbed {
          static create(value) {
            const node = super.create();
            node.setAttribute('data-card-id', (value && value.id) || '');
            node.innerHTML = (value && value.html) || '';
            node.setAttribute('contenteditable', 'false');
            return node;
          }
          static value(node) {
            return { id: node.getAttribute('data-card-id') || '', html: node.innerHTML };
          }
        }
        CardEmbed.blotName = 'card-embed';
        CardEmbed.tagName = 'DIV';
        CardEmbed.className = 'files-card-embed';
        global.Quill.register(CardEmbed);
      }
      quill = new Quill('#files-quill', { theme: 'snow', modules: { toolbar: false, history: { userOnly: true } } });
      quill.on('text-change', (delta, old, src) => {
        if (src !== 'user') return;
        scheduleSave();
        if (global.FilesOutline && global.FilesOutline.render) {
          global.FilesOutline.render(quill.root, (t) => t.scrollIntoView({ behavior:'smooth' }));
        }
      });
    }
    quill.root.innerHTML = data.doc.contentHtml || '';
    setStatus('✓ saved');
    if (global.FilesOutline && global.FilesOutline.render) {
      global.FilesOutline.render(quill.root, (t) => t.scrollIntoView({ behavior:'smooth' }));
    }
    if (global.FilesAIPalette && global.FilesAIPalette.attach) {
      global.FilesAIPalette.attach(quill);
    }
  }

  function scheduleSave() {
    setStatus('● saving…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 1500);
  }
  async function flushSave() {
    if (!currentId || !quill) return;
    clearTimeout(saveTimer);
    try {
      await API.docsUpdate(currentId, { contentHtml: quill.root.innerHTML });
      setStatus('✓ saved');
    } catch (e) {
      setStatus('⚠ error saving');
    }
  }

  global.FilesEditor = { open };
})(window);
