(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VerbaInlineStyle = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  // Token-level walker that tracks nested <u>/<b>/<strong>/<mark> and emits
  // plain <span> runs whose style merges every active format. Ensures that
  // when a highlight sits inside an underline (or a bold inside both), the
  // resulting span carries BOTH text-decoration:underline AND the yellow
  // background / bold weight — which Word and Google Docs DO preserve, while
  // they do NOT reliably inherit text-decoration through nested spans.
  function inlineStyleBody(html) {
    const src = String(html || '');
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

  return { inlineStyleBody };
}));
