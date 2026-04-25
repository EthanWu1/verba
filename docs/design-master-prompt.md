# Verba — Master Design Prompt

Paste this into a fresh Claude/ChatGPT session (or "Claude design" custom assistant). Replace `[ATTACH SCREENSHOT]` placeholders with actual screenshots of the relevant surface before sending.

---

## Project context

**Verba** is a single-page web app for high-school and college policy / Lincoln-Douglas / public-forum debate. Users upload evidence (cards), generate cards from URLs/PDFs via AI ("card cutter"), browse a 77,888-canonical evidence library (search, filter by argument type & topic), view tournament results & Elo-style team rankings, and chat with an AI assistant grounded in their own card library and a 776M-word analytics corpus.

Tech stack: **vanilla HTML/CSS/JS** (no React, no bundler). Server: Node + Express + SQLite. CSS lives in a single inline `<style>` block in `public/app.html` plus a few `public/assets/*.css` files. No CSS framework — all hand-rolled with CSS variables.

## Design tokens already in use (keep variable names, refine values)

```css
:root {
  /* surfaces */
  --panel:#F9FAFB; --panel-2:#F3F4F6; --panel-3:#FFFFFF;
  --line:#E5E7EB; --line-2:#D1D5DB; --line-soft:#F1F2F4;

  /* ink */
  --ink:#0F172A; --ink-2:#1F2937;
  --muted:#6B7280; --muted-2:#9CA3AF;

  /* accent (currently mostly black; was lilac) */
  --lilac:#000000; --lilac-2:#111111; --lilac-3:#262626;
  --lilac-ink:#FFFFFF; --lilac-soft:#F4F4F5;

  /* type */
  --font-ui:'Calibri',Inter,system-ui,sans-serif;
  --font-display:'Inter',system-ui,sans-serif;
  --font-mono:'JetBrains Mono',ui-monospace,monospace;

  /* shadows */
  --shadow-sm: 0 1px 2px rgba(16,24,40,0.04);
  --shadow:    0 4px 6px -1px rgba(0,0,0,0.05);
  --shadow-lg: 0 12px 24px -8px rgba(16,24,40,0.10);

  --focus-ring:0 0 0 3px var(--lilac-soft);
}
```

## Current personality (what to preserve)

- **Editorial / scholarly minimalism** — debate is academic, design must respect that
- **Black + white + soft grays primary; no bright color accents** for chrome
- **Card content uses Calibri 11pt** because that's the Verbatim/Word convention; do not change card body type
- **Cyan `#00ffff` highlight** is fixed brand: that's how cards are highlighted by debaters
- Density is OK — debaters skim large card lists; don't over-pad
- Mobile must work (44px touch targets, single-column collapse)
- WCAG AA contrast; focus rings always visible; keyboard nav works

## Surfaces to redesign

1. **Top nav (sidebar)** — vertical, 240px, collapsible to 76px icon-only. Sections: Cutter, Evidence (Library), Tournament, Rankings, Chat. Profile & settings at bottom.
2. **Cutter (Home)** — input bar (URL / paste / drop file) + carousel of generated cards (left/right arrows, tag/cite/body, hover-revealed copy + delete). Empty state should be inviting.
3. **Library (Evidence list)** — facet filters (type / topic / source), grid or list of card previews (tag + cite + truncated body), click → full card view.
4. **Tournament view** — list of tournaments, click for details, by-event tabs (LD/PF/CX/JV/Novice), pairings & results table.
5. **Rankings** — left-column filter sidebar (search / event toggle / season), right-column ranked team table, click team → profile (Elo chart, record, bid count, tournament history). Profile view hides the filter sidebar.
6. **Chat tab** — single-column centered chat (max 780px width), top bar with three pill buttons (`History`, `Context`, `+ New`), messages list, composer at bottom. `/explain` `/analytic` `/block` slash commands. `/block` output renders as inline file-card → click → opens 50% right split-view with the formatted block (read-only). History + Context are floating dropdowns.
7. **Profile drop-downs / dropdowns / modals** — dialog primitives for rename, delete, account.
8. **Card preview component** — reused across Library, Cutter carousel, Chat split-view. Heading4 tag (13pt bold Calibri), cite (author-year prefix bold 13pt + rest 11pt regular), body 11pt with `<u>` underlines + cyan highlight spans. **Must roundtrip cleanly to Word via clipboard.**

## Hard constraints

- **No bundler** — solutions must work as plain `<script>`/`<link>` tags or inline CSS. SVG icons inline (no icon font).
- **No CSS framework** — Tailwind/etc not allowed. Must use `var(--*)` tokens.
- **Mobile parity** — every desktop change needs a `@media (max-width:768px)` rule.
- **Don't break clipboard contract** — card → Ctrl+C → Word must preserve underlines, highlights, font, and 13pt-bold author-year prefix.
- **Don't add a docx editor** — Files-tab feature was removed. Chat split-view is read-only.
- **Heading visual spec** (used in Word-exported docs and some inline previews):
  - H1 (Pocket): 26pt bold, 1px solid box border around paragraph
  - H2 (Hat): 22pt bold, double underline
  - H3 (Block): 16pt bold, single underline
  - H4 (Tag): 13pt bold

## What I want from you

For each surface (1-8 above), produce:

1. **Visual mockup** — clean PNG-ish layout (you can use ASCII boxes, mermaid, or describe pixel-by-pixel). Two states minimum: default + a meaningful interaction state (hover/expanded/active).
2. **HTML markup** — semantic, accessible, ready to drop into `public/app.html`. Use existing class naming patterns where they exist (`.nav-item`, `.rk-sidebar`, `.chat-msg`, etc.). Suggest renames only when they materially improve clarity.
3. **CSS rules** — using only the design tokens above. Include `@media (max-width:768px)` rules. Add new tokens to `:root` only if necessary, name them in the same style.
4. **Interaction notes** — what JS hooks need to fire on what events. Do not write the JS; just spec the contract (e.g., "click `.tournament-row[data-tournid]` → call `window.tocOpenById(id)`").
5. **A11y checklist** — keyboard nav, focus states, ARIA labels, color contrast.
6. **What changes from today** — bullet list of every visible difference vs current state. Be specific.

## Design direction (the "vibe")

- Inspirations: **Linear, Notion, Claude.ai, Things 3, Vercel dashboard**. Crisp, restrained, type-led.
- Avoid: skeuomorphism, gradients used as decoration, heavy shadows, glassmorphism, dark-mode-only designs (we ship light by default; dark mode is future scope).
- Type pairing: Inter (UI/display) + Calibri (card content, locked) + JetBrains Mono (numbers, IDs, kbd hints).
- Negative space is welcome but not at expense of density in dense lists (rankings, library).
- Motion: 120-220ms eases (ease, cubic-bezier(.2,.9,.3,1)). Never bounce. Honor `prefers-reduced-motion`.

## Output format

For each surface, return a Markdown section:

```markdown
## [Surface name]

### Mockup
[ASCII / mermaid / description]

### HTML
```html
<!-- new markup -->
```

### CSS
```css
/* new rules + media queries */
```

### Interactions
- [trigger] → [contract]

### A11y
- [keyboard / focus / aria notes]

### Changes from today
- [bullets]
```

Start with **the top nav (sidebar)** and the **cutter (Home)** since those are highest visibility. Then chat, rankings, library, tournament, profile, modals, card preview component.

If a surface needs me to attach a screenshot for context, say so explicitly with `[ATTACH: <surface name>]` — I will provide.

If you need to invent a new design token, propose it in `:root` and explain why an existing token doesn't fit.

If you'd recommend dropping or merging a surface entirely, say so up front before designing it.

Begin.
