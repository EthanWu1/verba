(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VerbaClipboard = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  function extractAuthorYearPrefix() { return null; }
  function splitCite() { return { prefix: '', rest: '' }; }
  function flattenInlineStyles(html) { return String(html || ''); }
  function buildCopyHtml() { return ''; }
  function buildCopyPlain() { return ''; }
  function serializeSelectionHtml() { return { html: '', plain: '' }; }

  return {
    extractAuthorYearPrefix,
    splitCite,
    flattenInlineStyles,
    buildCopyHtml,
    buildCopyPlain,
    serializeSelectionHtml,
  };
}));
