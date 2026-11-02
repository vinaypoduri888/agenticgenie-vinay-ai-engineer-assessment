import type { Prisma } from "@prisma/client";
import { writeAuditLog } from "../../lib/audit.js";

export interface StatusChangeContext {
  actorUserId: string | null;
  requestId: string;
}

/**
 * Called right after a sale commits tickets. An event is sold out only when no
 * inventory is left AND no active hold could still give some back, so a release
 * or expiry can never make a SOLD_OUT event wrong. The conditional update makes
 * this a no-op unless the event is actually on sale.
 */
export async function markSoldOutIfExhausted(tx: Prisma.TransactionClient, ctx: StatusChangeContext, eventId: string) {
  const [tiersLeft, seatsLeft, activeHolds] = await Promise.all([
    tx.ticketTier.count({ where: { eventId, remainingQuantity: { gt: 0 } } }),
    tx.eventSeat.count({ where: { eventId, status: { in: ["AVAILABLE", "HELD"] } } }),
    tx.hold.count({ where: { eventId, status: "ACTIVE" } }),
  ]);
  if (tiersLeft > 0 || seatsLeft > 0 || activeHolds > 0) return;

  const event = await tx.event.findUniqueOrThrow({ where: { id: eventId }, select: { organiserId: true, status: true } });
  const changed = await tx.event.updateMany({
    where: { id: eventId, status: { in: ["PUBLISHED", "ON_SALE"] } },
    data: { status: "SOLD_OUT" },
  });
  if (changed.count === 0) return;

  await writeAuditLog(tx, {
    actorUserId: ctx.actorUserId,
    organiserId: event.organiserId,
    action: "EVENT_SOLD_OUT",
    entityType: "Event",
    entityId: eventId,
    beforeData: { status: event.status },
    afterData: { status: "SOLD_OUT" },
    requestId: ctx.requestId,
  });
}

/** Called when a refund returns inventory to sale: a SOLD_OUT event goes back
 * on sale. CANCELLED and COMPLETED events never reach this path. */
export async function reopenIfSoldOut(tx: Prisma.TransactionClient, ctx: StatusChangeContext, eventId: string) {
  const changed = await tx.event.updateMany({ where: { id: eventId, status: "SOLD_OUT" }, data: { status: "ON_SALE" } });
  if (changed.count === 0) return;

  const event = await tx.event.findUniqueOrThrow({ where: { id: eventId }, select: { organiserId: true } });
  await writeAuditLog(tx, {
    actorUserId: ctx.actorUserId,
    organiserId: event.organiserId,
    action: "EVENT_BACK_ON_SALE",
    entityType: "Event",
    entityId: eventId,
    beforeData: { status: "SOLD_OUT" },
    afterData: { status: "ON_SALE" },
    requestId: ctx.requestId,
  });
}
