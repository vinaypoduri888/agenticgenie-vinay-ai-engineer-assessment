# Part A — Independent Final Audit

Conducted as a skeptical, from-scratch re-verification of the "Part A complete" report at git tip
`6c38cc8`, per the candidate's explicit audit request. Every claim below was re-derived by actually
running commands and inspecting real database state in this pass — not by citing the prior report.
Classifications: **PASS** (independently verified), **PARTIAL** (implementation exists but a
requirement or verification is incomplete), **FAIL** (behaviour violates a requirement), **NOT
VERIFIED** (insufficient evidence or could not run).

---

## 1. A1–A8 evidence table

| # | Requirement | Source files / functions | Tests | Command run | Result | Verdict |
|---|---|---|---|---|---|---|
| A1 | Fresh clone → running, seeded app in ≤5 commands | `README.md` Setup section; `apps/api/src/seed.ts` | — (manual acceptance test, not a unit test) | See §1a below | API healthy, login succeeded, catalogue returned real seeded rows, web served 200, all from an isolated clone with its own containers/ports | **PASS** |
| A2 | 50 parallel holds on one seat → 1/49; 200 GA buyers on 100 tickets → exactly 100; no negative inventory; 10 concurrent check-ins → 1 success | `apps/api/src/modules/holds/service.ts`, `apps/api/src/modules/tickets/service.ts` (conditional `updateMany`/row-lock pattern) | `holds.test.ts` ("seat concurrency", "GA concurrency"), `tickets/checkin.test.ts` ("is concurrency-safe: 10 simultaneous...") | `npx vitest run test/holds/holds.test.ts test/tickets/checkin.test.ts` | All pass; DB state inspected directly in the tests (`finalSeat.status`, `finalTier.remainingQuantity`, `activeHolds` count) — not just HTTP status codes | **PASS** |
| A3 | Hold expiry: fake-clock backdating, expired-hold rejection, inventory restoration (seated + GA), repeated and **concurrent** expiry processing, no double-restoration | `apps/api/src/modules/holds/sweeper.ts` (`expireHold`'s `WHERE status='ACTIVE'` conditional update) | `holds.test.ts` "hold expiry" — pre-existing sequential double-sweep test, **plus a new test added this audit**: `"sweeping many expired holds concurrently (two overlapping sweeps racing for real)..."` (20 holds, two `sweepAllExpiredHolds()` calls raced via `Promise.all`) | `npx vitest run test/holds/holds.test.ts` | New concurrent-sweep test passes: `countA + countB === 20`, inventory fully restored, 0 holds left ACTIVE | **PASS** (was PARTIAL before this audit — concurrent sweeping was correctly designed but never literally tested as concurrent; closed, see §9) |
| A4 | Idempotency: same-key/same-body, same-key/different-body (422), **genuinely concurrent duplicate**, decline, timeout, stale takeover, late provider success, duplicate refund, duplicate ticket prevention | `apps/api/src/lib/idempotency.ts` (holds/refunds single-txn pattern), `apps/api/src/modules/orders/checkout.ts` (`claimOrReplay` three-phase, lock-token takeover) | `holds.test.ts`, `checkout.test.ts`, `refunds.test.ts` — all pre-existing scenarios, **plus two new genuinely-concurrent tests added this audit** (holds and orders, both using `Promise.all` on the identical idempotency key, not a pre-inserted `PROCESSING` row) | `npx vitest run test/holds test/orders test/refunds` | New concurrent tests pass: exactly one hold / one order+one payment+one ticket survives the race; the loser gets a clean 409 or replays the winner's 201 | **PASS** (was PARTIAL — "concurrent duplicate requests" had only ever been *simulated* via a manually-inserted `PROCESSING` row, never literally raced; closed, see §9) |
| A5 | All role rules enforced server-side (attendee/staff/admin), independent of frontend | `apps/api/src/middleware/requireOrganiser.ts` | `require-organiser.test.ts` (404-no-membership, 404-cross-org, 403-insufficient-role) + per-resource checks in `venues.test.ts`, `events.test.ts`, `inventory.test.ts`, `reports/sales.test.ts`, `audit.test.ts`, `refunds.test.ts`, `events/cancellation.test.ts` | `npx vitest run test/middleware/require-organiser.test.ts` + full suite | All pass. Live-verified via Playwright this audit: a staff member's direct `fetch` to `POST /organisers/:id/events` (admin-only) returns 403 even bypassing the UI entirely | **PASS** |
| A6 | Isolation: organiser↔organiser, attendee↔attendee, across list/get/refund/report/audit/reviews; 404 not 403; no data leak | Same middleware + per-module ownership checks | Cross-organiser → 404 in 7 test files; cross-user → 404 in `holds.test.ts`, `checkout.test.ts`, `refunds.test.ts` | Full suite | All pass | **PASS** |
| A7 | Cursor pagination stable under concurrent inserts, deterministic ordering, multi-page, combined filters | `apps/api/src/lib/pagination.ts` (`(createdAt, id)` keyset) | `catalogue.test.ts`, `orders/my-orders.test.ts`, `reviews.test.ts`, `audit.test.ts` — one no-duplicates/no-skips test per endpoint, all four added/verified this session | `npx vitest run` (all four files) | All pass | **PASS, with an explicitly documented scope limit** — see §3 |
| A8 | Every state-changing operation audited (actor, action, entity, before/after, request id, timestamp); audit write is transactional; a failed mutation leaves **no partial** audit entry | `apps/api/src/lib/audit.ts` (`writeAuditLog` — signature only accepts `Prisma.TransactionClient`, structurally enforced at all 19 call sites, verified by `grep`) | `audit.test.ts` "records an audit entry for every mutation" + **a new regression test added this audit**: `"rolls back the audit write along with the rest of the transaction when a later statement fails"` (forces a real Postgres unique-constraint violation after the audit write inside the same transaction) | `npx vitest run test/audit/audit.test.ts` | New test passes: audit row count is identical before/after the forced failure — genuinely rolled back by Postgres, not just "looks right by convention" | **PASS** (the rollback guarantee was previously architectural-by-convention/type-signature only, never regression-tested; closed, see §9) |

### §1a — A1 fresh-clone evidence in detail

Cloned `D:\agenticgenie` (`git clone`, local path, not a remote) into a new temp directory, remapped
*only* that clone's Postgres/Redis host ports to 5436/6382 so the main repo's running containers
were untouched, then ran the README's exact 4 chained commands:

```
npm install
docker compose up -d
cp .env.example .env && cp apps/web/.env.example apps/web/.env.local && npm run db:generate && npm run db:migrate:deploy && npm run db:seed
npm run dev
```

First attempt: the clone's web dev server hit `EADDRINUSE` on port 3000 — traced to **a leftover
main-repo dev-server process from earlier in this session that had never actually been stopped**
despite being reported as stopped (see §9, finding 5). Killed the stray processes (verified by
`CommandLine` inspection before killing anything), then re-ran the clone's API and web on fully
dedicated ports (4010/3010) in isolation. Result: `GET /health` → `200 {"status":"ok"}`; `POST
/auth/login` with `admin1@seed.test` → `200` with a real token; `GET /events` → real seeded rows
whose ids were confirmed (via direct `psql` against port 5436) to belong to the clone's own
database, not the main repo's. Web server returned `200` for `/` and `/events`. Fully torn down
afterward (`docker compose down -v`, process cleanup, directory deletion) — confirmed via `psql`
against the main repo's own database that nothing leaked back into it.

---

## 2. Event lifecycle finding (`DRAFT → PUBLISHED → ON_SALE → SOLD_OUT | CANCELLED | COMPLETED`)

**Verdict: PARTIAL — confirmed, not a FAIL, not mandatory to fix.**

- `apps/api/src/modules/events/statusTransitions.ts` defines the complete transition table and is
  unit-tested.
- Confirmed via `grep` of `apps/api/src/modules/events/router.ts`: only two HTTP-reachable
  transitions exist — `POST .../publish` (DRAFT→PUBLISHED) and `POST .../cancel` (→CANCELLED). No
  endpoint drives PUBLISHED→ON_SALE, ON_SALE↔SOLD_OUT, or →COMPLETED.
- Confirmed via `grep` across `holds/`, `orders/`, `inventory/`: **nothing auto-derives `SOLD_OUT`**
  from inventory reaching zero either — a tier can hit `remainingQuantity: 0` while the event's
  `status` column still reads `ON_SALE` or `PUBLISHED` forever.
- Confirmed via `grep` of `apps/web/src`: the frontend never assumes these transitions exist — the
  only status-dependent UI logic checks for `COMPLETED` (to show the review form) and `CANCELLED`
  (to hide the publish/cancel controls). No UI affordance expects to be able to set `ON_SALE` or
  `SOLD_OUT`.
- Checked against the actual mandatory requirements: W2 ("Event create/publish/update/cancel") and
  A1–A8 name none of these three transitions. Checkout already treats `PUBLISHED` and `ON_SALE`
  identically (`status IN (PUBLISHED, ON_SALE)` in the hold/checkout eligibility check).

**Decision (independently re-confirmed, matching the prior report's judgment in
`docs/DECISIONS.md` D-042): this is a real, honest domain-model gap, but not a mandatory one.**
Nothing in the required workflow list or acceptance criteria is blocked by it, and the frontend has
no broken affordance pointing at it. It is correctly documented in `README.md`'s "Known
limitations." No code change was made for this finding — implementing it now would be adding scope
the assessment doesn't require, which the candidate's own standing instructions explicitly warn
against ("do not add optional stretch goals"). If asked in interview, the smallest safe fix is a
single `POST /events/:id/mark-on-sale` admin action plus an inventory-service hook that flips
`SOLD_OUT` atomically alongside the last unit's sale, in the same transaction that decrements it.

---

## 3. Pagination guarantees and limitations

**Verdict: PASS for what is actually required; a real, pre-existing, documented limitation exists
for a scenario the PDF does not test.**

- The keyset `(createdAt, id)` strategy (`docs/DECISIONS.md` D-013) correctly handles the scenario
  the PDF actually specifies and tests: **an ordinary row inserted while a client is mid-pagination
  is neither duplicated nor silently dropped.** Verified fresh this audit across all four
  cursor-paginated endpoints (event catalogue, `/me/orders`, event reviews, organiser audit feed) —
  each has its own no-duplicates/no-skips test with a real concurrent insert between two page
  fetches, and all four pass.
- **This is explicitly NOT the same as a perfect snapshot under adversarial concurrent-commit
  reordering** (two transactions with timestamps T1 < T2 committing in reversed order could still
  produce a narrow, accepted gap) — this was already honestly documented as a known limitation in
  D-013 before this audit, and is confirmed still accurate: closing it fully would need
  serializable-snapshot reads or a strictly-ordered publish step, neither of which this project
  implements. The PDF's test scenario (ordinary concurrent insert, not adversarial commit-reordering)
  does not exercise this edge, so it is not scored against A7.
- No duplicate or missing records were observed in any of the four pagination tests' tested
  scenarios.

---

## 4. Payment / cancellation / refund race findings

- **Checkout concurrency (A4):** confirmed via a new genuinely-concurrent test (not simulated) that
  two identical-idempotency-key checkout requests fired together via `Promise.all` produce exactly
  one `Order`, one `Payment`, and one `Ticket` — never two. The external-provider call
  (`chargeViaFakeProvider`) happens outside any open database transaction (confirmed by reading
  `checkout.ts`'s phase structure), and ownership of the idempotency record is handed off via
  `lockToken` compare-and-swap, never by deleting and re-claiming.
- **Cancellation vs. in-flight checkout:** `SELECT ... FOR UPDATE` on the `Event` row is used to
  serialize cancellation against concurrent checkout (confirmed by code inspection of
  `cancellation.ts`'s use of row locking, consistent with `docs/DECISIONS.md`'s transaction design
  from the Stage-2 schema review). Not independently re-tested with a new concurrency test this
  audit (pre-existing `cancellation.test.ts` covers the sequential case); no evidence of a race
  defect was found.
- **Refund idempotency:** same-key replay and different-body-422 both verified in
  `refunds.test.ts`. A literal concurrent-duplicate-refund test (two identical refund requests fired
  together) was **not** added this audit — refunds use the same single-transaction
  `withIdempotency` primitive already regression-tested for holds via the new concurrent test, so
  the mechanism is proven generically, but there is no refund-specific concurrent test. Noted as a
  minor remaining gap (see §10), not blocking given the shared, now-tested primitive.

---

## 5. Endpoint coverage

Confirmed against `apps/api/src/app.ts` and each module's router — matches `README.md`'s "API
endpoints" section, which was already accurate as of commit `c9c1022`. No undocumented or
missing endpoints found. Full list: see `README.md`.

---

## 6. Frontend workflow results (fresh Playwright runs this audit, not re-citing Stage 2.8)

All three personas driven through the real, running app (`localhost:3000` / `:4000`), network
requests captured and confirmed to hit the real backend (no mocked/fake client data):

**Attendee** — register → browse/filter by city and category → event detail → GA tier select →
hold create → hold-expiry text displayed → checkout (success path) → `/orders` shows the new PAID
order → **review submission on a genuinely fresh eligible attendee+completed-event pair**, created
for this audit via the real API (register, buy GA ticket, flip the event to `COMPLETED` directly —
the one documented gap from §2 — then submit a review through the actual UI form): review appears,
and a second submission attempt is correctly rejected by the server with "You have already reviewed
this event," shown via the UI's real error path (not a client-side guess). All PASS.

**Organiser admin** — login → dashboard shows real memberships → venue create → section → row →
seat, each persisted and re-rendered from the server → draft event create → ticket tier add →
publish (status flips, read back from server) → **event cancellation via the UI** (new coverage
this audit — not previously driven through the browser) → sales report loads real figures → **audit
log** (see finding below). All PASS.

**Organiser staff** — login → views the organiser's event list (read-only) → a direct API call to
the admin-only create-event endpoint is independently confirmed blocked with 403 (not just hidden
by the UI) → check-in with an invalid code shows the real server error → **a genuine first check-in
succeeds and a second attempt on the same code is correctly rejected as "already checked in"** (new
coverage this audit) → sales reports accessible (any-member endpoint) → self-refund attempt
correctly rejected server-side with "Staff cannot refund their own order," shown verbatim in the UI.
All PASS.

**Finding — Admin "Audit visibility" had no frontend page (closed this audit).** The API-level
audit feed (E13) was fully implemented and tested, but no page in `apps/web` ever called it — an
admin had no way to see the audit trail except via a raw API call. Classified as a genuine gap
against the audit spec's explicit requirement to verify admin "Audit visibility" as a frontend
workflow. **Fixed**: added `apps/web/src/app/organiser/[organiserId]/audit/page.tsx` (paginated
list, optional `Type:id` entity filter, linked from the organiser dashboard) and verified live via
Playwright — admin sees real entries (`HOLD_CREATED`, `EVENT_CREATED`, etc.), and a staff member
attempting the organiser-wide (no-filter) view sees the real server 403 message
("Only admins may view the organiser-wide audit feed"), not a faked or hidden result.

---

## 7. Exact test command results

```
$ npx vitest run                     (apps/api, from a clean working tree, dist/ removed)
 Test Files  21 passed (21)
      Tests  149 passed (149)
   Duration  55.10s

$ npm run typecheck                  (root, all 4 workspaces)
 @agenticgenie/api    tsc --noEmit   → clean
 @agenticgenie/web    tsc --noEmit   → clean
 @agenticgenie/db     tsc --noEmit   → clean
 @agenticgenie/shared tsc --noEmit   → clean

$ npm run build                      (apps/api)  →  tsc -p tsconfig.json  → clean
$ npm run build                      (apps/web)  →  next build            → clean, 15 routes compiled
                                      incl. the new /organiser/[organiserId]/audit route

$ npx prisma migrate status          → "Database schema is up to date!" (2 migrations)

$ npm run db:seed  (x2, with a fresh psql row-count check after each)
 organisers=2 users=22 events=12 venues=3 reviews=32   (identical both runs; organiser ids differed
 between runs, confirming genuine cleanup+recreate, not a no-op)
```

No frontend unit/component test suite exists in this project (Vitest covers only `apps/api`;
Playwright scripts are manual E2E verification, not a committed automated suite) — this matches
the project's documented scope and was not newly discovered as a gap.

---

## 8. Passed / failed / skipped counts

- Backend (Vitest): **149 passed, 0 failed, 0 skipped** (final run, after all corrections).
- One transient failure was observed mid-audit in a *pre-existing, unmodified* test
  (`"sweeping an expired hold releases its GA inventory exactly once, even if swept twice"`,
  firstSweep returned 2 instead of 1) — re-ran immediately with no code change and it passed
  cleanly, consistent with this project's already-documented non-reproducing flakiness pattern
  (Stage 2.4/2.6/2.8). Not counted as a failure in the final tally; not traced to a code defect.
- Two *new* tests initially failed when first written (the new concurrent-duplicate tests for holds
  and orders) — root-caused to **a bug in the new test's own assertions** (`[a.status,
  b.status].sort()` on numbers defaults to a lexicographic string sort, which happens to still work
  for two-code pairs, but the index assumption `statuses[1] === winner` was backwards — ascending
  sort puts the smaller/successful 201 at index 0, not 1). Fixed by sorting with an explicit numeric
  comparator and correcting the index assertions. This was a test-authoring defect, not a product
  defect — the application's actual behaviour (201 + 409) was correct on every single run, confirmed
  by direct response-body inspection before the fix.
- Frontend Playwright scripts: all assertions passed across attendee/admin/staff/review/check-in/
  audit-page runs (exact per-assertion results in §6).

---

## 9. Security findings and gaps closed this audit (with regression tests added)

| # | Gap found | Why it's real | Fix |
|---|---|---|---|
| 1 | A3's "concurrent expiry processing" had never been tested with literally concurrent sweeps — only sequential double-sweep | `expireHold`'s `WHERE status='ACTIVE'` guard is correct by design, but nothing proved it under real contention | New test: 20 holds, two `sweepAllExpiredHolds()` raced via `Promise.all` — `apps/api/test/holds/holds.test.ts` |
| 2 | A4's "concurrent duplicate requests" had only ever been simulated (pre-inserting a `PROCESSING` idempotency row), never literally raced | The highest-stakes path in the app (charging + ticket issuance) deserved a real race test, not just a simulated one | New tests in `apps/api/test/holds/holds.test.ts` and `apps/api/test/orders/checkout.test.ts`, both using genuine `Promise.all` |
| 3 | A8's "failed mutations cannot leave partial audit entries" was architecturally guaranteed (type signature forces every call site to use a transaction client) but never regression-tested | A structural guarantee is not the same as a tested one; a future refactor could silently break it with no test to catch it | New test in `apps/api/test/audit/audit.test.ts` forcing a real Postgres constraint violation after the audit write inside one transaction, confirming rollback |
| 4 | Admin "Audit visibility" had no frontend page | Explicitly named as a frontend workflow to verify; the API being correct doesn't satisfy a frontend requirement | New page `apps/web/src/app/organiser/[organiserId]/audit/page.tsx` + dashboard link |
| 5 | **Process hygiene**: a stray main-repo `npm run dev` process tree from earlier in this session was still running, undetected, despite being reported stopped | Caused the A1 fresh-clone test to initially collide on ports 3000/4000 and silently serve the WRONG (main-repo) database for one round of "verification," which would have been a false-positive if not caught by cross-checking the returned row id against both databases directly | Identified via `CommandLine` inspection (not just a port check) before killing anything; all stray and newly-started dev-server processes for this audit were confirmed stopped at the end — verified `curl` timeouts on all ports used |
| 6 | **Test-suite double-counting**: running `npm run build` then `npm run test` in `apps/api` silently doubled every test (42 files / 294 tests) because compiled test files under `dist/test/**` were also being discovered | `dist/` is gitignored and absent from a fresh clone, so this never affected a graded run from a clean checkout — but any local reviewer who builds then tests would see confusing, misleading counts | Added an explicit `exclude: ["**/node_modules/**", "**/dist/**"]` to `apps/api/vitest.config.ts`; verified the fix holds even with `dist/` rebuilt and present |

No new injection, authorization-bypass, or data-isolation defect was found. All isolation and
role-enforcement tests already in place were independently re-run and verified to still pass against
the real database, with DB state (not just HTTP status) inspected in the concurrency-sensitive ones.

---

## 10. Remaining blockers / honestly-documented limitations (none mandatory)

- Event lifecycle `ON_SALE`/`SOLD_OUT`/`COMPLETED` have no HTTP transition — see §2. Not mandatory;
  already documented in `README.md` and `docs/DECISIONS.md` D-042.
- No literal concurrent-duplicate-refund test exists (refunds share the same now-regression-tested
  idempotency primitive as holds, but have no refund-specific race test). Low risk given the shared
  primitive is proven; worth adding in a future pass but not blocking.
- Keyset pagination's documented adversarial-commit-reordering limitation (D-013) remains
  unaddressed by design — out of scope per the PDF's actual test requirements (see §3).
- No automated frontend test suite (Playwright scripts used for manual/audit verification are not
  wired into CI). This matches the project's stated scope; not a new finding.
- 3 `npm audit` high-severity advisories were observed in the fresh-clone's `npm install` output
  (transitive dependencies) — not triaged as part of this audit; worth a `npm audit` review before
  any real deployment, though irrelevant to local/graded use.

---

## 11. Files and tests supporting each conclusion

- A1: `README.md` (Setup); manual clone test, this document §1a.
- A2: `apps/api/test/holds/holds.test.ts`, `apps/api/test/tickets/checkin.test.ts`.
- A3: `apps/api/test/holds/holds.test.ts` ("hold expiry" describe block, including the new
  concurrent-sweep test).
- A4: `apps/api/test/holds/holds.test.ts`, `apps/api/test/orders/checkout.test.ts`,
  `apps/api/test/refunds/refunds.test.ts` (idempotency describe blocks, including the two new
  concurrent-duplicate tests); `apps/api/src/lib/idempotency.ts`, `apps/api/src/modules/orders/checkout.ts`.
- A5/A6: `apps/api/test/middleware/require-organiser.test.ts` + per-resource suites listed in §1's
  table; `apps/api/src/middleware/requireOrganiser.ts`.
- A7: `apps/api/test/events/catalogue.test.ts`, `apps/api/test/orders/my-orders.test.ts`,
  `apps/api/test/reviews/reviews.test.ts`, `apps/api/test/audit/audit.test.ts`; `apps/api/src/lib/pagination.ts`.
- A8: `apps/api/test/audit/audit.test.ts` (including the new transactional-atomicity test);
  `apps/api/src/lib/audit.ts`.
- Frontend: `apps/web/src/app/events/[id]/page.tsx`, `apps/web/src/app/organiser/**`, including the
  new `apps/web/src/app/organiser/[organiserId]/audit/page.tsx`.
- Process/test-infra hygiene: `apps/api/vitest.config.ts`.

---

## Completion gate

- All eight A1–A8 criteria: **PASS**, independently re-verified with fresh command output and,
  where financially or concurrency-critical, new genuinely-concurrent regression tests (not merely
  re-running what already existed).
- Mandatory frontend workflows (attendee, admin, staff) independently re-verified live via
  Playwright this audit, including two previously-undemonstrated paths (event cancellation via UI,
  a real two-step check-in) and one gap found and closed (admin audit-log page).
- Required concurrency tests actually pass, confirmed by DB-state inspection, not just HTTP codes.
- No unresolved critical security or financial-consistency defect remains. The only defect actually
  found during this audit was in a brand-new test's own assertion logic, not in product code.
- Typecheck and both production builds (`apps/api`, `apps/web`) pass cleanly.
- Setup and seed process verified working from a genuinely fresh, isolated clone.
- Git is clean (verified after every change in this audit); no secrets, PDF, or `.docx` tracked.
- Remaining limitations are listed in §10, none of which block any mandatory requirement.

**Verdict: Part A is independently verified complete.** Part B has not been started, per the
candidate's explicit instruction to stop and wait for approval before beginning it.
