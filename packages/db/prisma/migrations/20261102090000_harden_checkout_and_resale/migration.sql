-- Hand-written: partial unique indexes Prisma's schema language can't express.

-- 1. A refunded seat must be resellable, so (event_seat_id) can no longer be
--    globally unique. The real invariant is "at most one VALID ticket per seat".
DROP INDEX "tickets_event_seat_id_key";
CREATE INDEX "tickets_event_seat_id_idx" ON "tickets" ("event_seat_id");
CREATE UNIQUE INDEX "tickets_one_valid_per_seat"
  ON "tickets" ("event_seat_id")
  WHERE "status" = 'VALID';

-- 2. Database-level backstop for the double-charge race: one order can have at
--    most one in-flight charge and at most one successful charge, whatever the
--    application layer does.
CREATE UNIQUE INDEX "payments_one_pending_per_order"
  ON "payments" ("order_id")
  WHERE "status" = 'PENDING';
CREATE UNIQUE INDEX "payments_one_succeeded_per_order"
  ON "payments" ("order_id")
  WHERE "status" = 'SUCCEEDED';

-- 3. The human-readable text a user is confirming, stored so the API reports
--    what is pending from the database rather than from anything the model said.
ALTER TABLE "agent_pending_confirmations" ADD COLUMN "summary" TEXT;
