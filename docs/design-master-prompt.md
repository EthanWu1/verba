# Verba — Master Design Prompt

Paste into a fresh design session. Attach screenshots of current screens when relevant.

---

## What Verba is

A web app for high-school and college policy / Lincoln-Douglas / public-forum debate. Users:
- Generate "cards" (formatted evidence) from URLs and PDFs via AI
- Browse a personal library of ~78k canonical cards (search, filter)
- See tournament results and team Elo rankings
- Chat with an AI grounded in their library + a debate analytics corpus

It's a tool for serious work — debaters skim hundreds of cards. Density matters. So does respect for the academic context.

## Tech reality

- Vanilla HTML/CSS/JS. No bundler. No framework.
- One big `public/app.html` with inline `<style>`. A few side `*.css` files. CSS variables for tokens.
- Solutions ship as `<script>` and `<link>` tags. SVG icons inline.

## Surfaces that exist

Top nav (vertical sidebar) → Cutter / Library / Tournament / Rankings / Chat. Profile + settings at bottom. Each surface has its own page. There's a card preview component reused across pages.

Look at the current app for everything else. You're free to merge, split, rename, or rethink any surface if it serves users better.

## Hard constraints (don't break these)

- Cards copied to clipboard must paste cleanly into Microsoft Word with their underlines, cyan highlights, font, and bold author-year prefix intact. (Keeps the "Verbatim" workflow alive.)
- Card body text stays Calibri 11pt. Cyan `#00ffff` is the highlight color — that's the brand convention from the debate community.
- WCAG AA contrast. Keyboard nav. Mobile (≤768px) works.
- No glassmorphism. No bouncy animations. Honor `prefers-reduced-motion`.

## What I want

Redesign the app. Surprise me. Have a point of view.

Pick a personality — editorial, terminal-inspired, brutalist, soft-academic, whatever you think fits. Justify it briefly.

For each surface, return:
- A mockup (ASCII, mermaid, or pixel-level description — your call)
- The HTML I'd drop in
- The CSS to make it look right (use CSS variables; propose new ones in `:root` when you need them)
- Notes on what's changing from today and why

Start wherever you want. Tell me what to attach if you need to see what something looks like now.

Don't ask me a long list of clarifying questions before starting — make decisions, show me, I'll redirect if something's off.
