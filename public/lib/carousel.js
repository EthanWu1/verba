(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VerbaCarousel = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  const SOFT_CAP_ITEMS = 50;
  const SOFT_CAP_BYTES = 500 * 1024;

  function createState() { return { items: [], activeIndex: 0 }; }
  function pushItem(state, partial) { return state; }
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
