import type { EventStatus } from "@prisma/client";

/**
 * draft → published → on_sale → sold_out | cancelled | completed, per the
 * PDF's status diagram. Publish, on-sale, complete and cancel are organiser
 * actions over HTTP. SOLD_OUT is derived from inventory (see soldOut.ts), and
 * a PUBLISHED event can already be sold, so it can sell out or complete
 * directly. CANCELLED/COMPLETED are terminal.
 */
const ALLOWED_TRANSITIONS: Record<EventStatus, EventStatus[]> = {
  DRAFT: ["PUBLISHED", "CANCELLED"],
  PUBLISHED: ["ON_SALE", "SOLD_OUT", "CANCELLED", "COMPLETED"],
  ON_SALE: ["SOLD_OUT", "CANCELLED", "COMPLETED"],
  SOLD_OUT: ["ON_SALE", "CANCELLED", "COMPLETED"],
  CANCELLED: [],
  COMPLETED: [],
};

export function canTransitionEventStatus(from: EventStatus, to: EventStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}
