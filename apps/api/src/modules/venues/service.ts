import { prisma } from "@agenticgenie/db";
import { ApiError } from "../../lib/errors.js";
import { writeAuditLog } from "../../lib/audit.js";
import { toConflictError } from "../../lib/prismaErrors.js";
import type { ActionContext } from "../../lib/actionContext.js";
import type {
  CreateRowBody,
  CreateSeatBody,
  CreateSectionBody,
  CreateVenueBody,
  UpdateVenueBody,
} from "./schemas.js";

/** Exported for reuse by the events module, which needs to confirm an
 * event's venue belongs to the same organiser before creating the event
 * (the DB's composite FK is the ultimate backstop — see
 * docs/DECISIONS.md D-008 — this is the app-level check that returns a
 * clean 404 instead of a raw constraint-violation error). */
export async function requireVenue(organiserId: string, venueId: string) {
  const venue = await prisma.venue.findUnique({ where: { id: venueId } });
  if (!venue || venue.organiserId !== organiserId) {
    throw new ApiError(404, "NOT_FOUND", "Venue not found");
  }
  return venue;
}

async function requireSection(organiserId: string, venueId: string, sectionId: string) {
  await requireVenue(organiserId, venueId);
  const section = await prisma.section.findUnique({ where: { id: sectionId } });
  if (!section || section.venueId !== venueId) {
    throw new ApiError(404, "NOT_FOUND", "Section not found");
  }
  return section;
}

async function requireRow(organiserId: string, venueId: string, sectionId: string, rowId: string) {
  await requireSection(organiserId, venueId, sectionId);
  const row = await prisma.row.findUnique({ where: { id: rowId } });
  if (!row || row.sectionId !== sectionId) {
    throw new ApiError(404, "NOT_FOUND", "Row not found");
  }
  return row;
}

export async function createVenue(ctx: ActionContext, body: CreateVenueBody) {
  return prisma.$transaction(async (tx) => {
    const venue = await tx.venue.create({ data: { organiserId: ctx.organiserId, ...body } });
    await writeAuditLog(tx, {
      actorUserId: ctx.actorUserId,
      organiserId: ctx.organiserId,
      action: "VENUE_CREATED",
      entityType: "Venue",
      entityId: venue.id,
      afterData: venue,
      requestId: ctx.requestId,
    });
    return venue;
  });
}

export async function listVenues(organiserId: string) {
  return prisma.venue.findMany({ where: { organiserId }, orderBy: { createdAt: "asc" } });
}

export async function getVenueDetail(organiserId: string, venueId: string) {
  const venue = await prisma.venue.findUnique({
    where: { id: venueId },
    include: {
      sections: {
        orderBy: { createdAt: "asc" },
        include: {
          rows: {
            orderBy: { createdAt: "asc" },
            include: { seats: { orderBy: { createdAt: "asc" } } },
          },
        },
      },
    },
  });
  if (!venue || venue.organiserId !== organiserId) {
    throw new ApiError(404, "NOT_FOUND", "Venue not found");
  }
  return venue;
}

export async function updateVenue(ctx: ActionContext, venueId: string, body: UpdateVenueBody) {
  const existing = await requireVenue(ctx.organiserId, venueId);
  return prisma.$transaction(async (tx) => {
    const updated = await tx.venue.update({ where: { id: venueId }, data: body });
    await writeAuditLog(tx, {
      actorUserId: ctx.actorUserId,
      organiserId: ctx.organiserId,
      action: "VENUE_UPDATED",
      entityType: "Venue",
      entityId: venueId,
      beforeData: existing,
      afterData: updated,
      requestId: ctx.requestId,
    });
    return updated;
  });
}

export async function createSection(ctx: ActionContext, venueId: string, body: CreateSectionBody) {
  await requireVenue(ctx.organiserId, venueId);
  try {
    return await prisma.$transaction(async (tx) => {
      const section = await tx.section.create({ data: { venueId, ...body } });
      await writeAuditLog(tx, {
        actorUserId: ctx.actorUserId,
        organiserId: ctx.organiserId,
        action: "SECTION_CREATED",
        entityType: "Section",
        entityId: section.id,
        afterData: section,
        requestId: ctx.requestId,
      });
      return section;
    });
  } catch (err) {
    return toConflictError(err, "A section with this name already exists for this venue");
  }
}

export async function createRow(
  ctx: ActionContext,
  venueId: string,
  sectionId: string,
  body: CreateRowBody,
) {
  await requireSection(ctx.organiserId, venueId, sectionId);
  try {
    return await prisma.$transaction(async (tx) => {
      const row = await tx.row.create({ data: { sectionId, ...body } });
      await writeAuditLog(tx, {
        actorUserId: ctx.actorUserId,
        organiserId: ctx.organiserId,
        action: "ROW_CREATED",
        entityType: "Row",
        entityId: row.id,
        afterData: row,
        requestId: ctx.requestId,
      });
      return row;
    });
  } catch (err) {
    return toConflictError(err, "A row with this label already exists in this section");
  }
}

export async function createSeat(
  ctx: ActionContext,
  venueId: string,
  sectionId: string,
  rowId: string,
  body: CreateSeatBody,
) {
  await requireRow(ctx.organiserId, venueId, sectionId, rowId);
  try {
    return await prisma.$transaction(async (tx) => {
      const seat = await tx.seat.create({ data: { rowId, ...body } });
      await writeAuditLog(tx, {
        actorUserId: ctx.actorUserId,
        organiserId: ctx.organiserId,
        action: "SEAT_CREATED",
        entityType: "Seat",
        entityId: seat.id,
        afterData: seat,
        requestId: ctx.requestId,
      });
      return seat;
    });
  } catch (err) {
    return toConflictError(err, "A seat with this label already exists in this row");
  }
}
