// public/lib/filesTree.js
(function(global){
  'use strict';
  const API = global.API;

  function el(tag, attrs = {}, children = []) {
    const e = document.createElement(tag);
    Object.entries(attrs).forEach(([k,v]) => {
      if (k === 'class') e.className = v;
      else if (k === 'style') e.setAttribute('style', v);
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (v != null) e.setAttribute(k, v);
    });
    (Array.isArray(children)?children:[children]).forEach(c => {
      if (c == null) return;
      if (typeof c === 'string') e.appendChild(document.createTextNode(c));
      else e.appendChild(c);
    });
    return e;
  }

  function byParent(rows) {
    const m = new Map();
    rows.forEach(r => {
      const k = r.parentId || '';
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(r);
    });
    return m;
  }

  async function renderTree(container, onOpen) {
    container.innerHTML = '';
    const toolbar = el('div', { class:'files-toolbar' }, [
      el('button', { onclick: () => promptCreate('folder', null, () => renderTree(container, onOpen)) }, '+ New folder'),
      el('button', { onclick: () => promptCreate('file',   null, id => { onOpen(id); renderTree(container, onOpen); }) }, '+ New file'),
    ]);
    container.appendChild(toolbar);
    let data;
    try { data = await API.docsList(); }
    catch (e) {
      container.appendChild(el('div', { style:'padding:16px;color:#c33' }, 'Failed to load files: ' + e.message));
      return;
    }
    const bp = byParent(data.docs || []);
    const root = el('div', { class:'files-tree' });
    renderLevel(root, bp, '', onOpen, container);
    if (!(data.docs || []).length) {
      root.appendChild(el('div', { style:'padding:16px;color:#888' }, 'No files yet. Click + New file to begin.'));
    }
    container.appendChild(root);
  }

  function renderLevel(parentEl, bp, parentId, onOpen, treeContainer) {
    const rows = (bp.get(parentId) || []).sort((a,b)=>a.sortOrder-b.sortOrder || a.name.localeCompare(b.name));
    rows.forEach(r => {
      const row = el('div', {
        class: 'files-row' + (r.kind === 'folder' ? ' is-folder' : ''),
        onclick: () => { if (r.kind === 'file') onOpen(r.id); else row.classList.toggle('is-open'); },
      }, [
        el('span', { class:'icon' }, r.kind === 'folder' ? '📁' : '📄'),
        el('span', {}, r.name),
        el('button', {
          class:'files-row-action',
          title:'Rename',
          onclick: (ev) => { ev.stopPropagation(); promptRename(r, () => renderTree(treeContainer, onOpen)); },
        }, '✎'),
        el('button', {
          class:'files-row-action',
          title:'Delete',
          onclick: async (ev) => { ev.stopPropagation(); if (confirm(`Delete "${r.name}"?`)) { await API.docsDelete(r.id); renderTree(treeContainer, onOpen); } },
        }, '✕'),
      ]);
      parentEl.appendChild(row);
      if (r.kind === 'folder') {
        const sub = el('div', { class:'files-subtree', style:'padding-left:18px' });
        renderLevel(sub, bp, r.id, onOpen, treeContainer);
        parentEl.appendChild(sub);
      }
    });
  }

  async function promptCreate(kind, parentId, cb) {
    const name = prompt(`New ${kind} name:`);
    if (!name) return;
    try {
      const { doc } = await API.docsCreate({ kind, name, parentId, contentHtml: kind === 'file' ? '' : null });
      cb(doc.id);
    } catch (e) {
      alert('Create failed: ' + e.message);
    }
  }

  async function promptRename(row, cb) {
    const name = prompt('Rename to:', row.name);
    if (!name || name === row.name) return;
    try {
      await API.docsUpdate(row.id, { name });
      cb();
    } catch (e) {
      alert('Rename failed: ' + e.message);
    }
  }

  global.FilesTree = { renderTree };
})(window);
