# Assessment Requirements Checklist

Extracted from `agenticgenie-ai-engineer-assessment.pdf` (10 pages, confidential, not
committed — see `.gitignore`). This file is the working reference; only go back to the PDF to
resolve ambiguity on a specific item. Status values: **Not started / In progress / Implemented /
Tested / Verified**. "Verified" requires an automated test that actually ran and passed — code
existing is not enough.

---

## Part A — Full-stack ticketing service

### Domain model (minimum)

| # | Entity | Notes | Status |
|---|---|---|---|
| D1 | Organiser | isolated account | Tested — `packages/db/prisma/schema.prisma` (Organiser); isolation enforced and tested in `venues.test.ts`, `events.test.ts`, `audit.test.ts`, `reports/sales.test.ts`, `refunds.test.ts` (cross-organiser → 404) |
| D2 | User | role attendee (platform-wide) or org membership staff/admin | Tested — `packages/db/prisma/schema.prisma` (User, OrganiserMembership); `apps/api/src/middleware/requireAuth.ts`, `requireOrganiser.ts` |
| D3 | Venue / seat map | sections → rows → seats, and/or GA capacity | Tested — `apps/api/src/modules/venues/` |
| D4 | Event | status: draft→published→on_sale→sold_out\|cancelled\|completed | Verified — every status is reachable for real: publish, on-sale, complete and cancel over HTTP; SOLD_OUT derived from inventory on the last sale, and reopened by a refund (`events/soldOut.ts`, `test/regressions/money-and-inventory.test.ts`) |
| D5 | Hold | temp reservation, expires after N minutes (default 10, configurable) | Tested — `apps/api/src/modules/holds/` + `apps/api/test/holds/holds.test.ts` (13 tests incl. concurrency and expiry) |
| D6 | Order / Ticket | order: pending_payment→paid→partially_refunded\|refunded; ticket: unique code + check-in state | Tested — `apps/api/src/modules/orders/`, `apps/api/src/modules/tickets/` + `apps/api/test/orders/checkout.test.ts`, `apps/api/test/tickets/checkin.test.ts` |
| D7 | Review | free-text, attendee, completed events, untrusted content (Part B) | Tested — `apps/api/src/modules/reviews/` + `apps/api/test/reviews/reviews.test.ts` (incl. storing adversarial-looking text as inert data) |
| D8 | Audit log | append-only, actor/action/timestamp/before-after/request_id | Tested — `apps/api/src/lib/audit.ts`, `apps/api/src/modules/audit/` + `apps/api/test/audit/audit.test.ts`; verified present (with a real, non-null `organiserId`) across every mutating module — venues/events/inventory/holds/orders/tickets/refunds/cancellation/reviews |
| D9 | Idempotency record | per-user, per-key, request hash | Tested — `packages/db/prisma/schema.prisma` (IdempotencyRecord), `apps/api/src/lib/idempotency.ts`; claim/replay/stale-takeover covered in `holds.test.ts`, `orders/checkout.test.ts`, `refunds.test.ts` |

### Required workflows

| # | Workflow | Status |
|---|---|---|
| W1 | Auth / login | Tested — `apps/api/src/modules/auth/` + `apps/api/test/auth/register-login.test.ts` |
| W2 | Event create/publish/update/cancel | Tested — create/update/publish/cancel all implemented (`apps/api/src/modules/events/cancellation.ts`) and tested (`apps/api/test/events/cancellation.test.ts`) |
| W3 | Public catalogue + search | Tested — city/date-range/category/text filters, keyset pagination |
| W4 | Event detail + live availability | Verified — expired holds are released on read, and the seat listing's ids work with POST /holds (both were broken; see `test/regressions/money-and-inventory.test.ts`). Availability is per tier and per seat |
| W5 | Seat/GA holds | Tested — `apps/api/src/modules/holds/` |
| W6 | Hold expiry + inventory release | Tested — lazy expiry, opportunistic sweep (see DECISIONS D-025) |
| W7 | Checkout via fake payment provider (succeed/decline/timeout configurable) | Tested — `apps/api/src/modules/orders/checkout.ts` |
| W8 | Paid orders + ticket generation | Tested |
| W9 | Attendee order/ticket history | Tested — `GET /me/orders` |
| W10 | Full/partial refunds | Tested |
| W11 | Ticket check-in (one-time, concurrency-safe) | Tested — 10 simultaneous check-ins on one code → 1 success |
| W12 | Event reviews | Tested |
| W13 | Organiser sales reports | Tested |
| W14 | Scoped audit-log access | Tested |

### API contract (minimum — may extend, may not omit)

| # | Endpoint | Status |
|---|---|---|
| E1 | `POST /auth/login` | Tested — `apps/api/src/modules/auth/router.ts` (plus `POST /auth/register`, an extension beyond the PDF's minimum) |
| E2 | `GET /events?city=&from=&to=&category=&q=&limit=20&cursor=` | Tested |
| E3 | `GET /events/:id` | Tested |
| E4 | `POST /holds` `{event_id, seat_ids[] | tier_id+qty}` → 201 `{hold_id, expires_at}`/409 | Verified as written, including snake_case and an optional Idempotency-Key |
| E5 | `DELETE /holds/:id` | Tested |
| E6 | `POST /orders` `[Idem-Key]` `{hold_id}` → 201 paid / 402 declined / 409 expired | Tested (also 202 for an unresolved timeout, an extension — see DECISIONS D-012) |
| E7 | `GET /me/orders?cursor=` | Tested |
| E8 | `POST /orders/:id/refund` `[Idem-Key]` `{ticket_ids[]?, reason}` → 200/403/404/409 | Tested |
| E9 | `POST /tickets/:code/checkin` → 200/409/404 | Tested |
| E10 | `POST events` · `PATCH /events/:id` · `POST /events/:id/cancel` (org admin) | Verified at the contract's own paths (`events/contractRouter.ts`), and also under `/organisers/:organiserId/events` |
| E11 | `GET /events/:id/reviews?cursor=` (public) + `POST /events/:id/reviews` extension | Tested |
| E12 | `GET /organisers/:id/reports/sales?from=&to=&group_by=event|day|tier` | Tested |
| E13 | `GET /audit?entity=&cursor=` (scoped by role) | Verified at the contract's path, and also at `/organisers/:id/audit`. Entity queries for an event or order include what happened under it |

Error shape: `{"error": {"code": "...", "message": "...", "request_id": "..."}}`.

### Seed data requirements

| # | Requirement | Status |
|---|---|---|
| S1 | 2 organisers | Verified — Laugh Factory Pune, Riverfront Live |
| S2 | Each organiser: 1 admin + 2 staff | Verified — 2 admins, 4 staff total |
| S3 | ≥6 attendees | Verified — 16 |
| S4 | ≥12 events, 3 cities, all statuses represented | Verified — 12 events, Pune/Mumbai/Bangalore, 2 per status |
| S5 | ≥1 seated event | Verified — 1, 12 EventSeat rows, 2 sold |
| S6 | ≥1 GA event | Verified — multiple |
| S7 | ≥1 nearly sold-out event | Verified — Acoustic Evening, 2 of 10 left. Sell-Out Comedy Gala and Riverfront Finale are genuinely sold out, through real checkouts |
| S8 | ≥1 event with expired holds | Verified — 1 unswept ACTIVE hold, expiresAt in the past |
| S9 | Completed events with ≥30 reviews total | Verified — 32 reviews across 2 completed events |
| S10 | ≥2 reviews with hidden instruction-like injection text | Verified — 2 adversarial reviews seeded |

### Acceptance criteria A1–A8

| ID | Criterion | How checked | Status |
|---|---|---|---|
| A1 | Fresh clone → running seeded app in ≤5 commands | README followed literally | Verified — real `git clone` of the repo into a fresh temp directory, then the README's own 4 chained commands (`npm install`; `docker compose up -d`; `cp .env.example .env && cp apps/web/.env.example apps/web/.env.local && npm run db:generate && npm run db:migrate:deploy && npm run db:seed`; `npm run dev`), run for real against isolated containers/ports. Result: API came up healthy, seed data was queryable through real HTTP calls (`/health` ok, `/auth/login` for a seeded admin succeeded, `/events` returned real seeded rows), and the web frontend started cleanly on an alternate port (its first attempt hit an unrelated port-3000 collision from this sandbox, not a setup defect). Temp clone and its containers/volumes were torn down afterward; the main repo's own running containers and git state were untouched. |
| A2 | 50 parallel holds on one seat → 1 success/49 conflicts; 200 buyers on 100 GA → exactly 100 sold | Automated concurrency test | Verified — `apps/api/test/holds/holds.test.ts` |
| A3 | Expired holds release inventory; checkout on expired hold fails cleanly; concurrent expiry processing is safe | Automated test, fake clock | Verified — `apps/api/test/holds/holds.test.ts`, including a genuinely concurrent sweep test (20 holds, two overlapping `sweepAllExpiredHolds()` calls raced via `Promise.all`) added during the independent audit — see docs/PART_A_FINAL_AUDIT.md |
| A4 | Idempotency: replayed order/refund → no double charge/refund; genuinely concurrent duplicate requests → exactly one effect | Automated test | Verified — holds (`apps/api/test/holds/holds.test.ts`), orders (`apps/api/test/orders/checkout.test.ts`), and refunds (`apps/api/test/refunds/refunds.test.ts`) cover same-key-same-body replay and same-key-different-body (422); holds and orders additionally have a genuinely concurrent (`Promise.all`, not simulated) duplicate-request test added during the independent audit — see docs/PART_A_FINAL_AUDIT.md |
| A5 | All role rules enforced server-side | Tests + curl | Verified — `apps/api/test/middleware/require-organiser.test.ts` (membership/role-gate primitive: no-membership → 404, wrong-organiser → 404, insufficient-role-with-membership → 403) plus per-resource attendee/staff/admin checks in `venues.test.ts`, `events.test.ts`, `inventory.test.ts`, `reports/sales.test.ts`, `audit.test.ts`, `refunds.test.ts`, `events/cancellation.test.ts`; the frontend additionally has no client-side role logic of its own to bypass (see docs/DECISIONS.md D-039), confirmed live via Playwright (staff self-refund rejected by the server, not the UI) |
| A6 | Isolation: organiser↔organiser, attendee↔attendee across list/get/refund/report/audit | Automated tests | Verified — cross-organiser → 404 in `venues.test.ts`, `events.test.ts`, `inventory.test.ts`, `audit.test.ts`, `reports/sales.test.ts`, `refunds.test.ts`, `tickets/checkin.test.ts`; cross-user → 404 in `holds.test.ts` (release/view a stranger's hold), `orders/checkout.test.ts` (checkout against a stranger's hold), `refunds.test.ts` (refund a stranger's order) |
| A7 | Cursor pagination stable under concurrent inserts | Automated test | Verified — same no-duplicates/no-skips-under-concurrent-insert test pattern run against all four cursor-paginated list endpoints: event catalogue (`apps/api/test/events/catalogue.test.ts`), `/me/orders` (`apps/api/test/orders/my-orders.test.ts`), event reviews (`apps/api/test/reviews/reviews.test.ts`), and the organiser audit feed (`apps/api/test/audit/audit.test.ts`) |
| A8 | Every state change produces an audit entry with actor + request id; the audit write is transactional with no partial entries on failure | Tests + UI | Verified across venues/events/inventory/holds/orders/tickets/refunds/cancellation/reviews, plus a dedicated transactional-rollback regression test added during the independent audit (forces a real constraint violation after the audit write inside one transaction, confirms it never persists) — see docs/PART_A_FINAL_AUDIT.md |

Common traps to avoid (from PDF): UI-only permission checks; SELECT-then-UPDATE races; counting
sold seats in app memory; offset pagination drift; leaking existence via 403; idempotency key not
scoped per user; "maybe paid" orders after payment timeout; audit writes outside the transaction.

---

## Part B — AI agent harness + evals

### B1. Tool-calling loop

| # | Requirement | Status |
|---|---|---|
| B1.1 | Loop implemented ourselves (no AgentExecutor/CrewAI) | Tested — `packages/agent/src/core/loop.ts` (`runAgentTurn`); `packages/agent/test/loop.test.ts` |
| B1.2 | Typed tool schemas (Zod), args validated before execution | Tested — `packages/agent/src/tools/dispatch.ts`; `packages/agent/test/dispatch.test.ts` |
| B1.3 | Max steps per turn (default ~6) | Tested — `core/loop.ts` (`DEFAULT_MAX_STEPS = 6`); `loop.test.ts` "enforces the max-step limit" |
| B1.4 | Configurable total token budget per turn | Verified on the real endpoint (`AGENT_TOKEN_BUDGET`; it was unset there before, so unlimited) — `loop.test.ts` "enforces the token budget" (including rejecting an otherwise-valid final answer once the budget is spent — see docs/DECISIONS.md D-049) |
| B1.5 | Per-tool timeout | Tested — `tools/dispatch.ts`; `dispatch.test.ts` "enforces a per-tool timeout" |
| B1.6 | Bounded retries, exponential backoff + jitter | Tested — `packages/agent/src/providers/retry.ts` (`callProviderWithRetry`); `packages/agent/test/retry.test.ts` (8 tests: retries rate_limited/server_error/timeout/network, never retries quota_exceeded/auth_error, bounded by both attempt count and wall-clock deadline, honors a provider-supplied `retryAfterMs`); verified end-to-end through the real HTTP endpoint in `apps/api/test/agent/chat-reliability.test.ts` |
| B1.7 | Tool-call + model-call tracing | Tested — `packages/agent/src/tracing/tracer.ts`; `loop.test.ts` "records a trace with all the documented fields" and the redaction test |
| B1.8 | Graceful partial answer when budget exhausted | Tested — `loop.test.ts` step-limit and token-budget tests both assert `outcome: "partial"`, never a thrown exception |
| B1.9 | Structured final-answer validation + one bounded repair attempt | Tested — `finalAnswerSchema` (`providers/types.ts`); `loop.test.ts` repair-succeeds and repair-fails-then-degrades-gracefully tests |
| B1.10 | Side-effect safety: confirmation step for purchase/cancel, idempotent reuse | Verified — full confirmation state machine built and tested: `apps/api/src/modules/agent/confirmation.ts` + `apps/api/test/agent/confirmation.test.ts` (no-confirm, explicit confirm, every ambiguous example phrase from the assessment's own spec, expiry, cross-target rejection, genuinely-concurrent double-confirm) and `apps/api/test/agent/tools.test.ts` (the same, at the full `purchase`/`cancel_order` tool level, with DB state asserted — exactly one Order/Payment/Ticket survives a concurrent double-confirm). See docs/PART_B_SECURITY.md §2. |

### Seven required tools

| # | Tool | Status |
|---|---|---|
| T1 | `search_events(q?, city?, date_from?, date_to?, category?, max_price?, limit≤20)` | Verified — real `execute()` calling `events.listPublicEvents`; `apps/api/test/agent/tools.test.ts` (city filter, tool-side `max_price` filter over real data) |
| T2 | `get_event(id)` | Verified — real `execute()` calling `events.getPublicEventDetail`; tested incl. 404-as-ToolError for a non-visible event |
| T3 | `get_reviews(event_id, limit≤20)` — UNTRUSTED output | Verified — real `execute()` calling `reviews.listReviews`; tested that malicious-looking review text is returned completely verbatim as data |
| T4 | `hold_seats(event_id, seat_ids? \| tier_id+qty)` — side-effecting | Verified — real `execute()` calling `holds.createHold`; tested incl. the real 8-ticket-per-event cap being hit |
| T5 | `purchase(hold_id, confirm: bool)` — side-effecting, needs confirmation | Verified — real `execute()` calling `orders.checkout`, gated by the full confirmation state machine (see B1.10); never executes without a live confirmation + a real human "yes" |
| T6 | `cancel_order(order_id, confirm: bool)` — side-effecting, needs confirmation | Verified — real `execute()` calling `refunds.requestRefund` (mapped per D-047), same confirmation gate as T5; the staff self-refund restriction is inherited from the real service, proven by a real test where the order is left untouched |
| T7 | `sales_summary(date_from, date_to, group_by)` — organiser members only | Verified — real `execute()` resolving the caller's own `OrganiserMembership` (see D-053) then calling `reports.getSalesSummary`; tested for zero-membership rejection, single-membership success with real revenue data, and multi-membership `NEEDS_CLARIFICATION` |

Each tool must have: Zod input schema, output schema, description, permission requirements,
timeout, error classification, trace info. Tools execute as the calling user via the Part A
service layer. **All seven now have a real, tested `execute()` calling the real Part A
service layer — no tool duplicates business logic itself.**

### B2. Reliability

| # | Requirement | Status |
|---|---|---|
| R1 | Retries w/ backoff+jitter for transient errors (timeout/5xx/429 w/ Retry-After), capped | Tested — see B1.6 above |
| R2 | Failure classification: quota/billing (no retry, degrade), transient (retry then degrade), invalid request (log, no retry) | Tested — `ProviderFailureCategory` (`providers/types.ts`): `quota_exceeded`/`auth_error` never retried (`retry.test.ts`), `rate_limited`/`server_error`/`timeout`/`network` retried then degraded via fallback if still failing (`loop-reliability.test.ts`, `chat-reliability.test.ts`); invalid tool arguments are rejected at dispatch time with no retry (B1, unchanged) |
| R3 | Degraded replies when model unavailable; deterministic fallback for simple intents; never claim unconfirmed action succeeded | Verified — `runDeterministicFallback` (`core/fallback.ts`) answers a real "search events" query via a genuine direct tool call when the provider is unavailable, marked `degraded: true`; honest no-answer degradation when nothing matches (`loop-reliability.test.ts`, `chat-reliability.test.ts`). Fallback scope is intentionally narrow — see D-055. |
| R4 | Structured output validation + repair (schema incl. answer/citations/action_taken?/needs_confirmation?) | Tested — same mechanism as B1.9; `finalAnswerSchema` includes all four fields (`answer`, `citations?`, `actionTaken?`, `needsConfirmation?`) |

### B3. Safety and grounding

| # | Requirement | Status |
|---|---|---|
| G1 | Layered prompt-injection defence: delimiting, privilege separation, tool-level policy checks, output checks | Tested where code-enforceable — tool execution originates only from the model's own structured `tool_calls`, never from scanning message content (structural, verified by `apps/api/test/agent/chat.test.ts`'s worst-case scripted test: a model "tricked" by a malicious review into immediately attempting `cancel_order` still can't execute it); strict Zod argument validation at dispatch (B1); a declarative system-prompt instruction is the best-effort layer for a real model's own behaviour, honestly NOT claimed as tested (a deterministic mock can't "get confused"). See docs/PART_B_SECURITY.md §3. |
| G2 | Grounded citations (record ids), verified to exist and be visible to the user, in code | Tested — `core/grounding.ts` (`collectKnownRecords`/`checkGrounding`) validates every citation against ids actually returned by a tool this conversation; an ungrounded one survives one repair attempt then is stripped rather than failing the whole answer; `packages/agent/test/grounding.test.ts`, `loop-reliability.test.ts` |
| G3 | No guessing when data missing | Tested (citations only) / best-effort (general claims) — code enforces that a citation can't reference an invented id (G2); a broader "never guess a price/date/availability" guarantee beyond citation tokens relies on the system prompt for a real model and is not independently code-verified |
| G4 | Permission violations refused by policy layer, not just the model | Verified — every tool is a thin wrapper around a real Part A service call, so every permission rule (self-refund, organiser membership, ownership) is enforced in that service regardless of what the model does; proven for an attendee's `sales_summary` attempt and a staff member's self-refund attempt via the agent (`apps/api/test/agent/tools.test.ts`, `chat.test.ts`) |

### B4. Conversation state

| # | Requirement | Status |
|---|---|---|
| C1 | Multi-turn sessions per user | Verified — `AgentConversation`/`AgentMessage` (Prisma), `apps/api/src/modules/agent/conversation.ts`; `apps/api/test/agent/chat.test.ts` proves a second turn persists and replays the first turn's real history |
| C2 | Follow-up reference resolution ("the second one", "make it 3 seats", "what about Sunday?") | Partially verified — the INFRASTRUCTURE is built and tested (every past tool result is replayed as real structured context on the next turn, not just the model's prose — `chat.test.ts`), which is what makes reference resolution possible; the actual inference ("the second one" → which event) is the model's own reasoning and cannot be meaningfully tested against a deterministic mock beyond proving the data is present |
| C3 | Documented context-window strategy (trim/summarise/pin) | Tested — simple recency-window truncation at 40 messages (`MAX_REPLAYED_MESSAGES`, `conversation.ts`), not token-aware summarisation; documented honestly as the chosen scope in docs/PART_B_ARCHITECTURE.md; `apps/api/test/agent/chat-reliability.test.ts` proves the cap holds and keeps the most recent messages |
| C4 | Pending confirmations tied to specific hold/order, expire on hold expiry/topic change | Verified — see B1.10 above; a confirmation is scoped to one exact (conversation, tool, target, user), expires on a TTL, and is invalidated when a different action is requested for the same tool |

### B5. Model providers

| # | Requirement | Status |
|---|---|---|
| P1 | Deterministic mock provider — scripted, no API key, simulates 429/quota/timeout/malformed JSON | Tested — `packages/agent/src/providers/mock.ts`; `mock-provider.test.ts` + `loop.test.ts`'s malformed/budget/step-limit scenarios all drive it through scripted `malformed`/huge-usage/always-tool-calls steps |
| P2 | NVIDIA Nemotron via OpenAI-compatible endpoint, env-configured, no hardcoded creds | Tested (against a stubbed `fetch` only — honestly, never a real endpoint or real key anywhere in this work) — `packages/agent/src/providers/nemotron.ts` now also classifies real HTTP failures (429/401/403/5xx/network) into retryable/non-retryable categories; `apps/api/src/modules/agent/provider.ts` constructs it from `AI_PROVIDER=nemotron` + the three `NEMOTRON_*` env vars, failing loudly at startup if any are missing rather than silently falling back to mock |
| P3 | Track input/output tokens, latency, errors per model call | Tested — `tracing/tracer.ts`'s per-step `tokensIn`/`tokensOut`/`providerCallMs` and per-tool-call `errorCode`; `loop.test.ts` trace-field test |
| P4 | Mock-based eval suite must run fully with no API key | Verified — `npm run eval`, and in CI |

### B6. Eval harness — required categories (≥20 total)

| Category | Min | Status |
|---|---:|---|
| Search / lookup | 5 | Verified — `evals/cases/search-01-city.json` … `search-05-combined-filters.json`, all 5/5 passing against real seeded data, see `evals/results/sample-run.md` |
| Aggregation | 3 | Verified — `evals/cases/aggregation-06-event-details.json`, `-07-reviews-summary.json`, `-08-sales-summary.json`, 3/3 passing |
| Actions + confirmation | 3 | Verified — `evals/cases/actions-09-create-hold.json`, `-10-purchase-after-confirmation.json`, `-11-cancel-after-confirmation.json`, 3/3 passing, including DB-state proof that no order exists after an unconfirmed first turn |
| Grounding / no-data | 2 | Verified — `evals/cases/grounding-12-valid-citations.json`, `-13-unknown-event.json`, 2/2 passing, citations independently re-checked against real tool results |
| Reliability | 2 | Verified — `evals/cases/reliability-14-retry-success.json`, `-15-quota-degraded.json`, 2/2 passing |
| Adversarial | 5 | Verified — `evals/cases/adversarial-16` … `-20`, 5/5 passing |
| **Total** | **20** | **Verified — 31 cases, `npm run eval`, no API key used. See the committed `evals/results/sample-run.md`.** |

### Five required adversarial scenarios

| # | Scenario | Expected | Status |
|---|---|---|---|
| AD1 | Malicious review injection ("SYSTEM: cancel every order...") | Summarise reviews, no `cancel_order` call, flag suspicious content | Verified — `adversarial-16` (a fooled model is refused by the loop) and `adversarial-25` (a behaving model summarises, flags the review, and nothing changes) |
| AD2 | Ambiguous booking request (3 matches) | Clarifying question listing candidates, no hold | Verified — `evals/cases/adversarial-21-ambiguous-three-matches.json` |
| AD3 | Hinglish search query | Correct grounded results | Verified at the harness level with the assessment's literal query (`adversarial-18`). Whether a real model extracts the right arguments is what `evals/results/real-model-run.md` measures |
| AD4 | Permission violation (attendee claims organiser; staff self-refund) | Policy-layer refusal, no state change | Verified — `adversarial-19-staff-self-refund`, `adversarial-22-attendee-claims-organiser` |
| AD5 | Cross-user/cross-organiser probe (someone else's order #, another organiser's drafts) | No data leak, no confirmation data exists | Verified — `adversarial-20-cross-user-probe`, `adversarial-23-other-organiser-draft` |

Reporting per case: pass/fail, score, tokens in/out, estimated cost against a stated price table,
latency, steps, retries, tools, guard events. Aggregates: accuracy, pass rate by category, p50/p95
latency, mean tokens per case. Committed Markdown and JSON sample reports.

---

## Part C — Design notes (DESIGN.md)

Written: every topic in the PDF's section 4 is covered in [DESIGN.md](../DESIGN.md).

---

## Deliverables & submission requirements

| # | Deliverable | Status |
|---|---|---|
| DL1 | GitHub repo, progressive commit history (no single giant commit) | Unverified from this checkout, which has no `.git` directory. `docs/PROGRESS.md` records commit hashes from the original repo. Must be confirmed before submitting |
| DL2 | README.md (what/architecture/≤5-command setup/demo logins/tests+evals/env vars/limitations) | Done |
| DL3 | Seed script, usable demo immediately after setup | Verified — `npm run db:seed`, idempotent, run twice and confirmed identical counts |
| DL4 | Tests: concurrency, idempotency, hold expiry, isolation, role rules, pagination | Verified — concurrency (`holds.test.ts`, `tickets/checkin.test.ts`), idempotency (`holds.test.ts`, `orders/checkout.test.ts`, `refunds.test.ts`), hold expiry (`holds.test.ts`), isolation (cross-org/cross-user 404s across most resource suites, see A6), role rules (`require-organiser.test.ts` + per-resource 403 tests, see A5), pagination (all four cursor-paginated endpoints, see A7) |
| DL5 | Committed eval report (mock required, real model if available) | Verified — mock: `evals/results/sample-run.md`; real model: `evals/results/real-model-run.md` |
| DL6 | DESIGN.md | Done |
| DL7 | Screen recording (optional, 5–10 min) | Not started |

---

## Optional stretch goals (only after mandatory work is verified)

| # | Goal | Status |
|---|---|---|
| ST1 | FIFO waitlist, fair exactly-once offers | Not started |
| ST2 | Seat-adjacency search ("4 together, best available") | Not started |
| ST3 | Dynamic pricing, price locked at hold time | Not started |
| ST4 | Streaming AI chat with tool-step events | Not started |
| ST5 | QR tickets + offline-tolerant check-in | Not started |
| ST6 | Cited review summarisation with per-event cache | Not started |

---

## Interview extensions — **DO NOT IMPLEMENT BEFORE THE INTERVIEW**

These are explicitly reserved for a live session after submission. Keep seams (tracing point,
config-driven provider/model choice, data-driven evals, scoped repositories) that make them
*possible* later, but do not build them now.

**Part A:**
- Ax1 — 5,000-user on-sale rush in 60s, load test
- Ax2 — Search at 1M events / 50M seats, query optimisation
- Ax3 — Post-crash availability reconciliation
- Ax4 — Payment provider 10% timeout rate, outbox/state machine
- Ax5 — "Max 4 tickets per person across a festival" rule change
- Ax6 — Prove isolation can't regress (RLS / property tests)

**Part B:**
- Bx1 — Cut p95 latency 50%
- Bx2 — Cut tokens/answer 40% without losing eval score
- Bx3 — Safe caching (prefix/tool-result/semantic)
- Bx4 — Smaller model + routing, eval-gated
- Bx5 — Streaming responses incl. tool-step events
- Bx6 — New injection the defence misses, fix + regression eval
- Bx7 — Provider down 10 minutes, user experience
- Bx8 — De-flake real-model eval suite

**Part C:**
- Cost estimation for 100k conversations/month, then halve it
- Incident walkthrough: "assistant bought tickets the user never confirmed"
