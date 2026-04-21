(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VerbaCopyExport = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Extract "LastName YY" prefix: sequence of capitalized words + 2-digit year
  function extractAuthorYearPrefix(cite) {
    if (!cite) return null;
    const m = String(cite).match(/^([A-Z][A-Za-z'\-]+(?:\s+(?:et\s+al\.?|and|&|[A-Z][A-Za-z'\-]+))*\s+\d{2,4})/);
    return m ? m[1] : null;
  }

  function ensureHighlightStyle(bodyHtml) {
    if (!bodyHtml) return '';
    // Add inline style to <mark> tags so Word/Verbatim render yellow bg
    return String(bodyHtml).replace(/<mark\b([^>]*)>/gi, (full, attrs) => {
      if (/style\s*=/i.test(attrs)) {
        return `<mark${attrs.replace(/style\s*=\s*"([^"]*)"/i, (m, s) =>
          `style="${s};background:#FFEB3B;color:#000"`
        )}>`;
      }
      return `<mark${attrs} style="background:#FFEB3B;color:#000">`;
    });
  }

  function buildCopyHtml(card) {
    card = card || {};
    const tag = card.tag || '';
    const cite = card.cite || card.shortCite || '';
    let body = card.body_html;
    if (!body && card.body_plain) {
      body = '<p>' + esc(card.body_plain).replace(/\n+/g, '</p><p>') + '</p>';
    }
    body = ensureHighlightStyle(body || '');

    const prefix = extractAuthorYearPrefix(cite);
    let citeHtml;
    if (prefix) {
      const rest = cite.slice(prefix.length);
      citeHtml =
        `<b style="font-family:Calibri,Arial,sans-serif;font-size:13pt;color:#000">${esc(prefix)}</b>` +
        `<span style="font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#000">${esc(rest)}</span>`;
    } else {
      citeHtml = `<span style="font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#000">${esc(cite)}</span>`;
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

  function buildCopyPlain(card) {
    card = card || {};
    const tag = card.tag || '';
    const cite = card.cite || card.shortCite || '';
    const body = card.body_plain || card.body_markdown || '';
    return `${tag}\n${cite}\n\n${body}`;
  }

  return { buildCopyHtml, buildCopyPlain, extractAuthorYearPrefix };
}));
