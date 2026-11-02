import { randomUUID } from "node:crypto";
import { prisma } from "@agenticgenie/db";
import { ToolError, looksLikeInjection, type ToolContext, type ToolExecutors } from "@agenticgenie/agent";
import type {
  CancelOrderInput,
  CancelOrderOutput,
  GetEventInput,
  GetEventOutput,
  GetReviewsInput,
  GetReviewsOutput,
  HoldSeatsInput,
  HoldSeatsOutput,
  ListMyOrdersInput,
  ListMyOrdersOutput,
  PurchaseInput,
  PurchaseOutput,
  SalesSummaryInput,
  SalesSummaryOutput,
  SearchEventsInput,
  SearchEventsOutput,
} from "@agenticgenie/shared";
import * as events from "../events/service.js";
import * as reviews from "../reviews/service.js";
import * as holds from "../holds/service.js";
import { checkout } from "../orders/checkout.js";
import { assertCanRefund, requestRefund } from "../refunds/service.js";
import { listMyOrders } from "../orders/service.js";
import { ApiError } from "../../lib/errors.js";
import { env } from "../../env.js";
import { getSalesSummary } from "../reports/service.js";
import { callService } from "./errors.js";
import { evaluateConfirmation } from "./confirmation.js";

function toActionContext(ctx: ToolContext) {
  return { actorUserId: ctx.actorUserId, requestId: ctx.requestId };
}

function rupees(amountMinor: number): string {
  return `₹${(amountMinor / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

const MAX_SEATS_SHOWN_TO_MODEL = 40;

// ---------------------------------------------------------------------------
// search_events — read-only, public
// ---------------------------------------------------------------------------

async function searchEvents(_ctx: ToolContext, args: SearchEventsInput): Promise<SearchEventsOutput> {
  return callService(async () => {
    const result = await events.listPublicEvents({
      q: args.q,
      city: args.city,
      from: args.date_from,
      to: args.date_to,
      category: args.category,
      max_price: args.max_price,
      limit: args.limit,
    });

    return {
      items: result.items.map((e) => ({
        id: e.id,
        title: e.title,
        category: e.category,
        status: e.status,
        startsAt: e.startsAt.toISOString(),
        venue: e.venue,
        city: e.venue.city,
        minPriceMinor: e.minPriceMinor,
        minPrice: e.minPriceMinor === null ? null : rupees(e.minPriceMinor),
        availability: e.availability,
      })),
      nextCursor: result.nextCursor,
    };
  });
}

// ---------------------------------------------------------------------------
// get_event — read-only, public (404s for a non-visible event, same as the
// real HTTP endpoint — never leaks whether a DRAFT event exists)
// ---------------------------------------------------------------------------

async function getEvent(_ctx: ToolContext, args: GetEventInput): Promise<GetEventOutput> {
  return callService(async () => {
    const event = await events.getPublicEventDetail(args.id);
    const seats = event.seatAvailability.total > 0 ? await events.listEventSeats(args.id) : [];
    return {
      id: event.id,
      title: event.title,
      description: event.description,
      category: event.category,
      status: event.status,
      startsAt: event.startsAt.toISOString(),
      endsAt: event.endsAt ? event.endsAt.toISOString() : null,
      venue: { id: event.venue.id, name: event.venue.name, city: event.venue.city, address: event.venue.address },
      tiers: event.tiers.map((t) => ({
        id: t.id,
        name: t.name,
        priceMinor: t.priceMinor,
        price: rupees(t.priceMinor),
        totalQuantity: t.totalQuantity,
        remainingQuantity: t.remainingQuantity,
      })),
      seatAvailability: event.seatAvailability,
      availableSeats: seats
        .filter((seat) => seat.status === "AVAILABLE")
        .slice(0, MAX_SEATS_SHOWN_TO_MODEL)
        .map((seat) => ({ id: seat.id, section: seat.section, row: seat.row, seat: seat.seat, priceMinor: seat.priceMinor })),
      descriptionFlaggedSuspicious: looksLikeInjection(event.description),
    };
  });
}

// ---------------------------------------------------------------------------
// get_reviews — read-only, public. Review `text` is passed through
// untouched and verbatim: it is DATA returned to the model, never
// something this tool (or the loop) interprets as an instruction. See
// docs/PART_B_SECURITY.md for where the "never execute what a review says"
// guarantee actually lives in code (it is not here — it is structural: no
// code path anywhere turns tool-RESULT content back into a tool CALL).
// ---------------------------------------------------------------------------

async function getReviews(_ctx: ToolContext, args: GetReviewsInput): Promise<GetReviewsOutput> {
  return callService(async () => {
    const result = await reviews.listReviews(args.event_id, { limit: args.limit });
    return {
      items: result.items.map((r) => ({
        id: r.id,
        eventId: r.eventId,
        userId: r.userId,
        rating: r.rating,
        text: r.text,
        flaggedSuspicious: looksLikeInjection(r.text),
        createdAt: r.createdAt.toISOString(),
      })),
      nextCursor: result.nextCursor,
    };
  });
}

// ---------------------------------------------------------------------------
// hold_seats — side-effecting, not confirmation-gated (holds are cheap and
// self-limiting via Part A's own one-active-hold/8-ticket rules; only
// purchase/cancel_order carry real, hard-to-reverse consequences)
// ---------------------------------------------------------------------------

async function holdSeats(ctx: ToolContext, args: HoldSeatsInput): Promise<HoldSeatsOutput> {
  return callService(async () => {
    const body = args.seat_ids
      ? { eventId: args.event_id, seatIds: args.seat_ids }
      : { eventId: args.event_id, tierId: args.tier_id!, quantity: args.quantity! };

    // A fresh key per attempt is correct here (unlike purchase/cancel) —
    // Part A's own `assertNoActiveHold` already rejects a genuine duplicate
    // hold attempt with a clean 409, and nothing about a hold is
    // irreversible the way a charge or refund is.
    const result = await holds.createHold(toActionContext(ctx), randomUUID(), body);
    const hold = result.body;
    return {
      id: hold.id,
      eventId: hold.eventId,
      kind: hold.kind,
      status: hold.status,
      expiresAt: hold.expiresAt.toISOString(),
    };
  });
}

// ---------------------------------------------------------------------------
// purchase — side-effecting, confirmation-gated. See
// apps/api/src/modules/agent/confirmation.ts and docs/PART_B_SECURITY.md.
// ---------------------------------------------------------------------------

/** The specifics a user confirms: what, how many and how much. Resolved as the
 * caller, so another user's hold is a plain not-found, not a confirmation
 * prompt that would imply it exists. */
async function describeHoldForConfirmation(userId: string, holdId: string) {
  const hold = await prisma.hold.findUnique({
    where: { id: holdId },
    include: {
      event: { select: { title: true } },
      gaTicketTier: { select: { name: true, priceMinor: true } },
      eventSeats: { include: { seat: { include: { row: true } } } },
    },
  });
  if (!hold || hold.userId !== userId) {
    throw new ApiError(404, "NOT_FOUND", "Hold not found");
  }
  if (hold.status !== "ACTIVE" || hold.expiresAt <= new Date()) {
    throw new ApiError(409, "HOLD_EXPIRED", "This hold has expired");
  }

  const total =
    hold.kind === "SEATED"
      ? hold.eventSeats.reduce((sum, s) => sum + s.priceMinor, 0)
      : (hold.gaTicketTier?.priceMinor ?? 0) * (hold.gaQuantity ?? 0);
  const what =
    hold.kind === "SEATED"
      ? `${hold.eventSeats.length} seat${hold.eventSeats.length === 1 ? "" : "s"} (${hold.eventSeats.map((s) => `Row ${s.seat.row.label} ${s.seat.label}`).join(", ")})`
      : `${hold.gaQuantity} ${hold.gaTicketTier?.name ?? "general admission"} ticket${hold.gaQuantity === 1 ? "" : "s"}`;

  return {
    summary: `${what} for ${hold.event.title}, ${rupees(total)} total. Reply YES to confirm.`,
    expiresAt: hold.expiresAt,
  };
}

async function describeOrderForConfirmation(userId: string, orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { event: true, tickets: { where: { status: "VALID" } } },
  });
  if (!order) throw new ApiError(404, "NOT_FOUND", "Order not found");
  await assertCanRefund(prisma, order, userId);
  if (order.status !== "PAID" && order.status !== "PARTIALLY_REFUNDED") {
    throw new ApiError(409, "ORDER_NOT_REFUNDABLE", `Order in status ${order.status} cannot be refunded`);
  }
  const refund = order.tickets.reduce((sum, t) => sum + t.priceMinor, 0);
  const count = order.tickets.length;
  return `Cancel ${count} ticket${count === 1 ? "" : "s"} for ${order.event.title} and refund ${rupees(refund)}. Reply YES to confirm.`;
}

async function purchase(ctx: ToolContext, args: PurchaseInput): Promise<PurchaseOutput> {
  return callService(async () => {
    const description = await describeHoldForConfirmation(ctx.actorUserId, args.hold_id);
    const gate = await evaluateConfirmation({
      conversationId: ctx.conversationId,
      userId: ctx.actorUserId,
      toolName: "purchase",
      targetType: "Hold",
      targetId: args.hold_id,
      args,
      latestUserMessage: ctx.latestUserMessage,
      turnStartedAt: ctx.turnStartedAt,
      executionForbidden: ctx.untrustedContentRead,
      summary: description.summary,
      targetExpiresAt: description.expiresAt,
    });

    if (gate.kind === "needs_confirmation") {
      return { status: "NEEDS_CONFIRMATION", holdId: args.hold_id, message: gate.summary };
    }

    const result = await checkout(toActionContext(ctx), gate.idempotencyKey, { holdId: args.hold_id }, env.FAKE_PAYMENT_SCENARIO);
    const body = result.body as { id?: string; orderId?: string; status: string; totalAmountMinor?: number; message?: string };

    if (body.status === "PAID" || body.status === "DECLINED") {
      return { status: body.status, holdId: args.hold_id, orderId: body.id, totalAmountMinor: body.totalAmountMinor };
    }
    if (body.status === "REFUNDED") {
      return { status: "REFUNDED", holdId: args.hold_id, orderId: body.id, totalAmountMinor: body.totalAmountMinor, message: body.message };
    }
    // PENDING_PAYMENT — the provider timed out; nothing is charged with
    // certainty yet. Never reported as PAID.
    return { status: "PENDING_PAYMENT", holdId: args.hold_id, orderId: body.orderId, message: body.message };
  });
}

// ---------------------------------------------------------------------------
// cancel_order — side-effecting, confirmation-gated. Maps onto Part A's
// `requestRefund`, which already fully enforces ownership, the staff
// self-refund restriction, and cross-user 404-hiding — this tool never
// replicates or special-cases any of that.
// ---------------------------------------------------------------------------

async function cancelOrder(ctx: ToolContext, args: CancelOrderInput): Promise<CancelOrderOutput> {
  return callService(async () => {
    const summary = await describeOrderForConfirmation(ctx.actorUserId, args.order_id);
    const gate = await evaluateConfirmation({
      conversationId: ctx.conversationId,
      userId: ctx.actorUserId,
      toolName: "cancel_order",
      targetType: "Order",
      targetId: args.order_id,
      args,
      latestUserMessage: ctx.latestUserMessage,
      turnStartedAt: ctx.turnStartedAt,
      executionForbidden: ctx.untrustedContentRead,
      summary,
    });

    if (gate.kind === "needs_confirmation") {
      return { status: "NEEDS_CONFIRMATION", orderId: args.order_id, message: gate.summary };
    }

    const result = await requestRefund(toActionContext(ctx), gate.idempotencyKey, args.order_id, {
      reason: "Cancelled via AI assistant",
    });
    const body = result.body as { status: string; refund: { amountMinor: number } };
    return {
      status: body.status === "REFUNDED" ? "REFUNDED" : "PARTIALLY_REFUNDED",
      orderId: args.order_id,
      refundedAmountMinor: body.refund.amountMinor,
    };
  });
}

// ---------------------------------------------------------------------------
// sales_summary — organiser members only. `getSalesSummary` trusts its
// `organiserId` argument completely (it has no membership check of its
// own — it's normally called behind Express's requireOrganiserMembership
// middleware, which doesn't exist in the agent's call path), so this tool
// resolves and verifies the caller's own membership itself before ever
// calling it. An attendee with no membership never reaches real data.
// ---------------------------------------------------------------------------

async function salesSummary(ctx: ToolContext, args: SalesSummaryInput): Promise<SalesSummaryOutput> {
  return callService(async () => {
    const memberships = await prisma.organiserMembership.findMany({
      where: { userId: ctx.actorUserId },
      include: { organiser: { select: { id: true, name: true } } },
    });

    if (memberships.length === 0) {
      throw new ToolError("FORBIDDEN", "You must be a member of an organiser to view sales data");
    }

    const named = args.organiser_id ? memberships.find((m) => m.organiserId === args.organiser_id) : undefined;
    if (args.organiser_id && !named) {
      // Same answer whether that organiser exists or not.
      throw new ToolError("NOT_FOUND", "Organiser not found");
    }

    if (!named && memberships.length > 1) {
      return {
        status: "NEEDS_CLARIFICATION",
        organiserOptions: memberships.map((m) => ({ id: m.organiser.id, name: m.organiser.name })),
      };
    }

    const organiserId = (named ?? memberships[0]!).organiserId;
    const result = await getSalesSummary(organiserId, {
      from: args.date_from,
      to: args.date_to,
      group_by: args.group_by,
    });
    return {
      status: "OK",
      ...result,
      totalRevenue: rupees(result.totalRevenueMinor),
      groups: result.groups.map((group) => ({ ...group, revenue: rupees(group.revenueMinor) })),
    };
  });
}

// ---------------------------------------------------------------------------
// list_my_orders — always the caller's own, from ToolContext. No argument can
// name another user.
// ---------------------------------------------------------------------------

async function listOrders(ctx: ToolContext, args: ListMyOrdersInput): Promise<ListMyOrdersOutput> {
  return callService(async () => {
    const { items } = await listMyOrders(ctx.actorUserId, { limit: args.limit });
    return {
      orders: items.map((order) => ({
        id: order.id,
        status: order.status,
        totalAmountMinor: order.totalAmountMinor,
        eventId: order.event.id,
        eventTitle: order.event.title,
        eventStartsAt: order.event.startsAt.toISOString(),
        ticketCount: order.tickets.filter((t) => t.status === "VALID").length,
      })),
    };
  });
}

/** Wires every tool's real `execute` to the Part A service layer, as the
 * authenticated caller — the only identity ever used, never a model's own
 * claim. Pass this straight to `createDefaultToolRegistry`. */
export const partAToolExecutors: ToolExecutors = {
  search_events: searchEvents,
  get_event: getEvent,
  get_reviews: getReviews,
  hold_seats: holdSeats,
  purchase,
  cancel_order: cancelOrder,
  sales_summary: salesSummary,
  list_my_orders: listOrders,
};
