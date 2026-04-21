(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VerbaAlert = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  const STYLE_ID = '__verba-alert-style';
  const STACK_ID = '__verba-alert-stack';

  const CSS = `
  #__verba-alert-stack{position:fixed;top:16px;right:16px;z-index:9999;display:flex;flex-direction:column;gap:10px;max-width:380px;pointer-events:none}
  .va-alert{pointer-events:auto;display:flex;align-items:flex-start;gap:10px;padding:12px 14px;border-radius:10px;border:1px solid transparent;background:#fff;color:#111;font:500 13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.08),0 1px 2px rgba(0,0,0,.06);transform:translateX(420px);opacity:0;transition:transform .28s cubic-bezier(.2,.8,.2,1),opacity .2s ease}
  .va-alert.va-in{transform:translateX(0);opacity:1}
  .va-alert.va-out{transform:translateX(420px);opacity:0}
  .va-alert .va-icon{flex:0 0 auto;width:20px;height:20px;display:flex;align-items:center;justify-content:center;margin-top:1px}
  .va-alert .va-icon svg{width:20px;height:20px}
  .va-alert .va-body{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px}
  .va-alert .va-title{font-weight:600;letter-spacing:-.01em;color:inherit}
  .va-alert .va-desc{font-weight:500;color:rgba(17,17,17,.72);word-break:break-word}
  .va-alert .va-close{flex:0 0 auto;width:22px;height:22px;border:none;background:transparent;border-radius:6px;cursor:pointer;color:inherit;opacity:.55;display:flex;align-items:center;justify-content:center;padding:0;margin-top:-1px;transition:opacity .15s ease,background-color .15s ease}
  .va-alert .va-close:hover{opacity:1;background:rgba(0,0,0,.06)}
  .va-alert .va-close svg{width:14px;height:14px}

  .va-alert[data-variant=success]{background:#f0fdf4;border-color:#bbf7d0;color:#111}
  .va-alert[data-variant=success] .va-icon{color:#16a34a}
  .va-alert[data-variant=destructive]{background:#fef2f2;border-color:#fecaca;color:#111}
  .va-alert[data-variant=destructive] .va-icon{color:#dc2626}
  .va-alert[data-variant=warning]{background:#fefce8;border-color:#fde68a;color:#111}
  .va-alert[data-variant=warning] .va-icon{color:#ca8a04}
  .va-alert[data-variant=info]{background:#f5f3ff;border-color:#ddd6fe;color:#111}
  .va-alert[data-variant=info] .va-icon{color:#7c3aed}
  .va-alert[data-variant=secondary]{background:#f4f4f5;border-color:#e4e4e7;color:#111}
  .va-alert[data-variant=secondary] .va-icon{color:#52525b}

  @media (prefers-color-scheme:dark){
    .va-alert{background:#18181b;color:#fafafa;border-color:#27272a;box-shadow:0 4px 16px rgba(0,0,0,.4)}
    .va-alert .va-desc{color:rgba(250,250,250,.7)}
    .va-alert .va-close:hover{background:rgba(255,255,255,.08)}
    .va-alert[data-variant=success]{background:#052e1a;border-color:#14532d}
    .va-alert[data-variant=success] .va-icon{color:#4ade80}
    .va-alert[data-variant=destructive]{background:#2d0a0a;border-color:#7f1d1d}
    .va-alert[data-variant=destructive] .va-icon{color:#f87171}
    .va-alert[data-variant=warning]{background:#2a1f05;border-color:#78350f}
    .va-alert[data-variant=warning] .va-icon{color:#facc15}
    .va-alert[data-variant=info]{background:#1e1b4b;border-color:#4c1d95}
    .va-alert[data-variant=info] .va-icon{color:#a78bfa}
  }

  @media (max-width:768px){
    #__verba-alert-stack{top:10px;right:10px;left:10px;max-width:none}
    .va-alert{padding:11px 12px}
  }
  `;

  const ICONS = {
    success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>',
    destructive: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
    warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    secondary: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/></svg>',
  };

  const CLOSE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

  function ensureStyle() {
    if (typeof document === 'undefined') return;
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function ensureStack() {
    let stack = document.getElementById(STACK_ID);
    if (stack) return stack;
    stack = document.createElement('div');
    stack.id = STACK_ID;
    stack.setAttribute('role', 'region');
    stack.setAttribute('aria-label', 'Notifications');
    document.body.appendChild(stack);
    return stack;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function push(opts) {
    if (typeof document === 'undefined') return { close() {} };
    ensureStyle();
    const stack = ensureStack();
    const o = typeof opts === 'string' ? { description: opts } : (opts || {});
    const variant = o.variant || 'secondary';
    const title = o.title || '';
    const description = o.description || '';
    const duration = o.duration == null ? 3000 : o.duration;
    const showClose = o.close !== false;

    const el = document.createElement('div');
    el.className = 'va-alert';
    el.setAttribute('role', variant === 'destructive' ? 'alert' : 'status');
    el.setAttribute('data-variant', variant);
    el.innerHTML = `
      <span class="va-icon" data-slot="alert-icon">${ICONS[variant] || ICONS.secondary}</span>
      <div class="va-body" data-slot="alert-content">
        ${title ? `<div class="va-title" data-slot="alert-title">${esc(title)}</div>` : ''}
        ${description ? `<div class="va-desc" data-slot="alert-description">${esc(description)}</div>` : ''}
      </div>
      ${showClose ? `<button type="button" class="va-close" data-slot="alert-close" aria-label="Dismiss">${CLOSE_SVG}</button>` : ''}
    `;

    stack.appendChild(el);
    requestAnimationFrame(() => el.classList.add('va-in'));

    let killed = false;
    function close() {
      if (killed) return; killed = true;
      el.classList.remove('va-in');
      el.classList.add('va-out');
      setTimeout(() => { el.remove(); }, 260);
    }

    const closeBtn = el.querySelector('.va-close');
    if (closeBtn) closeBtn.addEventListener('click', close);
    if (duration > 0) setTimeout(close, duration);

    return { close, el };
  }

  return { push };
}));
