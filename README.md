# Agentic Genie — Event Ticketing Platform + AI Agent Harness

Take-home assessment submission: a multi-organiser event-ticketing platform (Part A) with a custom
AI agent harness and evaluation suite (Part B) on top of it, plus written design notes (Part C).
See [CLAUDE.md](CLAUDE.md) for the full project brief and [docs/](docs/) for the detailed
requirements checklist, progress log and decisions log.

> **Status:** Stage 1 (project foundation) complete. No ticketing business logic yet — this stage
> only proves the monorepo, database, and frontend↔backend wiring work end-to-end. See
> [docs/PROGRESS.md](docs/PROGRESS.md) for what's done and what's next.

## Architecture

```
apps/
  api/   Express 5 + TypeScript API (OpenAPI/Swagger at /docs)
  web/   Next.js + TypeScript frontend
packages/
  db/      Prisma schema + generated client, shared by apps/api
  shared/  Zod schemas shared between api/agent/web
```

`apps/web` talks to `apps/api` over HTTP (`NEXT_PUBLIC_API_URL`); `apps/api` is the only thing that
talks to PostgreSQL (via `packages/db`'s Prisma client) and, later, Redis.

## Why these libraries

- **Express 5 + TypeScript** — mature, minimal, explicit middleware chain; easiest to reason about
  for the server-side permission/idempotency/audit logic Part A requires.
- **Prisma + PostgreSQL** — typed query builder with real transactions and row-level locking for the
  no-oversell guarantees; Postgres is the single source of truth for inventory (never Redis).
- **Zod** — one validation library shared across the API request layer, the agent's tool schemas,
  and environment config, so types aren't hand-duplicated.
- **Next.js** — server components let the UI fetch directly from the API without a separate client
  data-fetching library for this stage.
- **Redis** — provisioned now, used later (Part A hold-expiry sweeper); never the source of truth.

Full rationale and alternatives considered: [docs/DECISIONS.md](docs/DECISIONS.md).

## Setup

Requires Node 20+, Docker Desktop.

```bash
npm install
docker compose up -d
cp .env.example .env && cp apps/web/.env.example apps/web/.env.local && npm run db:generate && npm run db:push
npm run dev
```

Then open:
- http://localhost:3000 — frontend (renders the live API health check)
- http://localhost:4000/health — API health/DB-connectivity check
- http://localhost:4000/docs — Swagger UI

That's 4 commands (step 3 is a single chained line). A `db:seed` step will be folded into step 3
once seed data exists (Stage 2+), keeping the total at the assessment's ≤5-command limit.

### Local ports

Postgres and Redis are mapped to non-default host ports (**5434** and **6380**) because this
machine already had other local services bound to 5432/6379. The containers themselves still run
standard Postgres 16 / Redis 7 on their default internal ports — only the host-side mapping
differs. If your machine is clean, feel free to remap to the defaults in `docker-compose.yml` and
`.env.example`.

## Environment variables

See [.env.example](.env.example) (root — used by `apps/api` and `packages/db`) and
[apps/web/.env.example](apps/web/.env.example) (frontend). Copy each to `.env` / `.env.local`
respectively; both are git-ignored.

## Tests and typechecking

```bash
npm run test        # Vitest, all workspaces
npm run typecheck   # tsc --noEmit, all workspaces
```

## Known limitations (Stage 1)

- No domain schema yet (Prisma schema is intentionally empty — infra-only).
- No auth, no business endpoints beyond `/health`.
- `apps/api`'s `build`/`start` scripts exist and work but aren't needed for local dev (`npm run
  dev` runs TypeScript directly via `tsx`).
