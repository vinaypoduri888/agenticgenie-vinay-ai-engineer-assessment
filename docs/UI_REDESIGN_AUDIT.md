# UI Redesign Audit — premium hero, 3D/immersive evaluation, full visual pass

> **Partly out of date (2026-11-02).** Written before the independent review recorded at the end of [PROGRESS.md](PROGRESS.md), which reproduced and fixed real bugs this document doesn't know about. Where they disagree, the code, the regression tests in `apps/api/test/regressions/`, and DESIGN.md are correct.

A dedicated visual-quality milestone on top of the already-complete B6 redesign, triggered by an
explicit review that the landing page in particular did not yet meet the "premium, futuristic,
immersive" bar the product needs. Conducted as a skeptical, from-scratch look at the existing
frontend — screenshots were taken and judged critically before any code was written, not assumed
acceptable because B6 had already shipped.

---

## 1. Previous UI weaknesses, identified honestly

A fresh screenshot of the live app (not a re-read of the B6 docs) surfaced four real, specific
weaknesses:

1. **The hero was flat text beside a plain bordered list.** No depth, no atmosphere, no imagery —
   purely typography and a bordered "Try asking" card. It read as "clean minimal text page," not
   "immersive, art-directed, cinematic." This was the single clearest gap against the brief, and the
   one the candidate specifically called out.
2. **The AI assistant's welcome state had a large, dead void** below the suggested-prompt buttons —
   functional, but visually unfinished, especially next to a now-richer hero.
3. **The organiser dashboard was a single sparse card** (one membership, six flat bordered buttons)
   sitting in a large black void — the weakest page in the app relative to the stated bar.
4. **The event detail page had zero visual continuity with the catalogue it was reached from** — a
   user clicks a card with a colored gradient top, then lands on a page with no gradient, no media
   area at all, and a raw, unformatted `toLocaleString()` timestamp (with seconds) inconsistent with
   the "D Mon YYYY" format used everywhere else in the app.

None of these were functional defects — Part A/B's business logic, security, and confirmation
behavior were all already correct (see `docs/PART_B_FINAL_REPORT.md`). This was a presentation-only
pass; no backend business rule was touched except the small, additive conversation-title change
described in §3.

---

## 2. New visual direction

Kept the existing B6 identity (deep charcoal canvas, warm off-white text, one amber accent, serif
display / sans body pairing — see `docs/FRONTEND_DESIGN_SYSTEM.md`) rather than replacing it; the
palette and typography were never the problem. The fix was **adding depth and motion where none
existed**:

- A perspective field of real upcoming events rendered as floating "ticket" cards (dashed
  perforation, real title/date/price/city — never invented data), layered amber + violet blurred
  glows, a faint grain overlay, and pointer-driven parallax.
- A centered, glowing brand mark for the assistant's empty state instead of a void.
- A proper tile grid with one-line descriptions for the organiser dashboard's quick actions.
- A deterministic per-event gradient banner on the event detail page, matching its catalogue card.

---

## 3. Design-system changes (diff against B6, not a restatement of it)

- **New:** `apps/web/src/components/marketing/HeroVisual.tsx` and the `.hero-stage`/`.hero-glow`/
  `.hero-ticket*` CSS rules in `globals.css` (hero composition).
- **New:** `.chat-empty`/`.chat-empty-mark` CSS (assistant welcome centering + brand mark).
- **New:** `.dashboard-tile-grid`/`.dashboard-tile` CSS + `.organiser-cta*` CSS (dashboard tiles,
  landing-page organiser CTA section — the "Organiser call-to-action" section the spec asked for,
  which the original B6 landing page never actually had).
- **New:** `.event-detail-banner*` CSS, reusing `EventCard`'s existing `gradientFor(id)` helper
  (exported for reuse rather than duplicated).
- **New:** `apps/web/public/favicon.svg` + `metadata.icons` in `layout.tsx` (B6 shipped with no
  favicon at all — a real 404 caught by Lighthouse, see §6).
- **Fixed, not new:** `.footer-heading`'s color token (contrast fix, see §6).
- No new dependency was added anywhere in this milestone. No existing token, component, or page was
  removed.

---

## 4. The 3D/immersive decision

See `docs/DECISIONS.md` D-066 for the full reasoning. Summary: evaluated React Three Fiber honestly
against a CSS 3D composition and chose CSS — a real WebGL scene for one hero moment on a ticketing
app (not a 3D showcase product) would add ~600KB+ gzipped, a genuine WebGL-availability risk in
headless/CI and some mobile browsers, and real lighting/material investment to avoid looking like a
generic rotating-object demo. The CSS approach (`perspective`, `rotate3d`, `translate3d`, blurred
radial gradients, a pointer-move listener writing `--px`/`--py` custom properties) gets genuine
dimensional depth — confirmed by screenshot, not assumed — with zero new dependency, zero WebGL
risk, and perfect Lighthouse performance scores (§6). `prefers-reduced-motion: reduce` is respected
by skipping both the float `@keyframes` animation and the pointer listener entirely; verified via
`page.evaluate(() => getComputedStyle(...).animationName)` under Playwright's `reducedMotion:
"reduce"` emulation, returning `"none"` — not just inferred from reading the CSS.

**Before/after, landing-page hero (desktop, 1440×900):**
- *Before:* flat two-column layout — headline/CTAs on the left, a plain bordered list of three
  example-prompt buttons on the right. No imagery, no depth, no motion.
- *After:* the same headline/CTAs, now beside a perspective field of three real upcoming events as
  floating, slightly-rotated "ticket" cards with a warm amber glow behind them, idle float animation,
  and mouse-parallax. Screenshots saved this session (not committed to the repo, consistent with
  this project's existing practice of not committing Playwright-captured binaries):
  `before-landing-hero-desktop.png` → `v1-hero-desktop.png` under this session's scratch directory.

---

## 5. Pages touched

`apps/web/src/app/page.tsx` (hero rebuild, new organiser-CTA section), `apps/web/src/app/assistant/
page.tsx` (welcome-state centering), `apps/web/src/app/organiser/page.tsx` (tile-grid redesign),
`apps/web/src/app/events/[id]/page.tsx` (gradient banner, date formatting fix),
`apps/web/src/components/ui/EventCard.tsx` (`gradientFor` exported for reuse), plus the backend
`apps/api/src/modules/agent/conversation.ts`/`router.ts`/`apps/api/src/evals/runner.ts` for the
conversation-title change (D-067) — the only non-presentation code touched this milestone, and
purely additive cosmetic metadata, not a business/security rule.

Pages reviewed and found already meeting the bar, left unchanged: catalogue, login/register, orders,
organiser events/venues/reports/checkin/refunds/audit sub-pages (already redesigned with the B6
component set and tile-consistent styling).

---

## 6. Responsive results — all 7 required viewports, real Playwright screenshots

| Viewport | Landing | Catalogue |
|---|---|---|
| 320×720 | no overflow | no overflow |
| 375×812 | no overflow | no overflow |
| 430×932 | no overflow | no overflow |
| 768×1024 | no overflow | no overflow |
| 1366×768 | no overflow | no overflow |
| 1440×900 | no overflow | no overflow |
| 1920×1080 | no overflow | no overflow |

All 14 checks used `document.documentElement.scrollWidth > clientWidth`, not eyeballing. The
smallest viewport (320×720) was screenshotted and confirmed readable with correctly-stacked content.
The mobile nav menu was opened via Playwright and confirmed to show real, non-overlapping menu items
(toggle button correctly flips "Menu" ↔ "Close"). The hero composition recedes to a shorter,
simplified stage (320px tall vs. 440px desktop) below 900px rather than being forced to resize 1:1.

---

## 7. Accessibility checks

- **Keyboard focus:** tabbing through the landing page lands on real `<a>`/`<button>` elements with
  a visible amber `:focus-visible` ring (screenshotted after 4 `Tab` presses, not just read from
  CSS).
- **Reduced motion:** confirmed via `reducedMotion: "reduce"` emulation that `.hero-ticket`'s
  computed `animation-name` is `"none"` — the float animation and the pointer-parallax listener are
  both skipped entirely, not just "less noticeable."
- **Labels:** no new form inputs were introduced this milestone; existing `Field`-based labeling
  (B6) is unchanged.
- **Color contrast:** a real, specific WCAG AA failure was found and fixed — see §8. No other
  contrast failures were reported by the same scan.
- Known limitation, carried over from B6 and still true: no axe-core or other automated a11y tool is
  wired into CI; Lighthouse's accessibility category (run for real this milestone, see §8) is the
  closest to an automated check this project has.

---

## 8. Real Lighthouse measurements (production build, `next build` + `next start`, not dev mode)

| Page | Preset | Performance | Accessibility | Best Practices | SEO |
|---|---|---:|---:|---:|---:|
| `/` (landing) | desktop | 100 | 100 | 100 | 100 |
| `/` (landing) | mobile (default) | 98 | 100 | 100 | 100 |
| `/assistant` | desktop | 100 | 100 | 100 | 100 |

These are the scores **after** two real, specific issues found by the first run were fixed:

- **Color contrast (accessibility, was 96):** `.footer-heading` used `--color-text-faint` (#6f6c66)
  on `--color-bg` (#0b0c0e) at 12.48px — a measured 3.73:1 ratio, below WCAG AA's 4.5:1 minimum for
  normal text. Fixed by switching to `--color-text-muted`. Re-run confirmed `color-contrast` audit
  score 1 (pass).
- **Console error / broken network request (best practices, was 96):** no favicon existed anywhere
  in the app — a genuine `404` on `/favicon.ico`, logged as a console error. Fixed by adding
  `apps/web/public/favicon.svg` and `metadata.icons` in the root layout (the `app/icon.svg`
  file-convention route did not reliably serve a `<link>` tag in this environment — the explicit
  `metadata.icons` API is the more robust fix). Re-run confirmed `errors-in-console` audit score 1.

Neither of these had ever been caught before, because no prior stage had actually run Lighthouse (or
any accessibility-scoring tool) against this app's real production build — a genuine gap in this
project's own verification history, not introduced by this milestone.

---

## 9. Functional audit (Playwright, real backend, real Postgres, real production build)

14 of 15 scripted checks passed on the first run; the one failure (`event-detail loads`, checked
immediately after `waitForURL` with no settle time) was a false negative in the test script itself —
a follow-up debug run with a short wait confirmed the page genuinely renders (`h1` text "Weekend
Stand-Up Special", zero console errors). Not a product defect.

Verified for real, with assertions against actual state (not just HTTP 200 or page-title presence):

- Visitor: landing loads, catalogue shows real events, event detail loads, logged-out `/assistant`
  shows a proper sign-in prompt (not a broken page).
- Attendee: login → "Find comedy shows in Pune" returns grounded event cards with citations rendered
  as readable links (verified the raw `[event:` token never appears in the rendered DOM) → "Book the
  first one" produces a real confirmation card → an **ambiguous** reply ("Yes, but for another
  event") was sent first and verified via a direct `/me/orders` count check (before === after, no
  order created) → a genuine "Yes" on a fresh attempt completes a real purchase, verified both in
  the chat transcript and on `/orders` (status `PAID`) → conversation history sidebar is populated
  with the real titled conversation (D-067).
- Organiser admin: dashboard shows the new tile grid, sales report loads with real data.
- Staff: role-scoped organiser dashboard renders correctly.

A number of `requestfailed` network events were observed during rapid scripted navigation
(`?_rsc=...` requests to `/events/:id` and organiser sub-pages) — these are Next.js App Router's
own React Server Component prefetch requests, which the browser legitimately aborts when a test
script navigates away before they resolve. Investigated and confirmed benign: no genuine console
`error`-level message accompanied them, and every page they relate to was independently confirmed to
load and render correctly.

---

## 10. Known limitations, stated honestly

- `node dist/src/server.js` (the literal compiled production start path) still does not run, for a
  reason unrelated to this milestone's scope: `packages/db`/`packages/shared`/`packages/agent` point
  their `package.json` `main` at raw `.ts` source, which `tsx` transpiles on the fly but plain `node`
  cannot execute. This is pre-existing, project-wide infrastructure, not a UI-redesign concern — see
  D-068 for the full reasoning and what a proper fix would involve. This milestone's Lighthouse and
  functional verification used `tsx` for the API (functionally identical business logic) against the
  real `next build`/`next start` frontend, which is what this milestone's scope actually required.
- No automated visual-regression or axe-core accessibility tooling is wired into CI — verification
  here is a real, one-time Playwright + Lighthouse pass, not a standing automated gate.
- The hero's floating-ticket composition always shows the first 3 items from `/events?limit=6` —
  there is no dedicated "pick visually interesting events for the hero" curation; this matches the
  rest of the app's "never invent or curate fake data" discipline, at the cost of the hero not being
  able to guarantee a particular visual mix of categories.
- Declined-payment/expired-hold paths remain undemonstrable through the chat UI specifically (an
  existing B6-documented limitation of the fake-payment design, not something this milestone changed
  or was asked to change).

---

## 11. Final verification — all run for real, just now

- `apps/api` test suite: **183/183** passing.
- `packages/agent` test suite: **96/96** passing.
- `npm run eval`: **20/20** passing (unaffected by any frontend change, as expected).
- Root `npm run typecheck`: clean across all 5 workspaces.
- `apps/api` production build (`tsc`): clean.
- `apps/web` production build (`next build`): clean, 17 routes.
- `npx prisma migrate status`: up to date.
- Lighthouse (production build): see §8.
- Playwright functional audit: see §9.
- `git status`: clean. No `.pdf`, `.docx`, real `.env`, or other confidential/secret material
  tracked (same scan pattern used at every prior pre-push review this session).

## Commit hashes (branch `feature/part-b-agent`, not pushed)

- `3d01feb` — feat(web): redesign the landing-page hero with a dimensional ticket composition
- `30df5a7` — feat(web): polish the assistant welcome state, organiser dashboard, and event detail
- `6c77bca` — fix(api,web): correct prod env-path resolution, footer contrast, and add a favicon
- (this commit) — docs: UI redesign audit, progress, and decisions
