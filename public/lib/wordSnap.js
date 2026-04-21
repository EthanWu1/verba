(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VerbaWordSnap = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  // A word char = letter, digit, or apostrophe (inside word)
  const isWord = (ch) => ch != null && /[A-Za-z0-9']/.test(ch);

  function snapStart(text, pos) {
    // If at boundary or outside, find next word char forward (skip whitespace/punct)
    // If mid-word, expand backward to word start
    if (pos < 0) pos = 0;
    if (pos > text.length) pos = text.length;
    const prev = text[pos - 1];
    const cur = text[pos];
    if (isWord(cur) && isWord(prev)) {
      // mid-word: walk back
      let i = pos;
      while (i > 0 && isWord(text[i - 1])) i--;
      return i;
    }
    // at boundary or in whitespace: walk forward to next word char
    let i = pos;
    while (i < text.length && !isWord(text[i])) i++;
    return i;
  }

  function snapEnd(text, pos) {
    if (pos < 0) pos = 0;
    if (pos > text.length) pos = text.length;
    const prev = text[pos - 1];
    const cur = text[pos];
    if (isWord(prev) && isWord(cur)) {
      // mid-word: walk forward to word end
      let i = pos;
      while (i < text.length && isWord(text[i])) i++;
      return i;
    }
    // at boundary or whitespace: walk back to previous word char +1
    let i = pos;
    while (i > 0 && !isWord(text[i - 1])) i--;
    return i;
  }

  function snapToWordBoundaries(text, start, end) {
    text = String(text == null ? '' : text);
    let s = Math.min(start, end);
    let e = Math.max(start, end);
    if (s === e) return { start: s, end: e };
    const ns = snapStart(text, s);
    const ne = snapEnd(text, e);
    if (ne < ns) return { start: ns, end: ns };
    return { start: ns, end: ne };
  }

  function wordAt(text, index) {
    text = String(text == null ? '' : text);
    if (index < 0 || index > text.length) return null;
    if (isWord(text[index])) {
      let s = index;
      while (s > 0 && isWord(text[s - 1])) s--;
      let e = index;
      while (e < text.length && isWord(text[e])) e++;
      return { start: s, end: e };
    }
    // search forward then backward for nearest word
    let f = index;
    while (f < text.length && !isWord(text[f])) f++;
    if (f < text.length) {
      let e = f;
      while (e < text.length && isWord(text[e])) e++;
      return { start: f, end: e };
    }
    let b = index - 1;
    while (b >= 0 && !isWord(text[b])) b--;
    if (b >= 0) {
      let s = b;
      while (s > 0 && isWord(text[s - 1])) s--;
      return { start: s, end: b + 1 };
    }
    return null;
  }

  return { snapToWordBoundaries, wordAt };
}));
