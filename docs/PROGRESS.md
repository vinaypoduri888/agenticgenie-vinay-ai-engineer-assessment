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
- **Commit hash:** _pending — see next update._
- **Remaining issues / scope notes:** No business endpoints yet (by design — next stages). No
  audit-log entries are written for registration (deferred to when the broader audit-writing
  convention is established alongside the first real business mutation, to avoid half-wiring it
  here). No password reset / refresh-token flow (documented auth shortcut, to be written up in
  `DESIGN.md`).

---

<!-- Add new entries above this line, most recent first is NOT required — keep chronological. -->
