import { z } from "zod";

/**
 * Zod input/output contracts for the seven Part B agent tools. Shared
 * between `@agenticgenie/agent` (which only knows these shapes, never a
 * Prisma type) and, eventually, `apps/api` (which implements each tool's
 * `execute` by calling the real Part A service layer in Stage B2).
 *
 * Security invariant: no input schema below may include a user-identity
 * field (`userId`, `actorUserId`, etc). The authenticated caller is always
 * supplied out-of-band as `ToolContext.actorUserId` by the agent loop — a
 * model can hallucinate anything into a tool-call argument, but there is
 * structurally nowhere for an identity claim to go. See
 * `packages/agent/src/tools/dispatch.ts` and docs/DECISIONS.md.
 *
 * Output shapes are deliberately modeled on the REAL Part A service return
 * values (checked against `apps/api/src/modules/*\/service.ts` while writing
 * this), not invented from scratch — so Stage B2's real `execute` functions
 * won't need to redesign these schemas, only map into them.
 */

// ---------------------------------------------------------------------------
// Shared sub-shapes
// ---------------------------------------------------------------------------

const venueSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  city: z.string(),
});

const ticketTierSchema = z.object({
  id: z.string(),
  name: z.string(),
  priceMinor: z.number().int(),
  /** Ready to quote, so a model doesn't have to convert paise itself. */
  price: z.string().optional(),
  totalQuantity: z.number().int(),
  remainingQuantity: z.number().int(),
});

const seatAvailabilitySchema = z.object({
  total: z.number().int(),
  available: z.number().int(),
  held: z.number().int(),
  sold: z.number().int(),
});

// ---------------------------------------------------------------------------
// search_events — public catalogue search
// ---------------------------------------------------------------------------

export const searchEventsInputSchema = z.object({
  q: z.string().min(1).optional(),
  city: z.string().min(1).optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  category: z.string().min(1).optional(),
  /** In rupees, the way a user says it ("under ₹800" is 800). */
  max_price: z.number().nonnegative().optional(),
  limit: z.number().int().min(1).max(20).default(20),
});
export type SearchEventsInput = z.infer<typeof searchEventsInputSchema>;

const eventSearchResultSchema = z.object({
  id: z.string(),
  title: z.string(),
  category: z.string(),
  status: z.string(),
  startsAt: z.string(),
  venue: venueSummarySchema,
  city: z.string(),
  minPriceMinor: z.number().int().nullable(),
  minPrice: z.string().nullable().optional(),
  availability: z.object({ remaining: z.number().int(), total: z.number().int() }),
});

export const searchEventsOutputSchema = z.object({
  items: z.array(eventSearchResultSchema),
  nextCursor: z.string().nullable(),
});
export type SearchEventsOutput = z.infer<typeof searchEventsOutputSchema>;

// ---------------------------------------------------------------------------
// get_event — full detail for one event
// ---------------------------------------------------------------------------

export const getEventInputSchema = z.object({
  id: z.string().min(1),
});
export type GetEventInput = z.infer<typeof getEventInputSchema>;

export const getEventOutputSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  category: z.string(),
  status: z.string(),
  startsAt: z.string(),
  endsAt: z.string().nullable(),
  venue: z.object({ id: z.string(), name: z.string(), city: z.string(), address: z.string() }),
  tiers: z.array(ticketTierSchema),
  seatAvailability: seatAvailabilitySchema,
  /** Bookable seats (capped), so seat_ids for hold_seats come from real data. */
  availableSeats: z
    .array(z.object({ id: z.string(), section: z.string(), row: z.string(), seat: z.string(), priceMinor: z.number().int() }))
    .default([]),
  /** True when the free-text description looks like an embedded instruction. */
  descriptionFlaggedSuspicious: z.boolean().default(false),
});
export type GetEventOutput = z.infer<typeof getEventOutputSchema>;

// ---------------------------------------------------------------------------
// get_reviews — public reviews (UNTRUSTED text content, never instructions)
// ---------------------------------------------------------------------------

export const getReviewsInputSchema = z.object({
  event_id: z.string().min(1),
  limit: z.number().int().min(1).max(20).default(20),
});
export type GetReviewsInput = z.infer<typeof getReviewsInputSchema>;

const reviewSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  userId: z.string(),
  rating: z.number().int(),
  text: z.string(),
  /** Set by code, not the model, when the text looks like an embedded instruction. */
  flaggedSuspicious: z.boolean().default(false),
  createdAt: z.string(),
});

export const getReviewsOutputSchema = z.object({
  items: z.array(reviewSchema),
  nextCursor: z.string().nullable(),
});
export type GetReviewsOutput = z.infer<typeof getReviewsOutputSchema>;

// ---------------------------------------------------------------------------
// hold_seats — side-effecting
// ---------------------------------------------------------------------------

export const holdSeatsInputSchema = z
  .object({
    event_id: z.string().min(1),
    seat_ids: z.array(z.string().min(1)).min(1).max(8).optional(),
    tier_id: z.string().min(1).optional(),
    quantity: z.number().int().min(1).max(8).optional(),
  })
  .refine(
    (body) =>
      (body.seat_ids !== undefined && body.tier_id === undefined && body.quantity === undefined) ||
      (body.seat_ids === undefined && body.tier_id !== undefined && body.quantity !== undefined),
    { message: "Provide either seat_ids[] or tier_id + quantity, not both and not neither" },
  );
export type HoldSeatsInput = z.infer<typeof holdSeatsInputSchema>;

export const holdSeatsOutputSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  kind: z.enum(["SEATED", "GA"]),
  status: z.string(),
  expiresAt: z.string(),
});
export type HoldSeatsOutput = z.infer<typeof holdSeatsOutputSchema>;

// ---------------------------------------------------------------------------
// purchase — side-effecting, requires confirmation tied to a specific hold
// ---------------------------------------------------------------------------

export const purchaseInputSchema = z.object({
  hold_id: z.string().min(1),
  confirm: z.boolean(),
});
export type PurchaseInput = z.infer<typeof purchaseInputSchema>;

/**
 * `NEEDS_CONFIRMATION` is returned the first time this tool is called for a
 * given hold (or whenever the caller's message wasn't an unambiguous
 * confirmation of an already-pending one) — nothing is charged yet.
 * `confirm: true` on the tool-call arguments is never, by itself, enough to
 * reach PAID/DECLINED/PENDING_PAYMENT: that also requires a live
 * server-side `AgentPendingConfirmation` row for this exact hold AND the
 * current turn's raw human message passing a deterministic confirmation
 * classifier. See docs/PART_B_SECURITY.md.
 */
export const purchaseOutputSchema = z.object({
  status: z.enum(["NEEDS_CONFIRMATION", "PAID", "DECLINED", "PENDING_PAYMENT", "REFUNDED"]),
  holdId: z.string(),
  orderId: z.string().optional(),
  totalAmountMinor: z.number().int().optional(),
  message: z.string().optional(),
});
export type PurchaseOutput = z.infer<typeof purchaseOutputSchema>;

// ---------------------------------------------------------------------------
// cancel_order — side-effecting, requires confirmation tied to a specific
// order. Maps onto Part A's `requestRefund` (a full refund of every
// currently-VALID ticket on the order) — there is no separate "cancel a
// pending order" state machine in Part A, since checkout resolves
// synchronously to PAID/DECLINED. See docs/DECISIONS.md.
// ---------------------------------------------------------------------------

export const cancelOrderInputSchema = z.object({
  order_id: z.string().min(1),
  confirm: z.boolean(),
});
export type CancelOrderInput = z.infer<typeof cancelOrderInputSchema>;

/** Same `NEEDS_CONFIRMATION`-first-gate pattern as `purchase` — see there. */
export const cancelOrderOutputSchema = z.object({
  status: z.enum(["NEEDS_CONFIRMATION", "REFUNDED", "PARTIALLY_REFUNDED"]),
  orderId: z.string(),
  refundedAmountMinor: z.number().int().optional(),
  message: z.string().optional(),
});
export type CancelOrderOutput = z.infer<typeof cancelOrderOutputSchema>;

// ---------------------------------------------------------------------------
// sales_summary — organiser members only
// ---------------------------------------------------------------------------

export const salesSummaryInputSchema = z.object({
  /** Only needed by someone who belongs to more than one organiser. */
  organiser_id: z.string().min(1).optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  group_by: z.enum(["event", "day", "tier"]).default("event"),
});
export type SalesSummaryInput = z.infer<typeof salesSummaryInputSchema>;

const salesSummaryGroupSchema = z.object({
  key: z.string().nullable(),
  label: z.string().nullable(),
  revenueMinor: z.number().int(),
  revenue: z.string().optional(),
  ticketCount: z.number().int(),
});

/**
 * The organiser comes from the caller's own membership. A caller with no
 * membership gets a clean permission error (not this schema); a caller with
 * more than one gets `NEEDS_CLARIFICATION` listing the real options rather
 * than a guess, and answers with `organiser_id`, which is checked against
 * their memberships.
 */
export const salesSummaryOutputSchema = z.object({
  status: z.enum(["OK", "NEEDS_CLARIFICATION"]).default("OK"),
  organiserOptions: z.array(z.object({ id: z.string(), name: z.string() })).optional(),
  groupBy: z.enum(["event", "day", "tier"]).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  totalRevenueMinor: z.number().int().optional(),
  totalRevenue: z.string().optional(),
  totalTicketCount: z.number().int().optional(),
  groups: z.array(salesSummaryGroupSchema).optional(),
});
export type SalesSummaryOutput = z.infer<typeof salesSummaryOutputSchema>;

// ---------------------------------------------------------------------------
// list_my_orders — the caller's own orders. An extension beyond the required
// seven: without it, "cancel my order" has no way to find an order id, and the
// provider-down fallback has no way to answer "show my tickets".
// ---------------------------------------------------------------------------

export const listMyOrdersInputSchema = z.object({
  limit: z.number().int().min(1).max(20).default(10),
});
export type ListMyOrdersInput = z.infer<typeof listMyOrdersInputSchema>;

export const listMyOrdersOutputSchema = z.object({
  orders: z.array(
    z.object({
      id: z.string(),
      status: z.string(),
      totalAmountMinor: z.number().int(),
      eventId: z.string(),
      eventTitle: z.string(),
      eventStartsAt: z.string(),
      ticketCount: z.number().int(),
    }),
  ),
});
export type ListMyOrdersOutput = z.infer<typeof listMyOrdersOutputSchema>;
