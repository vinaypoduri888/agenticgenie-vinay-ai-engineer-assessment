# Agentic Genie — Event Ticketing Platform + AI Agent Harness

Take-home assessment submission: a multi-organiser event-ticketing platform (Part A) with a custom
AI agent harness and evaluation suite (Part B) on top of it, plus written design notes (Part C).
See [CLAUDE.md](CLAUDE.md) for the full project brief and [docs/](docs/) for the detailed
requirements checklist, progress log and decisions log.

> **Status:** Stage 2.1 (database schema + authentication/RBAC foundations) complete. Ticketing
> business endpoints (events, holds, orders, payments, tickets, refunds) are not implemented yet.
> See [docs/PROGRESS.md](docs/PROGRESS.md) for what's done and what's next.

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
- **bcryptjs + jsonwebtoken** — pure-JS password hashing (no native build step to break `npm
  install` across OSes) and a minimal, established JWT library for a stateless bearer token.

Full rationale and alternatives considered: [docs/DECISIONS.md](docs/DECISIONS.md).

## Setup

Requires Node 20+, Docker Desktop.

```bash
npm install
docker compose up -d
cp .env.example .env && cp apps/web/.env.example apps/web/.env.local && npm run db:generate && npm run db:migrate:deploy
npm run dev
```

Before the last two steps, replace `JWT_SECRET` in the generated `.env` with a real random value, e.g.
`node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.

Then open:
- http://localhost:3000 — frontend (renders the live API health check)
- http://localhost:4000/health — API health/DB-connectivity check
- http://localhost:4000/docs — Swagger UI
- `POST http://localhost:4000/auth/register` and `POST http://localhost:4000/auth/login` —
  `{ email, password, name }` / `{ email, password }`, both return `{ token, user }`

That's 4 commands (step 3 is a single chained line). A `db:seed` step will be folded into step 3
once seed data exists, keeping the total at the assessment's ≤5-command limit.

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

## Authentication

`POST /auth/register` and `POST /auth/login` return `{ token, user }`. Pass the token as
`Authorization: Bearer <token>` on subsequent requests. The token carries only the user's id — role
and organiser permissions are always re-checked against the database per request (see
`apps/api/src/middleware/requireAuth.ts` and `requireOrganiser.ts`), never cached in the token.
Every authenticated user can act as an attendee by default; organiser-scoped STAFF/ADMIN
permissions come only from an `OrganiserMembership` row.

## Known limitations

- Business endpoints (events, holds, orders, payments, tickets, refunds, reviews, reports, audit)
  are not implemented yet — see `docs/ASSESSMENT_REQUIREMENTS.md` for status per endpoint.
- No password reset / refresh-token flow (documented auth shortcut — single long-lived access
  token; see `DESIGN.md` once written).
- `apps/api`'s `build`/`start` scripts exist and work but aren't needed for local dev (`npm run
  dev` runs TypeScript directly via `tsx`).
