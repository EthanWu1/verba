(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VerbaIsDirty = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  function isDirty(current, saved) {
    const a = current || {};
    const b = saved || {};
    const keys = new Set();
    for (const k of Object.keys(a)) if (a[k] !== undefined) keys.add(k);
    for (const k of Object.keys(b)) if (b[k] !== undefined) keys.add(k);
    for (const k of keys) {
      if (a[k] !== b[k]) return true;
    }
    return false;
  }
  return { isDirty };
}));
