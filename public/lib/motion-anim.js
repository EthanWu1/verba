/* Motion One — entrance + interaction animations for the Verba app.
 * Tasteful, scoped, reduced-motion aware. No structural changes to DOM.
 *
 * Animations wired here:
 *   1. Page transitions   — when .page.on flips, stagger-fade direct children up.
 *   2. Chat messages      — new .chat-msg / .chat-file-card slides up + fades in.
 *   3. Quick-action cards — .qa-row children stagger on first paint of #page-today.
 *   4. List items         — .cont-item / .topic-chip / .lib-card / .tt-row added later get a fade-up.
 *   5. Modal/dropdown     — entrance handled by CSS already; we only normalize timing.
 */
import { animate, stagger } from 'https://esm.sh/motion@10.18.0?bundle';

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
if (!reduce) {

  /* ── Helpers ────────────────────────────────────────── */
  const fadeUp = (el, opts = {}) =>
    animate(
      el,
      { opacity: [0, 1], transform: ['translateY(8px)', 'translateY(0)'] },
      { duration: 0.28, easing: [0.22, 0.8, 0.3, 1], ...opts },
    );

  const staggerFadeUp = (els, opts = {}) =>
    animate(
      els,
      { opacity: [0, 1], transform: ['translateY(10px)', 'translateY(0)'] },
      { duration: 0.32, easing: [0.22, 0.8, 0.3, 1], delay: stagger(0.05), ...opts },
    );

  /* ── 1. Page transitions ────────────────────────────── */
  const animatePageEnter = (pageEl) => {
    if (!pageEl) return;
    // Disable the CSS pageIn keyframe for this element so we don't double-animate.
    pageEl.style.animation = 'none';

    // Animate the page itself first
    fadeUp(pageEl, { duration: 0.24 });

    // Then stagger any direct content rows / cards / sections
    const candidates = pageEl.querySelectorAll(
      ':scope > .qa-row > .qa, :scope > .today-grid > div > .section, :scope > .today-grid > div > .aside-card, :scope > .shellpad > .section-band, :scope > .shellpad > .tourn-grid, :scope > .shellpad > .tt-table, :scope > .shellpad > .t-toolbar, :scope > .lib-shell, :scope > .set-shell > .set-body > .set-section',
    );
    if (candidates.length) staggerFadeUp(candidates, { duration: 0.36 });
  };

  // Run on the initially-active page
  document.addEventListener('DOMContentLoaded', () => {
    const initial = document.querySelector('.page.on');
    if (initial) animatePageEnter(initial);
  });

  // Run when any .page gets the .on class — only on first entry per session.
  // Re-entries skip the animation (otherwise tab-switching feels laggy).
  const pageObs = new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.attributeName !== 'class') continue;
      const el = m.target;
      if (el.classList.contains('on') && !el.dataset.animatedOnce) {
        el.dataset.animatedOnce = '1';
        animatePageEnter(el);
      }
    }
  });
  document.querySelectorAll('.page').forEach((p) => pageObs.observe(p, { attributes: true, attributeFilter: ['class'] }));

  /* ── 2. Chat messages ───────────────────────────────── */
  const wireChatStream = () => {
    const el = document.getElementById('chat-messages');
    if (!el) return;
    new MutationObserver((muts) => {
      for (const m of muts) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (
            node.classList?.contains('chat-msg') ||
            node.classList?.contains('chat-file-card')
          ) {
            fadeUp(node, { duration: 0.22 });
          }
        }
      }
    }).observe(el, { childList: true });
  };
  document.addEventListener('DOMContentLoaded', wireChatStream);

  /* ── 3-4. Generic list-item entrance ───────────────── */
  // Watch a few known list containers and fade in their FIRST batch only.
  // Subsequent batches (paginated "Show more", filter changes) are skipped
  // so clicks don't feel laggy/repetitive.
  const listSelectors = [
    '#continue-list',
    '#topic-list',
    '#all-tourn-grid',
    '#upcoming-grid',
    '#rk-rows',
    '.recent-row',
  ];
  const wireListAdditions = () => {
    listSelectors.forEach((sel) => {
      const el = document.querySelector(sel);
      if (!el || el.dataset.motionWired) return;
      el.dataset.motionWired = '1';
      let firstBatchSeen = false;
      let lastBatchAt = 0;
      new MutationObserver((muts) => {
        const newNodes = [];
        for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) newNodes.push(n);
        if (!newNodes.length) return;
        const now = Date.now();
        // Skip if we've already animated a batch — pagination/filter swaps shouldn't re-animate.
        if (firstBatchSeen) return;
        // Skip "empty" placeholder rows.
        if (newNodes.length === 1 && newNodes[0].classList?.contains('empty')) return;
        firstBatchSeen = true;
        lastBatchAt = now;
        staggerFadeUp(newNodes, { duration: 0.3 });
      }).observe(el, { childList: true });
    });
  };
  document.addEventListener('DOMContentLoaded', wireListAdditions);
  // Also wire after a tick in case JS-rendered containers replace the elements above.
  setTimeout(wireListAdditions, 800);
  setTimeout(wireListAdditions, 2000);

  /* ── 5. Card panel (chat) — gentle bounce on open ───── */
  // The chat-split open animation is CSS-driven (transform translateX/Y).
  // We piggyback for a light scale punch on the card body when newly opened.
  const splitObs = new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.attributeName !== 'hidden') continue;
      const el = m.target;
      if (!el.hasAttribute('hidden')) {
        const body = el.querySelector('.chat-split-body');
        if (body) animate(body, { opacity: [0, 1] }, { duration: 0.34, easing: 'ease-out' });
      }
    }
  });
  const split = document.getElementById('chat-split');
  if (split) splitObs.observe(split, { attributes: true, attributeFilter: ['hidden'] });
}
