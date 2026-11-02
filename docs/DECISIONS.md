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

### D-014: bcryptjs + jsonwebtoken for auth, not native bcrypt/argon2

- **Decision:** passwords are hashed with `bcryptjs` (pure JS); sessions are a single stateless JWT
  signed with `jsonwebtoken`, HS256 only, carrying just `{ sub: userId }`.
- **Why we chose it:** `bcryptjs` has no native build step — `argon2` and native `bcrypt` both
  require node-gyp/a C++ toolchain, which is a real risk to the PDF's ≤5-command, any-machine setup
  requirement (this project already hit native-build friction with Prisma's own engine in Stage 1).
  bcrypt remains OWASP-acceptable even though Argon2id is now their top recommendation — the
  reliability trade-off is worth it here. Pinning JWT verification to `algorithms: ['HS256']`
  explicitly prevents algorithm-confusion attacks (a token claiming a different/weaker algorithm).
- **Why the token carries only `sub`:** embedding role/organiserId in the token would mean a
  membership change doesn't take effect until the token expires. Every permission check re-queries
  `OrganiserMembership` fresh, per request — slightly more DB load, substantially simpler reasoning
  about staleness and revocation.
- **Why requireAuth re-fetches the user from the DB on every request:** there's no refresh-token /
  revocation-list system in this design (a documented auth shortcut) — re-fetching is what stands in
  for revocation: a deleted account's still-unexpired token stops working on its very next request,
  rather than continuing to work until expiry.
- **Trade-off:** no logout/revocation before natural expiry; `JWT_EXPIRES_IN` defaults to 12h as a
  balance between not forcing re-login during a demo/interview session and not being absurdly long.

### D-015: 404-vs-403 split between `requireOrganiserMembership` and `requireOrganiserRole`

- **Decision:** a user with *no* membership for the resolved organiser always gets 404 (existence-
  hiding, per the PDF's isolation rule). A user who *is* a member but lacks the required role (e.g.
  STAFF hitting an ADMIN-only route) gets 403, not 404.
- **Why we chose it:** 404 is for "you have no relationship to this scope, so neither confirm nor
  deny anything about it exists." 403 is for "this scope is already known to exist for you — you're
  a member — you just don't have enough privilege for this specific action." Collapsing both into
  404 would be over-hiding (no isolation benefit, since the user already knows they're a member) and
  collapsing both into 403 would leak existence for genuinely out-of-scope organisers.
- **Interview explanation:** "404 answers 'do you have any business being here at all'; 403 answers
  'given that you do, are you allowed to do *this*.' Only the first one needs to hide existence."

### D-016: `canRefundOrder` implemented as a pure policy function now, no refund endpoint yet

- **Decision:** the self-refund rule ("staff can't refund their own order; admins can refund their
  own, the one exception") is implemented as a standalone, dependency-free function in
  `apps/api/src/modules/auth/policies.ts`, unit-tested directly, with no `Order`/refund HTTP route
  built around it yet.
- **Why we chose it:** the rule is genuinely an authorization-foundations concern (it's a decision
  about who may act on whose behalf, same category as the role middleware), so it belongs in this
  stage per the explicit test requirement — but the refund *endpoint* belongs to a later Part A
  stage once `Order`/`Refund` business logic exists. Writing the decision function now means the
  later refund route is a thin wrapper that calls an already-tested function, not new untested logic
  bolted on under time pressure.
- **Trade-off:** none — this is pure, stateless logic; wiring it into a real route later is
  mechanical.

### D-017: Event visibility split — catalogue search vs. direct GET by id

- **Decision:** `GET /events` (search/catalogue) only returns `PUBLISHED`, `ON_SALE`, `SOLD_OUT`
  events. `GET /events/:id` (direct lookup) additionally resolves `CANCELLED` and `COMPLETED`
  events; only `DRAFT` is hidden from both. Organiser members see every status via the separate
  `GET /organisers/:organiserId/events/:eventId`.
- **Why we chose it:** the PDF doesn't define this split explicitly ("list published events"). A
  cancelled or completed show cluttering "comedy in Pune this weekend" search results would be
  noise, but hiding it entirely from direct access would break legitimate uses — viewing why an
  event got cancelled, or browsing reviews for a completed one (reviews require completed events).
- **Trade-off:** a documented assumption, easy to change if the PDF's intent was narrower.

### D-018: Publish validates "has sellable inventory," not more

- **Decision:** `POST .../events/:eventId/publish` (DRAFT→PUBLISHED) requires at least one
  `TicketTier` or one generated `EventSeat` to exist; otherwise 422. All other event fields are
  already non-nullable at creation, so there's nothing else to validate for readiness.
- **Why we chose it:** publishing an event nobody can buy anything for is a real, testable footgun
  worth blocking; it's also the natural seam for whatever "required information" later stages decide
  to add (e.g. a minimum lead time before `startsAt`) without redesigning the publish flow.
- **Scope note:** only DRAFT→PUBLISHED is exposed over HTTP this stage. The full transition table
  (`PUBLISHED→ON_SALE→SOLD_OUT`, cancellation from various states, etc.) is defined in
  `statusTransitions.ts` and unit-tested, so later stages (going on sale, selling out, cancellation)
  call an already-correct rule instead of re-deriving one — same pattern as `canRefundOrder` in
  Stage 2.1.

### D-019: Event cancellation is not exposed this stage — by explicit instruction

- **Decision:** no `/cancel` endpoint exists yet, even for a `DRAFT` event with no orders.
- **Why we chose it:** cancelling an event with paid orders must resolve active holds and refund
  every paid order exactly once (see the Stage-2-schema-review transaction design in this file's
  earlier entries) — none of that machinery exists yet (no holds, no orders). Exposing cancellation
  now, even restricted to a currently-harmless case, would be a partial implementation of a
  correctness-critical flow; better to build it once, completely, alongside holds/orders/refunds.

### D-020: Overall seat-availability summary now; per-section breakdown deferred

- **Decision:** event detail includes `seatAvailability: { total, available, held, sold }` (one
  `groupBy` query) and, for GA, each tier's `remainingQuantity` directly. It does **not** include a
  per-section breakdown of seat status.
- **Why we chose it:** a true per-section breakdown needs a join across `EventSeat → Seat → Row →
  Section` that Prisma's `groupBy` can't express directly (would need raw SQL). The PDF's explicit,
  testable acceptance criteria don't require this granularity — it's a UI nicety, not a correctness
  requirement — so it's deferred rather than reached for now.
- **Trade-off:** a seated event's detail response is slightly less informative than it could be;
  easy to add later as a `$queryRaw` without touching anything else.

### D-021: Query validation needs `req.validatedQuery`, not a `req.query` reassignment

- **Decision:** `validateQuery` middleware stores the parsed/coerced query on `req.validatedQuery`
  (a new field), rather than reassigning `req.query` the way `validateBody`/`validateParams` do.
- **Why we chose it:** discovered (and verified with a small standalone script before relying on it)
  that Express 5 made `req.query` a read-only getter — assigning to it silently no-ops instead of
  throwing, which would have made query validation appear to work while actually doing nothing.
  `req.body` and `req.params` remain assignable. Documented here so nobody "fixes" this back to a
  `req.query =` assignment later and reintroduces a silent bug.

### D-022: Test fixture cleanup scoped by organiser id, not per-row tracking

- **Decision:** `test/helpers/fixtures.ts` tracks only the organiser and user ids a test created,
  and `resetFixtures()` deletes every `Event`/`Venue`/`OrganiserMembership` scoped to those
  organiser ids (in that order, before deleting the organisers themselves), rather than tracking
  individual venue/event/section/row/seat ids.
- **Why we chose it:** found during this stage — tests exercise the real HTTP endpoints (`POST
  /organisers/:id/events`, etc.), which create rows the fixtures module never directly constructed
  and so had no id to track. The first test run failed with 20 foreign-key-constraint errors because
  cleanup only knew about fixture-helper-created rows, not API-created ones, and tried to delete a
  venue that an untracked, API-created event still referenced. Scoping cleanup by organiser id
  instead catches every descendant regardless of which code path created it — and this pattern will
  keep working as later stages add holds/orders/tickets/reviews/audit rows, none of which need their
  own tracking arrays either.
- **Trade-off:** cleanup runs a few more `deleteMany` queries per test than strictly necessary when
  nothing was created under a given organiser — negligible at this scale.

### D-023: Idempotency-Key is required (not just accepted) on holds/orders/refunds

- **Decision:** `POST /holds` (and later `POST /orders`, `POST /orders/:id/refund`) return 400
  `IDEMPOTENCY_KEY_REQUIRED` if the header is missing, rather than silently proceeding without
  dedup protection.
- **Why we chose it:** the PDF says these endpoints "accept" an Idempotency-Key, which could be read
  as optional. For money/inventory-moving operations, making the protection mandatory is safer and
  removes an entire class of "client forgot to send it" bugs, at the cost of being slightly stricter
  than the letter of the spec. Documented here precisely because it's a deliberate strengthening,
  not an oversight.

### D-024: `withIdempotency` — one-transaction claim, no `lockToken` needed for DB-only operations

- **Decision:** `lib/idempotency.ts`'s `withIdempotency()` wraps the idempotency claim, the business
  logic, and marking the record `COMPLETED` in **one** transaction. A stale `PROCESSING` row is
  simply deleted and the claim retried fresh — no ownership-token handoff.
- **Why this is safe (and why it's *not* the same mechanism designed for payments):** because the
  claim and the business mutation are the same transaction, a stale `PROCESSING` row provably means
  that transaction never committed — transaction atomicity guarantees none of its side effects
  exist. There is nothing to reconcile, so deleting and retrying is fully correct. This is only true
  because holds/releases/refunds never call an external service mid-transaction. Stage 2.4's payment
  flow calls an external (simulated) provider between two separate transactions, so a stale record
  there *might* correspond to a still-in-flight external operation — that path needs the full
  `lockToken`-preserving takeover protocol designed during schema review, implemented separately in
  the orders module.

### D-025: Hold expiry — lazy, swept opportunistically, no BullMQ job yet

- **Decision:** no scheduled sweeper process exists. Expiry is enforced two ways: (1) whenever a new
  hold is requested for an event, that event's expired holds are swept first (so freed inventory is
  immediately available to the next buyer); (2) whenever a specific hold is loaded for checkout, it's
  lazily re-checked and expired inline if needed (`getUsableHoldOrThrow`) — so an expired hold can
  never be purchased regardless of sweep timing. `sweepAllExpiredHolds()` exists and is tested, ready
  to be attached to a BullMQ repeatable job.
- **Why we chose it:** the PDF explicitly accepts "lazily on read **or** through a sweeper" — lazy
  alone is compliant. The two opportunistic sweep points close the realistic gap (inventory sitting
  idle because nobody happens to revisit that exact hold) without needing queue/worker lifecycle
  plumbing. Given the remaining scope in this session (orders, tickets, refunds, cancellation,
  reviews, reports, seed data, full frontend integration), wiring real BullMQ infrastructure now
  would trade correctness-irrelevant polish for velocity on the pieces that actually gate
  correctness. Flagged as a known, deliberate simplification, not an oversight.
- **Idempotent by construction:** `expireHold()` guards its own update with `WHERE status =
  'ACTIVE'`, so sweeping the same hold twice (concurrent sweeps, or a sweep racing a user's own
  release) only credits its inventory back once — tested directly (`firstSweep === 1, secondSweep
  === 0`).

### D-026: Max-8-tickets cap is cumulative (existing valid tickets + this request)

- **Decision:** the per-user-per-event ticket cap counts existing `VALID` tickets from past orders
  plus the quantity in the hold being requested, not just the current request in isolation.
- **Why we chose it:** "max 8 tickets per user per event" reads most naturally as a standing limit
  on total tickets held for that event, not a per-API-call limit that a user could bypass by making
  several smaller requests. Combined with "one active hold per user per event," this means the
  cumulative check mostly matters against *already-purchased* tickets from a prior order.

### D-027: Vitest runs test files sequentially — one shared real Postgres, not mocked

- **Decision:** `fileParallelism: false` in `apps/api/vitest.config.ts`.
- **Why we chose it:** Vitest's default parallel-file execution gives each file its own worker
  process, each opening its own Prisma connection pool against the *same* real Postgres container
  (deliberately not mocked, per the instruction to use real Postgres for correctness/concurrency
  tests). During Stage 2.4 this surfaced as one intermittent failure in a full-suite run that didn't
  reproduce running the same file alone — consistent with transient connection-pool contention
  across simultaneously-running files, not a product bug (confirmed by 5 consecutive clean runs
  after the change). A flaky suite is a real cost for a graded submission; trading some wall-clock
  time (≈36s vs ≈22s) for a deterministically green `npm test` is the right trade here.
- **Trade-off:** slower CI/local runs. Tests *within* a file that intentionally fire many concurrent
  requests (the 50-seat and 200-GA-buyer tests) are unaffected — that concurrency is the thing being
  tested and still happens via `Promise.all` inside one file.

### D-028: A declined order is retryable, not terminal

- **Decision:** Phase 1 of checkout treats `Order.status === 'DECLINED'` the same as
  `PENDING_PAYMENT` — both fall through to create a fresh `Payment` attempt. Only `PAID`,
  `PARTIALLY_REFUNDED`, and `REFUNDED` are treated as "already resolved, nothing more to do."
- **Why this needed fixing:** the first implementation treated *any* non-`PENDING_PAYMENT` order as
  terminal, which incorrectly blocked a legitimate "retry with a different card" flow after a clean
  decline — caught by a test that declines, then retries with a fresh Idempotency-Key and expects
  success. Since `Order.holdId` is unique, a retry on the same hold *must* reuse the same `Order`
  row (never a second `Order`) — "retryable" means "create another `Payment` attempt against the
  existing order," not "create a new order."

### D-029: Lazy-expiry-at-checkout must commit in its own transaction, separate from Phase 1's

- **Decision:** `checkout.ts`'s Phase 1 runs the hold's lazy-expiry check (`expireHold`) in its own
  `prisma.$transaction` *before* opening Phase 1's main transaction (event lock, order/payment
  creation), rather than inline inside that main transaction.
- **Why this needed fixing:** the first implementation called `expireHold` inside Phase 1's single
  transaction, then threw `HOLD_EXPIRED` when the hold turned out to be expired — but throwing
  inside a `prisma.$transaction` callback rolls back *everything* in that transaction, including the
  inventory release `expireHold` had just performed a moment earlier. The 409 response was correct;
  the inventory was never actually released. Caught by a test asserting `remainingQuantity` was
  fully restored after an expired-hold checkout attempt — it reported the pre-expiry value, revealing
  the rollback. This is a sharper, more general version of the same lesson as D-025's "safe to
  discard and retry" reasoning: a side effect you want to *keep* can never live in the same
  transaction as a throw you use to *reject* the overall request.

### D-030: Refund authorization — pure attendee is window-bound, organiser staff/admin are not

- **Decision:** a refund request from the order's own owner, who has **no** `OrganiserMembership`
  for that event's organiser, is a standard self-service cancellation and is rejected once the
  event's `refundWindowHours` deadline has passed. A request from someone who **is** a member
  (STAFF or ADMIN) — whether refunding their own order or someone else's — is a discretionary
  organiser action and is never window-bound; it's gated purely by `canRefundOrder` (Stage 2.1):
  STAFF cannot refund their own order (403), ADMIN can (the documented exception).
- **Why we chose it:** the PDF's refund-window language ("cancel within the event's refund window")
  describes consumer-facing attendee self-service, not organiser-side discretionary refunds — an
  admin manually refunding a dissatisfied customer after the window shouldn't be blocked by the same
  rule designed to stop late self-service cancellations. The self-refund rule (not the window) is
  what actually needs to apply uniformly to staff regardless of timing, which is what closes the real
  loophole (a staff member buying a ticket and refunding themselves using their elevated
  organiser-side refund permission, bypassing the attendee window).

### D-031: `performRefund` takes a transaction client, doesn't open its own

- **Decision:** the core refund logic (per-ticket conditional update, inventory release rules,
  `Refund` row, `Order` status recompute, audit) lives in one function that accepts an existing
  `Prisma.TransactionClient` rather than starting its own transaction.
- **Why we chose it:** it's called from two different transaction-boundary shapes — the user-facing
  `POST /orders/:id/refund` endpoint (one transaction, inside `withIdempotency`'s callback) and event
  cancellation's bulk refund (one transaction **per order**, explicitly not one giant transaction
  across every order — see the Stage-2-schema-review design). Factoring the shared logic this way
  means both call sites get identical inventory-release/duplicate-prevention behavior without
  duplicating it, while each still controls its own transaction boundary correctly for its situation.

### D-032: Audit log entries must carry the real `organiserId`, never `null`

- **Decision:** every audit write that happens in an organiser-scoped context (holds, hold expiry,
  checkout outcomes, check-in, refunds, reviews) resolves and stores the actual event's
  `organiserId` — fixed a gap where several Stage 2.3/2.4 call sites had been writing `organiserId:
  null` since no organiser-scoped route was directly involved in those flows.
- **Why this needed fixing:** caught while building Stage 2.6's audit endpoint, which scopes every
  query by `organiserId` — entries written with `null` would have been silently invisible to the
  very audit feature meant to show them, even though the row existed. `expireHold` (called from
  opportunistic sweeps with no request context at all) now does one small extra lookup of the
  event's `organiserId` specifically so its audit trail stays queryable.

### D-033: Audit query authorization depends on the query string, not just the route

- **Decision:** `GET /organisers/:organiserId/audit` requires only membership (any role) when
  `?entity=Type:id` scopes the query to one specific entity, but requires ADMIN when no entity filter
  is given (the full organiser-wide feed). This check lives in the service function, not as a second
  static middleware, because the required role is a function of the query string.
- **Why we chose it:** matches the PDF's split exactly ("viewable per order and per event
  (organiser members), plus organiser-wide (admin only)") without needing two separate routes or a
  middleware that inspects query params (which would blur the usual "middleware decides access,
  handler does work" separation for no real benefit here).

### D-034: Sales reports use raw SQL for all three groupings, net revenue only

- **Decision:** `group_by=event|day|tier` all use `$queryRaw` (not Prisma's `groupBy`), summing
  `Ticket.priceMinor` where `status = 'VALID'` only.
- **Why we chose it:** `day` grouping needs `DATE(created_at)`, which Prisma's query builder can't
  express without raw SQL anyway — using raw SQL for all three keeps the three code paths
  structurally identical rather than mixing `groupBy` for two cases and raw SQL for the third.
  Counting only `VALID` tickets means a refund automatically reduces reported revenue with no
  separate subtraction step — confirmed by a test that refunds a ticket and checks revenue drops to
  exactly zero.

### D-035: Test fixture cleanup must explicitly clear `AuditLog`, which `SetNull` doesn't

- **Decision:** `resetFixtures()` now deletes `AuditLog` rows matching tracked organiser/user ids as
  its first step, before deleting the organisers/users those ids belong to.
- **Why this needed fixing:** `AuditLog.actorUserId`/`organiserId` are `onDelete: SetNull` by design
  (D-008-adjacent: real audit history must outlive the actor/organiser being deleted) — which means,
  unlike every other table in this schema, deleting a test's organiser/user does **not** clean up its
  audit rows; they survive with both fields nulled out. Across many iterations of this session's test
  runs this had silently accumulated over 1,200 orphaned rows before being caught (debris, not a
  correctness bug — confirmed via `psql` row counts, same verification method used throughout this
  session). Fixed and the existing debris cleared.

### D-036: Seed script lives in `apps/api`, reuses the real service layer

- **Decision:** `apps/api/src/seed.ts` (not `packages/db`) calls `createHold`/`checkout` directly
  (in-process function calls, no HTTP server needed) to generate every sold/held ticket, rather than
  hand-crafting `Order`/`Ticket`/`Payment` rows via raw Prisma inserts.
- **Why we chose it:** `packages/db` is deliberately a dependency-free data-layer package (D-009);
  a seed script that needs business logic (atomic inventory decrement, idempotency, ticket issuance)
  belongs next to that logic, not reaching backward from the data layer into the API layer. Reusing
  the real functions also means every seeded "sold" ticket is guaranteed to satisfy the same
  invariants a real purchase would — which is exactly what caught the bug below, something
  hand-crafted rows would have silently gotten wrong instead of catching.
- **Idempotent re-running:** every seed-created row is identifiable (organiser names "Laugh Factory
  Pune"/"Riverfront Live", user emails ending in `@seed.test`) and the script deletes exactly that
  data (same dependency-ordered cleanup as the test suite's `fixtures.ts`) before recreating it —
  verified by running it twice and confirming identical row counts both times, never touching
  anything else in the database.

### D-037: Seated checkout had never been exercised end-to-end before the seed script ran it

- **Bug:** `issueTickets`'s seated branch set `EventSeat.status = 'SOLD'` without clearing `hold_id`,
  violating the `event_seats_hold_id_matches_status` CHECK constraint (D-010) the very first time a
  seated hold was actually checked out successfully.
- **Why Stage 2.4's own test suite missed it:** every checkout test used a GA hold; a seated *hold*
  was tested (Stage 2.3), but no test had carried a seated hold all the way through a successful
  checkout. The bug was latent in shipped code for two full stages before the seed script's first
  real seated-ticket purchase hit it.
- **Fix and the lesson:** cleared `holdId` alongside the status flip, and — more importantly — added
  the missing regression test directly to `checkout.test.ts` rather than only trusting the seed
  script to keep catching it. This is the second time in this session a "write realistic data/flows
  through the real code paths" exercise (first the test suite's own fixtures, now the seed script)
  surfaced a gap pure unit-style testing of each piece in isolation had missed — worth remembering
  for Part B's eval design too: cases that drive full, realistic flows end-to-end catch a different
  class of bug than cases that test one function at a time.

### D-038: Frontend is client-rendered with a localStorage JWT, not server-side auth

- **Decision:** every page that needs data or auth is a `"use client"` component; the JWT and basic
  user info live in `localStorage` (`lib/api.ts`), attached to every request by one shared
  `apiFetch` helper. No server components fetch authenticated data, no auth cookie, no middleware.
- **Why we chose it:** this is explicitly a correctness-over-polish assessment ("a simple seat
  grid/list is sufficient," "avoid spending time on unnecessary animations or cosmetic polish").
  Server-side auth (cookies, Next middleware, server-component data fetching with credentials) adds
  real complexity for no behavioral difference the grading criteria care about — the backend enforces
  every permission regardless of how the frontend stores its token, so this is purely a presentation-
  layer simplification, not a security shortcut (the frontend never makes an authorization decision
  itself; see D-039).
- **Trade-off:** no SSR of authenticated pages (slightly slower perceived load, a brief "Loading…"
  on every protected page), not usable with JS disabled. Acceptable for a local-only demo app.

### D-039: The frontend never makes an authorization decision — it only reflects the server's

- **Decision:** no page hides or shows content based on a client-side guess about the user's role.
  Every write action is attempted against the real endpoint; a 403/404 from the server is caught and
  displayed as-is (e.g. the refund page lets any logged-in staff/admin *submit* a refund for any
  order id — the self-refund rejection is the server's 403 message, shown verbatim, not a client-side
  check that tries to predict it).
- **Why we chose it:** the instructions are explicit — "do not trust client-side role checks as
  security." A frontend permission check is, at best, a UX nicety; treating it as authoritative
  anywhere would contradict the entire server-side-enforcement design this project has maintained
  since Stage 2.1. Verified directly: a Playwright test submits a staff self-refund through the UI
  and confirms the server's exact rejection message ("Staff cannot refund their own order") is what
  appears, not a client-side-blocked form.

### D-040: Three small backend endpoints added specifically to make the frontend possible

- **Decision:** `GET /me/memberships`, `GET /organisers/:organiserId/events` (list), and
  `GET /events/:eventId/seats` (list) were added during frontend work — none are in the PDF's
  minimum API contract.
- **Why we chose it:** each is a genuine blocker, not a nice-to-have: without the first, a logged-in
  admin/staff user has no way to discover which organiser(s) they belong to at all; without the
  second, there's no way to list an organiser's own events to manage; without the third, an attendee
  can't pick a *specific* seat to hold (the event-detail endpoint only ever returned an aggregate
  seat-availability summary, by design — see D-020). All three are thin, read-only, permission-scoped
  identically to their sibling endpoints, and each has its own test.

### D-041: Two real bugs found by actually using the app in a browser, not by code review

Per the instructions ("start the dev server and use the feature in a browser before reporting the
task as complete"), every frontend workflow below was driven end-to-end with Playwright against the
real running API and seeded database — not just typechecked or eyeballed:

1. **Seated checkout path was already fixed in Stage 2.7** (D-037) — re-verified here by actually
   generating seats, holding one, and checking out through the UI, not just the API test.
2. **New bug, found here:** the venue seat-map page's "add row" / "add seat" dropdowns displayed a
   computed fallback value (`value={state || firstOption.id}`) so the `<select>` always *showed* a
   valid option, but the submit handlers read the raw state variable directly — which stayed empty
   until the user manually touched the dropdown. A user who left the pre-selected default in place
   (the natural thing to do) would silently POST to a URL with a blank id segment. Worse, `addSeat`'s
   failure path (`if (!section) return;`) swallowed this completely with no error shown at all —
   exactly the "fake success" / silent failure the instructions explicitly warn against. Fixed by
   syncing the state to a real value via `useEffect` whenever the data changes, so the displayed
   value and the submitted value are always the same thing, and by making the remaining defensive
   branch report an error instead of returning silently. Caught by Playwright clicking through the
   section → row → seat flow exactly as a real admin would, confirmed by re-running the same test
   after the fix.
3. **Minor:** several `<input>` elements had no explicit `type` attribute (defaults to `text`
   correctly at runtime, but CSS/Playwright attribute selectors like `input[type=text]` don't match
   an absent attribute). Fixed across the frontend for explicitness — not a functional bug, but worth
   fixing once found rather than working around it only in the test.

### D-042: `ON_SALE` / `SOLD_OUT` / `COMPLETED` event-status transitions stay seed-only

- **Decision:** `statusTransitions.ts` defines and unit-tests the full state machine
  (`PUBLISHED→ON_SALE→SOLD_OUT→COMPLETED`, with cancellation from any non-terminal state), but no
  HTTP endpoint exists to drive `PUBLISHED→ON_SALE`, `ON_SALE↔SOLD_OUT`, or `→COMPLETED`, and nothing
  auto-derives `SOLD_OUT` from inventory hitting zero. Only the seed script sets these statuses
  directly, for demo data variety.
- **Why we chose it:** found during the final consolidated acceptance-testing pass (an audit
  sub-agent flagged it while correcting docs/ASSESSMENT_REQUIREMENTS.md). Checked against the PDF's
  actual required workflow list (W2: "create/publish/update/cancel") and acceptance criteria
  (A1–A8): none of them name these three transitions. Checkout logic already treats `PUBLISHED` and
  `ON_SALE` identically (`status IN (PUBLISHED, ON_SALE)`, see the Stage-2-schema transaction
  design), so attendees can already buy tickets for a `PUBLISHED` event — `ON_SALE` carries no
  functional difference today, only a cosmetic one. Building three more endpoints (or an
  inventory-triggered auto-transition) for states nothing in the mandatory spec exercises would be
  scope creep this late, not a fix for a real defect.
- **Trade-off:** the event-status enum's middle states are only ever reachable via direct seed
  writes, never through a real user action — documented plainly in `README.md`'s "Known
  limitations" rather than silently left unbuilt. If asked in interview: the correct production fix
  is a small admin "mark on sale" action plus an inventory-service hook that flips `SOLD_OUT`
  atomically alongside the last unit's sale, inside the same transaction that decrements it.

### D-043: Vitest explicitly excludes `dist/**`, not just relying on its own defaults

- **Decision:** `apps/api/vitest.config.ts` now sets `exclude: ["**/node_modules/**", "**/dist/**"]`
  explicitly.
- **Why we chose it:** found during the independent Part A audit's build-verification pass — running
  `npm run build` (tsc) then `npm run test` silently doubled the whole suite (42 files / 294 tests
  instead of 21 / 149), because compiled test files under `dist/test/**` were also being discovered
  and run. `dist/` is gitignored and never present in a fresh clone or CI, so this never affected a
  graded run from a clean checkout, but it's a real local-dev footgun — exactly the kind of
  confusing, misleading test count a reviewer could hit by following the README's own mention that
  `build`/`start` scripts exist and work.
- **Trade-off:** none — this only narrows what Vitest looks at, with no behavior change for the
  normal `test/**` suite.

### D-044: Three "already covered" acceptance criteria got real concurrent regression tests

- **Decision:** added three genuinely-concurrent (`Promise.all`, not simulated) regression tests
  during the independent Part A audit: two expired holds swept by two overlapping
  `sweepAllExpiredHolds()` calls racing for real (A3), and a same-idempotency-key hold request and
  order/checkout request each fired as a true race rather than simulated via a pre-inserted
  `PROCESSING` idempotency row (A4).
- **Why we chose it:** the underlying code was already correctly designed (conditional
  `UPDATE ... WHERE status = 'ACTIVE'`, and the unique-constraint-plus-retry-loop idempotency
  pattern), but "designed to be race-safe" and "proven race-safe by a test that actually races it"
  are different claims — the audit explicitly asked to verify "concurrent expiry processing" and
  "concurrent duplicate requests" literally, and the existing tests only exercised the sequential or
  simulated version of each. Closing this gap with new tests, rather than just asserting the design
  is correct, is consistent with this project's standing rule to never claim a test passed unless it
  actually ran and passed.
- **A real bug was found and fixed in the process — but in the new tests, not the product.**
  `[a.status, b.status].sort()` on two HTTP status codes defaults to JavaScript's lexicographic
  string sort, which happens to still order a 201/409 pair correctly by coincidence (same digit
  count, '2' < '4'), but the assertion `expect(statuses[1]).toBe(201)` had the index backwards
  (ascending sort puts the smaller, successful code at index 0). The application's actual behaviour
  (one 201, one 409, exactly once-charged/once-ticketed) was correct on every single run — confirmed
  by writing the race's raw response bodies to a file and inspecting them directly before touching
  any assertion. Fixed by sorting with an explicit numeric comparator and correcting the index
  checks. A reminder that a failing new test is not automatically a product bug — verify which side
  is wrong before "fixing" anything.
- **Also added:** a direct regression test that `writeAuditLog` calls are rolled back along with
  their enclosing transaction on a later failure (A8) — previously this was guaranteed only by
  `writeAuditLog`'s type signature forcing every call site to pass a transaction client (verified by
  `grep` across all 19 real call sites), never by a test that forces a real failure and checks the
  row didn't survive.

### D-045: `packages/agent` never imports `apps/api` — real tool `execute()` lives in `apps/api`, not here

- **Decision:** `@agenticgenie/agent` depends only on `@agenticgenie/shared` and `zod`. It defines
  `ToolDefinition`, `ToolRegistry`, the loop, the providers, and the tracer — but no tool registered
  in `tools/catalogue.ts` has an `execute` function yet. Stage B2 will build a second registry (or
  populate this one) inside `apps/api` — e.g. `apps/api/src/modules/agent/tools.ts` — that imports
  the real Part A service functions (`events.listPublicEvents`, `holds.createHold`,
  `orders.checkout`, `refunds.requestRefund`, `reports.getSalesSummary`, ...) and supplies them as
  each tool's `execute`.
- **Why we chose it:** `apps/*` depends on `packages/*` in this monorepo, never the other way —
  `packages/agent` importing from `apps/api` would invert that direction and create exactly the kind
  of tangled dependency graph a modular-monolith layout is meant to avoid (see CLAUDE.md's planned
  architecture: "agent never talks to Postgres/Redis directly; it calls the api service layer"). A
  generic agent package that only knows Zod schemas and a `ToolContext` shape can be tested in full
  isolation (47 tests, 0 database dependency) and is trivially reusable if `apps/api`'s internals
  ever change shape.
- **Trade-off:** nothing in Part A's web of permission/idempotency/audit guarantees is exercised by
  this stage's tests — that's deliberate (B1 is architecture, not integration) and is exactly what
  Stage B2 closes. The seven tools are registered with complete schemas and metadata now so B2 is
  "write `execute`," not "redesign the contract."

### D-046: A registered tool with no `execute` is an honest `NOT_IMPLEMENTED`, never a crash or a fake success

- **Decision:** `tools/dispatch.ts` checks `definition.execute` before calling it; if absent, it
  returns `{ success: false, error: { code: "NOT_IMPLEMENTED", ... } }` through the exact same
  `ToolDispatchResult` shape a real failure would use — not a thrown exception, not a stub value that
  looks like a real answer.
- **Why we chose it:** the loop (and, later, the model) must never be able to tell the difference
  between "this tool doesn't exist," "this tool failed," and "this tool isn't wired up yet" by
  crashing in three different ways — they're all just an error the agent can react to gracefully
  (e.g. apologize and suggest trying something else), which is exactly the behavior Stage B2's real
  failures need too. Building this path now means Stage B2 doesn't introduce new error-shape
  conventions — it just starts returning `success: true` instead.

### D-047: `cancel_order` maps onto Part A's `requestRefund`, not a new cancellation state machine

- **Decision:** the `cancel_order(order_id, confirm)` tool's Stage B2 implementation will call
  `refunds.requestRefund` for every currently-`VALID` ticket on the order (a full refund), the same
  operation the `/orders/:id/refund` endpoint already performs and the frontend's "cancel my order"
  action already drives.
- **Why we chose it:** Part A's `Order.status` machine only has `PENDING_PAYMENT → PAID →
  PARTIALLY_REFUNDED | REFUNDED | DECLINED` — checkout resolves synchronously (see
  docs/DECISIONS.md's three-phase checkout entries), so there is no "pending, not yet committed"
  order state for a tool to cancel out from under; the only sense in which an attendee "cancels an
  order" in this system is requesting a refund of what they already paid for. Reusing the existing,
  already-tested, already-permission-checked refund path means `cancel_order` inherits every
  guarantee `requestRefund` already has (self-refund restriction, refund-window enforcement,
  idempotency) for free in B2, rather than needing its own.

### D-048: Agent execution traces never record raw tool-call arguments or raw provider content

- **Decision:** `tracing/tracer.ts`'s `StepTrace`/`ToolCallTrace` only ever record a tool's name,
  duration, success flag, retry count, and an error *code* — never the arguments passed to it, the
  raw provider response text, or a raw thrown-error message. Any string that is recorded is passed
  through a `redact()` helper that strips common secret-shaped substrings (`sk-...`, `ghp_...`, JWTs,
  bearer tokens) as a defensive backstop.
- **Why we chose it:** a tool-call argument can be something a user reasonably considers private (a
  specific seat id, an order id, a date range tied to their own purchase history) without being a
  "secret" in the credentials sense — there's no reason diagnostic telemetry needs to retain it once
  the call is done. This trace is explicitly NOT Part A's audit log: `writeAuditLog` already owns the
  durable, access-controlled, transactional record of what actually changed (see the Part A audit-log
  decisions above); this tracer is operational telemetry for running the agent itself (latency spent,
  tokens spent, which tools got called, how the turn ended), and keeping it argument-free means it
  can eventually be exported/logged more freely than the audit log ever should be.

### D-049: The loop's resource-limit checks run before honoring an otherwise-valid final answer

- **Decision:** `core/loop.ts` checks the cumulative token budget immediately after a response comes
  back from the provider — even a well-formed, schema-valid final answer is rejected (replaced with a
  `partial`/`token_budget_exceeded` result) if accepting it would mean the turn's token spend already
  exceeded its budget. The one bounded repair attempt for malformed output is tracked per TURN, not
  per step, so a model that fails to self-correct once doesn't get a fresh repair budget on every
  subsequent step.
- **Why we chose it:** the PDF's wording is specific — "graceful partial answer when budget exhausted"
  and "never claim unconfirmed action succeeded" — which reads as a constraint on the *loop's own
  behavior*, not just the model's. A budget that can be silently exceeded by one token right before
  the model happens to produce a good answer isn't really a budget. Tracking repair per-turn (rather
  than resetting it every step) treats "the model can't produce valid structured output" as a single
  failure mode worth one correction attempt total, not a retry budget that could otherwise let a
  persistently malformed model consume the entire step/token budget doing nothing but failing to
  repair itself.

### D-050: Real tool implementations are injected into the registry, not registered a second time

- **Decision:** `packages/agent`'s `createDefaultToolRegistry` now takes an
  optional `executors` map; `apps/api` calls it with real, service-backed
  `execute` functions (`apps/api/src/modules/agent/tools.ts`), while
  `packages/agent`'s own tests still call it with none and get B1's honest
  "not implemented" behavior.
- **Why we chose it:** `ToolRegistry.register()` throws on a duplicate name, so
  there was no way to "fill in" a tool B1 already registered without either
  inverting the dependency direction (packages/agent importing apps/api — wrong
  way round) or duplicating all seven tools' schemas/descriptions/metadata a
  second time in `apps/api` just to attach an `execute`. Executor injection keeps
  one source of truth for the metadata and one seam for the implementation.

### D-051: `purchase`/`cancel_order` output schemas gained a `NEEDS_CONFIRMATION` status

- **Decision:** both schemas (`packages/shared/src/agent/tools.ts`) became
  `status: "NEEDS_CONFIRMATION" | ...` discriminated shapes instead of always
  returning an order-shaped object.
- **Why we chose it:** B1 designed these schemas before the confirmation state
  machine existed, assuming every call either succeeds or throws. Once
  `purchase`/`cancel_order` need to return "nothing happened yet, please confirm"
  as a normal, non-error result, the schema has to be able to say that honestly
  — returning a fake `Order`-shaped object with an invented status would violate
  the same "never invent data" principle this project applies everywhere else.

### D-052: The confirmation gate is two independent conditions, not one

- **Decision:** `purchase`/`cancel_order` execute only when (1) a live, matching
  `AgentPendingConfirmation` DB row exists AND (2) the current turn's raw human
  message passes a deterministic classifier (`classifyConfirmationIntent`). A
  model's own `confirm: true` tool-call argument satisfies neither condition by
  itself.
- **Why we chose it:** the assessment is explicit that "the model cannot confirm
  its own action" and that "an affirmative response to an unrelated question
  cannot be interpreted as approval." A model-settable boolean is exactly the
  kind of self-attestation the project's existing rule — never trust a
  model-generated permission/identity claim — already forbids; treating `confirm`
  as an exception to that rule for no good reason would be inconsistent. Using a
  regex allowlist instead of asking the model "was that really a yes?" removes an
  entire class of prompt-injection surface (a cleverly-crafted message convincing
  the model that something ambiguous was actually a confirmation).
- **Trade-off:** see docs/PART_B_SECURITY.md — a genuinely unusual confirmation
  phrasing gets rejected safely rather than guessed at.
- **Concurrency note:** correctness under a genuine race does NOT depend on this
  function's own atomicity (see the detailed reasoning in docs/PART_B_SECURITY.md
  §2) — it depends on handing both racing callers the identical, already-stored
  idempotency key and letting Part A's own (already-regression-tested)
  idempotency primitives collapse them. This function's conditional updates are
  real but are a secondary safety/bookkeeping measure, not the mechanism the
  no-double-charge guarantee actually rests on.

### D-053: `sales_summary` resolves membership itself; ambiguity gets a clarifying question, not a guess

- **Decision:** the tool queries the caller's own `OrganiserMembership` rows
  directly. Zero → permission error. One → use it. More than one →
  `NEEDS_CLARIFICATION` listing the real organisation names.
- **Why we chose it:** the PDF's fixed tool signature for `sales_summary` has no
  organiser-id argument, and `getSalesSummary` trusts whatever organiserId it's
  given completely (it's normally shielded by Express's
  `requireOrganiserMembership` middleware, which doesn't run on the agent's call
  path). Guessing which organiser a multi-org staff member meant would risk
  showing the wrong organiser's financial data to the wrong conversation; asking
  is the same pattern already required for an ambiguous event-booking request
  elsewhere in Part B's spec.

### D-054: `quota_exceeded`/`auth_error` are never retried; everything else transient is

- **Decision:** `callProviderWithRetry` retries `rate_limited`/`server_error`/
  `timeout`/`network` with bounded exponential backoff + jitter (honoring a
  provider-supplied `Retry-After`), but never retries `quota_exceeded` or
  `auth_error`.
- **Why we chose it:** a billing or auth failure is permanent for the current
  turn — retrying it burns the turn's time/attempt budget on something that
  cannot succeed, delaying the (correct) fallback/degrade path for no benefit.
  This matches the assessment's own retry-policy table exactly.

### D-055: The deterministic fallback covers exactly one intent, on purpose

- **Decision:** only "search/show events [in city]" → `search_events` is wired as
  a fallback intent. "Show event details"/"ticket tiers" and "show my orders"
  (an example in the assessment's own spec) are explicitly NOT implemented.
- **Why we chose it:** the first two need an event id this fallback has no
  reliable way to resolve from free text without the model (that's reference
  resolution); the third isn't one of the seven required tools at all — there is
  no `list_my_orders` agent tool to fall back to, and inventing one just to serve
  a fallback path would be unplanned scope, not a fix for a real gap. Documented
  honestly in docs/PART_B_RELIABILITY.md rather than silently narrowed or
  over-built with an unreliable heuristic.

### D-056: Each message in a persisted batch gets an explicit, strictly increasing timestamp

- **Decision:** `appendMessages` assigns `createdAt: new Date(base + i)` per row
  instead of letting Postgres's `now()` default apply.
- **Why we chose it:** a real bug, caught by a real test (not inspection) —
  Postgres freezes `now()` for the whole transaction, so every message in one
  `createMany` batch shared an identical timestamp, and cuid2 ids are only
  approximately time-sortable, not a safe same-millisecond tie-break. Unlike
  catalogue pagination (D-013), where same-batch ordering among otherwise-
  unrelated rows doesn't matter, getting a conversation's USER/ASSISTANT/TOOL
  messages out of order would corrupt the exact context replayed back to the
  model on the next turn.

### D-057: The `/agent/chat` rate limiter is process-local, by choice, documented as a limitation

- **Decision:** a plain in-memory `Map`-based sliding window, not Redis-backed.
- **Why we chose it:** Redis is provisioned in this project (`docker-compose.yml`)
  but genuinely unused anywhere else (see the Stage-1 decision on this) — standing
  up a Redis-backed limiter for exactly one endpoint in this stage would be
  infrastructure this assessment's scope doesn't call for. Honestly documented as
  not distributed-safe in docs/PART_B_RELIABILITY.md rather than silently
  presented as production-grade.

### D-058: The eval runner calls `runAgentTurn` directly, not through `/agent/chat` over HTTP

- **Decision:** `apps/api/src/evals/runner.ts` imports `runAgentTurn`, the real tool registry, and
  the real conversation/confirmation persistence helpers directly, driving each case's conversation
  in-process rather than issuing `supertest` HTTP requests against `createApp()` the way
  `apps/api/test/agent/*.test.ts` does.
- **Why we chose it:** the HTTP endpoint's JSON response deliberately does not expose the full
  `AgentTrace` (only a redacted `toolExecutionSummary` — see `docs/PART_B_SECURITY.md`'s redaction
  policy), but the eval harness's metrics (tokens, latency, step count, retry count) need exactly
  that trace. Calling `runAgentTurn` directly gets the real trace with zero changes to the
  already-reviewed B2–B4 HTTP contract, while still exercising the real tool implementations (they
  call Part A's real services via Prisma regardless of whether an Express request framed the call)
  and the real `AgentPendingConfirmation`/`AgentConversation` database rows. The only thing skipped
  is Express's own routing/auth-middleware layer, which the eval harness doesn't need to prove (it's
  already covered by `apps/api/test/agent/chat.test.ts`) and which would have added `supertest`
  request plumbing with no benefit to what this stage is actually verifying.
- **Trade-off:** an eval case technically doesn't prove `POST /agent/chat` itself is wired
  correctly — that remains the HTTP integration tests' job, not this harness's.

### D-059: `EvalProvider` is a new, eval-only sibling of `MockProvider`, not a change to it

- **Decision:** `apps/api/src/evals/provider.ts` reimplements `MockProvider`'s small, deterministic
  script-consumption contract (~30 lines) rather than extending or modifying
  `packages/agent/src/providers/mock.ts`, adding exactly one feature: a tool-call argument value may
  be `{ "$lastToolResult": "fieldName" }`, resolved at call time from the most recent real tool
  result already in the conversation.
- **Why we chose it:** confirmation-flow eval cases (`purchase`, `cancel_order`) need to reference a
  hold or order id that is only created *during* the scripted conversation itself (by an earlier
  `hold_seats`/`purchase` call hitting the real database) — a fully static script authored ahead of
  time has no way to know that id. `MockProvider` is B1–B4's own, already-reviewed, already-tested
  component; changing its contract to support dynamic argument resolution — a feature nothing in the
  product itself needs — would be scope creep against code that doesn't belong to this stage.
  Keeping `EvalProvider` entirely inside `apps/api/src/evals/` means B5 adds a new, small,
  independently-testable file rather than touching reviewed infrastructure.

### D-060: Eval case `seed` is a fixed vocabulary of fixture-helper calls, not a generic DSL

- **Decision:** `apps/api/src/evals/types.ts`'s `seedStepSchema` is a closed, 8-variant
  discriminated union (`organiser`, `venue`, `event`, `ticketTier`, `user`, `membership`, `review`,
  `order`); `apps/api/src/evals/seed.ts`'s `applySeed` is a single `switch` mapping each variant
  directly onto one `apps/api/test/helpers/fixtures.ts` call. Adding a seed need the current 20 cases
  don't have means adding one more variant and one more `case`, never extending a query language.
- **Why we chose it:** reusing the exact same fixture helpers every other integration test in this
  project already relies on means eval-created rows get the exact same `resetFixtures()` cleanup
  tracking for free, with no separate bookkeeping to get wrong or forget.

### D-061: `dbCheck.afterTurn` lets a case assert an intermediate conversation state

- **Decision:** a `dbChecks` entry may carry an optional `afterTurn: N` (1-indexed), evaluated right
  after that turn of the conversation completes rather than only once at the very end.
- **Why we chose it:** the assessment's own spec for case 10 (`purchase`) explicitly requires proving
  "the first turn produces `needs_confirmation`, NO order exists yet" as a distinct, checkable fact —
  not an assumption inferred from the final state. Scoping this to one extra, explicit field on a
  `dbCheck` (rather than, say, letting a case declare several independent sub-conversations) keeps
  the case format's surface area small while still making the intermediate claim a real, checked
  assertion instead of an implicit one.

### D-062: Design tokens via plain CSS custom properties, not a UI library or Tailwind

- **Decision:** `apps/web/src/app/globals.css` defines the entire design system (color, typography,
  spacing, radii, shadows) as CSS custom properties, consumed by a small hand-written component set
  (`components/ui/`) using plain class names, not a utility framework.
- **Why we chose it:** the prior inline-React-style-object approach (`lib/styles.ts`) genuinely
  cannot express `:hover`, `:focus-visible`, or `@media` queries — all required for this stage
  (hover states, visible focus, responsive breakpoints). Introducing Tailwind or a component library
  would solve that but adds a real dependency and build-step surface for a one-person take-home
  project where "do not introduce large libraries unnecessarily" is an explicit instruction. Plain
  CSS custom properties get the same capability — real pseudo-classes and media queries — with zero
  new dependencies and a single, auditable stylesheet.
- **Trade-off:** no scoped styles (global class names must stay disciplined/prefixed by convention),
  no autogenerated utility classes, so some repetition across pages — acceptable at this project's
  size.

### D-063: System serif/sans font pairing, not `next/font/google`

- **Decision:** `--font-display`/`--font-body` are system font stacks (`ui-serif`/`ui-sans-serif` with
  platform fallbacks), not a custom webfont loaded via `next/font/google`.
- **Why we chose it:** `next/font/google` needs a network fetch at build time; failing that fetch in
  an unfamiliar CI/sandbox environment would silently break `next build`, which is a worse outcome
  than a slightly less distinctive typeface. A strong serif-display/sans-body contrast is itself a
  well-established editorial technique and reads as intentional even on system fonts — verified by
  screenshot, not just asserted.
- **Trade-off:** less visually distinctive than a custom typeface; judged not worth the build-time
  risk for this project's scope.

### D-064: Events with no image get a deterministic per-id gradient, never a stock photo

- **Decision:** `EventCard`'s media area renders one of a small fixed set of gradients, chosen by
  hashing the event's own id — the same event always renders the same treatment, and nothing is
  presented as a photo of the actual event.
- **Why we chose it:** the Part A data model has no event-image field (a real, pre-existing gap —
  not introduced here), and the instructions are explicit: "If the API has no event image field, use
  a tasteful, consistent fallback treatment rather than pretending a random image belongs to an
  event." A random stock photo would misrepresent the event; a solid color would be duller than
  necessary. A deterministic gradient is honest (never claims to depict anything) and still gives
  the catalogue visual variety.

### D-065: `DemoProvider` replaces the static demo-mode reply as the no-API-key default

- **Decision:** `apps/api/src/modules/agent/provider.ts`'s no-`AI_PROVIDER` default is now
  `DemoProvider` (`apps/api/src/modules/agent/demoProvider.ts`) — a small, pattern-matching
  `ModelProvider` implementation — rather than a `MockProvider` scripted with one fixed canned reply.
- **Why we chose it:** found while producing B6's required Playwright E2E verification — the fixed
  reply meant the live app (every manual demo, every screenshot) never showed the agent doing
  anything real, which would have made the "Playwright E2E across the full discover→chat→confirm→
  purchase flow" requirement impossible to satisfy honestly without a real, paid Nemotron key (which
  this project should never require — see D-0xx from B1 on `AI_PROVIDER=mock`'s zero-key guarantee).
  `DemoProvider` recognizes a handful of plain-English intents via regex (search, "book that", an
  unambiguous confirmation — delegating to the real `classifyConfirmationIntent`, not a separate
  heuristic) and emits genuine `tool_calls`, so the entire real pipeline (registry dispatch, the real
  confirmation gate, real idempotency) runs exactly as it would for a real model.
- **Why this is not a security concern:** `DemoProvider` sits in the exact same interface slot a real
  LLM would — it cannot skip any authorization check any more than `MockProvider` or `NemotronProvider`
  can, because every one of those checks lives in the tool `execute()` functions and the confirmation
  service, never in the provider. Verified: 183/183 `apps/api` tests and 20/20 eval cases (which use
  their own precise `MockProvider`/`EvalProvider` scripts, never `DemoProvider`) were unaffected by
  this change.
- **Trade-off:** `DemoProvider`'s intent recognition is deliberately narrow (plain regex, no real
  NLU) — anything it doesn't recognize gets an honest "I can't tell what you mean yet" rather than a
  guess. This is a demo/UX quality limitation, not a scope gap: a real deployment would set
  `AI_PROVIDER=nemotron`, which this project already fully supports (B1).

### D-066: The landing-page hero uses a CSS 3D composition, not Three.js/R3F

- **Decision:** the hero's dimensional "floating ticket" field (`components/marketing/HeroVisual.tsx`)
  is built entirely from CSS `perspective`/`transform3d`/`rotate3d`, layered blurred radial-gradient
  glows, and a small pointer-move listener that drives parallax via CSS custom properties — no
  `<canvas>`, no WebGL, no new dependency, despite `CLAUDE.md` pre-approving Three.js + React Three
  Fiber for exactly this kind of moment.
- **Why we chose it:** evaluated honestly against the alternative, not reached for reflexively.
  A real R3F scene for one hero moment on a ticketing app (not a 3D showcase product) adds ~600KB+
  gzipped for three.js + fiber + drei, a genuine WebGL-availability risk in headless/CI and some
  mobile browsers, and real lighting/material/camera investment to avoid looking like a generic
  rotating-object demo — more than this single moment justifies. The CSS approach gets real
  dimensional depth (verified by screenshot, see `docs/UI_REDESIGN_AUDIT.md`), perfect performance
  (Lighthouse 98-100 across every category, desktop and mobile, against the real production build),
  zero WebGL risk, and trivial `prefers-reduced-motion` handling (skip attaching the pointer listener
  and the float animation entirely — verified via `page.evaluate(getComputedStyle)` under
  `reducedMotion: "reduce"`, not just reading the CSS).
- **Trade-off:** less visually extensible than a real 3D scene would be (no true camera movement,
  no lit materials) — acceptable for a single above-the-fold composition; if a future stage wants a
  more elaborate 3D product moment, R3F remains available and pre-approved, just not spent here.

### D-067: Conversation titles are derived from the opening message, not editable

- **Decision:** `createConversation` now takes the first user message and stores a truncated
  (≤48 char) version of it as the conversation's `title`, set once at creation and never
  re-derived — a conversation's topic can legitimately drift mid-conversation without that being
  treated as a "wrong" title.
- **Why we chose it:** found during this UI-polish pass — every conversation in the sidebar read
  "Untitled conversation" with no way to tell them apart, a real usability gap for the "polished AI
  product" bar this milestone targets. A derived title needs no new UI (edit/rename controls, a
  rename endpoint) and costs nothing at read time; purely cosmetic metadata, not a business rule, so
  it carries none of this project's usual permission/audit concerns.

### D-068: `apps/api`'s `.env` path resolution anchors on `process.cwd()`, not `__dirname`

- **Decision:** `server.ts` now resolves the repo-root `.env` via
  `path.resolve(process.cwd(), "../../.env")` instead of a `__dirname`-relative
  `"../../../.env"`.
- **Why we chose it:** found while actually running `npm start` against a real `npm run build`
  output for this milestone's Lighthouse work — something no prior stage had actually exercised
  end to end (every prior "production build" verification only checked that `tsc`/`next build`
  compiled without errors, never that the compiled output could actually start and serve traffic).
  The compiled entrypoint sits one directory deeper (`dist/src/server.js` vs `src/server.ts`), so a
  fixed `__dirname`-relative traversal silently resolved to the wrong path under `node
  dist/src/server.js` and crashed on missing env vars. `process.cwd()` is stable across both
  `tsx watch src/server.ts` and `node dist/src/server.js` because both are invoked via
  `npm run <script> -w apps/api`, which always sets the workspace directory as cwd.
- **Known remaining gap, not fixed in this milestone:** `node dist/src/server.js` still fails one
  step later, because `packages/db`'s (and `packages/shared`'s, `packages/agent`'s) `package.json`
  `main`/`types` point at raw `src/index.ts` — fine for `tsx`'s on-the-fly transpilation, not
  executable by plain `node`. Properly fixing this means giving every workspace package its own
  `tsc` build step and switching their `main` fields to compiled output, which is real, separate
  infrastructure work — out of scope for a UI-redesign milestone. Documented honestly here and in
  `docs/UI_REDESIGN_AUDIT.md` rather than silently left for someone to discover later; this
  milestone's Lighthouse/functional verification ran the API via `tsx` (functionally identical to
  `npm start` for everything except this packaging gap) against the real `next build`/`next start`
  frontend, which is what actually mattered for this stage's scope.

### D-069: The hold's conditional update decides who owns inventory, and losing it means a refund

Phase 3 of checkout now checks whether `hold ACTIVE -> CONVERTED` matched a row. If not, the hold expired or was released during the charge and its inventory is already back on sale, so the order is refunded rather than issued tickets. Checks earlier in the flow give better errors; this one is what guarantees no overselling. Alternative rejected: holding the hold's row lock across the payment call, which would keep a transaction open during an external call.

### D-070: One charge at a time per order, including across Idempotency-Keys

An idempotency key dedupes retries of one logical request. It says nothing about two different keys for one hold, which is what a double-click across tabs produces. Phase 1, under the event lock, refuses a second charge while another attempt on that order is unresolved, and partial unique indexes on `payments` back that up.

### D-071: Timeouts settle through the provider's ledger, from three places

A retry with the same key, the 30-second sweep, and the user's next `GET /me/orders` can all settle an open checkout, and Phase 3's compare-and-swap lets only one win. No record at the provider means nothing was charged, so it settles as a decline.

### D-072: Confirmation must predate the turn, and server state is what's reported

A pending confirmation only counts if it was created before the current turn began. Any reply other than a clear yes closes it, so a topic change can't leave it alive for a later "yes", and it can't outlive its hold. `needsConfirmation`, `pendingConfirmation` and `actionTaken` in the chat response now come from the database and tool results. The model's claims about them are ignored.

### D-073: Reading third-party text restricts what the same turn can do

After `get_reviews`, every side effect is refused for the rest of the turn. After `get_event`, purchase and cancel may ask but not execute. The two differ because a normal booking must read the event, hold, and then ask; refusing that outright broke the core flow, which only driving it in a browser revealed. Prompt wording and the regex flag aren't relied on for any of this.

### D-074: The contract is served as written, on top of the existing routes

`POST /events`, `PATCH /events/:id`, `POST /events/:id/cancel` and `GET /audit` were reachable only under `/organisers/:id/...`, with camelCase bodies. "May extend, may not omit" means both have to work, so thin routes resolve the organiser from the event or the caller and reuse the same services, and schemas accept both spellings.

### D-075: Geist and a neutral canvas replace the system serif and amber theme

The amber, serif and charcoal look read as a theme rather than a finished product. Tokens now use a near-black canvas, hairline borders, one warm accent and Geist, self-hosted through `@fontsource` so the build still makes no font requests. This replaces D-063, and adds two small dependencies. The ticket stack from D-066 is replaced by a canvas seat map (`SeatField.tsx`), which still needs no WebGL or Three.js. Only styling, the landing page and generated event art changed. No booking logic or API behaviour did.

<!-- Add new decisions below as they're made, each as its own ### D-NNN section. -->
