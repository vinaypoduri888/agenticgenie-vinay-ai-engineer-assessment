# Part B — Agent Architecture

> **Partly out of date (2026-11-02).** Written before the independent review recorded at the end of [PROGRESS.md](PROGRESS.md), which reproduced and fixed real bugs this document doesn't know about. Where they disagree, the code, the regression tests in `apps/api/test/regressions/`, and DESIGN.md are correct.

Covers B1 (foundation) through B4 (reliability) as actually built. For the full
assessment checklist and status, see `docs/ASSESSMENT_REQUIREMENTS.md`; for design
rationale, see `docs/DECISIONS.md` D-045 onward.

## Module boundaries

```
packages/agent/     App-agnostic agent library. No dependency on apps/api, no Prisma,
                    no HTTP. Knows nothing about ticketing — only about running a
                    tool-calling loop against a generic ToolRegistry.
  core/             runAgentTurn (the loop), fallback.ts (deterministic degraded
                    answers), grounding.ts (citation validation)
  providers/        ModelProvider interface, MockProvider, NemotronProvider,
                    callProviderWithRetry
  tools/            ToolRegistry, dispatch (validation/timeout/error-safety),
                    catalogue (the 7 tools' schemas + metadata, executors injected)
  tracing/          ExecutionTracer — diagnostic telemetry, not an audit log
  confirmation/     classifyConfirmationIntent — a pure, deterministic classifier
  conversation/     ConversationState/Turn/PendingConfirmation TYPES only

packages/shared/src/agent/tools.ts
                    Zod input/output schemas for the 7 tools, shared between
                    packages/agent (validates against them) and apps/api (maps
                    real service results into them) — the one place both sides
                    agree on shape, with no circular dependency.

apps/api/src/modules/agent/    Where real implementations live — the only place
                    this agent code is allowed to import Part A's service layer.
  tools.ts          The 7 real `execute` functions, each a thin wrapper calling an
                    existing Part A service function (never Prisma directly, never
                    a second copy of business logic).
  confirmation.ts   The server-verified confirmation state machine for
                    purchase/cancel_order (see docs/PART_B_SECURITY.md).
  conversation.ts   AgentConversation/AgentMessage persistence, replay, isolation.
  provider.ts       Builds the real ModelProvider from AI_PROVIDER (mock default).
  rateLimiter.ts    Simple per-user limiter for POST /agent/chat.
  router.ts         POST /agent/chat, GET /me/conversations[/:id].
```

**Why this split, not one package.** `packages/agent` cannot import `apps/api` —
apps depend on packages, not the reverse, in this monorepo. Real tool
implementations need Part A's service layer (Prisma, business rules), so they live
in `apps/api` and are *injected* into the generic registry via
`createDefaultToolRegistry(executors)` (see D-045, D-050). This is the one seam
where the two sides meet.

## Execution lifecycle — one `POST /agent/chat` call

1. `requireAuth` resolves the real authenticated user from the JWT. This is the
   only identity that will ever be used — see docs/PART_B_SECURITY.md.
2. The router resolves a conversation: a given `conversationId` is ownership-checked
   (`getOwnConversationOrThrow` — cross-user guess → 404, same isolation convention
   as every other resource in this project) or a new one is created.
3. Prior messages are replayed from `AgentMessage` rows (capped at the most recent
   40 — see "Conversation persistence" below) and prepended with a fixed system
   prompt (`systemPrompt.ts`, never persisted, rebuilt fresh every turn) and the new
   user message.
4. `runAgentTurn` (packages/agent) runs up to 6 steps:
   - Calls the model via `callProviderWithRetry` (bounded backoff for transient
     failures — see docs/PART_B_RELIABILITY.md).
   - A `provider_error` that survives retries triggers the deterministic fallback
     (`core/fallback.ts`) before giving up.
   - A tool-calling response dispatches each call through `ToolRegistry` →
     `dispatchToolCall` (Zod-validates args, enforces a per-tool timeout, never lets
     a raw internal error reach the model) → the real `apps/api` executor, with a
     `ToolContext` built ONLY from the authenticated caller.
   - A final-answer response is schema-validated, citation-checked against
     records actually returned by tools this conversation (`core/grounding.ts`),
     and — once — repaired if either check fails.
5. The router persists every new message (user + whatever the loop produced) and
   returns a response envelope: `answer`, `citations`, `eventCards`,
   `pendingConfirmation`, `degraded`, `outcome`/`reason`, and a `toolExecutionSummary`
   built directly from the trace (so the UI can show real tool activity regardless
   of what the model's prose says).

## The seven tools — what each one actually calls

| Tool | Real service | Notes |
|---|---|---|
| `search_events` | `events.listPublicEvents` | `max_price` has no server-side filter in Part A's catalogue — applied tool-side on the already-fetched page (documented limitation: a page can return fewer than `limit` items after filtering). |
| `get_event` | `events.getPublicEventDetail` | 404s for a non-visible event exactly like the real HTTP route. |
| `get_reviews` | `reviews.listReviews` | Review `text` is returned completely verbatim — see docs/PART_B_SECURITY.md for why this is safe. |
| `hold_seats` | `holds.createHold` | Not confirmation-gated — Part A's own one-active-hold/8-ticket rules already bound the damage, and nothing about a hold is hard to reverse. |
| `purchase` | `orders.checkout` | Confirmation-gated (see docs/PART_B_SECURITY.md). Always uses the `"success"` payment scenario — there's no real card-data path anywhere in this app. |
| `cancel_order` | `refunds.requestRefund` | Confirmation-gated. The underlying service already fully enforces ownership, the staff self-refund restriction, and the refund window — the tool never duplicates or special-cases any of that. |
| `sales_summary` | `reports.getSalesSummary` | The tool resolves the caller's own `OrganiserMembership` itself, since `getSalesSummary` trusts its `organiserId` argument completely and has no middleware in the agent's call path. Zero memberships → permission error; more than one → `NEEDS_CLARIFICATION` with real organiser names, never a guess. |

## Conversation persistence

`AgentConversation` / `AgentMessage` (Prisma, migration
`20261031212037_add_agent_conversations`). A conversation's full message history
(including every past tool call/result) is replayed back as context on every turn,
capped at the most recent 40 messages (`MAX_REPLAYED_MESSAGES` in
`conversation.ts`) — a simple recency-window truncation, not summarization; a long
conversation's earliest exchanges simply age out rather than being compressed.
Documented as the honest scope of B3's "context limits" requirement — no token-
aware summarization was built.

Reference resolution ("the second one", "my order") works because the full tool
RESULTS (not just the model's prose) are replayed as `role: "tool"` messages — the
model sees the actual structured data it fetched earlier and can refer back to it.
This was verified with a real two-turn conversation in
`apps/api/test/agent/chat.test.ts`.

**A real bug found and fixed while building this**: `appendMessages` originally
used one `createMany` call inside a transaction, so every message in a turn shared
an identical `created_at` (Postgres freezes `now()` per transaction) with only
cuid2 ids — not reliably insertion-ordered — left to tie-break. A conversation
could replay its USER/ASSISTANT messages out of order. Fixed by assigning each row
in a batch an explicit, strictly increasing timestamp. Caught by a real
integration test, not by inspection.

## Known architectural limitations

- `max_price` filtering in `search_events` is tool-side, not server-side (above).
- No token-aware context summarization — simple recency truncation only.
- The in-memory rate limiter is process-local, not distributed-safe (see
  docs/PART_B_RELIABILITY.md).
- The Nemotron provider is tested with a mocked `fetch`, never against a real
  endpoint (no API key was used anywhere in this work, by design).
