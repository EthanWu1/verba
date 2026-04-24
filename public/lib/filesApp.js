// public/lib/filesApp.js
(function(global){
  'use strict';
  function show() {
    const tree = document.getElementById('files-tree-view');
    const editor = document.getElementById('files-editor-view');
    if (!tree || !editor) return;
    document.body.classList.remove('files-editing');
    editor.hidden = true;
    tree.hidden = false;
    global.FilesTree.renderTree(tree, openFile);
  }
  function openFile(id) {
    const tree = document.getElementById('files-tree-view');
    const editor = document.getElementById('files-editor-view');
    if (!tree || !editor) return;
    document.body.classList.add('files-editing');
    tree.hidden = true;
    editor.hidden = false;
    if (global.FilesEditor && global.FilesEditor.open) {
      global.FilesEditor.open(id, show);
    } else {
      // FilesEditor not yet implemented
      editor.innerHTML = '<div style="padding:20px;color:#888">Editor coming soon. Doc id: ' + id + '</div>';
    }
  }
  global.FilesApp = { show };
})(window);
