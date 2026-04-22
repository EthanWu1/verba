(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VerbaClipboard = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  function extractAuthorYearPrefix(cite) {
    if (!cite) return null;
    const m = String(cite).match(
      /^([A-Z][A-Za-z'‘’\-]+(?:\s+(?:[A-Z][A-Za-z'‘’\-]+|and|&|et\s+al\.?))*\s+['‘’]?\d{2,4})/
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
  function normalizeSpanStyles(html) {
    // Convert span-based inline formatting into semantic tags so the walker
    // picks them up. Handles styles copied from Word/Docs or previous pastes
    // where underline/bold/highlight were stored as styled spans.
    let s = String(html == null ? '' : html);
    // underline spans
    s = s.replace(
      /<span([^>]*)\sstyle=("[^"]*"|'[^']*')([^>]*)>([\s\S]*?)<\/span>/gi,
      (full, pre, rawStyle, post, inner) => {
        const style = rawStyle.slice(1, -1);
        const underline = /text-decoration\s*:\s*[^;"']*underline/i.test(style);
        const bold = /font-weight\s*:\s*(?:bold|700|800|900)/i.test(style);
        const highlight = /(?:background(?:-color)?\s*:\s*(?:#?[fF][fF][fF]?[fF]00|#?[fF][fF][eE][bB]3[bB]|yellow|#?[fF][fF][fF][0-9a-fA-F]{3}))/i.test(style);
        if (!underline && !bold && !highlight) return full;
        let wrapped = inner;
        if (underline) wrapped = `<u>${wrapped}</u>`;
        if (bold) wrapped = `<b>${wrapped}</b>`;
        if (highlight) wrapped = `<mark>${wrapped}</mark>`;
        return wrapped;
      }
    );
    return s;
  }

  function flattenInlineStyles(html) {
    const src = normalizeSpanStyles(String(html == null ? '' : html));
    const FMT_TAGS = /^(u|b|strong|mark)$/i;
    const stack = [];
    let out = '';
    let i = 0;

    function emit(text) {
      if (!text) return;
      if (!stack.length) { out += text; return; }
      let underline = false, bold = false, highlight = false;
      for (const t of stack) {
        if (t === 'u') underline = true;
        else if (t === 'b' || t === 'strong') bold = true;
        else if (t === 'mark') highlight = true;
      }
      // Word paste filter: preserves <u>, <b> reliably; strips <mark> on some versions.
      // Use tags for u/b, span-with-background for highlight.
      let open = '', close = '';
      if (underline) { open += '<u style="text-decoration:underline">'; close = '</u>' + close; }
      if (bold) { open += '<b style="font-weight:700">'; close = '</b>' + close; }
      if (highlight) { open += '<span style="background-color:#ffff00;color:#000">'; close = '</span>' + close; }
      out += open + text + close;
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

  function stripDangerousAttrs(html) {
    let out = String(html || '')
      .replace(/\s+on[a-z]+\s*=\s*"[^"]*"/gi, '')
      .replace(/\s+on[a-z]+\s*=\s*'[^']*'/gi, '')
      .replace(/\s+class\s*=\s*"[^"]*"/gi, '')
      .replace(/\s+class\s*=\s*'[^']*'/gi, '')
      .replace(/\s+data-[a-z0-9\-]+\s*=\s*"[^"]*"/gi, '')
      .replace(/\s+data-[a-z0-9\-]+\s*=\s*'[^']*'/gi, '')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '');
    // Neutralize dangerous URL schemes in href/src
    out = out.replace(
      /(\s(?:href|src)\s*=\s*)(["'])\s*(?:javascript|data|vbscript):[^"']*\2/gi,
      '$1$2#$2'
    );
    return out;
  }

  function htmlToPlain(html) {
    return String(html || '')
      .replace(/<\/(p|div|br|li)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function serializeSelectionHtmlFromString(rawHtml, context) {
    const cleaned = stripDangerousAttrs(rawHtml);
    let html;
    if (context === 'cite') {
      const text = htmlToPlain(cleaned);
      const { prefix, rest } = splitCite(text);
      if (prefix) {
        html =
          `<span style="font-family:Calibri,Arial,sans-serif;font-size:13pt;font-weight:700;color:#000">${esc(prefix)}</span>` +
          `<span style="font-family:Calibri,Arial,sans-serif;font-size:11pt;font-weight:400;color:#000">${esc(rest)}</span>`;
      } else {
        html = `<span style="font-family:Calibri,Arial,sans-serif;font-size:11pt;font-weight:400;color:#000">${esc(text)}</span>`;
      }
    } else {
      const flat = flattenInlineStyles(cleaned);
      html = `<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#000">${flat}</div>`;
    }
    return { html, plain: htmlToPlain(cleaned) };
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
  function buildCopyPlain(card) {
    card = card || {};
    const tag = card.tag || '';
    const cite = card.cite || card.shortCite || '';
    const body = card.body_plain || card.body_markdown || '';
    return `${tag}\n${cite}\n\n${body}`;
  }
  function serializeSelectionHtml(range) {
    if (!range || typeof range.cloneContents !== 'function') {
      return { html: '', plain: '' };
    }
    const frag = range.cloneContents();
    const tmp = (typeof document !== 'undefined' && document.createElement)
      ? document.createElement('div') : null;
    if (!tmp) return { html: '', plain: '' };
    tmp.appendChild(frag);
    const rawHtml = tmp.innerHTML;

    const container = range.commonAncestorContainer;
    const node = container && container.nodeType === 1 ? container : (container && container.parentElement);
    let context = 'card-body';
    if (node && typeof node.closest === 'function') {
      if (node.closest('.cite-block')) context = 'cite';
      else if (node.closest('.wb-body, .card-preview, [data-field="body"]')) context = 'card-body';
      else context = 'mixed';
    }
    return serializeSelectionHtmlFromString(rawHtml, context);
  }

  return {
    extractAuthorYearPrefix,
    splitCite,
    flattenInlineStyles,
    buildCopyHtml,
    buildCopyPlain,
    serializeSelectionHtmlFromString,
    serializeSelectionHtml,
  };
}));
