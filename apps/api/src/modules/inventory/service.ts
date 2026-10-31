import { prisma } from "@agenticgenie/db";
import { ApiError } from "../../lib/errors.js";
import { writeAuditLog } from "../../lib/audit.js";
import { toConflictError } from "../../lib/prismaErrors.js";
import type { ActionContext } from "../../lib/actionContext.js";
import { EDITABLE_STATUSES, requireOrganiserEvent } from "../events/service.js";
import type { CreateTicketTierBody, GenerateEventSeatsBody } from "./schemas.js";

function requireEventEditable(event: { status: string }) {
  if (!EDITABLE_STATUSES.includes(event.status as (typeof EDITABLE_STATUSES)[number])) {
    throw new ApiError(409, "EVENT_NOT_EDITABLE", `Event in status ${event.status} cannot be edited`);
  }
}

export async function createTicketTier(ctx: ActionContext, eventId: string, body: CreateTicketTierBody) {
  const event = await requireOrganiserEvent(ctx.organiserId, eventId);
  requireEventEditable(event);

  try {
    return await prisma.$transaction(async (tx) => {
      const tier = await tx.ticketTier.create({
        data: {
          eventId,
          name: body.name,
          priceMinor: body.priceMinor,
          totalQuantity: body.totalQuantity,
          remainingQuantity: body.totalQuantity,
        },
      });
      await writeAuditLog(tx, {
        actorUserId: ctx.actorUserId,
        organiserId: ctx.organiserId,
        action: "TICKET_TIER_CREATED",
        entityType: "TicketTier",
        entityId: tier.id,
        afterData: tier,
        requestId: ctx.requestId,
      });
      return tier;
    });
  } catch (err) {
    return toConflictError(err, "A ticket tier with this name already exists for this event");
  }
}

export async function generateEventSeats(
  ctx: ActionContext,
  eventId: string,
  body: GenerateEventSeatsBody,
) {
  const event = await requireOrganiserEvent(ctx.organiserId, eventId);
  requireEventEditable(event);

  const alreadyGenerated = await prisma.eventSeat.count({ where: { eventId } });
  if (alreadyGenerated > 0) {
    throw new ApiError(409, "CONFLICT", "A seat map has already been generated for this event");
  }

  const sectionIds = body.sectionPrices.map((s) => s.sectionId);
  const sections = await prisma.section.findMany({
    where: { id: { in: sectionIds }, venueId: event.venueId },
    include: { rows: { include: { seats: true } } },
  });
  if (sections.length !== sectionIds.length) {
    throw new ApiError(404, "NOT_FOUND", "One or more sections were not found for this event's venue");
  }

  const priceBySectionId = new Map(body.sectionPrices.map((s) => [s.sectionId, s.priceMinor]));
  const seatRows = sections.flatMap((section) => {
    const priceMinor = priceBySectionId.get(section.id)!;
    return section.rows.flatMap((row) =>
      row.seats.map((seat) => ({ eventId, seatId: seat.id, priceMinor })),
    );
  });

  if (seatRows.length === 0) {
    throw new ApiError(422, "NO_SEATS", "The selected sections have no seats defined yet");
  }

  return prisma.$transaction(async (tx) => {
    await tx.eventSeat.createMany({ data: seatRows });
    await writeAuditLog(tx, {
      actorUserId: ctx.actorUserId,
      organiserId: ctx.organiserId,
      action: "EVENT_SEATS_GENERATED",
      entityType: "Event",
      entityId: eventId,
      afterData: { seatCount: seatRows.length, sectionIds },
      requestId: ctx.requestId,
    });
    return { seatsCreated: seatRows.length };
  });
}
