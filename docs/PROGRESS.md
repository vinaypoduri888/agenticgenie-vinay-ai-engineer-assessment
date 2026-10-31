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

<!-- Add new entries above this line, most recent first is NOT required — keep chronological. -->
