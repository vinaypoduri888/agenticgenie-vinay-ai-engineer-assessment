import { prisma } from "@agenticgenie/db";
import type { Hold, Prisma } from "@prisma/client";
import { writeAuditLog } from "../../lib/audit.js";

/**
 * Releases one ACTIVE, past-expiry hold's inventory and marks it EXPIRED,
 * inside the given transaction. Guarded by `WHERE status = 'ACTIVE'` so
 * running this twice on the same hold (concurrent sweeps, or a sweep racing
 * a user's own release/checkout) is a safe no-op the second time — exactly
 * the same idempotent-conditional-update pattern used for seat/tier
 * allocation itself. Returns true if this call actually expired it.
 */
export async function expireHold(tx: Prisma.TransactionClient, hold: Hold): Promise<boolean> {
  if (hold.status !== "ACTIVE" || hold.expiresAt > new Date()) {
    return false;
  }

  const resolved = await tx.hold.updateMany({
    where: { id: hold.id, status: "ACTIVE" },
    data: { status: "EXPIRED" },
  });
  if (resolved.count === 0) {
    return false; // someone else (another sweep, a release, a checkout) resolved it first
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

  const event = await tx.event.findUnique({ where: { id: hold.eventId }, select: { organiserId: true } });

  await writeAuditLog(tx, {
    actorUserId: null,
    organiserId: event?.organiserId ?? null,
    action: "HOLD_EXPIRED",
    entityType: "Hold",
    entityId: hold.id,
    beforeData: { status: "ACTIVE" },
    afterData: { status: "EXPIRED" },
    requestId: "system-sweep",
  });

  return true;
}

/**
 * Lazy expiry, swept opportunistically rather than on a fixed schedule (no
 * BullMQ job wired up yet — see docs/DECISIONS.md for why that's an
 * accepted, documented simplification): called at the two points where a
 * stale hold actually matters — before allocating a *new* hold against an
 * event (so freed-up inventory is immediately available to the next buyer),
 * and whenever a specific hold is read for checkout (so an expired hold can
 * never be purchased even if nothing has swept it yet).
 */
export async function sweepExpiredHoldsForEvent(eventId: string): Promise<number> {
  const candidates = await prisma.hold.findMany({
    where: { eventId, status: "ACTIVE", expiresAt: { lt: new Date() } },
  });

  let count = 0;
  for (const hold of candidates) {
    const expired = await prisma.$transaction((tx) => expireHold(tx, hold));
    if (expired) count++;
  }
  return count;
}

/** Sweeps every expired hold platform-wide — what a scheduled job would
 * call if one were wired up. Exposed now so it's trivial to attach to a
 * BullMQ repeatable job or cron later without touching the sweep logic. */
export async function sweepAllExpiredHolds(): Promise<number> {
  const candidates = await prisma.hold.findMany({
    where: { status: "ACTIVE", expiresAt: { lt: new Date() } },
  });

  let count = 0;
  for (const hold of candidates) {
    const expired = await prisma.$transaction((tx) => expireHold(tx, hold));
    if (expired) count++;
  }
  return count;
}
