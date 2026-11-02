import { prisma } from "@agenticgenie/db";
import { ApiError } from "../../lib/errors.js";
import { writeAuditLog } from "../../lib/audit.js";
import type { ActionContext } from "../../lib/actionContext.js";
import { performRefund } from "../refunds/service.js";
import { canTransitionEventStatus } from "./statusTransitions.js";

/**
 * Step A: one short transaction, internal-only (no external call) — lock
 * the event, flip it to CANCELLED, resolve every ACTIVE hold (seated and
 * GA) and restore their inventory. Guarded by `WHERE status = 'ACTIVE'`
 * throughout, so re-running cancellation (retry, double-click) is a safe
 * no-op the second time. The SAME `SELECT ... FOR UPDATE` on the event row
 * that checkout's Phase 1 and Phase 3 take serializes this against any
 * in-flight checkout for this event — see docs/DECISIONS.md.
 */
async function cancelEventAndResolveHolds(ctx: ActionContext, eventId: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM events WHERE id = ${eventId} FOR UPDATE`;
    const event = await tx.event.findUnique({ where: { id: eventId } });
    if (!event || event.organiserId !== ctx.organiserId) {
      throw new ApiError(404, "NOT_FOUND", "Event not found");
    }

    if (event.status === "CANCELLED") {
      return { alreadyCancelled: true as const };
    }
    if (!canTransitionEventStatus(event.status, "CANCELLED")) {
      throw new ApiError(409, "INVALID_STATUS_TRANSITION", `Cannot cancel an event in status ${event.status}`);
    }

    await tx.event.update({ where: { id: eventId }, data: { status: "CANCELLED" } });

    const activeHolds = await tx.hold.findMany({ where: { eventId, status: "ACTIVE" } });
    if (activeHolds.length > 0) {
      const holdIds = activeHolds.map((h) => h.id);
      await tx.hold.updateMany({ where: { id: { in: holdIds }, status: "ACTIVE" }, data: { status: "CANCELLED" } });
      await tx.eventSeat.updateMany({
        where: { holdId: { in: holdIds }, status: "HELD" },
        data: { status: "AVAILABLE", holdId: null },
      });

      const gaQuantityByTier = new Map<string, number>();
      for (const hold of activeHolds) {
        if (hold.kind === "GA") {
          gaQuantityByTier.set(hold.gaTicketTierId!, (gaQuantityByTier.get(hold.gaTicketTierId!) ?? 0) + hold.gaQuantity!);
        }
      }
      for (const [tierId, quantity] of gaQuantityByTier) {
        await tx.ticketTier.update({ where: { id: tierId }, data: { remainingQuantity: { increment: quantity } } });
      }

      await writeAuditLog(tx, {
        actorUserId: ctx.actorUserId,
        organiserId: ctx.organiserId,
        action: "HOLDS_RESOLVED_EVENT_CANCELLATION",
        entityType: "Event",
        entityId: eventId,
        afterData: { cancelledHoldIds: holdIds },
        requestId: ctx.requestId,
      });
    }

    await writeAuditLog(tx, {
      actorUserId: ctx.actorUserId,
      organiserId: ctx.organiserId,
      action: "EVENT_CANCELLED",
      entityType: "Event",
      entityId: eventId,
      beforeData: { status: event.status },
      afterData: { status: "CANCELLED" },
      requestId: ctx.requestId,
    });

    return { alreadyCancelled: false as const };
  });
}

/**
 * Step B: one transaction PER order (not one covering all of them, and
 * never spanning an external call — refunds are synchronous in this
 * model). Re-querying PAID/PARTIALLY_REFUNDED orders after Step A has
 * already committed is what makes "exactly once" fall out of the data
 * itself: an order this function already refunded is REFUNDED by the time
 * any re-run (retry, double-click) queries again, so it simply won't be
 * selected a second time.
 */
async function refundPaidOrdersForCancelledEvent(ctx: ActionContext, eventId: string) {
  const orders = await prisma.order.findMany({
    where: { eventId, status: { in: ["PAID", "PARTIALLY_REFUNDED"] } },
    include: { tickets: true, event: true },
  });

  let refundedCount = 0;
  for (const order of orders) {
    const validTicketIds = order.tickets.filter((t) => t.status === "VALID").map((t) => t.id);
    if (validTicketIds.length === 0) continue;
    try {
      await prisma.$transaction((tx) =>
        performRefund(tx, {
          order,
          ticketIds: validTicketIds,
          reason: "Event cancelled by organiser",
          requestedByUserId: ctx.actorUserId,
          requestId: ctx.requestId,
        }),
      );
      refundedCount++;
    } catch (err) {
      // A concurrent cancel, or a user's own refund, got to this order first.
      // That's the outcome we want, and it mustn't stop the remaining refunds.
      if (!(err instanceof ApiError && err.code === "ALREADY_REFUNDED")) throw err;
    }
  }

  return refundedCount;
}

export async function cancelEvent(ctx: ActionContext, eventId: string) {
  const stepA = await cancelEventAndResolveHolds(ctx, eventId);
  // Step B always runs, even on a repeat call. If an earlier run died between
  // the two steps, its unrefunded orders are only reachable from here, and an
  // order that's already refunded won't be selected again.
  const refundedOrderCount = await refundPaidOrdersForCancelledEvent(ctx, eventId);
  return { cancelled: true, refundedOrderCount, alreadyCancelled: stepA.alreadyCancelled };
}
