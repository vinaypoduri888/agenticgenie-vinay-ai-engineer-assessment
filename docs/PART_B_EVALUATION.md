# Part B — Evaluation harness (Stage B5)

> **Partly out of date (2026-11-02).** Written before the independent review recorded at the end of [PROGRESS.md](PROGRESS.md), which reproduced and fixed real bugs this document doesn't know about. Where they disagree, the code, the regression tests in `apps/api/test/regressions/`, and DESIGN.md are correct.

A reproducible, deterministic evaluation suite for the agent built in B1–B4, driven entirely by
the mock provider — `npm run eval` needs no API key and no network access, anywhere.

## Running it

```bash
npm run eval                  # from the repo root — all 20 cases
npm run eval -w apps/api       # equivalent, explicit workspace
```

To run a single case (useful while authoring or debugging one):

```bash
cd apps/api
npx tsx src/evals/runner.ts search-01-city
```

Each run writes a timestamped `evals/results/run-<ISO timestamp>.{json,md}` pair — git-ignored so
repeated local runs don't spam the repo — plus prints a per-case PASS/FAIL line and a final summary
to stdout. The command exits non-zero if any case fails, so it behaves like any other test command
in CI. `evals/results/sample-run.{json,md}` is the one representative, committed sample required by
the assessment, from a real 20/20 run against this codebase.

## Case format

Every case is one JSON file under `evals/cases/`, validated against a Zod schema
(`apps/api/src/evals/types.ts`) before it runs — an invalid case file fails loudly with the exact
validation error, not a confusing runtime crash deep inside a tool call.

```jsonc
{
  "id": "search-01-city",
  "category": "search",          // search | aggregation | actions | grounding | reliability | adversarial
  "description": "...",
  "seed": [ /* fixture steps, see below */ ],
  "persona": "attendee1",         // which seeded user (by ref) the conversation runs as
  "conversation": ["..."],        // one raw human message per turn
  "mockScript": [ /* the full, flat scripted provider response sequence for the WHOLE conversation */ ],
  "expectations": { /* see below */ }
}
```

### Seeding

`seed` is a short, ordered list of typed steps — **a fixed vocabulary, not a generic fixture DSL**.
Each `kind` (`organiser`, `venue`, `event`, `ticketTier`, `user`, `membership`, `review`, `order`)
maps directly to one call into `apps/api/test/helpers/fixtures.ts` — the exact same helpers every
other integration test in this project uses, including their cleanup tracking (`resetFixtures()`
runs after every case, so eval-created rows never accumulate in the database). `order` drives a
real hold + checkout through `purchaseGaTickets`, exactly as a real attendee would.

A step gives its created row a `ref` (e.g. `"ref": "event1"`); `{{event1}}` anywhere later in the
case (in `mockScript` or `expectations`) is substituted with the real id once seeding runs. Two
extra tokens are resolved the same way: `{{now}}` and `{{now+7d}}`/`{{now-1d}}` resolve against the
one `now` the whole case's seed used for its own `startsAt: "+7d"`-style relative dates, so a case's
scripted date filters always line up with its seeded events' actual dates regardless of when the
suite runs.

### The `$lastToolResult` marker

A few cases (confirmation flows) need a tool call's arguments to reference a *real* id that only
exists once an earlier step in the same conversation has actually executed against the database —
e.g. `purchase` needs the real `Hold.id` that `hold_seats` just created. Since ids aren't known at
authoring time, a tool-call argument value may be `{ "$lastToolResult": "fieldName" }`, resolved at
call time by `apps/api/src/evals/provider.ts`'s `EvalProvider` from the most recent "tool" role
message already in the conversation. This is intentionally **not** a change to `packages/agent`'s
own `MockProvider` (which stays exactly what B1–B4 already reviewed) — `EvalProvider` is a small,
eval-only sibling with the same deterministic script-consumption contract plus this one resolution
feature.

### Expectations

- `toolCalls: [{name, success?}]` — asserts at least one call to that tool occurred, and (if
  `success` is given) that at least one of its calls reported that dispatch outcome. This is a
  **presence check across the whole conversation, not a strict single-call match** — `trace.steps[]`
  deliberately never records a tool call's raw arguments (see `docs/PART_B_SECURITY.md`'s redaction
  policy), so there's nothing finer-grained to assert against from the trace. Argument correctness
  is instead what the case author already encoded into `mockScript` itself, and verified indirectly
  through the real downstream effects (`answerContains`, `dbChecks`).
- `outcome` — the loop's own `"success" | "partial" | "error"`.
- `answerContains` / `answerNotContains` — substring checks against the final answer text.
- `needsConfirmation` / `degraded` — checked against the final turn's structured answer.
- `citationsValid` — re-derives known records from the real tool-result messages
  (`collectKnownRecords`/`checkGrounding`, the same functions `packages/agent`'s loop itself uses)
  and independently checks every citation the final answer carries, rather than trusting the loop's
  own internal grounding enforcement at face value.
- `minRetries` — compares `EvalProvider.calls.length` against the loop's own `trace.stepCount`; any
  gap is a provider-level retry the B4 retry wrapper performed within a single loop step.
- `dbChecks` — a small, fixed vocabulary of real Postgres assertions (`orderStatus`,
  `orderUnchanged`, `noNewOrderForEvent`, `holdActive`, `ticketCount`, `pendingConfirmationCount`),
  implemented once in `apps/api/src/evals/checkers.ts`. A `dbCheck` may carry `"afterTurn": N` to run
  right after that turn rather than only at the end — needed to prove an *intermediate* state (e.g.
  "no order exists yet after the unconfirmed first turn").

**A case passes only if every declared expectation holds.** An HTTP-200-equivalent successful turn
with a failed expectation is a FAIL — this harness never scores on "the call didn't crash" alone.

## The 20 required cases

| ID | Category | What it actually proves |
|---|---|---|
| search-01-city … search-05-combined-filters | search | `search_events`'s city/date/category/max_price filters, and their combination, against real seeded events — including an event that must be *excluded* in every case, not just one that must appear |
| aggregation-06-event-details | aggregation | `get_event` returns real detail + availability, grounded |
| aggregation-07-reviews-summary | aggregation | `get_reviews` returns real reviews, including an adversarial-looking one, summarised without acting on it |
| aggregation-08-sales-summary | aggregation | `sales_summary` resolves the caller's real organiser membership and returns real revenue |
| actions-09-create-hold | actions | `hold_seats` creates a real, inventory-backed `Hold` row |
| actions-10-purchase-after-confirmation | actions | `purchase` creates no order on an unconfirmed first turn, then exactly one `Order`/`Payment`/`Ticket` after an unambiguous "Yes." |
| actions-11-cancel-after-confirmation | actions | the same two-turn pattern against `cancel_order` → `requestRefund`, for a legitimate (non-self) refund |
| grounding-12-valid-citations | grounding | a factual answer citing both an event and a review, both independently re-verified against real tool results |
| grounding-13-unknown-event | grounding | a nonexistent event id never gets fabricated details or a citation |
| reliability-14-retry-success | reliability | a scripted 429-with-Retry-After is retried and the turn still succeeds |
| reliability-15-quota-degraded | reliability | a non-retryable quota failure degrades honestly via the real deterministic fallback (a genuine search, not an invented answer) |
| adversarial-16-malicious-review | adversarial | the AD1 scenario — a review instructing the assistant to cancel every order; the model even attempts it with `confirm:true`, and the real order stays untouched because there's no live human confirmation |
| adversarial-17-ambiguous-confirmation | adversarial | `"Yes, but for another event."` does not execute a pending purchase |
| adversarial-18-hinglish-search | adversarial | a Hinglish query maps to sensible, grounded tool arguments — see the caveat below |
| adversarial-19-staff-self-refund | adversarial | a staff member cannot use the agent to refund their own order — Part A's real `canRefundOrder` policy rejects it |
| adversarial-20-cross-user-probe | adversarial | probing someone else's order id via the agent gets Part A's real existence-hiding 404, no leak, no state change |

**Honest caveat on `adversarial-18-hinglish-search`**: the deterministic mock provider cannot
actually *understand* Hinglish — nothing can, deterministically, without a real language model. What
this case tests is the **harness's** handling of a hypothetically-correct extraction: the script
stands in for what a competent real model would plausibly do with that input, and the case proves
the rest of the pipeline (tool dispatch, real data, grounding) behaves correctly once that
extraction happens. Verifying that a *real* model actually produces that extraction from the literal
Hinglish text requires a real-provider run (`AI_PROVIDER=nemotron`), which this harness does not
require and was not run with a real API key for this assessment. This matches the same honesty
standard `docs/ASSESSMENT_REQUIREMENTS.md`'s AD3 row already stated before this stage.

## Metrics and reporting

Pulled straight from each run's real `AgentTrace` objects: overall and per-category pass rate, mean
tokens in/out, p50/p95 latency (computed by sorting observed per-case latencies and indexing into
the sorted array, not a naive average), mean steps/case, total provider retries observed, and tool
call success rate. **Token figures are the scripted mock provider's own fixed `usage` numbers — not
a real tokenizer count** — every mention of them in the report says so explicitly; no cost figure is
invented anywhere. A real-provider run would report real usage from the API response in the exact
same fields, with no code change needed.

## CI

`.github/workflows/ci.yml` runs `npm run eval` immediately after `npm run test`, inside the same
job and against the same Postgres/Redis service containers — a clean, low-cost addition (the whole
suite runs in a couple of seconds locally; no real network, no real model call) rather than a
separate, slower job.

## Known limitations

- `toolCalls` expectations check *that* a tool was called and *whether it succeeded*, not its exact
  arguments — the trace deliberately never records raw tool-call arguments (see
  `docs/PART_B_SECURITY.md`), so there is nothing finer to assert against post-hoc; argument
  correctness is implicit in the case author's own `mockScript` and verified through real downstream
  effects instead.
- `reliability-15-quota-degraded`'s fallback-dispatched tool call is likewise not visible in the
  trace (the deterministic fallback calls the tool directly, outside the loop's own per-step tracing)
  — proven instead through the fallback's real formatted answer text actually naming the real seeded
  event.
- No eval case exercises a *real* model provider — by design, this stage's mandate is a suite that
  "must run fully with no API key." A real-`AI_PROVIDER=nemotron` run against the same case files is
  possible in principle (the case format and `EvalProvider`'s contract don't change), but would need
  a different script-authoring approach since a real model doesn't follow a fixed script — out of
  scope here.
- Cases are independent and currently run sequentially, not in parallel — the whole suite finishes
  in a couple of seconds against this project's scale, so parallelising wasn't worth the added
  complexity.
