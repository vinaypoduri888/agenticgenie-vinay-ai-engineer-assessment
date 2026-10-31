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
- **Commit hash:** _pending — see next update._
- **Remaining issues:** None blocking. The service-layer algorithms this schema supports (Phase
  1/2/3 checkout, idempotency claim/takeover, event-cancellation lock coordination, refund/inventory
  lifecycle) are designed and documented in D-011–D-012 but not yet implemented — that's Part A's
  next stages (auth/RBAC, then events/inventory, then holds, then checkout).

---

<!-- Add new entries above this line, most recent first is NOT required — keep chronological. -->
