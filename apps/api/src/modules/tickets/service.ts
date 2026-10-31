import { prisma } from "@agenticgenie/db";
import { ApiError } from "../../lib/errors.js";
import { writeAuditLog } from "../../lib/audit.js";

export interface TicketActionContext {
  actorUserId: string;
  requestId: string;
}

export async function checkInTicket(ctx: TicketActionContext, code: string) {
  const ticket = await prisma.ticket.findUnique({ where: { code }, include: { event: true } });
  if (!ticket) {
    throw new ApiError(404, "NOT_FOUND", "Ticket not found");
  }

  // Only staff/admin of the ticket's own organiser may check it in — hide
  // existence from anyone else, same as any other cross-organiser resource.
  const membership = await prisma.organiserMembership.findUnique({
    where: { organiserId_userId: { organiserId: ticket.event.organiserId, userId: ctx.actorUserId } },
  });
  if (!membership) {
    throw new ApiError(404, "NOT_FOUND", "Ticket not found");
  }

  if (ticket.event.status === "CANCELLED") {
    throw new ApiError(409, "EVENT_CANCELLED", "This event has been cancelled");
  }

  return prisma.$transaction(async (tx) => {
    // Atomic conditional update — concurrency-safe: of two simultaneous
    // scans of the same code, only one can match status='VALID' AND
    // checked_in_at IS NULL.
    const result = await tx.ticket.updateMany({
      where: { code, status: "VALID", checkedInAt: null },
      data: { checkedInAt: new Date(), checkedInByUserId: ctx.actorUserId },
    });

    if (result.count === 0) {
      const current = await tx.ticket.findUniqueOrThrow({ where: { code } });
      if (current.status === "REFUNDED") {
        throw new ApiError(409, "TICKET_REFUNDED", "This ticket has been refunded");
      }
      throw new ApiError(409, "ALREADY_CHECKED_IN", "This ticket has already been checked in");
    }

    const updated = await tx.ticket.findUniqueOrThrow({ where: { code } });

    await writeAuditLog(tx, {
      actorUserId: ctx.actorUserId,
      organiserId: ticket.event.organiserId,
      action: "TICKET_CHECKED_IN",
      entityType: "Ticket",
      entityId: ticket.id,
      beforeData: { checkedInAt: null },
      afterData: { checkedInAt: updated.checkedInAt, checkedInByUserId: ctx.actorUserId },
      requestId: ctx.requestId,
    });

    return updated;
  });
}
