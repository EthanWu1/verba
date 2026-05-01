# Chat — Shape Brief

Status: design-only artifact. No production code touched. Companion mockup: `public/_design/chat.html`.

## Locked decisions

| Decision               | Choice                                                                     |
|------------------------|----------------------------------------------------------------------------|
| Direction              | Workbench, expand-on-demand                                                |
| Pane count             | 2 base (rail + chat) → 3 when card open (rail + chat + card panel)         |
| Thread management      | Topbar dropdown (option A), Cmd-K from anywhere                            |
| Theme                  | Inherits `app.html` tokens, no chromatic accent, paper background          |
| Background             | `--paper` (`#FBFAF7`)                                                      |
| Citation rendering     | Inline card *box* (extends existing `.chat-file-card`), click-to-expand    |
| Card panel — desktop   | 380px slide-in from right                                                  |
| Card panel — mobile    | Full-screen overlay, swipe-down to dismiss                                 |
| Card box width         | Responsive: full message-column width at all sizes (column itself adapts)  |
| Empty page state       | Open most recent thread; no hero, no thread picker                         |
| Composer position      | Always pinned bottom; no centered-hero empty state                         |
| Slash commands         | Deferred to v2                                                             |

## Token map

All tokens already exist in [`public/app.html`](../public/app.html). No new tokens introduced.

| Surface                       | Token                                |
|-------------------------------|--------------------------------------|
| Page background               | `--paper` (`#FBFAF7`)                |
| Conversation surface          | `--paper`                            |
| Composer fill                 | `#fff` + `1px solid var(--line)`     |
| Composer focus ring           | `0 0 0 3px` of a 6%-opacity ink wash |
| Card box default              | `#fff` + `1px solid var(--line)`     |
| Card box hover                | `--panel` (`#F9FAFB`)                |
| Card box open                 | `#fff` + `1px solid var(--ink)` + 2px ink left rule |
| Hairline (turn divider)       | `--line-soft` (`#F1F2F4`)            |
| Pane divider                  | `--line` (`#E5E7EB`)                 |
| Body ink                      | `--ink` (`#0F172A`)                  |
| Secondary ink                 | `--ink-2` (`#1F2937`)                |
| Muted text                    | `--muted` (`#6B7280`)                |
| Speaker label                 | `--muted-2` (`#9CA3AF`), mono mini-caps |
| Active assistant turn rule    | 2px `--ink` left rule (mirrors `.rail-btn.on::before`) |
| Citation source line          | `--muted`                            |
| Highlight (cited card body)   | Existing `--hl-yellow-soft` etc, opt-in only |

## Type

| Role                  | Family + size + weight                            |
|-----------------------|---------------------------------------------------|
| Speaker label         | `var(--font-mono)` 11px / 600 / `tracking: 0.08em` / mini-caps |
| Body                  | `var(--font-display)` 14.5px / 400 / `line-height: 1.6` |
| Card box tag          | `var(--font-display)` 13px / 600                  |
| Card box source       | `var(--font-display)` 11.5px / 500 / `--muted`    |
| Card box body excerpt | `var(--font-display)` 13px / 400 / clamped 2 lines / `--ink-2` |
| Composer placeholder  | `var(--font-display)` 14px / 400 / `--muted-2`    |
| Topbar thread title   | `var(--font-display)` 13px / 600 / `tracking: -0.01em` |
| Timestamps            | `var(--font-mono)` 10.5px / 500 / `--muted-2`     |
| Card panel body       | `var(--font-serif)` 15px / 400 / `line-height: 1.55` (Newsreader, justified) |

Body line-length capped at `~72ch`. Card panel body capped at `~58ch` for serif legibility.

## Component inventory

### `chat-topbar`
Layout: `flex`, padding `10px 24px`, `border-bottom: 1px solid var(--line-soft)`, height `48px`.
Contents:
- **Thread switcher trigger** — left side. Caret + current thread title. Click → opens dropdown.
- **Thread title** — center-left, truncates with ellipsis.
- **Right cluster** — copy-thread, export, settings (icon buttons).

States: default, dropdown-open (caret rotated 180°).

### `thread-dropdown`
Position: `absolute`, anchored to switcher trigger. Width `320px`. Max-height `60vh`, overflow scroll. `z-index: 1000`. `box-shadow: var(--shadow-lg)`. `border-radius: var(--r-lg)`.
Contents:
- Search input (top, sticky).
- "+ New thread" row (icon + label).
- Thread rows: 36px height, last-message preview truncated, mono timestamp on right.
- Active thread row: `--panel` background + 2px ink left rule.

### `chat-stream`
Layout: `flex-direction: column`, `gap: 0` (turns separated by hairline, not gap), `padding: 24px 0`, `max-width` adapts:
- `<768px`: full minus `24px` horizontal padding
- `768–1280px`: `720px` centered
- `>1280px`: `880px` centered

### `chat-turn`
Per turn: padding `20px 24px`, full message column width.
- Speaker label (mono mini-caps, `--muted-2`) — top of turn, `margin-bottom: 8px`.
- Body content — Inter, no bubble.
- Hairline divider on `border-bottom: 1px solid var(--line-soft)` (last turn omits).
- Active streaming assistant turn: 2px `--ink` left rule + 2px progress rule animating along bottom.

### `chat-card-box` (extends existing `.chat-file-card`)
Inline within an assistant turn. Width: full message column. Padding `12px 14px`. `border: 1px solid var(--line)`. `border-radius: var(--r-lg)`. Background `#fff`.

Layout (flex row):
- Optional 16px icon (left)
- Meta column (flex 1, min-width 0): tag, source, 2-line clamped body excerpt
- Open chevron (right, `--muted`)

States:
- Default
- Hover: background `--panel`, border `--line-2`
- Open: 2px ink left rule + `border: 1px solid var(--ink)`, chevron rotated
- Loading: skeleton shimmer over meta column

### `composer`
Pinned to bottom. Padding `12px 24px 16px`. `border-top: 1px solid var(--line-soft)`. `background: var(--paper)`.
Card: `border: 1px solid var(--line)`, `border-radius: var(--r-lg)`, `background: #fff`. Focus-within: `box-shadow: 0 0 0 3px rgba(15,23,42,0.06)`.
Contents:
- Auto-grow textarea, min-height `60px`, max-height `200px`, padding `12px 14px`. Inter 14px.
- Bottom bar: tools left (attach, context — icon buttons), send right.
- Send button: `padding: 6px 14px`, `border: 1px solid var(--line)`, mono "Send" + `↵` mini-key. `has-content` state: ink fill, white text.
- Mobile: same structure, slightly larger touch targets (min-height 36px on buttons).

### `card-panel` (desktop slide-in)
Position: fixed right. Width `380px`. Height `100vh - topbar`. `border-left: 1px solid var(--line)`. Background `--paper`.
Contents:
- Header: card tag (Inter 600/14), close button. Padding `14px 18px`. `border-bottom: 1px solid var(--line-soft)`.
- Meta strip: source, citation, link to library. Mono 11px, `--muted`.
- Body: serif (Newsreader 15px), justified, padded `18px`, scrollable. Existing yellow/cyan/green highlights honored.
- Action row at bottom: "Open in library", "Copy citation". `border-top: 1px solid var(--line-soft)`.

Slides in via `transform: translateX(100%) → translateX(0)` with `transition: transform 200ms ease-out`. No bounce.

### `card-panel` (mobile overlay)
Position: fixed inset 0. Background `--paper`. Slides in from bottom (`translateY(100%) → translateY(0)`). Same content. Top header gets a swipe-handle (4px tall, 40px wide, `--muted-2`, centered, padding `8px 0 12px`). Swipe-down or tap-close dismisses.

## Page states

| State                  | Treatment                                                                  |
|------------------------|----------------------------------------------------------------------------|
| First-load returning   | Open most recent thread; conversation populates; no flash of empty UI.    |
| Loading thread         | Skeleton turns (3 placeholder turns with shimmering body lines).          |
| Empty thread (no msgs) | Show only composer pinned to bottom; conversation area empty (just paper). No headline, no suggested pills. |
| Streaming response     | Active assistant turn shows 2px ink left rule + 2px progress rule along bottom. Send button shows "Stop" with mono `Esc` mini-key. |
| Error sending          | Inline error row above composer, `--danger` ink, `--danger-soft` background, dismissible. |
| Card panel loading     | Skeleton lines in body area.                                               |
| Card panel error       | "Couldn't load card. Open in library →" link.                             |
| Offline                | Composer disabled with mono "offline" badge in bottom bar.                |

## Mobile collapse rules (`<768px`)

- Global app rail: hides behind hamburger (already app-level pattern).
- Topbar: stays. Thread switcher remains; right-cluster collapses to overflow menu.
- Conversation: full width minus `16px` horizontal padding.
- Composer: pinned bottom, sticks above the iOS keyboard via `env(safe-area-inset-bottom)`.
- Card panel: full-screen overlay, swipe-down dismiss.
- Thread dropdown: full-screen sheet from top, not floating.

## Anti-slop checklist

Designed *against* these defaults:

- [x] No bubble metaphor (no rounded turn containers).
- [x] No avatar circles for user/assistant.
- [x] No centered-hero empty state ("How can I help you today?").
- [x] No suggested-prompt pill row under composer.
- [x] No streaming blinking-cursor cliché (use progress rule instead).
- [x] No gradient anywhere.
- [x] No purple/lila accent (token names ignored, values are slate).
- [x] No pure `#000` / `#fff` (ink is `#0F172A`, paper is `#FBFAF7`).
- [x] No em dashes in microcopy (use commas, colons).
- [x] No identical-card grid feature row.
- [x] No modal-as-first-thought for card detail (it's a panel, not a modal).
- [x] No glassmorphism.
- [x] No serif except inside the card panel body (intentional texture for cited evidence).
- [x] Active state pattern (2px ink left rule) reuses the rail's existing pattern — consistency within the system, not a new visual language.

## Open follow-ups (post-mockup)

- Slash command palette (`/cite`, `/cut`, `/explain`) — v2.
- Multi-card selection in card panel (compare 2 cards side-by-side) — v2.
- Streaming progress: token counter vs progress rule — pick after seeing it move.
- Thread folders / tagging — only if user research shows actual need; resist for now.
