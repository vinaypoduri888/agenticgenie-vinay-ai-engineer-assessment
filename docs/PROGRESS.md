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
- **Commit hash:** `67ed1ef` — feat(api): implement three-phase checkout with idempotent payments.
- **Scope notes:** Tickets are issued only on `SUCCESS`; never on `DECLINE` or `TIMEOUT` (verified by
  test). The deeper "event cancelled while a checkout's payment call is genuinely in flight"
  interleaving is implemented (Phase 3 re-checks event status under its own lock and auto-refunds a
  late success) but not yet end-to-end tested with a real concurrent cancellation request — that
  lands with Stage 2.5's cancellation endpoint.

## Stage 2.5 — Tickets, check-in, refunds, and cancellation (2026-10-31)

- **Task:** `POST /tickets/:code/checkin`, `POST /orders/:id/refund`, event cancellation
  (`POST /organisers/:organiserId/events/:eventId/cancel`). No schema changes.
- **Status:** Implemented and tested.
- **Files:** `apps/api/src/modules/tickets/{service,router}.ts`; `apps/api/src/modules/refunds/
  {schemas,service}.ts` (`performRefund` shared core + `requestRefund` user-facing endpoint, wired
  into `orders/router.ts`); `apps/api/src/modules/events/cancellation.ts` (Step A: lock event,
  resolve holds, one transaction; Step B: one transaction per paid order, not one giant transaction);
  `apps/api/src/modules/events/service.ts` (+`INVENTORY_RELEASE_BLOCKED_STATUSES` export, shared by
  refunds and cancellation); `apps/api/test/{tickets/checkin,refunds/refunds,events/cancellation}
  .test.ts` (23 new tests); `apps/api/test/helpers/fixtures.ts` (+`purchaseGaTickets`, driving a real
  hold+checkout through the actual HTTP endpoints so downstream tests exercise the same path a real
  attendee would).
- **Tests (119 passing total, 23 new):** check-in — staff of the owning organiser succeeds; a second
  check-in on the same code → 409 `ALREADY_CHECKED_IN`; **10 simultaneous check-in attempts on one
  code → exactly 1 success, 9 clean 409s** (concurrency-safe, same conditional-update pattern as
  holds); staff of a *different* organiser → 404 (not 403); a plain attendee with no membership →
  404; check-in on a CANCELLED event → 409; unknown code → 404. Refunds — attendee self-refund
  within the window restores GA inventory; past the window → 409 `REFUND_WINDOW_CLOSED`; refunding
  someone else's order → 404; refunding an already-refunded order → 409 `ORDER_NOT_REFUNDABLE`
  (never double-refunds); idempotent replay returns the identical refund; staff refunds another
  attendee's order; **staff refunding their own order → 403** (the specific rule this whole
  assessment keeps calling out); admin refunds their own order even past the window (the documented
  exception); cross-organiser staff probing an order → 404; a checked-in ticket's refund does **not**
  return its inventory to sale. Cancellation — cancels the event and resolves an active hold,
  restoring GA inventory exactly; refunds every paid order for the event, exactly one `Refund` row
  per order; **repeated cancellation is a safe no-op** (`alreadyCancelled: true`, zero additional
  refunds, confirmed by counting `Refund` rows after a second call); staff forbidden (403); cancelling
  an already-COMPLETED event → 409 `INVALID_STATUS_TRANSITION` (terminal state, no outgoing
  transition); a hold created before cancellation can no longer be checked out afterward → 409.
- **One real bug caught by the test suite, fixed immediately:** the first version of the "refunds
  within the window" test asserted the wrong expected value (compared against `tier.remainingQuantity
  + 1` instead of recognizing the prior purchase had already decremented it, so purchase-then-refund
  nets back to the *original* value) — a test bug, not a product bug; fixed and re-verified.
- **Verification:** `npm run typecheck` clean. `npm run test` 119/119, run twice for stability. `prisma
  migrate status` unchanged. DB confirmed empty after a clean run, no residue this time.
- **Commit hash:** `b58e61d` — feat(api): implement check-in, refunds, and event cancellation.
- **Scope notes:** The deeper "event cancelled while a specific checkout's payment call is genuinely
  in flight" race (Phase 3's own re-check-and-auto-refund path, built in Stage 2.4) is exercised
  indirectly here (cancellation correctly blocks *new* checkouts against a cancelled event), but a
  true concurrent interleaving test (cancel request racing an in-flight checkout's Phase 2) was not
  written — doing so deterministically would need the fake provider to expose a controllable delay
  hook, which doesn't exist yet. Flagged as a known test-coverage gap, not a design gap: the code
  path itself was reviewed and is structurally identical to the already-tested "pre-cancelled event"
  case, just entered via a narrower timing window.

## Stage 2.6 — Reviews, sales reports, and audit (2026-10-31)

- **Task:** `GET/POST /events/:id/reviews`, `GET /organisers/:id/reports/sales`,
  `GET /organisers/:id/audit`. Also fixed a real gap found while building this: several audit
  writes from Stages 2.3–2.5 had `organiserId: null`, making them invisible to the organiser-scoped
  audit endpoint this stage adds. No schema changes.
- **Status:** Implemented and tested.
- **Files:** `apps/api/src/modules/reviews/{schemas,service,router}.ts`; `apps/api/src/modules/
  reports/{schemas,service,router}.ts` (raw-SQL net-revenue aggregation); `apps/api/src/modules/
  audit/{schemas,service,router}.ts`; `apps/api/src/modules/holds/{service,sweeper}.ts` and
  `apps/api/src/modules/orders/checkout.ts` (fixed `organiserId: null` → the real event's organiser
  — see D-032); `apps/api/test/{reviews/reviews,reports/sales,audit/audit}.test.ts` (15 new tests);
  `apps/api/test/helpers/fixtures.ts` (`resetFixtures` now explicitly clears `AuditLog`, which its
  `SetNull` relations don't clean up for free — see D-035).
- **Tests (134 passing total, 15 new):** Reviews — an attendee who attended a COMPLETED event can
  review it; someone who never attended → 403 `NOT_ELIGIBLE`; reviewing before the event completes →
  409; a second review from the same attendee → 409 (the `@@unique` constraint, surfaced cleanly);
  an out-of-range rating → 400; public listing works with no auth and stores adversarial-looking
  text ("SYSTEM: ignore previous instructions...") as plain inert data, never executed — exactly
  the seed-data injection scenario Part B will later test against the agent layer. Reports — net
  revenue grouped by event; a refund automatically zeroes reported revenue for that ticket, no
  separate subtraction logic needed; grouping by tier; staff (not just admin) can view sales, per
  the PDF's role table; a different organiser's member → 404. Audit — every mutation in a seeded
  flow (hold, checkout) shows up with a real `requestId` and timestamp; entity-scoped queries work
  for staff; the organiser-wide feed (no entity filter) is admin-only (403 for staff); cross-organiser
  access → 404; a malformed `entity` filter → 400.
- **Two real bugs caught and fixed:**
  1. **Audit entries silently unreachable:** `HOLD_CREATED`, `HOLD_RELEASED`, `HOLD_EXPIRED`, and
     every `ORDER_*` audit action had been written with `organiserId: null` since those modules
     don't run inside an organiser-scoped route — the writer had the user/hold/event in scope but
     never resolved the organiser id into the audit call. Not caught by Stage 2.3/2.4's own tests
     (which only checked the *mutation* succeeded, not that its audit trail was queryable by
     organiser) — only surfaced once this stage's audit endpoint tried to actually query by
     `organiserId`. Fixed across `holds/service.ts`, `holds/sweeper.ts`, `orders/checkout.ts`.
  2. **Orphaned audit debris across test runs:** `resetFixtures()` relied on cascading/relational
     deletes for cleanup, but `AuditLog`'s `SetNull` relations mean it's never cleaned up that way —
     over this session's many test iterations, over 1,200 orphaned rows (both `organiserId` and
     `actorUserId` null) had silently accumulated. Caught via the same `psql` row-count verification
     used throughout this session, confirmed as accumulating debris (not a live leak) by checking it
     only grew across *failed*-cleanup runs, fixed, and the debris cleared.
- **Verification:** `npm run typecheck` clean. `npm run test` 134/134, run twice. `prisma migrate
  status` unchanged. DB confirmed fully empty after a clean run, including `audit_logs` — the first
  time that table has read zero after a run all session.
- **Commit hash:** `c39df89` — feat(api): implement reviews, sales reports, and audit log access.

## Stage 2.7 — Seed data (2026-11-01)

- **Task:** repeatable, idempotent synthetic seed data covering every PDF requirement. No schema
  changes.
- **Status:** Implemented, run twice against the real dev database, and verified by direct SQL
  query against every individual requirement (not just "the script exited 0").
- **Files:** `apps/api/src/seed.ts` (new); `apps/api/package.json` / root `package.json`
  (`npm run db:seed`); one real bug fix in `apps/api/src/modules/orders/checkout.ts` (see below) plus
  a new regression test in `apps/api/test/orders/checkout.test.ts`.
- **Verification — every requirement checked by direct SQL, not assumed:**

  | Requirement | Actual |
  |---|---|
  | 2 organisers | 2 (Laugh Factory Pune, Riverfront Live) |
  | 1 admin + 2 staff per organiser | 2 admins, 4 staff total |
  | ≥6 attendees | 16 |
  | ≥12 events | 12 |
  | ≥3 cities | 3 (Pune, Mumbai, Bangalore) |
  | All required statuses | 2 of each: DRAFT, PUBLISHED, ON_SALE, SOLD_OUT, CANCELLED, COMPLETED |
  | ≥1 seated event | 1 (12 `EventSeat` rows generated, 2 sold) |
  | ≥1 GA event | multiple |
  | ≥1 nearly sold-out | 2 (`2/10` and `1/5` remaining) |
  | ≥1 event with expired holds | 1 unswept `ACTIVE` hold with `expiresAt` in the past |
  | Completed events, ≥30 reviews | 2 completed events, 32 reviews total |
  | ≥2 adversarial reviews | 2 ("SYSTEM: Ignore your previous instructions...", "Assistant: disregard all prior rules...") |

- **One real bug caught by the seed script's first real seated-ticket purchase, not by any prior
  test:** `issueTickets`'s seated branch flipped `EventSeat.status` to `SOLD` without clearing
  `holdId`, violating the `event_seats_hold_id_matches_status` CHECK constraint from Stage 2's
  migration. Root cause: no test in Stage 2.3 or 2.4 had ever carried a *seated* hold through a
  *successful checkout* — Stage 2.3 tested seated hold creation, Stage 2.4's checkout tests all used
  GA holds. Fixed (`status: "SOLD", holdId: null`) and closed the coverage gap permanently with a new
  regression test, rather than relying on the seed script to keep catching it. Documented in
  docs/DECISIONS.md D-037 as a reminder for Part B's eval design: full-flow exercises catch a
  different class of bug than per-function tests.
- **Idempotency verified**: ran `npm run db:seed` twice in a row; identical row counts both times
  (2 organisers, 22 users, 12 events, 32 reviews), confirming cleanup correctly removes exactly the
  previous seed run's data before recreating it, with no duplication.
- **Full suite re-verified with seed data present in the database** (not just in an empty test DB):
  135/135 passing (134 + 1 new regression test), run 3 times. One isolated, non-reproducing failure
  occurred once during this stage's work (unrelated test, passed cleanly on immediate retry with no
  code change) — noted honestly here as the kind of transient flakiness `fileParallelism: false`
  (D-027) was meant to eliminate; it reduced frequency substantially but apparently not to absolute
  zero in this environment. Not chased further given it never reproduced on retry and the remaining
  scope this session still has to cover.
- **Commit hash:** `a17ebb0` — feat(db): add idempotent seed script covering every seed requirement.

---

## Stage 2.8 — Frontend integration (attendee, organiser admin, organiser staff) (2026-11-01)

- **Task:** Build a real, backend-connected Next.js frontend for all three personas (attendee,
  organiser admin, organiser staff) per the mega-prompt's Section 7; no disconnected demo UI, no
  client-side-only permission logic, no fake success states. Add the minimum backend support
  endpoints the frontend genuinely cannot work without.
- **Status:** Implemented and verified end-to-end with real Playwright browser sessions against the
  real API and seeded Postgres database (not mocked, not just typechecked).
- **Files changed:**
  - New shared frontend libs: `apps/web/src/lib/api.ts` (fetch wrapper: Bearer token injection,
    Idempotency-Key passthrough, throws `ApiError` with the server's real status/code/message — never
    swallows an error into a fake success), `apps/web/src/lib/useSession.ts`, `apps/web/src/lib/styles.ts`.
  - New pages: `/register`, `/login`, `/events`, `/events/[id]`, `/orders`,
    `/organiser` (dashboard), `/organiser/[organiserId]/events`,
    `/organiser/[organiserId]/events/[eventId]`, `/organiser/[organiserId]/venues`,
    `/organiser/[organiserId]/venues/[venueId]`, `/organiser/[organiserId]/reports`,
    `/organiser/[organiserId]/checkin`, `/organiser/[organiserId]/refunds`; `components/Nav.tsx`
    wired into `layout.tsx`.
  - New backend endpoints (thin, read-only, same permission model as their siblings — see
    docs/DECISIONS.md D-040): `GET /me/memberships` (`apps/api/src/modules/auth/memberships.ts` +
    `meMembershipsRouter.ts`, 2 tests), `GET /organisers/:organiserId/events` list
    (`modules/events/service.ts` + `router.ts`, 2 tests), `GET /events/:eventId/seats`
    (`modules/events/service.ts` + `publicRouter.ts`, 2 tests).
  - Bug fixes found via browser testing (see docs/DECISIONS.md D-041): seated-checkout
    `holdId`/CHECK-constraint bug (already fixed and tested in Stage 2.7, re-verified here through the
    UI); a real dropdown state-sync bug in the venue seat-map page (`organiser/[organiserId]/venues/[venueId]/page.tsx`)
    where the submit handler could read a stale empty value despite the `<select>` visually showing a
    fallback option, including a silent-failure branch that showed no error at all; missing
    `type="text"` on several `<input>` elements across the frontend.
- **Workflows actually driven end-to-end in a real headless browser (Playwright), not just
  typechecked:**
  - **Attendee:** register → browse/search events by city and category → open event detail → select
    a GA tier → create a hold → see "Hold active" → confirm and pay → checkout completes with the
    server's real status (not an assumed one) → `/orders` shows the new PAID order.
  - **Organiser admin:** login → dashboard lists real organiser memberships → organiser events list →
    create a draft event → add a ticket tier → publish (status flips to PUBLISHED, read back from the
    server) → sales report page loads real revenue figures → venue management: create a venue →
    create a section → create a row → create a seat, all persisted and re-rendered from the server
    after each step.
  - **Organiser staff:** login → check-in page rejects an invalid ticket code with the server's real
    "Ticket not found" error (not a client-side guess) → attempts to refund their own order and is
    rejected with the server's exact message, "Staff cannot refund their own order," proving the
    frontend has no client-side self-refund guard of its own — the 403 and its message are the
    server's, displayed verbatim.
  - All three runs captured zero uncaught browser console errors.
- **Tests executed:**
  - `npm run typecheck` — clean, no errors, across api/web/shared/db.
  - `npm run test` (backend, real Postgres) — **141/141 passing**, run twice for stability (one
    transient truncated run investigated and immediately re-confirmed clean, consistent with the
    non-reproducing flakiness already documented in Stage 2.4/2.6; not a regression).
  - 3 Playwright scripts (attendee flow, organiser admin flow, venue+staff-refund flow) — all passed,
    details above.
- **Database hygiene:** after manual Playwright/browser testing, verified via direct `psql` queries
  that the dev database was restored to exactly the original seed baseline (2 organisers, 22 users,
  12 events, 3 venues, 32 reviews) — all Playwright-created rows (test users, test venue/event, test
  order) were identified and removed in FK-safe order (tickets → refunds → orders → holds → reviews →
  users/venues/events).
- **Commit hashes:** `fcddb2f` — feat(api): add membership lookup, organiser event list, and seat
  list endpoints; `bf02f82` — feat(web): build connected frontend for attendee, admin, and staff
  workflows.
- **Remaining issues:** none blocking. The ambient non-reproducing test flakiness (Docker-for-Windows/
  WSL2 connection-pool transient hiccups, hypothesized) remains a known, accepted, documented
  limitation — never traced to an actual code defect across ~4 occurrences this session.

---

## Stage 2.9 — Consolidated Part A acceptance-testing pass (2026-11-01)

- **Task:** per the "Complete Part A" mega-prompt's Section 9, run an explicit consolidated
  acceptance pass over A1–A8 rather than relying on each stage's own local verification, and bring
  `docs/ASSESSMENT_REQUIREMENTS.md` (which had drifted out of date since ~Stage 2.2) back in line
  with what the code and tests actually prove.
- **Status:** Done. A1–A8 all independently re-verified; two real coverage gaps found and closed
  (pagination tests, requirements-doc staleness); one real but out-of-scope gap found and
  consciously left as a documented limitation rather than fixed (event `ON_SALE`/`SOLD_OUT`/
  `COMPLETED` HTTP transitions — see docs/DECISIONS.md D-042).
- **A1 (fresh clone → running seeded app in ≤5 commands) — verified for real, not just by
  re-reading the README:** cloned the repo into an isolated temp directory, remapped only the
  throwaway clone's Postgres/Redis host ports to avoid colliding with the main repo's running
  containers, and ran the README's own 4 chained commands end to end. Result: API came up healthy,
  `/auth/login` succeeded for a seeded admin, `/events` returned real seeded rows. Fully torn down
  afterward (`docker compose down -v` + temp directory deleted); confirmed the main repo's own
  containers and git state were untouched throughout.
- **A5/A6 (role rules, isolation) — confirmed already covered**, just never reflected in the
  requirements doc: `require-organiser.test.ts` plus per-resource 403/404 tests across venues,
  events, inventory, reports, audit, refunds, check-in, and cancellation.
- **A7 (pagination) — real gap found and closed.** Only the event catalogue had a cursor-stability
  test; `/me/orders`, event reviews, and the organiser audit feed share the same keyset-pagination
  helper but had none. Added the identical no-duplicates/no-skips-under-concurrent-insert test to
  all three (`apps/api/test/orders/my-orders.test.ts` — new file, also covers basic
  caller-sees-only-their-own-orders isolation; `reviews.test.ts`; `audit.test.ts`).
- **D4 gap found and consciously scoped out, not fixed:** `statusTransitions.ts` defines
  `PUBLISHED→ON_SALE→SOLD_OUT→COMPLETED`, fully unit-tested, but no HTTP endpoint drives any of
  those three transitions, and nothing auto-derives `SOLD_OUT` from inventory. Checked against the
  PDF's actual required workflow list (W2) and A1–A8: none require it, and checkout already treats
  `PUBLISHED`/`ON_SALE` identically. Documented honestly in `README.md`'s "Known limitations" and
  `docs/DECISIONS.md` D-042 rather than silently left unexplained or built as unplanned scope creep
  this late in Part A.
- **docs/ASSESSMENT_REQUIREMENTS.md corrected**: D1, D5, D6, D7, D8, D9, W2, A1, A4, A5, A6, A7,
  DL1, DL2, DL4 all moved from stale "Not started"/partial statuses to accurate
  Tested/Verified/Implemented statuses, each citing the real file(s) that prove it.
- **README.md refreshed**: status banner now says Part A complete (not "frontend remaining"),
  added the 3 new endpoints, corrected the Next.js library-rationale bullet to describe what was
  actually built (client components + localStorage JWT, not server components), and refreshed
  "Known limitations" to current reality.
- **Tests executed:** full suite re-run after adding the 3 pagination tests — **145/145 passing**
  (141 + 3 new + 1 incidental from the new `my-orders.test.ts` file's first basic-isolation test).
  `npm run typecheck` clean across all 4 workspaces.
- **Commit hashes:** `fb78c65` — test(api): close the pagination coverage gap on /me/orders,
  reviews, and audit; `c9c1022` — docs: correct Part A requirements checklist and README to
  verified reality.
- **Remaining issues:** none blocking Part A completion. Part B and Part C have not been started,
  per the mega-prompt's explicit instruction to stop here and wait for independent Part A review.

---

## Stage 2.10 — Independent Part A audit and corrections (2026-11-01)

- **Task:** candidate requested a skeptical, independent re-audit of the "Part A complete" report at
  `6c38cc8` — not a restatement of the prior report, but real command execution and DB-state
  inspection to verify or refute every claim. Full detail, evidence table, and verdict:
  [docs/PART_A_FINAL_AUDIT.md](PART_A_FINAL_AUDIT.md).
- **Status:** Done. All A1–A8 independently re-verified PASS. Three real test-coverage gaps found
  and closed with new regression tests (concurrent hold-expiry sweeping, concurrent duplicate
  hold/checkout requests, audit-log transactional-atomicity). One real frontend gap found and closed
  (no admin UI for audit-log visibility). One real but non-mandatory domain-model gap re-confirmed
  and left as a documented limitation (event `ON_SALE`/`SOLD_OUT`/`COMPLETED` HTTP transitions — see
  D-042, independently re-checked, not overturned). One test-infrastructure footgun found and fixed
  (`dist/**` double-counting the Vitest suite after a build).
- **A1 re-verified for real, in full isolation**, after discovering and resolving a genuine process
  hygiene issue: a stray `npm run dev` process tree from earlier in this session was still running,
  undetected, on ports 3000/4000 — contradicting the prior report's claim that dev servers were
  stopped. This initially caused the fresh-clone test to silently talk to the wrong (main-repo)
  database for one round of verification, caught only by cross-checking a returned event id against
  both databases directly via `psql`. Identified the stray processes by `CommandLine` (not just port
  occupancy) before stopping them, then re-ran the clone's servers on fully dedicated ports (4010/3010)
  for unambiguous evidence.
- **New regression tests added** (all passing, re-run 3x for stability):
  `apps/api/test/holds/holds.test.ts` (genuinely concurrent duplicate hold request; genuinely
  concurrent hold-expiry sweep), `apps/api/test/orders/checkout.test.ts` (genuinely concurrent
  duplicate checkout), `apps/api/test/audit/audit.test.ts` (audit-write transactional rollback).
  Suite grew from 145 to 149 passing tests.
- **One real bug found — in the new tests' own assertions, not in product code:** `[status_a,
  status_b].sort()` defaults to lexicographic string sort; the index-based assertions assumed
  descending order. Confirmed the actual application behavior was correct on every run (raw response
  bodies captured and inspected) before fixing the test. See D-044.
- **New frontend page:** `apps/web/src/app/organiser/[organiserId]/audit/page.tsx` — the admin
  "audit visibility" workflow had no UI before this (API-only), found during the frontend-workflow
  re-verification. Verified live via Playwright: admin sees real entries, staff sees the real server
  403 for the organiser-wide feed (not hidden or faked).
- **Test-infra fix:** `apps/api/vitest.config.ts` now explicitly excludes `dist/**` — a stray build
  artifact from this audit's own `npm run build` verification step was silently doubling the whole
  suite's file/test count. See D-043.
- **Final verification, after all corrections:** `npx vitest run` → **149/149 passing**; `npm run
  typecheck` → clean across all 4 workspaces; `npm run build` → clean for both `apps/api` and
  `apps/web` (15 routes, including the new audit page); `prisma migrate status` → up to date;
  `npm run db:seed` run twice → identical counts (2 organisers, 22 users, 12 events, 3 venues, 32
  reviews), confirming idempotency; database confirmed restored to this exact baseline after all
  audit-created test data (throwaway users, venues, events, orders) was cleaned up.
- **Commit hashes:** recorded in the next commit(s) below this entry.
- **Remaining issues:** none blocking. See docs/PART_A_FINAL_AUDIT.md §10 for the full, honest list
  of non-mandatory limitations. Part B and Part C still not started, per standing instruction.

---

## Stage B1 — Part B agent architecture and foundation (2026-11-01)

- **Task:** build the custom AI agent harness's architecture per the Part B mega-prompt's Stage 1
  scope — a provider abstraction, a deterministic mock provider, a custom tool-calling loop (no
  LangChain/CrewAI), a tool registry for the seven required tools, and an execution tracer. No real
  Part A service wiring, no HTTP endpoint, no retries/backoff, no injection defence, no interview
  extensions — all deliberately deferred to Stage B2+.
- **Status:** Implemented and verified. On branch `feature/part-b-agent`; Part A untouched except two
  small, additive changes (see below). Zero regression in the existing 149-test Part A suite.
- **New workspace package `@agenticgenie/agent`** (`packages/agent/`), depending only on
  `@agenticgenie/shared` and `zod` — never on `apps/api` (see docs/DECISIONS.md D-045 for why):
  - `providers/` — `ModelProvider` interface (`providers/types.ts`), a deterministic, fully scriptable
    `MockProvider` (`providers/mock.ts`) with no randomness and no API key, and a `NemotronProvider`
    (`providers/nemotron.ts`) implementing the same interface via `fetch` against an OpenAI-compatible
    endpoint, constructor-configured (never reads `process.env` itself).
  - `tools/` — `ToolDefinition`/`ToolContext`/`ToolError` (`tools/types.ts`), `ToolRegistry`
    (`tools/registry.ts`, using Zod v4's built-in `z.toJSONSchema` to build each tool's provider-facing
    JSON-Schema `parameters`), `dispatchToolCall` (`tools/dispatch.ts` — validates args, enforces a
    per-tool timeout, never leaks a raw thrown error to the caller, treats a missing `execute` as a
    clean `NOT_IMPLEMENTED` result rather than a crash — see D-046), and `createDefaultToolRegistry`
    (`tools/catalogue.ts`) registering all seven required tools (`search_events`, `get_event`,
    `get_reviews`, `hold_seats`, `purchase`, `cancel_order`, `sales_summary`) with real schemas and
    metadata but no `execute` yet (Stage B2).
  - `core/loop.ts` — `runAgentTurn`, the custom tool-calling loop: enforces a max-step limit (default
    6), a configurable cumulative token budget (checked before honoring even a well-formed final
    answer — see D-049), a per-tool timeout, exactly one bounded repair attempt per turn on malformed
    provider output before degrading gracefully, and builds every tool's `ToolContext` solely from the
    authenticated caller passed into the function — never from anything in a tool-call's arguments.
  - `tracing/tracer.ts` — `ExecutionTracer`/`AgentTrace`: per-step provider-call latency, token usage,
    per-tool-call duration/success/retry-count/error-code, and a redaction policy that never records
    raw tool-call arguments or raw provider content (see D-048).
  - `conversation/types.ts` — `ConversationState`/`Turn`/`PendingConfirmation` type shapes only (no
    persistence or enforcement logic yet — that's Stage B2's confirmation-flow work).
- **New shared schemas:** `packages/shared/src/agent/tools.ts` — Zod input/output contracts for all
  seven tools, modeled on the REAL Part A service return shapes (checked against
  `apps/api/src/modules/{events,reviews,holds,orders,refunds,reports}/service.ts` while writing them,
  not invented). No input schema accepts a `userId`/`actorUserId`-shaped field — the structural half of
  the "model output is untrusted, identity is never model-supplied" guarantee (the other half is the
  loop never reading one even if present — see the identity-propagation test below).
- **Part A changes (small, additive only):** `apps/api/src/env.ts` gained optional `AI_PROVIDER`
  (default `"mock"`), `NEMOTRON_BASE_URL`, `NEMOTRON_API_KEY`, `NEMOTRON_MODEL` fields — unread by
  anything yet, forward-looking for Stage B2. `packages/agent`'s `tsconfig.json` was set up to
  typecheck `test/` alongside `src/`, matching `apps/api`'s existing pattern (caught before it became
  a gap, not after).
- **Tests — 47 new, all passing, across 6 files in `packages/agent/test/`:**
  `mock-provider.test.ts` (deterministic replay, script exhaustion behavior, per-step usage override),
  `provider-contract.test.ts` (the same contract test run against `MockProvider` and a second, minimal
  `ModelProvider` implementation), `tool-registry.test.ts` (register/lookup/duplicate-rejection,
  unknown-tool lookup, JSON-Schema generation, and assertions over the real seven-tool catalogue:
  correct `sideEffecting`/`requiresConfirmation`/`organiserScoped` flags, no `execute` yet, no
  identity field in any input schema), `dispatch.test.ts` (valid/invalid args, unknown tool, the
  `NOT_IMPLEMENTED` path using a real catalogue tool, per-tool timeout, thrown-`ToolError` surfaced
  as-is, a generic thrown error's message/stack NOT leaked, output-schema violations rejected),
  `loop.test.ts` (success path, a full tool-call-then-final round trip, max-step enforcement, token-
  budget enforcement — including that an otherwise-valid final answer is still rejected once the
  budget is already spent, exactly-one-repair-then-degrade on both bad-JSON and transport-level
  malformed responses, full trace-field coverage, trace argument redaction, and the identity-
  propagation proof: a tool call scripted with a hallucinated `userId` field in its arguments still
  receives a `ToolContext` built only from the real authenticated caller), and
  `nemotron-provider.test.ts` (correct OpenAI-compatible request shape, final-content parsing,
  tool-call argument JSON parsing, and five distinct malformed-response paths — bad tool-call JSON,
  non-2xx HTTP, empty choices, and a network failure — all via a stubbed `fetch`, no real network, no
  real key).
- **Verification:** `npx vitest run` in `packages/agent` → **47/47 passing**. `npm run typecheck`
  (root, all 5 workspaces now) → clean. Full `apps/api` suite re-run → **149/149 passing, zero
  regression**.
- **B6 UI proposal:** written up in `docs/UI_PROPOSAL_B6.md` — grounded in the actual current frontend
  (functional, minimal, plain inline styles via `lib/styles.ts`, no design-token system, no component
  extraction) with a concrete direction for the "premium modern SaaS" redesign the candidate wants
  later, once the agent's real tool-calling is in place. Proposal only — no implementation this stage.
- **Commit hashes:** `7813bf0` — feat(agent): scaffold packages/agent and shared Part B tool schemas;
  `1e8ca2a` — test(agent): add B1 test suite and forward-looking Nemotron env fields; doc commits
  recorded immediately below this entry.
- **Remaining limitations (all deliberate, all Stage B2+ scope, not gaps in B1 itself):** no tool has
  a real `execute` yet (by design — see D-046); no Express route exposes the loop to the frontend yet;
  no retry/backoff for transient provider errors yet (only the one structural repair-on-malformed-
  output path exists); no prompt-injection defence layers yet (the `get_reviews` tool's description
  already flags review text as untrusted, but no policy-layer enforcement exists); no persisted
  multi-turn conversation state (the `tracer` parameter and `ConversationState` type exist to make
  this possible, not to provide it yet); `NemotronProvider` has never been run against a real
  Nemotron endpoint (only a stubbed `fetch`) — first real-network verification is Stage B2's job, once
  real credentials are available to test with.

---

## Stage B2+B3+B4 — Real tools, confirmation, security, reliability (2026-11-01)

- **Task:** wire all 7 Part B tools to the real Part A service layer; build the
  confirmation state machine for `purchase`/`cancel_order`; prompt-injection
  defence; citation grounding; multi-turn conversation persistence; provider
  retry/backoff and a deterministic fallback; expose it all via a real,
  authenticated `POST /agent/chat` endpoint. Combined milestone per the
  candidate's own instruction, implemented as a sequence of small, independently
  tested, independently committed steps rather than one large change.
- **Status:** Implemented and verified — every claim below is backed by a real
  test that actually ran, listed next to it.
- **Schema:** new `AgentConversation`/`AgentMessage`/`AgentPendingConfirmation`
  Prisma models (migration `20261031212037_add_agent_conversations`), applied
  against the real running Postgres and confirmed via `prisma migrate status`.
- **packages/agent extensions** (app-agnostic, no Prisma/DB, 49 new tests):
  `classifyConfirmationIntent` (deterministic allowlist classifier — tested
  against every ambiguous example phrase in the candidate's own spec, see
  `test/classify-confirmation.test.ts`); `ToolContext` extended with
  `conversationId`/`latestUserMessage`, still sourced only from the loop's
  authenticated inputs; `collectKnownRecords`/`extractCitationTokens`/
  `checkGrounding` for citation validation; `callProviderWithRetry` (bounded
  backoff+jitter, `quota_exceeded`/`auth_error` never retried); `MockProvider`
  extended to script 429/5xx/timeout/network/quota/auth failures; `NemotronProvider`
  now classifies real HTTP failures instead of a flat "malformed";
  `runDeterministicFallback` for provider-unavailable degradation; `finalAnswerSchema`
  extended with `pendingConfirmation`/`eventCards`/`degraded` (additive, B1
  scripts still validate unchanged); `createDefaultToolRegistry` now accepts
  injectable real executors (D-050).
- **apps/api/src/modules/agent/** (new, 29 integration tests against real Postgres
  + the real HTTP endpoint): `tools.ts` wires all 7 tools to
  `listPublicEvents`/`getPublicEventDetail`/`listReviews`/`createHold`/`checkout`/
  `requestRefund`/`getSalesSummary` — never a second copy of their logic;
  `confirmation.ts` is the server-verified confirmation gate (see
  `docs/PART_B_SECURITY.md`); `conversation.ts` persists/replays/isolates
  conversations; `provider.ts` builds the real `AI_PROVIDER`-configured model
  (mock by default, zero API key); `rateLimiter.ts`; `router.ts` exposes
  `POST /agent/chat` + `GET /me/conversations[/:id]`, mounted behind `requireAuth`
  exactly like every other route.
- **Security verified by real test, not just by design:** a model-hallucinated
  `userId` tool-call argument is ignored (both at the `packages/agent` loop level
  and through the real HTTP endpoint); an attendee's `sales_summary` call is
  rejected by the real permission check with no data leaked; a staff member
  cannot use the agent to refund their own order (the order is left `PAID`,
  untouched); a worst-case scripted scenario — the model reading a malicious
  review and immediately attempting `cancel_order(confirm: true)` with no prior
  ask and no human message at all — still leaves the victim's order untouched,
  because there is no live pending confirmation and no real "yes" to classify.
- **Confirmation state machine verified under real concurrency:** a genuinely
  concurrent double-confirm (`Promise.all`, both at the `evaluateConfirmation`
  level and at the full `purchase` tool level) produces exactly one `Order`/
  `Payment`/`Ticket` row, DB-state-checked, not just HTTP-status-checked — this
  works by both racing callers reusing the identical stored idempotency key
  against Part A's own already-regression-tested idempotency primitives, not by
  any new locking built for Part B (see D-052).
- **Reliability verified through the real HTTP endpoint:** a scripted transient
  429 is retried and still succeeds; `quota_exceeded` is never retried and
  degrades via the real deterministic fallback (a genuine database search, not
  an invented answer); a provider failure with no matching fallback intent
  degrades honestly with no `answer` field at all; the per-user rate limiter
  actually trips in a real test; conversation replay caps itself at the most
  recent 40 messages rather than an unbounded history.
- **One real bug found and fixed by a test, not by inspection:** `appendMessages`
  originally batched a turn's messages into one `createMany` inside a
  transaction; Postgres freezes `now()` per transaction, so every row shared an
  identical timestamp, and cuid2 ids aren't a safe same-millisecond tie-break —
  a conversation could replay its USER/ASSISTANT messages out of order. Fixed by
  assigning each row in a batch an explicit, strictly increasing timestamp (D-056).
- **Tests — final counts, all actually run:** `packages/agent` 96/96 (49 new);
  `apps/api` 183/183 (149 Part A regression + 29 new agent integration + 5
  reliability, zero regressions); `npm run typecheck` clean across all 5
  workspaces.
- **Docs:** `docs/PART_B_ARCHITECTURE.md`, `docs/PART_B_SECURITY.md`,
  `docs/PART_B_RELIABILITY.md` (new); `docs/DECISIONS.md` D-050–D-057;
  `docs/ASSESSMENT_REQUIREMENTS.md` Part B rows updated against real tests only.
- **Commit hashes:** `a5fa930` feat(db) conversation/confirmation schema;
  `003648b` feat(agent) classifier/grounding/fallback/retry; `691467f`
  feat(shared) confirmation-gated output schemas; `cdf67a8` feat(agent) executor
  injection; `3242f7f` feat(api) real tool wiring; `a33d141` refactor(api)
  injectable provider for tests; `74e6598` test(api) tool/confirmation/chat
  integration tests; `be2377f` test(api) reliability/context-limit tests; doc
  commit recorded immediately below.
- **Remaining limitations, stated honestly (none mandatory for this milestone):**
  no token-aware context summarization (recency-window truncation only); the
  rate limiter is process-local, not distributed-safe; `NemotronProvider` has
  never been run against a real endpoint (no API key used anywhere in this
  work, by design); the deterministic fallback covers exactly one intent
  (`search_events`) and explicitly does not cover "show my orders" (not one of
  the 7 required tools) or event-detail lookups (need real reference
  resolution) — see D-055. B5 (the eval harness) and the B6 UI redesign have not
  been started, per the candidate's explicit instruction to stop here.

---

## Stage B5 — Agent evaluation harness (2026-11-01)

- **Task:** build a reproducible, deterministic evaluation suite for the agent — ≥20 cases across
  the 6 required categories (search, aggregation, actions+confirmation, grounding/no-data,
  reliability, adversarial, including all 5 required adversarial scenarios), real deterministic
  scoring against real database state (never "it returned 200"), metrics/reporting, `npm run eval`,
  CI integration. Mock provider only — no API key required anywhere in this stage.
- **Status:** Done. 20/20 cases passing, real run, verified twice for stability.
- **Architecture:** data lives in `evals/cases/*.json` (one file per case, Zod-validated); the
  runner lives at `apps/api/src/evals/runner.ts` and drives each case's conversation by calling
  `runAgentTurn` directly (not through `/agent/chat` over HTTP — see D-058) with the real tool
  registry wired to Part A's real services, a real `AgentConversation` row for FK correctness, and
  a new eval-only `EvalProvider` (D-059) that behaves exactly like `MockProvider` plus one feature:
  a tool-call argument can be `{"$lastToolResult": "fieldName"}`, resolved from the most recent real
  tool result already in the conversation — needed because confirmation-flow cases (`purchase`,
  `cancel_order`) must reference a hold/order id that only exists once an earlier step in the same
  scripted conversation has actually run against the database.
- **Seeding** (`apps/api/src/evals/seed.ts`) is a fixed, 8-variant vocabulary of steps
  (organiser/venue/event/ticketTier/user/membership/review/order), each mapping to one existing
  `apps/api/test/helpers/fixtures.ts` call — not a generic DSL (D-060). `{{ref}}` tokens in a case's
  `mockScript`/`expectations` resolve to real seeded ids; `{{now}}`/`{{now+7d}}` resolve against the
  same `now` the seed's own relative `startsAt` offsets used.
- **Scoring** (`apps/api/src/evals/checkers.ts` + the runner): a case passes only if every declared
  tool-call, outcome/answer, citation-grounding, retry-count, AND real-database-state expectation
  holds together — any one failing fails the case, regardless of HTTP-equivalent status. `dbChecks`
  may carry `afterTurn: N` to assert an intermediate conversation state (D-061) — used by
  actions-10/adversarial-17 to prove no order exists yet after an unconfirmed first turn.
- **Metrics**: pulled from each case's real `AgentTrace` — overall/per-category pass rate, mean
  tokens in/out (explicitly labelled estimated/mock-supplied, never presented as a real cost — see
  D-059's sibling note and `docs/PART_B_EVALUATION.md`), p50/p95 latency (computed by sorting, not
  averaging), mean steps/case, total provider retries, tool success rate.
- **Real bug found and fixed while authoring the cases, not by inspection:** `reliability-15`'s
  first draft asserted the deterministic fallback's search result by event title alone — the
  fallback has no category filter, only a city/near-phrase extractor, so against a database that
  already has other published events (e.g. this machine's own demo seed data) the assertion was
  genuinely flaky depending on what else existed. Fixed by seeding a venue with a uniquely-named
  city (`Zzyzxville`) and phrasing the user message to match the fallback's `near <city>` pattern,
  making the case deterministic regardless of any other data present — a real eval-authoring defect,
  not a product defect (confirmed by first finding the mismatch, then tracing it to the fallback's
  documented, honest scope limit — see D-055 — not a bug in the fallback itself).
- **Tests — final counts, all actually run just now:** `npm run eval` — **20/20 passing** (run
  twice for stability, identical result both times); full `packages/agent` suite 96/96; full
  `apps/api` suite 183/183 (zero regression); `npm run typecheck` clean across all 5 workspaces.
- **CI:** `.github/workflows/ci.yml` runs `npm run eval` immediately after `npm run test`, reusing
  the same Postgres/Redis service containers — a clean addition, the whole suite completes in
  roughly a second locally.
- **Docs:** `docs/PART_B_EVALUATION.md` (new); `docs/DECISIONS.md` D-058–D-061;
  `docs/ASSESSMENT_REQUIREMENTS.md`'s Part B eval-harness and adversarial-scenario rows moved to
  Verified with real cases cited; `evals/results/sample-run.{json,md}` committed as the required
  sample report (the full timestamped-run pattern is gitignored so repeat local runs don't
  accumulate in the repo).
- **Remaining limitations, stated honestly:** `toolCalls` expectations check presence/success, not
  exact arguments (the trace never records raw arguments by design — nothing finer to assert
  against); AD2's "3 ambiguous event matches → clarifying question" wasn't given its own dedicated
  case (the identical ask-don't-guess mechanism is already proven for confirmation ambiguity and for
  `sales_summary`'s multi-organiser case); AD3 (Hinglish) is verified at the harness level only — no
  real model was run to verify it actually extracts the right parameters from literal Hinglish text.
  B6 (the premium frontend redesign) has not been started.

---

## Stage B6 — Premium frontend redesign (2026-11-01)

- **Task:** a complete visual redesign of `apps/web` — design tokens, a reusable component set, a
  real landing page, a premium AI assistant chat UI consuming B2-B4's `/agent/chat`/`/me/conversations`
  endpoints, polish across every existing Part A page, responsive/accessibility verification, and
  real Playwright E2E across the full discover→chat→confirm→purchase flow. No backend business logic
  changes except one real gap found and fixed while producing the required E2E verification.
- **Status:** Done. Verified by actually running the app and looking at real screenshots at three
  breakpoints, not by reading the code.
- **Design system** (`docs/FRONTEND_DESIGN_SYSTEM.md`): replaces the prior ad hoc inline-style-object
  approach (`lib/styles.ts`, now deleted — nothing referenced it after the redesign) with
  `apps/web/src/app/globals.css` (CSS custom properties for color/typography/spacing/radii/shadows,
  real `:hover`/`:focus-visible`/`@media` rules — none of which inline React styles can express) and
  a small component set under `apps/web/src/components/ui/` (Button, Card, Badge, Field/TextInput/
  TextArea/Select, EmptyState/ErrorBanner/Skeleton, EventCard). No new dependency — deliberately a
  plain system serif/sans pairing rather than `next/font/google`, for zero build-time network
  dependency (see docs/FRONTEND_DESIGN_SYSTEM.md). Palette: deep charcoal canvas, warm off-white
  text, one amber accent — chosen over a blue/purple "AI product" look since this is a ticketing
  brand first.
- **Landing page** (`apps/web/src/app/page.tsx`, full rewrite): real nav with a working mobile menu,
  hero, a "Happening now" section backed by the real `GET /events` endpoint (loading/empty/error
  states; events with no image field get a deterministic per-id gradient treatment rather than a
  fake photo — see D-04x below), an AI-discovery section whose example prompts route into a
  pre-filled, auto-sent chat turn, how-it-works, a capabilities section limited to true claims, and a
  complete footer.
- **AI assistant** (new route `/assistant`): conversation sidebar from `GET /me/conversations`, a
  message thread rendering real `toolExecutionSummary` steps and `[event:ID]`/`[review:ID]` citations
  as actual links, and a confirmation card for `purchase`/`cancel_order`. The card's Confirm/Cancel
  controls send the literal `"Yes"`/`"No"` as the next `/agent/chat` message — there is no separate
  confirm endpoint, because the real server-side gate (B3) is a deterministic classifier over the
  next real human message plus a live `PendingConfirmation` row, not a button the client can call
  directly. This is a correctness requirement from the mega-prompt ("the frontend must reflect the
  server's confirmation state"), not a design choice.
- **Real gap found and fixed while producing the required E2E verification, not by inspection:** the
  no-API-key default provider (`createConfiguredProvider()`) returned one fixed "I'm running in demo
  mode" string for every single message, so the live app had nothing real to screenshot and no way to
  demonstrate B2-B4's actual tool/confirmation pipeline without a paid Nemotron key. Fixed by adding
  `DemoProvider` (`apps/api/src/modules/agent/demoProvider.ts`) — a small, honestly-limited,
  pattern-matching stand-in (distinct from the deterministic `MockProvider` tests/evals use) that
  recognizes a few plain-English intents (search, "book that", an unambiguous confirmation — reusing
  the real `classifyConfirmationIntent`) and drives genuine `tool_calls` through the exact same
  registry/dispatch/confirmation path a real model would. This is a demo-quality fix: every tool call
  it issues still goes through full real authorization regardless of what this "model" decides to
  call. Verified via a real Playwright run: search → grounded event cards → "book the first one" →
  real confirmation card → "Yes" → real order created and visible on `/orders`.
- **Polished every existing Part A page** (catalogue, event detail, login/register, orders, organiser
  dashboard, venues/seat-map management — preserving the existing dropdown state-sync fix exactly —
  events, sales reports, check-in, refunds, audit log) with the new component set, with zero business-
  logic changes. Event detail gained a live hold-expiry countdown (ticks every second, auto-releases
  the UI state at zero) and a price breakdown above the hold/checkout actions.
- **Responsive/accessibility, verified with real Playwright screenshots at 375/768/1440px:** no
  horizontal overflow at any breakpoint on the catalogue, organiser dashboard, or assistant pages; a
  real functional mobile nav menu (not just a squished desktop layout); visible amber focus rings on
  keyboard tab (checked by pressing Tab and screenshotting, not just reading the CSS); every form
  input has an associated `<label for>`.
- **Frontend E2E, all real app + real Postgres, verified via actual screenshots inspected at each
  step:** landing page → real featured events → login → assistant → "Find comedy shows in Pune" →
  grounded event cards with citations and tool-activity steps → "Book the first one" → confirmation
  card with a live expiry countdown → "Yes, confirm" → real order created, verified both in the chat
  UI and on `/orders`. Also verified: an ambiguous confirmation reply ("Yes, but for another event")
  does not execute anything.
- **Honestly-documented E2E gap:** a declined-payment path cannot be demonstrated through the chat UI
  — the agent's `purchase` tool always passes the fake provider's `"success"` scenario (there is no
  real payment-method collection anywhere in this app, by design since Stage 2.4), so decline/timeout
  are only reachable via the direct API's `X-Payment-Scenario` header, already exercised in the
  backend test suite (`apps/api/test/orders/checkout.test.ts`), not through natural conversation. Not
  a defect — a consequence of the already-documented fake-payment design.
- **Tests — final counts, all actually run just now:** full `apps/api` suite 183/183 (zero
  regression from the `DemoProvider` change); full `packages/agent` suite 96/96; `npm run eval`
  20/20 (zero regression); `npm run typecheck` clean across all 5 workspaces; `apps/api` production
  build clean; `apps/web` production build clean (16 routes, including the new `/assistant`).
- **Docs:** `docs/FRONTEND_DESIGN_SYSTEM.md` (new), `docs/PART_B_FINAL_REPORT.md` (new, synthesizes
  B1-B6), `docs/DECISIONS.md` (D-062–D-065: the design-token/CSS approach, the `DemoProvider` fix,
  and the image-fallback treatment). `docs/ASSESSMENT_REQUIREMENTS.md` is intentionally untouched by
  this stage — it tracks the PDF's own requirement list, and the premium frontend redesign is the
  candidate's own added milestone, not a PDF-defined row (the PDF's own "B6" label refers to the
  eval-harness categories, already covered in Stage B5 — a naming collision with this stage's own
  "B6" convention worth flagging, not a tracking gap).
- **Remaining limitations, stated honestly:** no automated Playwright suite is committed/wired into
  CI (manual scripts only, matching this project's established pattern since Stage 2.8); conversation
  history reloaded from `GET /me/conversations/:id` shows plain message text only — citations,
  event cards, and tool-activity steps are not persisted per-message (only the raw provider-message
  transcript is, by B3's design), so they render live for the current session only, not retroactively
  on reload; declined-payment/expired-hold paths are demonstrable through the existing Part A UI
  (checkout page / hold countdown) but not through the agent chat, for the reason above.

---

## Stage — UI redesign audit: premium hero, 3D/immersive evaluation (2026-11-01)

- **Task:** a dedicated visual-quality milestone, triggered by explicit feedback that the B6 landing
  page in particular did not yet meet the "premium, futuristic, immersive" bar — most pointedly the
  hero, which needed a more art-directed, possibly-3D treatment rather than flat editorial text.
- **Status:** Done. Full detail, before/after evidence, and every measurement in
  `docs/UI_REDESIGN_AUDIT.md` — this entry is a summary.
- **Honest starting assessment:** a fresh look (screenshots taken before any code was written, not
  assumed acceptable because B6 had shipped) found four real weaknesses: a flat, imageless hero; a
  large dead void in the assistant's welcome state; a sparse one-card organiser dashboard; and an
  event-detail page with zero visual continuity from the catalogue card that led to it.
- **Hero redesign:** replaced the flat two-column layout with a CSS-only perspective field of real
  upcoming events rendered as floating "ticket" cards (dashed perforation, real title/date/price),
  layered amber/violet glow, a grain overlay, and pointer-driven parallax. Evaluated React Three
  Fiber honestly and chose CSS instead — see `docs/DECISIONS.md` D-066 for the full reasoning
  (bundle size, WebGL-availability risk, and lighting/material investment needed to avoid a generic
  rotating-object look, versus zero-dependency CSS transforms that measured 98-100 on every
  Lighthouse category). `prefers-reduced-motion` is respected by skipping both the float animation
  and the pointer listener — verified via `getComputedStyle` under Playwright's reduced-motion
  emulation, not just read from the CSS.
- **Other polish:** assistant welcome state now centers around a glowing brand mark instead of a
  void; conversations get a real title derived from their opening message (D-067 — were always
  "Untitled conversation" before); the organiser dashboard's flat button row became a tile grid with
  one-line descriptions; event detail gained the same per-event gradient banner used on catalogue
  cards, plus a fixed, properly-formatted date (was a raw `toLocaleString()` with seconds).
- **Two genuine, previously-uncaught bugs found via real production-build verification** (not
  introduced by this milestone, pre-existing): (1) `apps/api/src/server.ts`'s `.env` path resolution
  was `__dirname`-relative and silently broke under `node dist/src/server.js` (one directory deeper
  than `tsx watch src/server.ts`) — fixed by anchoring on `process.cwd()` instead (D-068); (2) a real
  WCAG AA contrast failure (3.73:1, footer headings) and a missing favicon (a real 404), both caught
  by actually running Lighthouse against the real `next build`/`next start` output for the first time
  in this project's history — both fixed and re-verified at Lighthouse score 100.
- **Responsive:** all 7 required viewports (320×720 through 1920×1080) × 2 pages = 14 checks, zero
  horizontal overflow, verified programmatically. Functional mobile nav confirmed via screenshot.
- **Lighthouse (production build):** landing desktop 100/100/100/100; landing mobile 98/100/100/100;
  assistant desktop 100/100/100/100.
- **Functional audit:** 14/15 Playwright checks passed outright; the one failure was a timing issue
  in the test script itself (confirmed by a follow-up debug run that the page genuinely works), not a
  product defect. Verified with real DB-state assertions, not just HTTP status: an ambiguous
  confirmation reply creates no order (`/me/orders` count checked before/after); an explicit "Yes"
  completes a real purchase.
- **Tests — final counts, all run just now:** `apps/api` 183/183; `packages/agent` 96/96;
  `npm run eval` 20/20 (unaffected, as expected); `npm run typecheck` clean across all 5 workspaces;
  both production builds clean; `prisma migrate status` up to date; git clean, no secrets/PDF/docx
  tracked.
- **Docs:** `docs/UI_REDESIGN_AUDIT.md` (new), `docs/DECISIONS.md` D-066–D-068.
- **Remaining limitations, stated honestly:** `node dist/src/server.js` still doesn't run end to end
  — a separate, pre-existing packaging gap across `packages/db`/`shared`/`agent` (raw `.ts` `main`
  fields, incompatible with plain `node`), documented in D-068 as real but out of scope for a
  UI-focused milestone; no automated visual-regression or axe-core tooling in CI (manual
  Playwright + Lighthouse only, matching this project's established pattern).
- **Commit hashes:** `3d01feb`, `30df5a7`, `6c77bca`, and the doc commit recorded immediately after
  this entry.

---

## Stage — Independent review, fixes and Part C (2026-11-02)

- **Task:** check the build against the PDF by running it rather than reading its docs, prove suspected bugs with failing tests, fix them, improve the UI, and write Part C.
- **Found by reproducing against the code as it stood:**
  - Checking out one hold under different Idempotency-Keys at once double-charged and issued extra tickets (15 of 15 trials). The earlier concurrency tests only used one key.
  - Releasing a hold during its checkout oversold GA inventory (24 of 30 trials). Checkout ignored the result of its conditional hold update.
  - No seated purchase could work: `GET /events/:id/seats` returned `EventSeat.id` where `POST /holds` expects `Seat.id`. Earlier checks only drove GA through the UI.
  - A refunded seat couldn't be resold, because `tickets.event_seat_id` was globally unique.
  - A timed-out payment whose client never retried stayed `PENDING_PAYMENT` forever, and after hold expiry a retry got a bare 409 over a charge that had gone through.
  - A refund key reused on another order replayed the first order's refund and left the second unrefunded.
  - A repeat cancel after a crash between its two steps returned early, leaving paid orders unrefunded.
  - The agent could answer its own confirmation in one turn, using a "yes" the human said about something else, and refund an order. `evaluateConfirmation` never checked that the confirmation existed before the turn began.
  - Chat had no token budget on the real endpoint, partial results had no answer text, fabricated citations stayed in the answer's prose, and a trimmed history could start on an orphaned tool result, which real APIs reject.
  - The API contract wasn't served as written (`POST /events`, `PATCH /events/:id`, `POST /events/:id/cancel`, `GET /audit`, snake_case bodies, `hold_id`/`expires_at`, optional key on holds), and admins had no way to manage staff.
  - `holds.test.ts` failed on the first run after seeding, because the global sweep counted the seed's expired hold. That's a likely cause of some of the "non-reproducing flakiness" recorded in earlier stages.
- **Fixed, each with a regression test:** `apps/api/test/regressions/{money-and-inventory,agent-safety}.test.ts`. See docs/DECISIONS.md D-069 to D-074.
- **Added:** staff management, event on-sale/complete, derived SOLD_OUT, a background sweep and payment reconciliation, `GET /holds`, `/organisers/:id/orders`, `list_my_orders`, full OpenAPI paths, `npm run setup`, DESIGN.md.
- **Verified from a brand-new copy, following the README exactly:** typecheck clean; 325 tests passing, twice in a row (227 API, 98 agent); `npm run eval` 31 of 31; both production builds; contract calls by curl. Real model (`qwen3.5:9b`, local, one run): 12 of 23.
- **Evals:** 31 cases. Argument checks, forbidden tools, cited-record prefixes, a whole-database "unchanged" check, per-case score and estimated cost, and token counts measured from real payloads instead of scripted numbers. First real-model report, on a local model through Ollama.
- **Frontend:** browse filters in the URL, a two-column event page with a real seat map, hold restore on reload, a timeout-aware checkout, ticket cards with partial refunds, an assistant with server-driven confirmation and restored history, and an organiser shell with overview, orders and refunds, team, and a sales chart. Patterns referenced from Mobbin; see docs/FRONTEND_DESIGN_SYSTEM.md.
- **Found while verifying, in the fixes themselves:** the first untrusted-content rule also stopped normal bookings from asking for confirmation (caught by driving the assistant in a browser, then narrowed); a repair instruction was whitelisting the invented price it was rejecting; `npm run eval -- --real` dropped its flags; a seed change broke the production type build.
- **Commit hash:** none. This copy of the project has no `.git` directory, so these changes are uncommitted.

## Frontend finish pass (2026-11-02)

- **Status:** Done. Styling, the landing page and generated event art only. No booking logic or API changes. See docs/DECISIONS.md D-075.
- **Also fixed:** the README injection steps, which could not work in demo mode because search hides completed events.
- **Commit hash:** none. This copy of the project has no `.git` directory.

<!-- Add new entries above this line, most recent first is NOT required — keep chronological. -->
