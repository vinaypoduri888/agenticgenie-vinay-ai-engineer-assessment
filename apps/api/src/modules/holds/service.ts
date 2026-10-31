import { prisma } from "@agenticgenie/db";
import type { EventStatus, Prisma } from "@prisma/client";
import { ApiError } from "../../lib/errors.js";
import { writeAuditLog } from "../../lib/audit.js";
import { withIdempotency } from "../../lib/idempotency.js";
import { env } from "../../env.js";
import { expireHold, sweepExpiredHoldsForEvent } from "./sweeper.js";
import type { CreateHoldBody } from "./schemas.js";

export const HOLDABLE_EVENT_STATUSES: EventStatus[] = ["PUBLISHED", "ON_SALE"];
export const MAX_TICKETS_PER_USER_PER_EVENT = 8;

export interface HoldActionContext {
  actorUserId: string;
  requestId: string;
}

async function assertWithinTicketLimit(
  tx: Prisma.TransactionClient,
  userId: string,
  eventId: string,
  requestedQuantity: number,
) {
  const existingValidTickets = await tx.ticket.count({
    where: { eventId, status: "VALID", order: { userId } },
  });
  if (existingValidTickets + requestedQuantity > MAX_TICKETS_PER_USER_PER_EVENT) {
    throw new ApiError(
      422,
      "TICKET_LIMIT_EXCEEDED",
      `Maximum ${MAX_TICKETS_PER_USER_PER_EVENT} tickets per user per event`,
    );
  }
}

async function assertNoActiveHold(tx: Prisma.TransactionClient, userId: string, eventId: string) {
  const active = await tx.hold.findFirst({ where: { userId, eventId, status: "ACTIVE" } });
  if (active) {
    throw new ApiError(409, "ACTIVE_HOLD_EXISTS", "You already have an active hold for this event");
  }
}

async function assertEventHoldable(tx: Prisma.TransactionClient, eventId: string) {
  const event = await tx.event.findUnique({ where: { id: eventId } });
  if (!event) {
    throw new ApiError(404, "NOT_FOUND", "Event not found");
  }
  if (!HOLDABLE_EVENT_STATUSES.includes(event.status)) {
    throw new ApiError(409, "EVENT_NOT_ON_SALE", `Event in status ${event.status} cannot be held`);
  }
  return event;
}

export async function createHold(
  ctx: HoldActionContext,
  idempotencyKey: string,
  body: CreateHoldBody,
) {
  // Opportunistic sweep, outside the transaction: frees up anything this
  // event's expired holds were sitting on before we even check availability,
  // so a genuinely-available seat/tier isn't rejected just because nobody
  // has touched its stale holder yet.
  await sweepExpiredHoldsForEvent(body.eventId);

  const expiresAt = new Date(Date.now() + env.HOLD_EXPIRY_MINUTES * 60_000);

  const result = await withIdempotency(
    { userId: ctx.actorUserId, key: idempotencyKey, endpoint: "POST /holds", requestBody: body },
    async (tx) => {
      const event = await assertEventHoldable(tx, body.eventId);
      await assertNoActiveHold(tx, ctx.actorUserId, body.eventId);

      const hold =
        body.seatIds !== undefined
          ? await allocateSeatedHold(tx, ctx, body.eventId, body.seatIds, expiresAt)
          : await allocateGaHold(tx, ctx, body.eventId, body.tierId!, body.quantity!, expiresAt);

      await writeAuditLog(tx, {
        actorUserId: ctx.actorUserId,
        organiserId: event.organiserId,
        action: "HOLD_CREATED",
        entityType: "Hold",
        entityId: hold.id,
        afterData: hold,
        requestId: ctx.requestId,
      });

      return { status: 201, body: hold };
    },
  );

  return result;
}

async function allocateSeatedHold(
  tx: Prisma.TransactionClient,
  ctx: HoldActionContext,
  eventId: string,
  seatIds: string[],
  expiresAt: Date,
) {
  await assertWithinTicketLimit(tx, ctx.actorUserId, eventId, seatIds.length);

  const hold = await tx.hold.create({
    data: { eventId, userId: ctx.actorUserId, kind: "SEATED", status: "ACTIVE", expiresAt },
  });

  // Atomic conditional UPDATE: of N concurrent requests for the same seat,
  // only the first to reach this statement can match status = 'AVAILABLE' —
  // Postgres's row lock on the UPDATE serializes the rest, and whichever
  // commits first wins; every later one re-evaluates against the now-'HELD'
  // row and matches 0.
  const claimed = await tx.eventSeat.updateMany({
    where: { eventId, seatId: { in: seatIds }, status: "AVAILABLE" },
    data: { status: "HELD", holdId: hold.id },
  });
  if (claimed.count !== seatIds.length) {
    // Rolling back via throw releases any seats this same statement DID
    // claim a moment ago — the whole transaction (hold + partial claims)
    // never committed, so nothing is visible to anyone else.
    throw new ApiError(409, "SEAT_UNAVAILABLE", "One or more requested seats are no longer available");
  }

  return hold;
}

async function allocateGaHold(
  tx: Prisma.TransactionClient,
  ctx: HoldActionContext,
  eventId: string,
  tierId: string,
  quantity: number,
  expiresAt: Date,
) {
  await assertWithinTicketLimit(tx, ctx.actorUserId, eventId, quantity);

  const tier = await tx.ticketTier.findUnique({ where: { id: tierId } });
  if (!tier || tier.eventId !== eventId) {
    throw new ApiError(404, "NOT_FOUND", "Ticket tier not found for this event");
  }

  const hold = await tx.hold.create({
    data: {
      eventId,
      userId: ctx.actorUserId,
      kind: "GA",
      status: "ACTIVE",
      expiresAt,
      gaTicketTierId: tierId,
      gaQuantity: quantity,
    },
  });

  const claimed = await tx.ticketTier.updateMany({
    where: { id: tierId, eventId, remainingQuantity: { gte: quantity } },
    data: { remainingQuantity: { decrement: quantity } },
  });
  if (claimed.count === 0) {
    throw new ApiError(409, "INSUFFICIENT_INVENTORY", "Not enough tickets remaining in this tier");
  }

  return hold;
}

export async function releaseHold(ctx: HoldActionContext, holdId: string) {
  const hold = await prisma.hold.findUnique({ where: { id: holdId }, include: { event: true } });
  if (!hold || hold.userId !== ctx.actorUserId) {
    throw new ApiError(404, "NOT_FOUND", "Hold not found");
  }
  if (hold.status === "CONVERTED") {
    throw new ApiError(409, "HOLD_CONVERTED", "This hold has already been converted to an order");
  }
  if (hold.status !== "ACTIVE") {
    return { released: true }; // DELETE is idempotent: already resolved is a success, not an error
  }

  return prisma.$transaction(async (tx) => {
    const resolved = await tx.hold.updateMany({
      where: { id: holdId, status: "ACTIVE" },
      data: { status: "RELEASED" },
    });
    if (resolved.count === 0) {
      return { released: true }; // lost a race with expiry/another release — still a success
    }

    if (hold.kind === "SEATED") {
      await tx.eventSeat.updateMany({
        where: { holdId: hold.id, status: "HELD" },
        data: { status: "AVAILABLE", holdId: null },
      });
    } else {
      await tx.ticketTier.update({
        where: { id: hold.gaTicketTierId! },
        data: { remainingQuantity: { increment: hold.gaQuantity! } },
      });
    }

    await writeAuditLog(tx, {
      actorUserId: ctx.actorUserId,
      organiserId: hold.event.organiserId,
      action: "HOLD_RELEASED",
      entityType: "Hold",
      entityId: holdId,
      beforeData: { status: "ACTIVE" },
      afterData: { status: "RELEASED" },
      requestId: ctx.requestId,
    });

    return { released: true };
  });
}

/** Loads a hold for checkout use (Stage 2.4), lazily expiring it first if
 * it's past its expiry but hasn't been swept yet — so a hold can never be
 * purchased after expiring regardless of sweep timing. */
export async function getUsableHoldOrThrow(holdId: string, userId: string) {
  const hold = await prisma.hold.findUnique({ where: { id: holdId } });
  if (!hold || hold.userId !== userId) {
    throw new ApiError(404, "NOT_FOUND", "Hold not found");
  }
  const wasExpired = await prisma.$transaction((tx) => expireHold(tx, hold));
  if (wasExpired || hold.status !== "ACTIVE" || hold.expiresAt <= new Date()) {
    throw new ApiError(409, "HOLD_EXPIRED", "This hold has expired");
  }
  return hold;
}
