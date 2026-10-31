# Agentic Genie — Event Ticketing Platform + AI Agent Harness

Take-home assessment submission: a multi-organiser event-ticketing platform (Part A) with a custom
AI agent harness and evaluation suite (Part B) on top of it, plus written design notes (Part C).
See [CLAUDE.md](CLAUDE.md) for the full project brief and [docs/](docs/) for the detailed
requirements checklist, progress log and decisions log.

> **Status:** Part A backend complete (auth/RBAC, venues, events, inventory, holds, checkout,
> tickets, check-in, refunds, cancellation, reviews, sales reports, audit) and seeded with synthetic
> demo data. Frontend integration and full acceptance-criteria verification are the remaining work.
> See [docs/PROGRESS.md](docs/PROGRESS.md) for the stage-by-stage log.

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
cp .env.example .env && cp apps/web/.env.example apps/web/.env.local && npm run db:generate && npm run db:migrate:deploy && npm run db:seed
npm run dev
```

Before the last two steps, replace `JWT_SECRET` in the generated `.env` with a real random value, e.g.
`node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.

That's 4 commands (step 3 is a single chained line — migrate + seed are folded into it, keeping the
total at the assessment's ≤5-command limit).

Then open:
- http://localhost:3000 — frontend
- http://localhost:4000/health — API health/DB-connectivity check
- http://localhost:4000/docs — Swagger UI (endpoint summaries; full behavior documented inline in
  each route's test suite)

### Demo logins (seeded, password `Seed@12345` for all of them)

| Role | Email | Organiser |
|---|---|---|
| Admin | `admin1@seed.test` | Laugh Factory Pune |
| Staff | `staff1@seed.test`, `staff2@seed.test` | Laugh Factory Pune |
| Admin | `admin2@seed.test` | Riverfront Live |
| Staff | `staff3@seed.test`, `staff4@seed.test` | Riverfront Live |
| Attendee | `attendee1@seed.test` … `attendee16@seed.test` | — (platform-wide) |

`npm run db:seed` is idempotent — safe to re-run any time; it deletes and recreates only the rows it
created (identified by the organiser names and the `@seed.test` email domain), never touching
anything else in the database. See `apps/api/src/seed.ts` for exactly what it creates (12 events
across 3 cities and all 6 statuses, seated + GA inventory, a nearly-sold-out tier, an unswept expired
hold, 32 reviews across 2 completed events including 2 deliberately adversarial ones for Part B).

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

## API endpoints

Public (no auth):
- `POST /auth/register`, `POST /auth/login`
- `GET /events` (filters: `city`, `from`, `to`, `category`, `q`, `limit`, `cursor`), `GET /events/:id`
- `GET /events/:id/reviews`

Authenticated, attendee-scoped:
- `POST /holds` `[Idempotency-Key]`, `DELETE /holds/:id`
- `POST /orders` `[Idempotency-Key]` (`X-Payment-Scenario: success|decline|timeout_then_success|
  timeout_then_decline` to exercise the fake provider deterministically), `GET /me/orders`
- `POST /orders/:id/refund` `[Idempotency-Key]`
- `POST /tickets/:code/checkin` (staff/admin of the ticket's own organiser)
- `POST /events/:id/reviews`

Organiser-scoped (`/organisers/:organiserId/...`), membership required, most writes admin-only:
- `GET`/`POST /venues`, `GET`/`PATCH /venues/:id`, `POST /venues/:id/sections[/...rows[/...seats]]`
- `POST /events`, `GET`/`PATCH /events/:id`, `POST /events/:id/publish`, `POST /events/:id/cancel`
- `POST /events/:id/ticket-tiers`, `POST /events/:id/seats/generate`
- `GET /reports/sales` (`from`, `to`, `group_by=event|day|tier`) — any member
- `GET /audit` (`entity=Type:id` for any member; organiser-wide feed is admin-only)

## Authentication

`POST /auth/register` and `POST /auth/login` return `{ token, user }`. Pass the token as
`Authorization: Bearer <token>` on subsequent requests. The token carries only the user's id — role
and organiser permissions are always re-checked against the database per request (see
`apps/api/src/middleware/requireAuth.ts` and `requireOrganiser.ts`), never cached in the token.
Every authenticated user can act as an attendee by default; organiser-scoped STAFF/ADMIN
permissions come only from an `OrganiserMembership` row.

## Known limitations

- Frontend integration is in progress — see `docs/PROGRESS.md` for current status.
- Event cancellation is implemented but there's no endpoint for the `PUBLISHED → ON_SALE →
  SOLD_OUT` transitions yet (not reachable from any current flow; the transition rule itself is
  written and tested in `apps/api/src/modules/events/statusTransitions.ts`).
- No BullMQ-scheduled hold-expiry sweeper — expiry is lazy, triggered opportunistically at
  hold-creation and checkout time (PDF-compliant; see `docs/DECISIONS.md` D-025).
- No password reset / refresh-token flow (documented auth shortcut — single long-lived access
  token; see `DESIGN.md` once written).
- `apps/api`'s `build`/`start` scripts exist and work but aren't needed for local dev (`npm run
  dev` runs TypeScript directly via `tsx`).
- Occasional transient test flakiness was observed on this machine (non-reproducing on retry,
  never traced to a code defect) — see `docs/PROGRESS.md` Stage 2.7 for details.
