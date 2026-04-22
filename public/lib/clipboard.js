(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VerbaClipboard = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  function extractAuthorYearPrefix(cite) {
    if (!cite) return null;
    const m = String(cite).match(
      /^([A-Z][A-Za-z'\-]+(?:\s+(?:[A-Z][A-Za-z'\-]+|and|&|et\s+al\.?))*\s+\d{2,4})/
    );
    return m ? m[1] : null;
  }
  function splitCite(cite) {
    const s = String(cite == null ? '' : cite);
    if (!s) return { prefix: '', rest: '' };
    const prefix = extractAuthorYearPrefix(s);
    if (!prefix) return { prefix: '', rest: s };
    return { prefix, rest: s.slice(prefix.length) };
  }
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
