import { prisma } from "@agenticgenie/db";
import type { Event, Order, Prisma, Ticket } from "@prisma/client";
import { ApiError } from "../../lib/errors.js";
import { writeAuditLog } from "../../lib/audit.js";
import { withIdempotency } from "../../lib/idempotency.js";
import { canRefundOrder } from "../auth/policies.js";
import { INVENTORY_RELEASE_BLOCKED_STATUSES } from "../events/service.js";
import { refundViaFakeProvider } from "../payments/fakeProvider.js";
import type { RequestRefundBody } from "./schemas.js";

export interface RefundActionContext {
  actorUserId: string;
  requestId: string;
}

type OrderWithRelations = Order & { tickets: Ticket[]; event: Event };

/**
 * The core refund transaction body — reused by both the user-facing
 * POST /orders/:id/refund endpoint and event cancellation's bulk refund
 * (Stage 2.5). Does not open its own transaction; the caller controls that
 * boundary, since cancellation needs one transaction *per order*, not one
 * covering everything (see docs/DECISIONS.md on avoiding one giant
 * transaction across every refund).
 */
export async function performRefund(
  tx: Prisma.TransactionClient,
  params: {
    order: OrderWithRelations;
    ticketIds: string[];
    reason: string;
    requestedByUserId: string;
    requestId: string;
  },
) {
  let refundedAmount = 0;
  const refundedTicketIds: string[] = [];

  for (const ticketId of params.ticketIds) {
    const ticket = params.order.tickets.find((t) => t.id === ticketId);
    if (!ticket) {
      throw new ApiError(404, "NOT_FOUND", `Ticket ${ticketId} not found on this order`);
    }

    // Conditional update — the second attempt to refund the same ticket
    // (duplicate request, or double-counted in ticketIds) matches 0 rows.
    const updated = await tx.ticket.updateMany({ where: { id: ticketId, status: "VALID" }, data: { status: "REFUNDED" } });
    if (updated.count === 0) continue;

    refundedAmount += ticket.priceMinor;
    refundedTicketIds.push(ticketId);

    // Inventory lifecycle rules (see docs/DECISIONS.md, schema-review
    // discussion): a checked-in ticket never returns to inventory — once
    // someone has used it, reselling the same seat/unit for that showing
    // doesn't make sense. Neither does releasing inventory for an event
    // that's CANCELLED or COMPLETED — there's no one left to sell it to.
    if (!ticket.checkedInAt && !INVENTORY_RELEASE_BLOCKED_STATUSES.includes(params.order.event.status)) {
      if (ticket.eventSeatId) {
        await tx.eventSeat.updateMany({
          where: { id: ticket.eventSeatId, status: "SOLD" },
          data: { status: "AVAILABLE", holdId: null },
        });
      } else if (ticket.ticketTierId) {
        await tx.ticketTier.update({
          where: { id: ticket.ticketTierId },
          data: { remainingQuantity: { increment: 1 } },
        });
      }
    }
  }

  if (refundedTicketIds.length === 0) {
    throw new ApiError(409, "ALREADY_REFUNDED", "The specified tickets have already been refunded");
  }

  const refund = await tx.refund.create({
    data: {
      orderId: params.order.id,
      amountMinor: refundedAmount,
      reason: params.reason,
      requestedByUserId: params.requestedByUserId,
    },
  });
  // Refund.id is the key passed to the fake provider — see D-012: defense
  // in depth against a double-refund even at the "provider" level, on top
  // of the per-ticket conditional update above and the caller's own
  // Idempotency-Key handling.
  await refundViaFakeProvider(refund.id);

  await tx.ticket.updateMany({ where: { id: { in: refundedTicketIds } }, data: { refundId: refund.id } });

  const remainingValid = await tx.ticket.count({ where: { orderId: params.order.id, status: "VALID" } });
  const newStatus = remainingValid === 0 ? "REFUNDED" : "PARTIALLY_REFUNDED";
  const updatedOrder = await tx.order.update({ where: { id: params.order.id }, data: { status: newStatus } });

  await writeAuditLog(tx, {
    actorUserId: params.requestedByUserId,
    organiserId: params.order.event.organiserId,
    action: "ORDER_REFUNDED",
    entityType: "Order",
    entityId: params.order.id,
    afterData: { refundId: refund.id, amountMinor: refundedAmount, status: newStatus },
    requestId: params.requestId,
  });

  return { refund, order: updatedOrder };
}

export async function requestRefund(
  ctx: RefundActionContext,
  idempotencyKey: string,
  orderId: string,
  body: RequestRefundBody,
) {
  return withIdempotency(
    { userId: ctx.actorUserId, key: idempotencyKey, endpoint: "POST /orders/:id/refund", requestBody: body },
    async (tx) => {
      const order = await tx.order.findUnique({ where: { id: orderId }, include: { tickets: true, event: true } });
      if (!order) {
        throw new ApiError(404, "NOT_FOUND", "Order not found");
      }

      const isOwnOrder = order.userId === ctx.actorUserId;
      const membership = await tx.organiserMembership.findUnique({
        where: { organiserId_userId: { organiserId: order.event.organiserId, userId: ctx.actorUserId } },
      });

      if (!membership) {
        if (!isOwnOrder) {
          // Cross-user probe on someone else's order — hide existence.
          throw new ApiError(404, "NOT_FOUND", "Order not found");
        }
        // Pure attendee self-service cancellation — bound by the event's
        // refund window. Staff/admin refunds (below) are discretionary
        // organiser actions and are not window-bound.
        const deadline = new Date(order.event.startsAt.getTime() - order.event.refundWindowHours * 3_600_000);
        if (new Date() > deadline) {
          throw new ApiError(409, "REFUND_WINDOW_CLOSED", "The refund window for this event has closed");
        }
      } else if (!canRefundOrder({ actorRole: membership.role, isOwnOrder })) {
        throw new ApiError(403, "FORBIDDEN", "Staff cannot refund their own order");
      }

      if (order.status !== "PAID" && order.status !== "PARTIALLY_REFUNDED") {
        throw new ApiError(409, "ORDER_NOT_REFUNDABLE", `Order in status ${order.status} cannot be refunded`);
      }

      const ticketIds = body.ticketIds ?? order.tickets.filter((t) => t.status === "VALID").map((t) => t.id);
      if (ticketIds.length === 0) {
        throw new ApiError(422, "NO_TICKETS_TO_REFUND", "No valid tickets to refund");
      }

      const { refund, order: updatedOrder } = await performRefund(tx, {
        order,
        ticketIds,
        reason: body.reason,
        requestedByUserId: ctx.actorUserId,
        requestId: ctx.requestId,
      });

      return { status: 200, body: { ...updatedOrder, refund } };
    },
  );
}
