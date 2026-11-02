# B6 Frontend Redesign — Proposal (not implemented this stage)

> **Partly out of date (2026-11-02).** Written before the independent review recorded at the end of [PROGRESS.md](PROGRESS.md), which reproduced and fixed real bugs this document doesn't know about. Where they disagree, the code, the regression tests in `apps/api/test/regressions/`, and DESIGN.md are correct.

Written during Stage B1, after re-reading every page under `apps/web/src/app/` and `lib/styles.ts`.
This is a proposal for Stage B6, once the agent's real tool-calling (Stage B2+) exists to build a
chat UI against. Nothing here is implemented yet — Stage B1 deliberately does not touch `apps/web`.

## Where the frontend actually stands today

- Every page is a `"use client"` component calling the real API directly through
  `lib/api.ts`'s `apiFetch` — no mocked data, no client-side permission logic (see D-038/D-039).
  That architecture is sound and should not change for B6; only the visual layer needs work.
- Styling is five shared inline-style objects in `lib/styles.ts` (`inputStyle`, `buttonStyle`,
  `secondaryButtonStyle`, `cardStyle`, `errorStyle`, `mutedStyle`) — flat colors (`#111`, `#ddd`,
  `#b00020`), no spacing scale, no type scale, no dark mode, reused as-is across every page
  (attendee catalogue, event detail, orders, and the entire organiser dashboard).
- Event cards (`events/page.tsx`) are plain bordered boxes: title, venue/city, a price line — no
  imagery, no visual hierarchy between a sold-out and an on-sale event, no category/status
  affordance beyond text.
- There is no design-token file, no component library, no shared `Button`/`Card`/`Badge`
  components — every page re-declares its own JSX structure around the same five style objects.
- Loading/error/empty states exist everywhere (a real, audited strength — see A-criteria
  verification) but are plain text (`<p>Loading…</p>`, `<p style={errorStyle}>`), not designed.

## Direction for B6

**1. A real design-token file**, `apps/web/src/lib/tokens.ts` (or CSS custom properties in
`globals.css`), replacing the flat colors in `lib/styles.ts` with a small, deliberate system: a
primary/neutral/success/danger color scale (5–7 stops each, not just one hex per concept), a
type scale (display/heading/body/caption with real line-heights, not just `fontSize: 13`), and a
spacing scale (4/8/12/16/24/32/48) used consistently instead of ad-hoc pixel values scattered
through each page's inline `style={{ marginLeft: 12 }}`.

**2. Component extraction, not more inline styles.** `Button`, `Card`, `Badge` (for event/order
status — `PUBLISHED`/`ON_SALE`/`SOLD_OUT`/`CANCELLED` each deserve a distinct, legible treatment,
not the same gray text everywhere), `Input`/`Select` with consistent focus states, and an
`EmptyState`/`ErrorState`/`LoadingState` trio so every page's already-good state coverage also
*looks* considered instead of being a bare paragraph. This is mechanical, low-risk work — the
data-fetching logic in every page stays untouched; only the JSX returned changes.

**3. Event-card and discovery redesign.** The catalogue (`events/page.tsx`) is the first thing an
attendee sees — it should look like a product, not a table: a responsive card grid (not a
single-column list), a status badge, a price treatment that reads clearly at a glance, and room
for an event image once the data model supports one (it doesn't yet — Part A's `Event` model has
no image field; adding one is a small, safe schema extension worth considering alongside this,
not blocking it).

**4. The AI chat interface — the centerpiece of B6.** Once Stage B2 wires real tools and Stage
B3+ adds citations/confirmation, the chat UI needs to show its work, not just a text bubble:
- Each tool call the agent makes should render as a small, dismissible "used `search_events`"
  / "used `get_event`" chip with its duration — directly surfacing the tracing data `packages/agent`
  already collects (`AgentTrace.steps[].toolCalls`), not inventing new plumbing for it.
- Citations (`FinalAnswer.citations`) should render as clickable references back to the actual
  event/review/order card they point at, not just italicized text — this is also how a grader
  verifies "grounded citations... visible to the user," per the PDF.
- A `needsConfirmation: true` final answer should render a distinct, clearly-bordered confirmation
  prompt tied to the specific hold/order it's about (matching `PendingConfirmation`'s shape) —
  never a generic "are you sure?" that could be answered out of context.
- Tool-execution visibility should default to collapsed-but-expandable, so the chat reads cleanly
  for a casual user but a grader (or the candidate, live) can expand it to prove the loop's
  internals are real, not scripted theater.

**5. Organiser dashboard polish.** The venue/seat-map/reports/audit pages are functionally
complete and already audited — this is lower priority than the attendee/chat surfaces, but the
same token/component system should extend here too: a real data-table component for sales
reports and audit entries (currently plain divs), and clearer visual separation between an
organiser's admin-only actions and staff-visible-only ones.

**6. Responsive layout.** Nothing in the current frontend has been built or tested at
tablet/mobile widths — B6 should establish a small number of breakpoints (not a full
mobile-first rewrite) and verify the catalogue, event detail, and chat panel specifically, since
those are the three surfaces most likely to be used on a phone in a real demo.

## What this proposal deliberately does NOT include

No new component library dependency (Tailwind/MUI/shadcn) is assumed — the existing inline-style
approach can evolve into a tokens-plus-extracted-components system without a new dependency,
which keeps the "5-command setup" promise intact. If a library turns out to meaningfully speed up
B6, that's a decision to make explicitly at the start of B6, not something to smuggle in here.
No visual changes are made in this stage — this file is the plan, not the work.
