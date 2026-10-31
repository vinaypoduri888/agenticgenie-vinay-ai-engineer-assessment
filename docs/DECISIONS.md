# Decisions Log

Important architecture/implementation decisions, in plain language, for interview defensibility.

---

### D-001: Technology stack

- **Decision:** Next.js + TS frontend, Express 5 + TS backend, Prisma + PostgreSQL, Redis + BullMQ
  for background jobs only, custom TypeScript agent harness, NVIDIA Nemotron via an
  OpenAI-compatible endpoint as the real model provider, Vitest/Playwright/k6/Postman for testing,
  Docker Compose for local env, GitHub Actions for CI.
- **Why we chose it:** The assessment grants full stack freedom and only requires ≤5-command setup,
  Postgres (preferred) as the source of truth, and a custom (non-framework-hidden) agent loop. This
  stack is a modern, strongly-typed, end-to-end TypeScript stack the candidate already has direct
  experience with (Node/Express, Next.js, Prisma, Postgres, Redis), which supports fast, defensible
  delivery under a ~12–16 hour time budget, and keeps one language across frontend/backend/agent so
  Zod schemas can be shared instead of duplicated.
- **Alternative considered:** Python/FastAPI backend (also suggested by the PDF) — rejected because
  it would split the stack across two languages for no functional benefit, and the Zod-based typed
  tool schemas Part B asks for are more natural in TypeScript.
- **Trade-off:** More moving parts (Prisma, Redis/BullMQ, Docker Compose) than a minimal SQLite +
  single-process solution; mitigated by keeping Redis usage narrow (hold-expiry sweeper only — never
  the inventory source of truth) and Docker Compose optional-but-provided for the 5-command setup.
- **Interview explanation:** "I picked a stack I could move fastest and most correctly in under a
  tight deadline, while keeping every component swappable — the agent loop doesn't care which model
  provider or DB client it's talking to, because those sit behind small interfaces."

---

### D-002: Confidential material handling

- **Decision:** The assessment PDF and the candidate's own docx notes paraphrasing it are excluded
  from git via `.gitignore`, never committed.
- **Why we chose it:** The PDF is explicitly marked confidential ("Please do not share or publish
  this document") and the assessment is a public/shared GitHub repo deliverable. The docx closely
  restates the PDF's confidential details, so it's treated the same way out of caution.
- **Alternative considered:** Committing a redacted summary — rejected as unnecessary; the extracted
  `docs/ASSESSMENT_REQUIREMENTS.md` already captures everything needed to work and to explain the
  submission, without reproducing the original document.
- **Trade-off:** None meaningful — nothing in these files is needed by a reviewer running the repo.
- **Interview explanation:** "The brief said not to publish the document, so I kept it and my notes
  on it local-only and git-ignored, and committed a derived, non-confidential requirements
  checklist instead."

---

### D-003: npm workspaces monorepo, TS-source packages (no build step for dev)

- **Decision:** `apps/api`, `apps/web`, `packages/db`, `packages/shared` as npm workspaces.
  `packages/db` and `packages/shared` are consumed as raw TypeScript source (via `tsx` for the API,
  Next's `transpilePackages` for the web app, and Vitest's built-in esbuild transform for tests) —
  no compile step is required for local dev.
- **Why we chose it:** npm workspaces ship with npm (no extra tool like pnpm/Turborepo to install
  or explain), and skipping a build step for the internal packages keeps the ≤5-command setup
  genuinely simple — editing a shared Zod schema is visible to the API and web app immediately.
- **Alternative considered:** pnpm + Turborepo — rejected as unnecessary overhead for a 4-package
  monorepo on a tight deadline; could revisit if the agent/evals packages (Part B) make the build
  graph more complex.
- **Trade-off:** `packages/db`/`packages/shared` have no real "build" output, so a production
  deployment would need one added later (out of scope — the assessment doesn't require deployment).
- **Interview explanation:** "I treated the shared packages as source, not build artifacts — tsx,
  Next, and Vitest all transpile TypeScript on the fly, so there's nothing to build until I actually
  need a production bundle, which this assessment doesn't require."

### D-004: Classic `prisma-client-js` generator, not Prisma's new `prisma-client` generator

- **Decision:** `packages/db/prisma/schema.prisma` uses `generator client { provider =
  "prisma-client-js" }`, producing the conventional client importable as `from "@prisma/client"`.
- **Why we chose it:** Prisma 6.19's CLI now defaults `prisma init` to a newer `prisma-client`
  generator that emits raw `.ts` source files (including a platform-specific native binary) into a
  project folder, imported via explicit `.ts` extensions — which requires `allowImportingTsExtensions`
  and reshapes how the typecheck/build config works. Confirmed via a throwaway scratch project
  before deciding (see PROGRESS.md Stage 1). The classic generator avoids all of that for no loss
  of functionality at this project's scale.
- **Alternative considered:** the new `prisma-client` generator — rejected for now as unnecessary
  complexity; may be worth revisiting in the "another week" list in DESIGN.md.
- **Trade-off:** classic generator is the path Prisma is nudging users away from long-term, so a
  future Prisma major version could deprecate it — acceptable risk for a 1-week assessment.
- **Interview explanation:** "I actually tried Prisma's new default generator first, saw it meant
  importing `.ts` files directly and baked-in native binaries, and deliberately stepped back to the
  classic generator — simpler, well-documented, works identically across tsx/Vitest/Next without
  special tsconfig flags."

### D-005: Dependency versions pinned to the latest Node-20-compatible release

- **Decision:** Where a package's npm `latest` tag required a newer Node than the installed 20.17
  (Prisma 7→**6.19.3**, Vitest 5→**4.0.8**, concurrently 10→**9.2.5**), pinned to the newest version
  in the prior major that still declares `engines.node` support for 20.x, instead of upgrading the
  machine's Node install.
- **Why we chose it:** nvm-windows was present but non-functional in this environment (silent
  failures investigated and not worth the detour); changing a shared, system-wide Node install is a
  bigger and less reversible action than pinning a few package.json ranges, and every pinned version
  is still current (not legacy) within its major line.
- **Alternative considered:** upgrade Node to 22/24 via nvm-windows — would unlock the latest major
  of every package, but the tool didn't work out of the box and wasn't worth fighting for a one-week
  assessment; documented here so it's an easy follow-up if the grading machine has a newer Node.
- **Trade-off:** not running the absolute newest major of Prisma/Vitest; functionally irrelevant at
  this project's scope.
- **Interview explanation:** "I checked actual engine requirements with `npm view <pkg> engines`
  before pinning versions, rather than guessing — a few packages had just bumped their Node minimum
  past what was installed here, so I pinned to the latest release that still supported it."

### D-006: Non-default local Docker ports for Postgres/Redis

- **Decision:** `docker-compose.yml` maps Postgres to host port **5434** (container still listens
  on 5432) and Redis to host port **6380** (container still listens on 6379).
- **Why we chose it:** this dev machine already had unrelated Postgres/Redis processes bound to the
  default ports (confirmed via `Get-NetTCPConnection` — one was a native/other local Postgres
  process, the other an unrelated Docker container from a different project: `boc-redis`). Changing
  our own port mapping is the non-invasive fix; stopping someone else's running container/service
  would not be.
- **Alternative considered:** stop the conflicting local services — rejected, they belong to
  unrelated work and are out of scope to touch.
- **Trade-off:** `DATABASE_URL`/`REDIS_URL` in `.env.example` use non-default ports, which a
  reviewer on a clean machine can freely change back to 5432/6379 if they prefer. CI (GitHub
  Actions runners are isolated) uses the real default ports, so this only affects local dev here.
- **Interview explanation:** "Rather than fight for the default ports on a machine already running
  other projects' databases, I remapped the host side only — the containers are still standard
  Postgres 16 / Redis 7 internally."

### D-007: Part A domain schema — 18 models, no HoldItem/OrderItem

- **Decision:** `packages/db/prisma/schema.prisma` implements the full Part A domain: User,
  Organiser, OrganiserMembership, Venue, Section, Row, Seat, Event, TicketTier, EventSeat, Hold,
  Order, Payment, Ticket, Refund, Review, AuditLog, IdempotencyRecord.
- **Why we chose it:** Mirrors the PDF's minimum domain model directly. Two simplifications from a
  literal reading of "hold items"/"order items": `EventSeat.holdId` already answers "which seats are
  in this hold" (no separate `HoldItem` table), and `Ticket` already *is* the order line item — it
  carries its own price, seat/tier reference, and status (no separate `OrderItem` table). `Event`
  denormalizes `organiserId` (also derivable via `venue.organiserId`) because tenant-isolation checks
  run on nearly every query and are security-critical — worth the narrow, explicit duplication.
  `Organiser.currency` (single currency per organiser) avoids a repeated currency column on every
  money-bearing row. `Event.refundWindowHours` defaults to 24 (PDF doesn't specify a value).
- **Alternative considered:** explicit `HoldItem`/`OrderItem` tables for literal fidelity to the
  PDF's wording — rejected as a pure pass-through layer adding no information `EventSeat`/`Ticket`
  don't already carry.
- **Trade-off:** `category` is a plain indexed string, not an enum (PDF doesn't enumerate valid
  categories); one review per user per event is enforced (`@@unique([eventId, userId])`), not
  explicitly required by the PDF but matches "review attended events" as one verdict per attendee.
- **Interview explanation:** "I looked for where the PDF's conceptual entities map onto data that
  already has to exist somewhere else, and collapsed the ones that would just forward fields."

### D-008: Composite foreign key ties Event to its own organiser's Venue

- **Decision:** `Venue` has `@@unique([id, organiserId])`; `Event.venue` is declared as a composite
  relation on `(venueId, organiserId) → (Venue.id, Venue.organiserId)`.
- **Why we chose it:** An event referencing another organiser's venue is a real tenant-isolation
  bug class, not a hypothetical — this makes it structurally impossible at the database level, not
  just checked in application code (which still runs first, for a clean 400 instead of a raw
  constraint-violation error).
- **Alternative considered:** application-only validation — rejected per explicit instruction; the
  DB must be the backstop, not the only check.
- **Trade-off:** none meaningful — one extra unique index on Venue, one composite FK instead of a
  simple one on Event.
- **Interview explanation:** "I made `organiserId` part of the join key itself, so the foreign key
  constraint can't be satisfied unless the venue and the event agree on which organiser owns them."

### D-009: snake_case `@map`/`@@map` everywhere

- **Decision:** every model and non-trivial field has an explicit `@map`/`@@map` to snake_case
  (e.g. `TicketTier` → `ticket_tiers`, `priceMinor` → `price_minor`).
- **Why we chose it:** this project relies on hand-written raw SQL for atomic conditional updates,
  row locking, and the CHECK constraints below (D-010) — all far more ergonomic against lowercase,
  unquoted Postgres identifiers than Prisma's un-mapped default (which preserves PascalCase and
  requires quoting every identifier in raw SQL).
- **Trade-off:** more verbose schema.prisma; worth it given how much raw SQL is planned.

### D-010: Hand-written raw-SQL migration for constraints Prisma can't express

- **Decision:** a second migration (`add_db_constraints`, intentionally separate from the
  Prisma-generated `init_ticketing_schema` migration so the generated SQL stays untouched) adds:
  - `CHECK (remaining_quantity >= 0 AND remaining_quantity <= total_quantity)` on `ticket_tiers`.
  - A **partial** unique index `holds(event_id, user_id) WHERE status = 'ACTIVE'` — "one active hold
    per user per event," filtered so a user can hold the same event again after a prior hold
    resolves.
  - `CHECK` on `holds`: GA fields present iff `kind = 'GA'`, absent iff `kind = 'SEATED'`.
  - `CHECK` on `event_seats`: `hold_id` set iff `status = 'HELD'`.
  - `CHECK` on `tickets`: exactly one of `event_seat_id` / `ticket_tier_id` set.
- **Why we chose it:** Prisma's schema DSL has no CHECK-constraint attribute and no filtered/partial
  unique index support. All five were manually verified against the live database (constraint
  listings via `psql \d+`, plus three negative-case inserts inside a rolled-back transaction proving
  the composite FK, the quantity CHECK, and the partial unique index each reject invalid data) —
  see docs/PROGRESS.md Stage 2 for the exact commands and output.
- **Trade-off:** these constraints exist in migration history but aren't visible in schema.prisma
  itself — documented here and in the schema's own comments so a future schema change doesn't
  accidentally assume they don't exist. Future `prisma migrate dev` runs diff against the replayed
  migration history (which includes this file), not live DB introspection, so they won't be
  silently dropped by an unrelated schema change.

### D-011: Idempotency — claim/finalize/stale-takeover protocol via `lockToken`

- **Decision:** `IdempotencyRecord` has `status (PROCESSING|COMPLETED)`, `lockToken`, `updatedAt`.
  Claiming a key is an `INSERT`; a unique-violation on retry means a record already exists — replay
  if `COMPLETED` and the request hash matches, `422` if the hash differs, `409` if `PROCESSING` and
  fresh. If `PROCESSING` and stale (`updatedAt` older than a configurable grace period, default
  30s), a new request may take over via a compare-and-swap on the specific old `lockToken` it read
  (`UPDATE ... WHERE lock_token = :old`) — only one concurrent takeover attempt can win this.
- **Ownership safety without a `lockToken` column on every table:** rather than propagate
  `lockToken` onto `Order`/`Payment`/`Ticket`, the authoritative finalize transaction makes the
  `lockToken`-gated `IdempotencyRecord` update its *first* statement and aborts the whole transaction
  (touching nothing else) if that update affects zero rows. Postgres holds the row lock from that
  `UPDATE` for the rest of the transaction, so a concurrent takeover attempt blocks behind it and,
  once this transaction commits or rolls back, correctly sees the record is no longer the state it
  expected and doesn't double-process.
- **Why we chose it over per-table lock columns:** equally safe (transaction atomicity + Postgres
  row locking does the serializing), without adding an unrelated column to business tables.
- **Trade-off:** requires the finalize step to always order its writes with the idempotency-gate
  update first — a convention the service layer must follow consistently, documented here for that
  reason.

### D-012: Payment checkout — three phases, never a transaction across the external call

- **Decision:** `POST /orders` runs as Phase 1 (transaction: validate event/hold via
  `SELECT ... FOR UPDATE` on the Event row, re-check `status IN (PUBLISHED, ON_SALE)` and hold
  `ACTIVE`; create-or-reuse `Order(PENDING_PAYMENT)` by looking up `Order.holdId` first — see below
  — and create a `Payment(PENDING)` row only when actually about to call the provider) → Phase 2
  (no open transaction: call the fake payment provider) → Phase 3 (transaction, Event row locked
  again, `IdempotencyRecord` ownership-gated as in D-011; finalizes `PAID`/`DECLINED`, or — if the
  event was cancelled mid-flight and the outcome was `SUCCESS` — records the charge and immediately
  creates a `Refund`, landing the order on `REFUNDED` rather than `PAID`). A client-side timeout on
  Phase 2 does **not** run "Phase 3 proper" at all — it only writes `UPDATE payments SET
  status='TIMED_OUT' WHERE id=:myPaymentId AND status='PENDING'` (a row uniquely owned by this
  attempt), leaving `Order`/`IdempotencyRecord` untouched and eligible for a later takeover.
- **Why we chose it:** holding a DB transaction open across a (simulated, possibly slow/timing-out)
  external call blocks connections/locks for the duration — exactly the scenario the PDF's timeout
  requirement is testing, so it's the one thing the design must not do.
- **Provider-side dedup:** `Payment.externalRef` equals the owning `IdempotencyRecord.id`, shared
  across every attempt (original + any takeover) of the same logical checkout. The fake provider
  keeps its own in-memory ledger keyed by `externalRef` (deliberately *not* a Prisma table — it
  stands in for a third-party system's ledger, not our durable record); the first call for a given
  `externalRef` decides the outcome, any later call for the same key replays it. This means a
  takeover's reconciliation call can't cause a real double charge, because it gets the same answer
  the original (possibly still-resolving) call will get.
- **`Order.paidByPaymentId`:** nullable, unique FK to `Payment`, set only by the winning Phase-3
  transaction — disambiguates which of possibly several `Payment` attempt-rows under one order is
  the authoritative charge (needed for refund-targeting and display).
- **Stale-takeover must not create a second Order for the same hold:** Phase 1 always looks up
  `Order` by `holdId` (unique) first. If found and still `PENDING_PAYMENT`, it's reused — only a new
  `Payment` row is created (since a new Phase 2 call is about to be made), never a new `Order`. The
  `Order.holdId` unique constraint is also a hard backstop against this at the DB level.
- **Event-cancellation coordination:** `POST /events/:id/cancel`'s Step A takes the *same* `SELECT
  ... FOR UPDATE` lock on the Event row as checkout Phase 1 and Phase 3, as its first statement —
  this fully serializes the two flows (whichever gets the lock first proceeds; the other re-reads a
  now-consistent state once it acquires the lock). Refunds triggered by cancellation are processed
  as **one transaction per order**, not one transaction for the whole cancellation, since the PDF's
  "no giant transaction across every refund" guidance applies — refunds themselves don't call an
  external provider in this synchronous fake-refund design (documented scope reduction: only the
  *charge* path simulates timeouts, matching the PDF's actual reliability requirements), so each
  refund transaction is still small and fast.
- **Trade-off:** no proactive background reconciliation sweep in Stage 2's design (an order stuck in
  `PENDING_PAYMENT` only resolves when a retry arrives) — flagged as a natural extension using the
  same BullMQ mechanism as the hold-expiry sweeper, once Part A's core flows are implemented.

### D-013: Pagination — `(createdAt, id)` composite keyset cursor, not an autoincrement sequence

- **Decision:** `Event`, `Order`, `Review`, `AuditLog` are paginated via `WHERE (created_at, id) >
  (:cursorCreatedAt, :cursorId) ORDER BY created_at, id LIMIT n`, backed by a composite index per
  access pattern (e.g. `events(status, created_at, id)`, `orders(user_id, created_at, id)`). No
  `seq`/autoincrement column.
- **Why we chose it:** a `BigInt @default(autoincrement())` sequence is allocated immediately on
  `nextval()`, independent of transaction commit order — a slower transaction can commit a lower
  sequence value after a faster one with a higher value is already visible, meaning a reader who has
  paginated past the higher value would permanently skip the lower one. `(createdAt, id)` doesn't
  have this specific failure mode for the case the PDF actually tests (new rows inserted while a
  client pages through results).
- **Honest limitation (corrected from an earlier overclaim in this design process):** keyset
  pagination eliminates the classic offset-pagination failure (rows shifting under concurrent
  inserts) — it is **not** a perfect snapshot under every possible concurrent-commit-order scenario.
  Two transactions inserting with timestamps T1 < T2 but committing in reversed order could still
  produce a narrow, accepted gap. Closing that fully needs serializable-snapshot reads or a strictly
  ordered publish step — out of scope here, and stated as a known limitation in DESIGN.md rather than
  engineered around.
- **Trade-off:** rows bulk-inserted in one seed-script transaction share an identical `createdAt`
  (Postgres's `now()` is frozen per-transaction) and sort only by `id` among themselves — stable and
  correct for pagination, just not meaningfully chronological for that batch.

<!-- Add new decisions below as they're made, each as its own ### D-NNN section. -->
