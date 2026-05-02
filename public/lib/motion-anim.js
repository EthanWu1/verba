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
  // Clear any inline transform Motion leaves behind. Critical because a
  // residual `transform: translateY(0)` on an ancestor turns it into the
  // containing block for any position:fixed child (like .lib-preview),
  // breaking viewport-fixed positioning and making the bottom-sheet
  // scroll with the list instead of staying glued off-screen.
  const clearTransform = (target) => {
    if (!target) return;
    if (target.style) { target.style.transform = ''; return; }
    if (target.forEach) target.forEach(el => { if (el && el.style) el.style.transform = ''; });
  };

  const fadeUp = (el, opts = {}) => {
    const ctrl = animate(
      el,
      { opacity: [0, 1], transform: ['translateY(8px)', 'translateY(0)'] },
      { duration: 0.28, easing: [0.22, 0.8, 0.3, 1], ...opts },
    );
    if (ctrl && ctrl.finished) ctrl.finished.then(() => clearTransform(el)).catch(() => {});
    return ctrl;
  };

  const staggerFadeUp = (els, opts = {}) => {
    const ctrl = animate(
      els,
      { opacity: [0, 1], transform: ['translateY(10px)', 'translateY(0)'] },
      { duration: 0.32, easing: [0.22, 0.8, 0.3, 1], delay: stagger(0.05), ...opts },
    );
    if (ctrl && ctrl.finished) ctrl.finished.then(() => clearTransform(els)).catch(() => {});
    return ctrl;
  };

  /* ── 1. Page transitions ────────────────────────────── */
  const animatePageEnter = (pageEl) => {
    if (!pageEl) return;
    // Disable the CSS pageIn keyframe for this element so we don't double-animate.
    pageEl.style.animation = 'none';

    // Animate the page itself first
    fadeUp(pageEl, { duration: 0.24 });

    // Then stagger any direct content rows / cards / sections.
    // Note: deliberately exclude root containers like .lib-shell and .set-shell
    // because they often contain position:fixed children (e.g. .lib-preview
    // mobile bottom sheet). Adding transform to them turns them into the
    // containing block for fixed descendants, which breaks viewport-fixed
    // positioning permanently if Motion leaves an inline transform behind.
    const candidates = pageEl.querySelectorAll(
      ':scope > .qa-row > .qa, :scope > .today-grid > div > .section, :scope > .today-grid > div > .aside-card, :scope > .shellpad > .section-band, :scope > .shellpad > .tourn-grid, :scope > .shellpad > .tt-table, :scope > .shellpad > .t-toolbar, :scope > .set-shell > .set-body > .set-section',
    );
    if (candidates.length) staggerFadeUp(candidates, { duration: 0.36 });
  };

  // Run on the initially-active page
  document.addEventListener('DOMContentLoaded', () => {
    // Defensive: blank any stale inline transforms left on shell containers
    // by an older script version. These would otherwise pin position:fixed
    // children to that ancestor instead of the viewport.
    document.querySelectorAll('.lib-shell, .set-shell, .page').forEach(clearTransform);
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
