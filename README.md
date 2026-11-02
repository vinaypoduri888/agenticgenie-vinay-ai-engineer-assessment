# Agentic Genie: event ticketing with an AI assistant

A multi-organiser ticketing platform (Part A), a hand-built agent harness and eval suite on top of it (Part B), and design notes in [DESIGN.md](DESIGN.md) (Part C).

## Setup

Needs Node 20+ and Docker.

```bash
npm install
docker compose up -d --wait
npm run setup
npm run dev
```

`npm run setup` creates the env files with a generated JWT secret, generates the Prisma client, runs migrations and seeds the demo. No API key is needed for anything, including the assistant and the evals.

- App: http://localhost:3000
- API docs: http://localhost:4000/docs
- Health: http://localhost:4000/health

Postgres and Redis use host ports 5434 and 6380, to avoid clashing with local services.

### Demo logins

Password for all: `Seed@12345`. The login page has one-click buttons for these.

| Role | Email | Organiser |
|---|---|---|
| Attendee | `attendee1@seed.test` to `attendee16@seed.test` | none |
| Admin | `admin1@seed.test` | Laugh Factory Pune |
| Staff | `staff1@seed.test`, `staff2@seed.test` | Laugh Factory Pune |
| Admin | `admin2@seed.test` | Riverfront Live |
| Staff | `staff3@seed.test`, `staff4@seed.test` | Riverfront Live |

The seed creates 12 events across 3 cities and every status, a seated event, GA events, a nearly sold-out event (Acoustic Evening), an expired hold, and 32 reviews on completed events, 2 of them injection attempts. Re-running it is safe.

### Things to try

- **Seated checkout:** log in as an attendee and open Riverfront Seated Concert. Pick seats, hold, and choose a payment outcome, including a timeout.
- **Assistant:** ask for "Comedy shows in Pune", then "Book the second one", then confirm. Try "Yes, but for another event" instead, and nothing happens.
- **Injection:** run `npm run eval -- adversarial-16-malicious-review`. A scripted model obeys a malicious review and tries to cancel an order. The loop refuses, and the order stays paid. To see such a review in the app, log in as `attendee1` and open Last Month's Comedy Fest from My tickets, under Past. Demo mode's chat can't reach it, because search hides completed events.
- **Organiser:** log in as `admin1`, then try the same pages as `staff1`.

## Architecture

```
apps/web        Next.js UI (attendee, organiser, assistant)
apps/api        Express 5 API: services hold every rule, permission and audit write
  src/evals     Eval runner; cases live in evals/cases/*.json
packages/agent  The loop, tools, providers, retries, grounding, guards, tracing
packages/shared Zod schemas for tool inputs and outputs
packages/db     Prisma schema and migrations
```

```
Browser -> /agent/chat -> runAgentTurn -> provider (mock | demo | real model)
                            |  every model call, tool call and token goes through one tracer
                            v
                         tool registry -> Zod validation -> Part A service, as the signed-in user
                                                               |
                         REST routes ---------------------> same services -> Postgres
```

`packages/agent` never imports the API or the database. Its tools get their implementations injected, and they call the same service functions as the REST routes, so the agent can't do anything the user couldn't do directly.

## Tests and evals

```bash
npm run test       # Vitest against real Postgres, including the concurrency tests
npm run typecheck
npm run eval       # the eval suite on the mock provider, no key needed
```

The docker containers must be up. Tests share the demo database, so run `npm run db:seed` afterwards to restore the seeded expired hold.

Committed reports: [mock run](evals/results/sample-run.md) and [real model run](evals/results/real-model-run.md).

`npm run eval -- <case-id>` runs one case. To run against a real model (any OpenAI-compatible endpoint, including Ollama):

```bash
AI_PROVIDER=nemotron NEMOTRON_BASE_URL=http://localhost:11434/v1 NEMOTRON_API_KEY=local NEMOTRON_MODEL=qwen3.5:9b npm run eval -- --real
```

The mock's responses are scripted, so the mock run measures the harness (tools, permissions, confirmation, grounding, retries, database effects), not language understanding. The real-model run is what tests that.

## Environment variables

Listed with defaults in [.env.example](.env.example). `npm run setup` handles the required ones. Worth knowing:

| Variable | Default | Purpose |
|---|---|---|
| `AI_PROVIDER` | `mock` | `nemotron` for any OpenAI-compatible endpoint, with `NEMOTRON_BASE_URL`, `NEMOTRON_API_KEY`, `NEMOTRON_MODEL` |
| `AGENT_MAX_STEPS`, `AGENT_TOKEN_BUDGET`, `AGENT_TOOL_TIMEOUT_MS` | `6`, `24000`, `10000` | Per-turn limits |
| `HOLD_EXPIRY_MINUTES` | `10` | How long a hold lasts |
| `SWEEP_INTERVAL_SECONDS` | `30` | Expired-hold and stuck-payment sweep. `0` turns it off |
| `FAKE_PAYMENT_SCENARIO` | `success` | Default fake payment outcome. A request can override it with `X-Payment-Scenario` |

## API

Everything in the assessment's contract is served as written, and the OpenAPI document at `/docs` lists every route.

- Request fields are accepted in the contract's snake_case (`event_id`, `seat_ids`, `tier_id`, `qty`, `hold_id`, `ticket_ids`) or camelCase.
- Beyond the contract: register; organiser-scoped event, venue and seat management; event status changes; `GET /holds`; `GET /events/:id/seats`; `/organisers/:id/orders`; `/organisers/:id/members`; `/me/memberships`; `/me/conversations`; `/agent/chat`.
- Out-of-scope ids return 404, not 403.

## Libraries, and why

- **Express 5 + Zod:** an explicit middleware chain and one validation library across API, agent and config.
- **Prisma + Postgres:** typed queries, real transactions, and raw SQL where constraints or row locks need it.
- **Next.js:** client components calling the API directly. The UI holds no permission logic to bypass.
- **Geist via @fontsource:** self-hosted fonts, so the build makes no font requests.
- **bcryptjs + jsonwebtoken:** no native build step. A stateless token that holds only the user id.
- **No agent framework:** the loop, retries, budgets and policy checks are written here, as the brief requires.

## Assumptions

- A `PUBLISHED` event can already be sold; `ON_SALE` is a label an admin can set. `SOLD_OUT` is derived from inventory, and a refund reopens it.
- Attendee refunds are bound by the event's refund window; staff and admin refunds aren't.
- `DECLINED` is an added order status, and a declined order can be retried against its hold.
- Sales figures are net of refunds and dated by when the order was placed.
- A checked-in ticket can still be refunded by staff, but its seat doesn't go back on sale.

## Known limitations

See [DESIGN.md](DESIGN.md) for the fuller list and what I'd do next. The short version:

- No load test has been run, so behaviour in an on-sale rush is reasoned, not measured.
- No browser tests in CI. UI flows were verified by hand in a real browser.
- Organisers can only be created by the seed script.
- Payments use a fake provider whose ledger is lost on restart.
- Demo mode understands a few phrasings only. Open conversation needs a real model.
- `node dist/src/server.js` doesn't run, because workspace packages export raw TypeScript. Use `npm run dev`.
- Stretch goals aren't built, and neither are the interview extensions, on purpose.
