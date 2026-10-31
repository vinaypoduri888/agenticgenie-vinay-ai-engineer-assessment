import type { EventStatus } from "@prisma/client";

/**
 * draft → published → on_sale → sold_out | cancelled | completed, per the
 * PDF's status diagram. Only DRAFT→PUBLISHED is exposed over HTTP in this
 * stage (the `publish` action) — the rest of the table exists now so later
 * stages (going on sale, selling out, completing, and cancellation/refund)
 * call an already-defined, already-tested transition rule instead of
 * re-deriving one under time pressure. CANCELLED/COMPLETED are terminal.
 */
const ALLOWED_TRANSITIONS: Record<EventStatus, EventStatus[]> = {
  DRAFT: ["PUBLISHED", "CANCELLED"],
  PUBLISHED: ["ON_SALE", "CANCELLED"],
  ON_SALE: ["SOLD_OUT", "CANCELLED", "COMPLETED"],
  SOLD_OUT: ["ON_SALE", "CANCELLED", "COMPLETED"],
  CANCELLED: [],
  COMPLETED: [],
};

export function canTransitionEventStatus(from: EventStatus, to: EventStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}
