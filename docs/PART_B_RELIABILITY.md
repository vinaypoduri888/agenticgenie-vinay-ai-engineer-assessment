# Part B — Reliability

> **Partly out of date (2026-11-02).** Written before the independent review recorded at the end of [PROGRESS.md](PROGRESS.md), which reproduced and fixed real bugs this document doesn't know about. Where they disagree, the code, the regression tests in `apps/api/test/regressions/`, and DESIGN.md are correct.

## 1. Retry policy (provider calls only — never tool execution)

`packages/agent/src/providers/retry.ts::callProviderWithRetry` wraps every call to
`ModelProvider.complete()`. Classification is carried on the response itself
(`ProviderResponse.kind === "provider_error"`, with a `category`):

| Category | Retried? | Notes |
|---|---|---|
| `rate_limited` (429) | Yes | Honors a provider-supplied `retryAfterMs` (parsed from a numeric `Retry-After` header in `NemotronProvider`) instead of computing its own backoff. |
| `server_error` (5xx) | Yes | Bounded exponential backoff with full jitter. |
| `timeout` | Yes | Same backoff. |
| `network` | Yes | A thrown `fetch` rejection is classified as this, never left to crash the turn. |
| `quota_exceeded` (treated as 402/403 by `NemotronProvider`) | **No** | Retrying a billing failure wastes the turn's time budget on something that cannot succeed. |
| `auth_error` (401/403) | **No** | Same reasoning — permanent for this turn. |
| A plain `malformed` response (no choices, unparseable tool-call JSON, unclassified HTTP status) | No (handled separately — see below) | Not retried by this wrapper at all; the loop's own one-shot repair-then-degrade path handles it, since there may be real model `content` worth trying to fix rather than just re-asking. |
| Invalid tool arguments, permission denials, user validation errors | N/A — not provider failures | These happen at tool dispatch, not provider call; they are never retried (retrying a 403 or a bad argument can't help). |

Retries are bounded by both an attempt cap (`maxAttempts`, default 4) **and** a
wall-clock deadline (`deadlineMs`, default 30s) — whichever is hit first stops
retrying, so a provider stuck returning 429s can never make a turn hang
indefinitely. Verified in `packages/agent/test/retry.test.ts` (8 tests) and
end-to-end through the real HTTP endpoint in
`apps/api/test/agent/chat-reliability.test.ts`.

## 2. Provider failure handling

- **Timeout / network / 5xx**: retried per the table above; if retries are
  exhausted, the loop treats it as "provider unavailable" and tries the
  deterministic fallback (below) before degrading honestly.
- **Quota-exceeded / auth**: never retried, goes straight to fallback/degrade.
- **Malformed JSON**: one bounded repair attempt (re-prompt with an explicit
  correction instruction), shared with the grounding-repair path — a model gets
  one correction chance total per turn, not one per failure type, so a
  persistently broken model can't consume the whole step/token budget retrying
  itself.
- **The mock provider needs no API key** — it's the default (`AI_PROVIDER=mock`)
  and is what every automated test in this project runs against. Switching to
  Nemotron is a startup-time configuration choice
  (`apps/api/src/modules/agent/provider.ts`) that fails loudly if misconfigured,
  rather than silently falling back to mock.
- **Never silently invents a successful result.** Every stop condition (step
  limit, token budget, unrepairable malformed output, provider unavailable with
  no fallback match) returns a typed `partial`/`error` outcome with no `answer`
  field at all — a caller cannot accidentally display a fabricated response,
  because there isn't one to display.

## 3. Tool execution reliability

- Input validation, a per-tool timeout (`Promise.race`, default 10s, tool-level
  overrides for `hold_seats`/`purchase`/`cancel_order`), a structured
  success/error result, and safe error mapping (`ToolError` → a code + safe
  message, never a raw stack trace) were all built in B1 and are unchanged
  structurally in B2–B4; see `packages/agent/src/tools/dispatch.ts`.
- **Tool calls are never blindly retried by the harness** — a retried
  `purchase`/`cancel_order` could double a financial side effect. Side-effect
  safety comes entirely from idempotency key reuse (Part A's own primitives for
  `hold_seats`'s accidental-duplicate case, and the confirmation-stored key reuse
  for `purchase`/`cancel_order` — see docs/PART_B_SECURITY.md), never from
  retry-suppression logic in the loop.
- Real Part A idempotency mechanisms are reused as-is, not reimplemented:
  `createHold`/`checkout`/`requestRefund` are called exactly as Part A's own HTTP
  routes call them.

## 4. Deterministic fallback

`packages/agent/src/core/fallback.ts::runDeterministicFallback` — when the
provider is unavailable after exhausting retries, a small table of plain,
confidently-matchable intents is tried against the raw user message, calling the
matching tool DIRECTLY (same registry, same authorization, same validation path a
model-driven call would use) and formatting a templated response, always marked
`degraded: true`.

**Implemented**: "search/show/find events [in <city>]" → `search_events`.

**Honestly NOT implemented**, and why:
- "Show event details" / "display ticket tiers" — these need a specific event id
  this fallback has no reliable way to resolve from free text alone (that's
  reference resolution, which genuinely needs the model). Guessing would be worse
  than not trying.
- "Show my orders" — not one of the seven required tools at all; inventing an
  eighth tool just for the fallback path would be scope creep, not a fix for a
  real gap.
- **Never** covers a side-effecting tool (`hold_seats`/`purchase`/`cancel_order`)
  — the fallback path must never create a side effect or bypass confirmation,
  full stop.

Verified end-to-end through the real HTTP endpoint in
`apps/api/test/agent/chat-reliability.test.ts`: a provider forced to
`quota_exceeded` still returns a real event found via a real database query, with
`degraded: true` in the response.

## 5. Final response validation

`finalAnswerSchema` (`packages/agent/src/providers/types.ts`) — every model
response that claims to be final is parsed and schema-validated before the loop
accepts it, covering: `answer` text, `citations`, `eventCards`, `actionTaken`,
`needsConfirmation` + `pendingConfirmation` detail, and `degraded`. One bounded
repair attempt is allowed per turn (shared with the grounding-repair path, not a
separate budget) before the turn is degraded rather than passed through broken.

## 6. Rate limiting

`apps/api/src/modules/agent/rateLimiter.ts` — a simple per-user sliding window (20
requests/minute), applied only to `POST /agent/chat`. **Honestly documented
limitation**: this is process-local (an in-memory `Map`), not distributed-safe — a
multi-instance deployment would let each instance enforce its own independent
limit. Redis is provisioned in this project but genuinely unused elsewhere (see
docs/DECISIONS.md); building a Redis-backed limiter for one endpoint in this
stage would be infrastructure the assessment doesn't call for. Verified with a
real test that actually trips the limit
(`apps/api/test/agent/chat-reliability.test.ts`).

## Known gaps

- No token-aware context summarization (simple recency-window truncation at 40
  messages instead — see docs/PART_B_ARCHITECTURE.md).
- `NemotronProvider` is tested only against a mocked `fetch`; no real endpoint was
  ever called (by design — zero API key used anywhere in this work).
- The rate limiter is process-local (above).
