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
  function flattenInlineStyles(html) {
    const src = String(html == null ? '' : html);
    const FMT_TAGS = /^(u|b|strong|mark)$/i;
    const stack = [];
    let out = '';
    let i = 0;

    function currentStyle() {
      let underline = false, bold = false, highlight = false;
      for (const t of stack) {
        if (t === 'u') underline = true;
        else if (t === 'b' || t === 'strong') bold = true;
        else if (t === 'mark') highlight = true;
      }
      const parts = ['color:#000', 'font-style:normal'];
      if (highlight) parts.push('background-color:#ffff00');
      if (bold) parts.push('font-weight:700');
      if (underline) parts.push('text-decoration:underline');
      return parts.join(';');
    }

    function emit(text) {
      if (!text) return;
      if (!stack.length) { out += text; return; }
      out += `<span style="${currentStyle()}">${text}</span>`;
    }

    while (i < src.length) {
      const lt = src.indexOf('<', i);
      if (lt < 0) { emit(src.slice(i)); break; }
      emit(src.slice(i, lt));
      const gt = src.indexOf('>', lt);
      if (gt < 0) { out += src.slice(lt); break; }
      const raw = src.slice(lt + 1, gt).trim();
      const isClose = raw.startsWith('/');
      const name = (isClose ? raw.slice(1) : raw.split(/\s/)[0]).toLowerCase();
      if (FMT_TAGS.test(name)) {
        if (isClose) {
          for (let j = stack.length - 1; j >= 0; j--) {
            if (stack[j] === name) { stack.splice(j, 1); break; }
          }
        } else {
          stack.push(name);
        }
      } else {
        out += src.slice(lt, gt + 1);
      }
      i = gt + 1;
    }
    return out;
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function buildCopyHtml(card) {
    card = card || {};
    const tag = card.tag || '';
    const cite = card.cite || card.shortCite || '';
    let body = card.body_html;
    if (!body && card.body_plain) {
      body = '<p>' + esc(card.body_plain).replace(/\n+/g, '</p><p>') + '</p>';
    }
    body = flattenInlineStyles(body || '');

    const { prefix, rest } = splitCite(cite);
    let citeHtml;
    if (prefix) {
      citeHtml =
        `<span style="font-family:Calibri,Arial,sans-serif;font-size:13pt;font-weight:700;color:#000">${esc(prefix)}</span>` +
        `<span style="font-family:Calibri,Arial,sans-serif;font-size:11pt;font-weight:400;color:#000">${esc(rest)}</span>`;
    } else {
      citeHtml = `<span style="font-family:Calibri,Arial,sans-serif;font-size:11pt;font-weight:400;color:#000">${esc(cite)}</span>`;
    }

    const parts = [];
    parts.push('<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#000">');
    if (tag) {
      parts.push(`<p style="font-family:Calibri,Arial,sans-serif;font-size:13pt;font-weight:700;margin:0 0 4pt 0">${esc(tag)}</p>`);
    }
    parts.push(`<p style="font-family:Calibri,Arial,sans-serif;font-size:11pt;margin:0 0 6pt 0">${citeHtml}</p>`);
    parts.push(`<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt">${body}</div>`);
    parts.push('</div>');
    return parts.join('');
  }
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
