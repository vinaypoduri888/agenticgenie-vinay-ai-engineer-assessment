-- Hand-written migration: PostgreSQL-specific constraints Prisma's schema
-- language cannot express (CHECK constraints, a filtered/partial unique
-- index). Kept in a separate migration from the Prisma-generated one so the
-- generated SQL stays untouched and this file is easy to review on its own.
-- Rationale for each constraint is recorded in docs/DECISIONS.md.

-- 1. GA inventory can never go negative or exceed what was configured. This
--    backs the atomic conditional UPDATE used for GA-tier concurrency
--    (UPDATE ... SET remaining_quantity = remaining_quantity - :qty WHERE
--    remaining_quantity >= :qty) with a DB-level invariant, not just app logic.
ALTER TABLE "ticket_tiers"
  ADD CONSTRAINT "ticket_tiers_remaining_quantity_bounds"
  CHECK ("remaining_quantity" >= 0 AND "remaining_quantity" <= "total_quantity");

-- 2. "One active hold per user per event" — a FILTERED unique index, since
--    the same user may hold the same event again once a prior hold has
--    expired, been released, converted, or been cancelled. Prisma's
--    @@unique cannot express the WHERE clause.
CREATE UNIQUE INDEX "holds_one_active_per_user_event"
  ON "holds" ("event_id", "user_id")
  WHERE "status" = 'ACTIVE';

-- 3. A hold is either SEATED (no GA fields) or GA (both GA fields present) —
--    never a mix, never neither when kind = 'GA'.
ALTER TABLE "holds"
  ADD CONSTRAINT "holds_ga_fields_match_kind"
  CHECK (
    ("kind" = 'GA' AND "ga_ticket_tier_id" IS NOT NULL AND "ga_quantity" IS NOT NULL)
    OR
    ("kind" = 'SEATED' AND "ga_ticket_tier_id" IS NULL AND "ga_quantity" IS NULL)
  );

-- 4. An EventSeat only carries a hold_id while it is actually HELD — closes
--    off the possibility of a dangling hold reference on an AVAILABLE/SOLD
--    seat, or a HELD seat with no hold to point back to.
ALTER TABLE "event_seats"
  ADD CONSTRAINT "event_seats_hold_id_matches_status"
  CHECK (
    ("status" = 'HELD' AND "hold_id" IS NOT NULL)
    OR
    ("status" != 'HELD' AND "hold_id" IS NULL)
  );

-- 5. A ticket is either a seated ticket (event_seat_id set) or a GA ticket
--    (ticket_tier_id set) — never both, never neither.
ALTER TABLE "tickets"
  ADD CONSTRAINT "tickets_exactly_one_seat_or_tier"
  CHECK (
    ("event_seat_id" IS NOT NULL AND "ticket_tier_id" IS NULL)
    OR
    ("event_seat_id" IS NULL AND "ticket_tier_id" IS NOT NULL)
  );
