# Progress Log

Concise, chronological record of implementation stages. Update after every meaningful stage.
Format per entry: Task / Status / Files changed / Tests run / Commit hash / Remaining issues.

---

## Stage 0 — Audit & documentation (2026-10-31)

- **Task:** Inspect repo, read full assessment PDF (all 10 pages), create/update CLAUDE.md,
  docs/ASSESSMENT_REQUIREMENTS.md, docs/PROGRESS.md, docs/DECISIONS.md.
- **Status:** In progress.
- **Files changed:** `.gitignore`, `CLAUDE.md`, `docs/ASSESSMENT_REQUIREMENTS.md`,
  `docs/PROGRESS.md` (this file), `docs/DECISIONS.md`.
- **Findings:**
  - Repo had no git history (`git init` run, no commits yet). No application code exists.
  - Repo contained two local-only files besides the PDF brief: the assessment PDF itself and
    `ticketbooking.docx` — the candidate's own paraphrase/notes on the assessment, confirming the
    tech stack decision (Next.js/Express 5/Prisma/Postgres/Redis+BullMQ/Nemotron/Three.js) already
    matches the PDF's requirements. Both are gitignored (confidential / derived-from-confidential).
  - Tooling confirmed available locally: Node v20.17.0, npm 10.8.2, Docker 29.8.2,
    Docker Compose v5.6.0, PostgreSQL client 18.6, Git 2.55.0.
- **Tests executed:** None yet (no code).
- **Commit hash:** `77b1757` — docs: add project instructions, requirements checklist, progress and decisions logs.
- **Remaining issues:** None blocking; awaiting approval to start Stage 1 (project foundation).

---

## Stage 1 — Project foundation (2026-10-31)

- **Task:** Scaffold the monorepo (apps/api, apps/web, packages/db, packages/shared), wire up
  Docker Compose (Postgres + Redis), Prisma + env-validated config, a health endpoint, a minimal
  Next.js page that calls it, Vitest, an OpenAPI/Swagger skeleton, `.env.example`, and basic CI.
  No ticketing business logic.
- **Status:** Implemented and verified (all 9 completion criteria below actually ran and passed).
- **Files changed:** `package.json`, `tsconfig.base.json`, `docker-compose.yml`, `.env.example`,
  `README.md`, `.github/workflows/ci.yml`; `apps/api/**` (Express app, env loader, `/health` route,
  OpenAPI doc, Vitest config + 2 tests); `apps/web/**` (Next.js app router page + layout that
  server-fetches the API); `packages/db/**` (empty Prisma schema, `prisma.config.ts`, client
  singleton); `packages/shared/**` (shared `healthResponseSchema`).
- **Verification actually run:**
  - `docker compose up -d` → both `agenticgenie-postgres-1` and `agenticgenie-redis-1` reached
    `healthy` status.
  - `npm run db:generate` → Prisma Client generated successfully.
  - `npm run db:push` → `prisma db push` connected to the live Postgres container and reported
    "already in sync" (empty schema).
  - `npm run typecheck` → all 4 workspaces (`api`, `web`, `db`, `shared`) passed with 0 errors.
  - `npm run test` → 2/2 Vitest tests passed in `apps/api` (health-ok, health-503-on-db-failure).
  - `npm run dev` (manually, api + web separately) → `curl http://localhost:4000/health` returned
    `{"status":"ok","service":"api","timestamp":"..."}` with the real DB round-trip; `curl
    http://localhost:3000` rendered that exact JSON server-side-fetched from the API.
  - `npm run build -w apps/api` (tsc) and `npm run build -w apps/web` (next build) both succeeded.
  - `git status --porcelain --ignored` confirmed `.env`, `apps/web/.env.local`, and all
    `node_modules/` are ignored; nothing resembling a secret was staged.
- **Commit hashes:** `329f107` (workspace scaffold), `6be514d` (shared package), `5ffcd6b` (db
  package), `608b1c7` (api package), `a335b19` (web app), `b0219a2` (CI + README).
- **Remaining issues / notes:**
  - Local Postgres/Redis are mapped to non-default host ports (5434 / 6380) because this machine
    already had unrelated containers/processes bound to 5432 and 6379 — documented in README and
    DECISIONS. CI uses the standard 5432/6379 inside its own isolated runner, so this doesn't
    affect reviewers running CI.
  - Dependency versions were pinned down from each package's "latest" npm tag to the newest release
    still compatible with the installed Node 20.17 runtime (Prisma 7→6.19, Vitest 5→4, concurrently
    10→9) rather than upgrading the system Node install — see DECISIONS.md.
  - `npm audit` reports 3 high-severity advisories, all transitively from `prisma`'s own CLI
    dependency `deepmerge-ts` (stack exhaustion on recursive input) — a dev-only tool dependency,
    not part of the runtime app; accepted for now, revisit if a non-breaking fix becomes available.
  - Next.js 16 auto-generates `apps/web/AGENTS.md` on every `next dev`/`next build` with guidance
    for AI coding agents about Next 16 breaking changes vs. older training data — kept and
    committed (regenerated harmlessly either way); worth a closer read of
    `node_modules/next/dist/docs/01-app` before Stage 4 (frontend) work begins.

---

## Stage 2 — Part A core: database schema and migration foundation (2026-10-31)

- **Task:** Implement the full Part A domain model in `packages/db/prisma/schema.prisma` (18
  models), per the multi-round design review recorded in this conversation and docs/DECISIONS.md
  (D-007–D-013). No business-logic APIs yet — schema and migrations only, as scoped.
- **Status:** Implemented and verified at the schema/constraint level (not yet "Verified" in the
  CLAUDE.md sense of automated tests — that comes with the service-layer stages that use this
  schema; what's below was hand-verified directly against the live database).
- **Files changed:**
  - `packages/db/prisma/schema.prisma` — full rewrite from Stage 1's infra-only placeholder.
  - `packages/db/prisma/migrations/20261031165147_init_ticketing_schema/migration.sql` —
    Prisma-generated: 18 tables, 9 enums, all indexes/FKs.
  - `packages/db/prisma/migrations/20261031165203_add_db_constraints/migration.sql` —
    hand-written: 3 CHECK constraints + 1 partial unique index Prisma's schema DSL can't express.
- **Verification actually run:**
  - `prisma validate` → schema valid.
  - `prisma generate` → client generated successfully (18 models).
  - `prisma migrate dev --name init_ticketing_schema` → applied cleanly against the live Stage-1
    Postgres container (which had zero tables, since Stage 1 only ever ran `db push` on an empty
    schema).
  - `prisma migrate dev --create-only --name add_db_constraints` + hand-written SQL +
    `prisma migrate dev` → applied cleanly.
  - `prisma migrate status` → "Database schema is up to date!", 2 migrations recorded.
  - Manually reviewed the full generated `migration.sql` (480 lines) end-to-end for unintended
    changes — every table, index, FK `onDelete` rule, and the composite FK on `events` matched the
    approved design exactly; nothing unexpected.
  - `psql \d+ holds` / `\d+ ticket_tiers` / `\d+ event_seats` / `\d+ tickets` / `\d+ venues` →
    confirmed all 5 raw-SQL constraints, the composite FK, and `timestamptz` columns are present
    exactly as designed.
  - **Negative-case proof** (inside one outer transaction, rolled back at the end — confirmed zero
    residual rows afterward): (1) inserting an `Event` for organiser B pointing at organiser A's
    venue → rejected with `events_venue_id_organiser_id_fkey` violation; (2) inserting a
    `TicketTier` with `remaining_quantity = -1` → rejected with
    `ticket_tiers_remaining_quantity_bounds` violation; (3) inserting a second `ACTIVE` hold for the
    same user+event → rejected with `holds_one_active_per_user_event` violation.
  - `npm run typecheck` → 0 errors, all 4 workspaces (generated Prisma types for all 18 models
    compile cleanly against existing code).
  - `npm run test` → 2/2 Stage 1 tests still passing (no regression).
- **Commit hash:** `a52dba7` — feat(db): implement Part A ticketing domain schema and migrations.
- **Remaining issues:** None blocking. The service-layer algorithms this schema supports (Phase
  1/2/3 checkout, idempotency claim/takeover, event-cancellation lock coordination, refund/inventory
  lifecycle) are designed and documented in D-011–D-012 but not yet implemented — that's Part A's
  next stages (auth/RBAC, then events/inventory, then holds, then checkout).

---

## Stage 2.1 — Authentication and RBAC foundations (2026-10-31)

- **Task:** Registration/login, JWT-based auth middleware, organiser-scoped STAFF/ADMIN
  authorization, no business (event/hold/order/payment/ticket/refund) endpoints. Schema unchanged —
  no genuine blocker was found requiring a schema change.
- **Status:** Implemented and tested (automated).
- **Files changed:**
  - `apps/api/src/env.ts` — added `JWT_SECRET` (required, min 32 chars), `JWT_EXPIRES_IN` (default
    12h), `BCRYPT_SALT_ROUNDS` (default 10).
  - `apps/api/src/lib/errors.ts` — `ApiError` class, formatted by a new central error handler.
  - `apps/api/src/middleware/{requestId,errorHandler,validate,requireAuth,requireOrganiser}.ts` —
    new shared middleware (request-id generation, PDF-shaped error envelope, Zod body/param
    validation, JWT-based identity, organiser membership/role gating).
  - `apps/api/src/modules/auth/{password,jwt,schemas,service,router,policies}.ts` — bcryptjs
    hashing, JWT sign/verify, Zod request schemas, register/login business logic, the Express
    router, and the `canRefundOrder` self-refund policy function.
  - `apps/api/src/types/express.d.ts` — augments `Request` with `requestId`, `user`, `membership`.
  - `apps/api/src/app.ts` — wires requestId → cors → json → `/health` → `/auth` → errorHandler
    (error handler last, per Express convention).
  - `apps/api/src/routes/health.ts` — small refactor to throw `ApiError` instead of a hand-rolled
    503 body, now that shared error infrastructure exists (keeps `request_id` populated instead of
    the Stage 1 placeholder `null`).
  - `apps/api/src/openapi.ts` — documented `/auth/register`, `/auth/login`.
  - `apps/api/test/helpers/fixtures.ts` — shared test fixtures (user/organiser/membership) with
    tracked-ID cleanup.
  - `apps/api/test/auth/{password,jwt,policies,register-login}.test.ts`,
    `apps/api/test/middleware/{require-auth,require-organiser}.test.ts` — see below.
  - `apps/api/test/setup.ts` — now loads the real root `.env` (these tests hit the live Postgres
    container, not a mock) with fallback defaults for CI.
  - `package.json` / `packages/db/package.json` — added `db:migrate:deploy` / `migrate:deploy`
    scripts; `.github/workflows/ci.yml` switched from `db:push` to `db:migrate:deploy` (per the
    explicit instruction to treat migrations, not `db push`, as the deployment strategy) and gained
    `JWT_SECRET`/`JWT_EXPIRES_IN`/`BCRYPT_SALT_ROUNDS` env vars.
  - `.env.example`, `.env` (local, untracked) — added the three new auth env vars.
  - `README.md`, `docs/ASSESSMENT_REQUIREMENTS.md` (D2, W1, E1 → Tested), `docs/DECISIONS.md`
    (D-014–D-016).
- **Tests added (34 passing, 7 files):**
  - Password hashing: round-trip, wrong password rejected, salted (two hashes of the same password
    differ).
  - JWT: sign/verify round-trip; rejects expired, wrong-signature, malformed, and
    missing-subject tokens.
  - `canRefundOrder`: staff+own order → false; staff+other's order → true; admin+own order → true
    (documented exception); admin+other's order → true.
  - `POST /auth/register` / `POST /auth/login` (real DB): successful registration returns no
    password hash; duplicate email → 409; invalid payload → 400; successful login; wrong password
    and unknown email both → 401 with an identical code/message (no enumeration).
  - `requireAuth` (real DB): missing header, malformed header, malformed token, expired token,
    wrong-signature token, and a well-signed token for a now-deleted user all → 401; a valid token
    establishes identity for a plain attendee with zero organiser memberships; a request whose body
    claims a *different* userId still resolves to the token's real identity (proves identity is
    never taken from client input).
  - `requireOrganiserMembership` / `requireOrganiserRole` / `requireAdmin` (real DB): member in any
    role passes the membership-only gate; a user with no membership at all → 404 (not 403); a user
    who belongs to a *different* organiser → 404 (cross-organiser rejection); staff passes a
    staff-or-admin gate but gets 403 (not 404) on an admin-only gate; admin passes the admin-only
    gate; a user with ADMIN on one organiser and STAFF on another is correctly scoped per-organiser
    (admin-only passes on their own org, 403 on the other, proving role isn't global).
  - Scope note: full resource-level cross-user tests (e.g. "can't view someone else's *order*") are
    deferred to each resource's own endpoint test suite once that resource exists — this stage
    proves the identity-establishment primitive itself can't be spoofed by client input, which every
    later resource-isolation check depends on.
- **Verification actually run:**
  - `npm run typecheck` → 0 errors, all 4 workspaces.
  - `npm run test` → 34/34 passing, run 4 times total (including 3 repeats after fixing a
    cross-file test race — see below) to confirm no flakiness.
  - `prisma migrate status` → still "up to date," 2 migrations, confirming no schema drift was
    introduced this stage.
  - `psql` query confirmed zero residual rows in `users`/`organisers`/`organiser_memberships` after
    the full test run (fixture cleanup verified, not just assumed).
  - **Bug caught and fixed during this stage:** the first test run had one intermittent-looking
    failure (passed in isolation, failed in the full suite). Root cause: `register-login.test.ts`'s
    cleanup deleted users by email prefix `test-auth-`, which was *also* the prefix
    `test/helpers/fixtures.ts` used for its own unrelated test users — when Vitest ran files in
    parallel, one file's cleanup deleted another file's in-flight fixtures. Fixed by giving
    `register-login.test.ts` its own distinct prefix (`test-register-login-`). Documented here
    rather than silently fixed, since it's a reusable lesson for every future test file: tracked-ID
    cleanup (`fixtures.ts`'s approach) doesn't have this failure mode; prefix-based cleanup does
    unless every file's prefix is provably disjoint.
- **Commit hash:** `ba8b6d1` — feat(api): implement authentication and organiser RBAC foundations.
- **Remaining issues / scope notes:** No business endpoints yet (by design — next stages). No
  audit-log entries are written for registration (deferred to when the broader audit-writing
  convention is established alongside the first real business mutation, to avoid half-wiring it
  here). No password reset / refresh-token flow (documented auth shortcut, to be written up in
  `DESIGN.md`).

---

## Stage 2.2 — Venues, events, and inventory management (2026-10-31)

- **Task:** Organiser-scoped venue CRUD + seat-map hierarchy (Section→Row→Seat), event
  create/update/publish with validated status transitions, GA ticket tiers, one-time EventSeat
  bulk-generation, and the public event catalogue (filters + keyset pagination). No holds, orders,
  payments, tickets, refunds, or event cancellation — explicitly deferred.
- **Status:** Implemented and tested (automated). No database schema changes were needed.
- **Files changed:**
  - `apps/api/src/lib/{actionContext,audit,prismaErrors,pagination}.ts` — new shared infra: the
    `{actorUserId, organiserId, requestId}` context every mutation needs, the one audit-write
    helper (not a framework), Prisma unique-constraint → 409 mapping, and the `(createdAt, id)`
    cursor encode/decode.
  - `apps/api/src/modules/venues/{schemas,service,router}.ts` — venue CRUD, Section/Row/Seat
    creation, organiser-ownership checks at every nesting level.
  - `apps/api/src/modules/events/{schemas,statusTransitions,service,router,publicRouter}.ts` —
    event create/update/publish, the full (if partially unexposed) status-transition table, and the
    public catalogue + detail endpoints.
  - `apps/api/src/modules/inventory/{schemas,service}.ts` — GA ticket tier creation, EventSeat
    bulk-generation from priced venue sections.
  - `apps/api/src/middleware/validate.ts`, `apps/api/src/types/express.d.ts` — added `validateQuery`
    / `req.validatedQuery` (see D-021 — `req.query` turned out to be a read-only getter in Express 5,
    unlike `req.body`/`req.params`).
  - `apps/api/src/app.ts` — mounted `/events` (public), `/organisers/:organiserId/venues` and
    `/organisers/:organiserId/events` (both behind `requireAuth`, reusing Stage 2.1's middleware
    unchanged).
  - `apps/api/src/openapi.ts` — documented the new endpoints (summary-level).
  - `apps/api/test/helpers/fixtures.ts` — extended with venue/section/row/seat/event/tier builders;
    cleanup strategy changed to organiser-id-scoped deletion (see D-022 — a real bug caught and
    fixed during this stage).
  - `apps/api/test/venues/venues.test.ts`, `apps/api/test/events/{events,catalogue}.test.ts`,
    `apps/api/test/inventory/inventory.test.ts` — see below.
  - `docs/ASSESSMENT_REQUIREMENTS.md` (D3, D4, D8, W2, W3, W4, E2, E3, E10, A7 updated),
    `docs/DECISIONS.md` (D-017–D-022).
- **Tests added (72 passing total, 11 files — 38 new this stage):**
  - Venues: admin creates a venue for their own organiser; audit entry written in the same
    transaction; staff forbidden (403); list scoped to the caller's own organiser only; 404 (not
    403) fetching another organiser's venue; update records accurate before/after audit state.
  - Seat map: section→row→seat creation returns the full nested structure on venue detail;
    duplicate section name → 409; duplicate seat label within a row → 409; a row whose
    `sectionId` doesn't match the URL's section → 404.
  - Events: creates as DRAFT with an audit entry; creating against another organiser's venue → 404
    (composite FK + service-layer check); staff forbidden; another organiser's event → 404; update
    while DRAFT succeeds, while COMPLETED → 409; publish with no inventory → 422; publish with a
    tier → 200 with before/after audit state; publishing an already-published or CANCELLED event →
    409 `INVALID_STATUS_TRANSITION`.
  - Inventory: tier creation seeds `remainingQuantity` from `totalQuantity`; invalid
    price/quantity → 400 at the validation layer; **the DB itself** rejects
    `remaining_quantity` outside `[0, total]` even bypassing the API (direct Prisma call); duplicate
    tier name → 409. EventSeat generation creates exactly one row per physical seat at the
    configured price; regenerating → 409; **the DB itself** rejects a duplicate
    `(eventId, seatId)` even bypassing the service layer; a section from a different venue → 404.
  - Catalogue: DRAFT hidden from both search and direct GET; PUBLISHED visible in search; direct
    GET resolves CANCELLED but not DRAFT; city/category/date-range/text filters, including a test
    that specifically exercises combining text search with another filter (the bug described
    below); cursor pagination proven stable across a concurrent insert made *between* two page
    fetches (no duplicate ids across pages, the insert and a previously-seeded row are both still
    reachable); malformed cursor → 400; oversized page size → 400.
- **Two real bugs caught and fixed while writing this stage (not left for later):**
  1. **Query-builder bug:** the first draft of the catalogue filter built `where` by object-spreading
     a `{...where, OR: [...]}` to add the cursor condition — but the text-search filter (`q`) also
     produces an `OR` key, so combining the two via spread would silently let the second `OR`
     overwrite the first, dropping the text-search condition whenever both were used together.
     Fixed by building the whole filter as an `AND` array of independent conditions before writing
     any tests — caught by reasoning about the code, then confirmed by the "text search combined
     with city filter" test.
  2. **Test-cleanup bug:** the first test run failed with 20 foreign-key-constraint violations.
     Root cause and fix recorded in docs/DECISIONS.md D-022 — fixture cleanup only tracked rows
     created directly through fixture helpers, not through the real HTTP endpoints under test.
- **Verification actually run:**
  - `npm run typecheck` → 0 errors, all 4 workspaces.
  - `npm run test` → 72/72 passing, run 5 times total (across both bug-fix iterations) to confirm
    no flakiness once fixed.
  - `prisma migrate status` → still "up to date," 2 migrations — confirmed no schema drift.
  - `psql` row counts confirmed the database returns to exactly empty after a full test run; also
    found and manually cleared ~26 orphaned organisers/venues/events/audit-logs left behind by the
    *failed* runs during debugging (before the cleanup fix) — confirmed via a repeat run that counts
    were static, not growing, before clearing them, so the leftover was debugging debris, not an
    ongoing leak.
- **Commit hash:** `0c9d6be` — feat(api): implement venue, event, and inventory management.
- **Remaining issues / scope notes:** Event cancellation is deliberately not implemented (see D-019
  — needs holds/orders to resolve correctly, which don't exist yet). `PUBLISHED→ON_SALE→SOLD_OUT`
  transitions aren't exposed over HTTP yet (the rule exists and is tested; no endpoint calls it
  yet — tied to when holds/purchases start depleting inventory). Per-section seat availability
  breakdown deferred (D-020) in favour of an overall summary. No "list organiser's own events"
  endpoint was built (not explicitly requested; organiser event access goes through the per-event
  detail route for now).

---

## Stage 2.3 — Holds and concurrency (2026-10-31)

- **Task:** `POST /holds` (seated + GA), `DELETE /holds/:id`, atomic concurrency guarantees, lazy
  expiry, ticket limits, required idempotency. Part of the larger "Complete Part A" continuous
  session (Stages 2.3–2.7 + frontend + acceptance, no stop-for-approval between stages per explicit
  instruction).
- **Status:** Implemented and tested. No schema changes.
- **Files:** `apps/api/src/lib/idempotency.ts` (new, shared claim/replay/stale-retry helper for
  single-transaction operations); `apps/api/src/modules/holds/{schemas,sweeper,service,router}.ts`;
  `apps/api/src/env.ts` (+`HOLD_EXPIRY_MINUTES`, default 10); `apps/api/src/app.ts` (mounted
  `/holds` behind `requireAuth`); `apps/api/test/holds/holds.test.ts` (13 tests).
- **Tests (85 passing total, 13 new):** **50 parallel holds on one seat → exactly 1 succeeds, 49 get
  409** (acceptance criterion A2, seated case). **200 buyers racing 100 GA tickets → exactly 100
  succeed, `remainingQuantity` ends at exactly 0, never negative** (A2, GA case) — both run against
  the real Postgres container with real concurrent HTTP requests, not simulated. Plus: DRAFT events
  can't be held; one active hold per user/event enforced; >8 tickets in one request rejected at
  validation; ambiguous seatIds+tierId body rejected; only the owning user can release their hold
  (404 for a stranger); releasing twice is idempotent (200, no double-credit); a swept expired hold
  releases inventory exactly once even if swept twice; an expired hold is rejected at checkout-time
  lazy-check and its inventory is released right there; idempotent replay (same key+body → same
  hold, inventory decremented once); same key+different body → 422; missing Idempotency-Key → 400.
- **Verification:** `npm run typecheck` clean (4/4 workspaces). `npm run test` 85/85, repeated twice
  for concurrency-test stability. `prisma migrate status` unchanged (no schema drift). DB confirmed
  empty after the run.
- **Commit hash:** `c7c41ba` — feat(api): implement holds with atomic concurrency guarantees.
- **Deliberate simplifications (see docs/DECISIONS.md D-023–D-026):** Idempotency-Key is required,
  not merely accepted. No BullMQ-scheduled sweeper yet — lazy expiry, triggered opportunistically at
  hold-creation and checkout time, fully satisfies the PDF's "lazily on read or sweeper" requirement
  and closes the realistic inventory-idle gap without queue/worker plumbing; `sweepAllExpiredHolds()`
  is written and tested, ready to attach to a scheduled job later.

## Stage 2.4 — Orders, payments, and idempotency (2026-10-31)

- **Task:** `POST /orders` (three-phase checkout against the deterministic fake payment provider),
  `GET /me/orders`. The architecturally hardest piece of Part A — the full claim/replay/stale-
  takeover idempotency protocol and the phase split designed during Stage 2's schema review.
- **Status:** Implemented and tested. No schema changes.
- **Files:** `apps/api/src/modules/payments/fakeProvider.ts` (in-memory, externalRef-keyed ledger —
  SUCCESS/DECLINE/TIMEOUT, with `timeout_then_success`/`timeout_then_decline` resolving
  synchronously for deterministic tests); `apps/api/src/modules/orders/{schemas,checkout,service,
  router}.ts`; `apps/api/src/app.ts` (mounted `/orders`, `/me/orders`); `apps/api/test/orders/
  checkout.test.ts` (11 tests); `apps/api/vitest.config.ts` (`fileParallelism: false` — see
  D-027); `apps/api/test/helpers/fixtures.ts` (cleanup extended for Ticket/Refund/Order — see
  below).
- **Tests (96 passing total, 11 new this stage):** full success path (order PAID, correct ticket
  count, hold CONVERTED, `paidByPaymentId` set, `Payment.externalRef` verified to equal the owning
  `IdempotencyRecord.id`); `Order.holdId` uniqueness enforced at the DB level even bypassing the
  service layer; decline path (hold stays ACTIVE, zero tickets issued, inventory untouched) and a
  successful retry afterward with a fresh key; **timeout-then-takeover**: first attempt gets 202 with
  `Payment.TIMED_OUT`, forced-stale via direct `updatedAt` manipulation (no real 30s wait), retry
  with the *same* key succeeds via the provider's already-resolved ledger entry — exactly one ticket
  set issued, two `Payment` rows total (one per attempt, for history), the original stays
  `TIMED_OUT` untouched, `paidByPaymentId` points at the second (authoritative) attempt; a genuinely
  concurrent non-stale duplicate gets 409 `REQUEST_IN_PROGRESS`; idempotent replay (same key+body →
  identical order, tickets not re-issued); same key + different hold → 422; checking out someone
  else's hold → 404; an expired hold is rejected and its inventory is provably restored; starting
  checkout against an already-cancelled event → 409 (full cancelled-mid-flight race deferred to
  Stage 2.5 where a real cancel endpoint exists to interleave against realistically).
- **Three real bugs caught and fixed while building this (all by the test suite, not after):**
  1. `Payment.externalRef` was wired to the *user's* id instead of the owning
     `IdempotencyRecord.id` — would have made every order from the same user share one ledger
     entry in the fake provider, corrupting the dedup mechanism entirely. Caught before running any
     tests, by re-reading the draft against the design (D-012).
  2. Phase 1 treated any non-`PENDING_PAYMENT` order as terminal, incorrectly blocking a legitimate
     retry after a decline — fixed per D-028.
  3. The lazy-expiry-at-checkout release was performed inside the same transaction as the 409 throw
     that rejects an expired-hold checkout, so the whole transaction (release included) rolled back —
     fixed per D-029.
  4. (Test infra, not product code) Vitest's parallel file execution against one real Postgres
     container produced one intermittent cross-file failure in a full-suite run — fixed per D-027
     (`fileParallelism: false`), confirmed stable across 5 consecutive full runs afterward.
  5. (Test infra) `resetFixtures()` needed Ticket/Refund/Order deletion added *before* Event deletion
     — Order/Ticket/Refund all have `Restrict` relations that blocked Event's own cascade to Hold.
     Same category of bug as D-022, now covering the full order lifecycle's tables.
- **Verification:** `npm run typecheck` clean. `npm run test` 96/96, run 5 times total for stability.
  `prisma migrate status` unchanged. DB confirmed empty after a clean run (debris from the
  bug-fixing iterations manually cleared and confirmed non-growing beforehand, same method as
  Stage 2.2/2.3).
- **Commit hash:** _pending._
- **Scope notes:** Tickets are issued only on `SUCCESS`; never on `DECLINE` or `TIMEOUT` (verified by
  test). The deeper "event cancelled while a checkout's payment call is genuinely in flight"
  interleaving is implemented (Phase 3 re-checks event status under its own lock and auto-refunds a
  late success) but not yet end-to-end tested with a real concurrent cancellation request — that
  lands with Stage 2.5's cancellation endpoint.

<!-- Add new entries above this line, most recent first is NOT required — keep chronological. -->
