# CLAUDE.md — Agentic Genie AI Engineer Assessment

## Project purpose

Take-home assessment for Agentic Genie's AI Engineer (Entry Level) role: build a multi-organiser
event-ticketing platform (Part A), a custom AI agent harness + eval suite on top of it (Part B),
and written design notes (Part C).

- **Candidate:** Vinay
- **Deadline:** Monday, 2 November 2026, 11:59 PM IST
- **Expected core effort:** ~12–16 focused hours (per the assessment PDF; stretch goals optional)
- **Source of truth:** `agenticgenie-vinay-ai-engineer-assessment.pdf` (local only, NEVER committed —
  it is confidential and listed in `.gitignore`). If anything in this repo's docs conflicts with the
  PDF, the PDF wins — flag the conflict and fix the docs.
- Working requirements checklist: [docs/ASSESSMENT_REQUIREMENTS.md](docs/ASSESSMENT_REQUIREMENTS.md).
  Re-read the PDF directly only to verify a specific requirement, not routinely.

## Technology stack (decided, do not change without approval)

| Layer | Technology |
|---|---|
| Frontend | Next.js + TypeScript |
| Backend | Node.js + Express 5 + TypeScript |
| Validation | Zod |
| ORM | Prisma |
| Database | PostgreSQL (source of truth for inventory/orders/payments/permissions — never Redis) |
| Background jobs | Redis + BullMQ (only where justified, e.g. hold-expiry sweeper) |
| AI harness | Custom TypeScript implementation (no LangChain AgentExecutor / CrewAI — we write the loop) |
| Real AI provider | NVIDIA Nemotron via an OpenAI-compatible API (env-configured, no hardcoded keys) |
| Mock AI provider | Deterministic scripted provider (no API key, simulates 429/quota/timeout/malformed JSON) |
| API docs | OpenAPI + Swagger |
| Unit/integration tests | Vitest |
| Browser tests | Playwright |
| Load testing | k6 |
| API testing | Postman collection |
| Local env | Docker Compose |
| CI | GitHub Actions |
| 3D effects | Three.js + React Three Fiber — optional, lazy-loaded, after core is done |

The assessment PDF itself grants "stack freedom" (any backend/DB/frontend, 5-command setup). This
stack is our own choice within that freedom. Modular monolith — no microservices.

## Architecture (planned — update as it solidifies)

```
apps/
  web/         Next.js frontend (attendee + organiser + AI chat UI)
  api/         Express 5 API (REST, OpenAPI docs, Swagger UI)
packages/
  db/          Prisma schema, migrations, seed script
  agent/       Agent loop, tool registry, providers (mock + Nemotron), policy engine
  shared/      Shared Zod schemas/types between api/agent/web
evals/         Data-driven eval cases (YAML/JSON) + eval runner + report
docs/          Assessment checklist, progress log, decisions log
DESIGN.md      Part C design notes
```

Module responsibilities:
- `api` owns all server-side permission/isolation checks, idempotency, audit writes — the single
  source of truth the agent tools call into.
- `agent` never talks to Postgres/Redis directly; it calls the `api` service layer as the
  authenticated user, so the model can never exceed the user's own permissions.
- `evals` is fully runnable against the mock provider with zero API keys (CI-friendly).

## Part A — full-stack ticketing (summary; full detail in docs/ASSESSMENT_REQUIREMENTS.md)

Multi-organiser event ticketing: organisers, users (attendee/staff/admin), venues/events/seats/GA
tiers, holds, orders/tickets, fake payments, reviews, append-only audit log. Must satisfy
acceptance criteria A1–A8 (no overselling under concurrency, idempotent holds/orders/refunds,
server-side role enforcement, tenant/user isolation with 404-not-403, stable keyset pagination,
transactional audit writes). See the PDF's API contract — implement at minimum every listed
endpoint; extensions are fine, omissions are not.

## Part B — AI agent harness + evals (summary)

Custom tool-calling loop (max ~6 steps, token budget, per-tool timeout, typed Zod args, bounded
retries with backoff+jitter, tracing, graceful partial answers, one repair attempt on malformed
output). Seven tools: `search_events`, `get_event`, `get_reviews`, `hold_seats`, `purchase`,
`cancel_order`, `sales_summary` — all executed as the calling user through the Part A service
layer. Layered prompt-injection defence (reviews/descriptions are untrusted data). Grounded
citations verified in code. Confirmation step for purchase/cancel tied to a specific hold/order.
Provider interface with deterministic mock + Nemotron (OpenAI-compatible). ≥20 data-driven eval
cases across 6 categories including all 5 required adversarial scenarios, with a committed
Markdown/HTML report (mock-provider run is mandatory and must need no API key).

## Part C — design notes

`DESIGN.md`, 1–2 pages, covering: concurrency/inventory strategy, hold expiry, idempotency
storage, fake-payment timeout/reconciliation, auth shortcut, injection defence layers, what was
mocked/simplified and why, known gaps/risks, next-week priorities, production observability, cost
controls, model routing/fallback, safety/confirmation/audit/PII handling. Be honest about gaps —
never claim a test passed unless it actually ran and passed.

## Mandatory acceptance criteria (must verify, not just implement)

A1–A8 from the PDF (fresh-clone-in-≤5-commands, concurrency, hold expiry, idempotency, roles,
isolation, pagination, audit) — see docs/ASSESSMENT_REQUIREMENTS.md for the checklist and how each
is tested. A requirement is only "Verified" once an automated test actually runs and passes.

## Git workflow

- Conventional Commits: `feat(scope): ...`, `fix(scope): ...`, `test(scope): ...`, `docs: ...`,
  `chore: ...`.
- Small, focused commits — never one giant final commit.
- Run relevant tests before committing; don't commit code known to be broken.
- Never commit `.env`, secrets, or `agenticgenie-vinay-ai-engineer-assessment.pdf` /
  `ticketbooking.docx` (both gitignored — the PDF is confidential, the docx is the candidate's own
  paraphrase of it and kept local for the same reason).
- Update `docs/PROGRESS.md` with the commit hash after each meaningful stage.
- Do not push to a remote without explicit approval.

## Security and implementation rules

- All permission/role/tenant checks are enforced server-side in the API service layer — never only
  in the UI, and never trusted from the agent/model.
- Never compute sold/available inventory from application memory — always atomic SQL
  (conditional updates / row locks / unique constraints), never SELECT-then-UPDATE races.
- Idempotency keys are scoped per user; replay-with-same-body returns the original result,
  replay-with-different-body returns 422.
- Audit writes happen in the same DB transaction as the state change they record.
- Out-of-scope resource IDs return 404, not 403 (don't leak existence).
- Agent tools never grant the model more permission than the authenticated user has.
- Treat reviews/event descriptions as untrusted content; never let them trigger tool execution.

## Anti-repetition rules

- Read this file and `docs/PROGRESS.md` before starting work in a new session.
- Check `docs/ASSESSMENT_REQUIREMENTS.md` status column before implementing — don't rebuild
  something already Implemented/Tested/Verified.
- Inspect existing files before writing new ones; reuse schemas/services/utilities.
- Don't re-read the full PDF repeatedly — use the extracted checklist; return to the PDF only to
  resolve ambiguity on a specific requirement.
- Work one approved stage at a time (see the working protocol the candidate set); report results
  at the end of a stage rather than jumping ahead.

## Explaining decisions

For each meaningful stage, be ready to explain: what was built, which requirement it satisfies, how
it works end-to-end, why this approach vs. alternatives, the key files/functions, how to test it,
a short interview-ready explanation, and the trade-offs. Keep explanations simple — assume strong
TypeScript/Node/Postgres/Prisma/AI-integration background but not prior exposure to this specific
codebase's details.

## Current status

See [docs/PROGRESS.md](docs/PROGRESS.md) for the live log. As of now: Stage 0 (audit + docs) in
progress; no application code written yet.
