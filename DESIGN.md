# Design notes

## Key trade-offs

**Inventory and concurrency.** Postgres is the only source of truth. A seat hold is a conditional `UPDATE ... WHERE status = 'AVAILABLE'`; a GA hold is `UPDATE ... WHERE remaining_quantity >= qty`, backed by a CHECK constraint. No read-then-write, no counts in memory. I chose conditional updates over `SELECT FOR UPDATE` on inventory because the row lock lasts one statement, so a losing buyer fails fast with a clean 409. Partial unique indexes back this up: one active hold per user per event, one VALID ticket per seat, one in-flight and one successful payment per order.

**Hold expiry.** Lazy on read (event detail, seat list, new hold, checkout), plus a 30-second in-process sweep so the catalogue doesn't drift when nobody is reading. Both are safe to run concurrently, because releasing is guarded by `WHERE status = 'ACTIVE'`. Redis and BullMQ are provisioned but unused: the job is repeatable and idempotent, so a queue would add a moving part without adding a guarantee.

**Idempotency storage.** A row per (user, key, endpoint) holding a body hash, status and stored response. A replay returns the stored response; a different body gets 422. Holds and refunds claim the key in the same transaction as the work, so a stale claim provably did nothing. Checkout can't, because a transaction must not stay open across the payment call, so it uses a lock token with compare-and-swap takeover.

**Payment timeouts.** Checkout has three phases: a transaction to create the order and payment attempt, the provider call with no transaction open, and a transaction to record the outcome. A timeout returns 202 with the order still `PENDING_PAYMENT` and the key unresolved. It can't stay "maybe paid": a retry with the same key, the sweep, or the user's next `GET /me/orders` asks the provider and settles it. While unresolved, another key can't charge the same hold. If a charge succeeds but the hold has since expired or the event was cancelled, the order is refunded automatically, because its inventory is gone. That conditional check on the hold in the last phase is what prevents overselling; everything before it is only there for a better error message.

**Auth shortcut.** One 12-hour JWT holding only the user id, kept in `localStorage`. Roles are read from the database on every request, so a demotion takes effect immediately. No refresh tokens, password reset or login rate limit.

**Injection defence, in layers.** Prompt wording is the weakest layer, since a model can be talked out of it, so nothing depends on it:
1. *Separation:* tool results arrive as their own role, and only the model's structured tool calls can execute anything. Identity comes from the session and is never an argument.
2. *Privilege separation:* after reading reviews, the loop refuses every side effect for the rest of that turn. After reading an event description, purchase and cancel may ask but not execute. A fooled model has nothing to spend.
3. *Confirmation in code:* money moves only if a pending row exists for that exact target, was created before this turn, and the human's raw message passes a strict allowlist. The model's `confirm: true` isn't even an input.
4. *Output checks:* citations are checked against records tools actually returned and removed from the text if invented; rupee figures no tool returned are masked; a claim of a completed booking that didn't happen is replaced. Confirmation state and `actionTaken` come from the database and tool results, not the model.
5. *Flagging:* a regex flags instruction-like text to the user. It's bypassable by design and blocks nothing.

**Mocked or simplified.** Payments are a fake provider with an in-memory ledger, which a restart loses, so a timed-out charge would then settle as a decline; a real provider has a status API. Demo mode's "model" is a small pattern matcher, kept apart from the scripted eval mock. Organisers are created only by the seed script.

## Known gaps and risks

What breaks first in a real on-sale rush: checkout takes a row lock on the event in two phases, which serializes all checkouts for one event. Holds don't take it, so holds should scale much further than checkouts. I haven't load tested this, so that's reasoning rather than a measurement.

Other known gaps: tests share the demo database (re-seed afterwards, since they consume the seed's expired hold). There's no browser test suite in CI; UI flows were checked by hand. The chat rate limiter is per process. Idempotency rows are never purged. Catalogue text search is an unindexed `ILIKE`, ordered by creation date. The figure guard only checks amounts written with ₹, so "500 rupees" isn't verified. An uncited answer is flagged and sent for one repair, not blocked. Demo mode doesn't handle "make it 3 seats"; only a real model can.

**Real model results.** On a small local model (`qwen3.5:9b` through Ollama, one run), 12 of 23 cases pass, with a mean score of 0.855: [report](evals/results/real-model-run.md). All the permission, isolation and injection cases in that run pass, and nothing was bought or refunded without confirmation. The failures are mostly the model's: repeated searches that use up the step limit, a malformed `limit`, listing two of three matches, not finishing a purchase after "yes". The mock run is 31 of 31, but its responses are scripted, so it tests the harness rather than language understanding.

## Another week, in priority order

1. A k6 on-sale test, then decide from its numbers whether to take the event lock out of checkout's last phase. It's the biggest unmeasured risk.
2. Playwright smoke tests in CI, since every serious UI bug here was found by driving the app.
3. A separate test database, and row-level security as a second isolation layer.
4. Repeated real-model eval runs with confidence intervals, since one run of a small local model is thin evidence.
5. A proper reconciliation job with alerting on anything older than a few minutes.

## Running it in production

**Observability.** Every turn already emits one structured line with request id, per-step tokens and latency, retries, tool outcomes and guard events, with no arguments or message content. I'd export those as spans alongside DB timings. Alerts: API 5xx rate; checkout p95; **any** event where sold plus remaining differs from capacity (page someone); payments unresolved past five minutes; tokens per turn; refusal rate; guard-event rate, since a spike means an attack or a bad model; eval score drift on a nightly run.

**Cost controls.** Per-turn step and token budgets exist and are enforced. Next: per-user and per-organiser daily budgets; prefix caching for the system prompt and tool schemas; projecting tool results down to the fields the model needs; history summarisation; a provider kill-switch that falls back to the deterministic paths.

**Model routing.** The provider interface and env config make this a small change. Send simple lookups to a small model, and escalate on low confidence, tool errors or failed grounding. Fall back across providers only after retries, with a circuit breaker. A model change ships only if the eval suite holds or improves on accuracy, tokens and p95, compared across repeated runs.

**Safety.** Money-moving actions already need a server-verified human yes tied to one hold or order. Add a virtual waiting room and per-account hold limits for high-demand on-sales, with bot detection in front. The audit log is append-only at the application layer and written in the same transaction as each change; a database trigger would make that stronger. For PII: traces carry no message content or tool arguments, attendee lists are organiser-scoped, and I'd add retention limits on conversations, since they can contain personal details.
