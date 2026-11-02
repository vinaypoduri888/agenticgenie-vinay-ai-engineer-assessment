# Frontend design system (Part B, Stage B6)

Covers `apps/web`'s visual design system: the token source, the component inventory, the CSS
approach and why, and the responsive/accessibility conventions every page follows.

## Token source

All design tokens live as CSS custom properties in `apps/web/src/app/globals.css`, scoped to
`:root`. There is no separate JS token file — components reference tokens directly in class names
(`.btn-primary`) or, for one-off layout values, inline `style={{ color: "var(--color-...)" }}`.

| Category | Tokens | Notes |
|---|---|---|
| Color | `--color-bg`, `--color-surface`, `--color-surface-raised`, `--color-border[-strong]`, `--color-text[-muted/-faint]`, `--color-accent[-strong/-contrast]`, `--gradient-accent`, `--gradient-warm`, `--color-success/danger/warning/info[-bg]` | Neutral near-black canvas, hairline borders and one warm accent, so the product reads as finished rather than themed. Amber is kept for warnings and stars only. |
| Typography | `--font-display` and `--font-body` (Geist), `--font-mono` (Geist Mono, for labels and figures) | Self-hosted through `@fontsource`. See "Why self-hosted fonts" below. |
| Spacing | `--space-1` (4px) … `--space-9` (96px) | A single linear-ish scale used everywhere instead of ad hoc pixel values. |
| Radii | `--radius-sm/md/lg/full` | 8/12/18px. |
| Shadows | `--shadow-sm/md`, `--shadow-ring`, `--edge-highlight` | Tuned for a dark canvas. |
| Motion | `--duration-fast/base`, `--ease-standard` | Short, consistent timing. `prefers-reduced-motion` turns all animation and transitions off. |

Breakpoints are not tokens (CSS custom properties can't appear inside `@media` conditions) — they're
documented literally in `globals.css`'s header comment and used consistently: **768px** (tablet) and
**1200px**/900px (desktop/chat layout), with the first mobile-first default below 768px.

## Why plain CSS, not Tailwind or a component library

The previous frontend (Stages 2.8–2.9) used inline React style objects exclusively
(`lib/styles.ts`). That approach cannot express `:hover`, `:focus-visible`, or `@media` — all
required by this stage. The fix needed a real stylesheet, but the project's own instructions say "do
not introduce large libraries unnecessarily." Plain CSS custom properties plus a small hand-written
component set gets real pseudo-classes and media queries with zero new dependencies — see
`docs/DECISIONS.md` D-062.

## Why self-hosted fonts

`next/font/google` needs a network fetch at build time, which can break `next build` in an unfamiliar CI or sandbox. `@fontsource-variable/geist` and `geist-mono` ship the font files through npm, so the build makes no font requests and every platform gets the same type. See D-075, which replaces D-063.

## Motion and backgrounds

- `components/Ambient.tsx`: the fixed background (slow gradient orbs, dot grid, grain) and the pointer spotlight on cards.
- `components/marketing/SeatField.tsx`: the canvas venue behind the landing hero. Capped at 30fps, pauses off screen, and draws one still frame under reduced motion.
- `components/marketing/AssistantPreview.tsx`: a looping example of the booking flow, labelled as an example, using a real listing.
- Booking state (selected seats, the hold countdown) never animates from invisible.
- References: arena42.ai, and on Mobbin Sweatpals, Grok, Plane and Gumloop.

## Component inventory (`apps/web/src/components/ui/`)

| Component | Purpose |
|---|---|
| `Button` / `LinkButton` | `primary`/`secondary`/`ghost`/`danger` variants, `sm`/`md` sizes, `block` for full-width. |
| `Card` | Base surface; `raised` for an elevated panel, `interactive` for hover-lift (list items, catalogue cards). |
| `Badge` | Status pills (`success`/`danger`/`warning`/`info`/default) — order status, event status, role. |
| `Field` / `TextInput` / `TextArea` / `Select` | Labelled form controls; `Field` always pairs a `<label for>` with an id. |
| `EmptyState` | Consistent "nothing here yet" treatment, optional CTA. |
| `ErrorBanner` | The one place server error messages are rendered — never a generic "something went wrong." |
| `Skeleton` / `SkeletonCard` | Shimmer loading placeholders (disabled under `prefers-reduced-motion`). |
| `EventCard` | The shared event tile used on the landing page, catalogue, and inside chat messages. No image field exists on an event (a pre-existing Part A gap), so the media area renders a deterministic per-id gradient — never a stock photo pretending to depict the event (D-064). |

Chat-specific components live in `apps/web/src/components/chat/` (`MessageBubble`, `ConfirmationCard`)
since they depend on the `/agent/chat` response shape, not the generic UI kit.

## Responsive conventions

- Mobile-first: base styles target the narrowest layout; `@media (min-width: 768px)` and `(min-width:
  900px)`/`1200px` add columns/reveal desktop-only chrome.
- The site nav collapses to a real functional mobile menu below 768px (not a squished desktop bar) —
  verified via Playwright screenshot with the menu open.
- The chat layout (`chat-shell`) is single-column below 900px (sidebar hidden, full-width thread) and
  two-column above it.
- No page was found to produce horizontal overflow at 375/768/1440px — checked programmatically
  (`document.documentElement.scrollWidth > clientWidth`) during the Stage B6 Playwright sweep, not
  just eyeballed.

## Accessibility conventions

- Every form input has an associated `<label for>` via the `Field` component.
- `:focus-visible` renders a 2px amber outline globally (`globals.css`'s `:focus-visible` rule) —
  verified by pressing Tab in a real browser and screenshotting the result, not just reading the CSS.
- Semantic landmarks: `<nav>`, `<main>`, `<footer>`; headings follow document order (`h1` once per
  page, `h2`/`h3` for sections).
- `ErrorBanner` uses `role="alert"`; the confirmation card uses `role="alert"` as well, since it
  represents a time-sensitive state the user should notice.
- Interactive elements are real `<button>`/`<a>` elements, never a `<div onClick>`.

## Known limitations

- No automated accessibility audit tool (e.g. axe-core) was wired in — verification here is manual
  (screenshot + keyboard-tab inspection), appropriate for this project's scope but not exhaustive.
- Color contrast was checked visually against the chosen palette, not measured against WCAG ratios
  with a tool.
- No dark/light theme toggle — the product has one deliberate dark identity throughout.

## Patterns referenced from Mobbin (2026-11-02)

Used for layout and interaction patterns only. No assets or copy came from these apps.

| Screen | Reference | What it informed |
|---|---|---|
| Browse | [Meetup](https://mobbin.com/screens/b4fe71f0-664e-439c-a0a8-427f227bd361), [Sweatpals](https://mobbin.com/screens/ff5cbd8d-9929-4d9a-a2eb-e87fc8df8785), [GetYourGuide](https://mobbin.com/screens/f57f3a57-c46c-473a-adc9-31ca9100f2df) | Search-and-location bar, filter chips in one row, media-first cards with no border |
| Date tile on cards | [Apple Music concerts](https://mobbin.com/screens/b896bf23-466c-42f0-9298-dbbb6756bd10) | Calendar-style date tile on the card's media |
| Event page | [Sweatpals](https://mobbin.com/screens/19e9bbfa-126b-42bb-8075-a08f8cf89237) | Dark two-column layout, icon tiles for date and venue, cancellation policy as its own section |
| Booking panel | [GetYourGuide](https://mobbin.com/screens/809cd489-7f0a-4dc3-bb8e-ffe31b00fa22) | Sticky "From ₹" panel with reassurance lines beneath the action |
| Assistant | [Plane](https://mobbin.com/screens/1d95ef0c-69df-49e5-a2af-45ba7bb5d456), [Attio](https://mobbin.com/screens/3fd10268-cb96-42b2-8886-0ab9dcf50793) | Centred composer with a suggestion list, recents sidebar, assistant text without a bubble, follow-up prompts |
| Organiser overview | [Sweatpals](https://mobbin.com/screens/6f0e80ad-7587-43f0-a41a-07ecb1318059) | Sidebar shell, KPI row, capacity meters |
| Sales | [Mercor](https://mobbin.com/screens/8cebd1ce-423c-4752-a403-0e8cd26d1156), [HoneyBook](https://mobbin.com/screens/5ed1ee20-c294-478f-9907-e37fbe348336) | Summary figures above one chart, date range above the data |

Headings moved from the serif display face to the body sans on product screens; the serif stays on the landing hero (`.display`). The sales chart is single-series with direct labels, so nothing relies on colour, and its bar colour (`--chart-bar`) has at least 3:1 contrast on the dark surface.
