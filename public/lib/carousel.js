(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VerbaCarousel = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  const SOFT_CAP_ITEMS = 50;
  const SOFT_CAP_BYTES = 500 * 1024;

  function createState() { return { items: [], activeIndex: 0 }; }
  function pushItem(state, partial) {
    const item = {
      id: partial.id,
      status: partial.status || 'done',
      createdAt: typeof partial.createdAt === 'number' ? partial.createdAt : Date.now(),
      sourceUrl: partial.sourceUrl || null,
      sourceLabel: partial.sourceLabel || null,
      tag: partial.tag || '',
      cite: partial.cite || '',
      body_html: partial.body_html || '',
      body_markdown: partial.body_markdown || '',
      body_plain: partial.body_plain || '',
      phase: partial.phase || null,
      phaseHistory: partial.phaseHistory || [],
      error: partial.error || null
    };
    const items = state.items.concat(item);
    return { items, activeIndex: items.length - 1 };
  }
  function updateItem(state, id, patch) { return state; }
  function removeItem(state, id) { return state; }
  function setActive(state, index) { return state; }
  function clearAll(state) { return state; }
  function serialize(state) { return ''; }
  function deserialize(json) { return createState(); }
  function hydrate(json) { return createState(); }

  return {
    createState, pushItem, updateItem, removeItem, setActive, clearAll,
    serialize, deserialize, hydrate,
    SOFT_CAP_ITEMS, SOFT_CAP_BYTES
  };
}));
