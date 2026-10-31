import { prisma } from "@agenticgenie/db";
import { Prisma, type EventStatus } from "@prisma/client";
import { ApiError } from "../../lib/errors.js";
import { writeAuditLog } from "../../lib/audit.js";
import { decodeCursor, encodeCursor } from "../../lib/pagination.js";
import type { ActionContext } from "../../lib/actionContext.js";
import { requireVenue } from "../venues/service.js";
import { canTransitionEventStatus } from "./statusTransitions.js";
import type { CreateEventBody, EventsCatalogueQuery, UpdateEventBody } from "./schemas.js";

/** DRAFT is never shown anywhere outside the owning organiser. Catalogue
 * search (discovery) additionally excludes CANCELLED/COMPLETED — not
 * useful when looking for something to attend — but a direct GET by id
 * still resolves them (e.g. to view a cancelled event's reviews or status).
 * Documented assumption — the PDF doesn't define this split explicitly. */
const CATALOGUE_VISIBLE_STATUSES: EventStatus[] = ["PUBLISHED", "ON_SALE", "SOLD_OUT"];
const DIRECT_VISIBLE_STATUSES: EventStatus[] = ["PUBLISHED", "ON_SALE", "SOLD_OUT", "CANCELLED", "COMPLETED"];
/** Also reused by the inventory module — tiers/seat-maps may only be
 * configured while the event hasn't gone further than PUBLISHED. */
export const EDITABLE_STATUSES: EventStatus[] = ["DRAFT", "PUBLISHED"];

/** Refunding a ticket for an event in one of these statuses never releases
 * its inventory back to sale — the event is over or gone, so there's
 * nothing left to resell it for. Shared by the refund endpoint and event
 * cancellation's bulk refund. */
export const INVENTORY_RELEASE_BLOCKED_STATUSES: EventStatus[] = ["CANCELLED", "COMPLETED"];

/** Exported for reuse by the inventory module (ticket tiers / seat
 * generation), which needs the same "does this event belong to this
 * organiser" check before touching its inventory. */
export async function requireOrganiserEvent(organiserId: string, eventId: string) {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event || event.organiserId !== organiserId) {
    throw new ApiError(404, "NOT_FOUND", "Event not found");
  }
  return event;
}

async function seatAvailabilitySummary(eventId: string) {
  const grouped = await prisma.eventSeat.groupBy({
    by: ["status"],
    where: { eventId },
    _count: { _all: true },
  });
  const summary = { total: 0, available: 0, held: 0, sold: 0 };
  for (const row of grouped) {
    summary.total += row._count._all;
    if (row.status === "AVAILABLE") summary.available = row._count._all;
    if (row.status === "HELD") summary.held = row._count._all;
    if (row.status === "SOLD") summary.sold = row._count._all;
  }
  return summary;
}

async function buildEventDetail(eventId: string) {
  const event = await prisma.event.findUniqueOrThrow({
    where: { id: eventId },
    include: { venue: true, tiers: { orderBy: { createdAt: "asc" } } },
  });
  const seatSummary = await seatAvailabilitySummary(eventId);
  return { ...event, seatAvailability: seatSummary };
}

export async function createEvent(ctx: ActionContext, body: CreateEventBody) {
  await requireVenue(ctx.organiserId, body.venueId);

  return prisma.$transaction(async (tx) => {
    const event = await tx.event.create({
      data: {
        organiserId: ctx.organiserId,
        venueId: body.venueId,
        title: body.title,
        description: body.description,
        category: body.category,
        startsAt: new Date(body.startsAt),
        endsAt: body.endsAt ? new Date(body.endsAt) : null,
        ...(body.refundWindowHours !== undefined ? { refundWindowHours: body.refundWindowHours } : {}),
      },
    });
    await writeAuditLog(tx, {
      actorUserId: ctx.actorUserId,
      organiserId: ctx.organiserId,
      action: "EVENT_CREATED",
      entityType: "Event",
      entityId: event.id,
      afterData: event,
      requestId: ctx.requestId,
    });
    return event;
  });
}

export async function getEventForOrganiser(organiserId: string, eventId: string) {
  await requireOrganiserEvent(organiserId, eventId);
  return buildEventDetail(eventId);
}

export async function updateEvent(ctx: ActionContext, eventId: string, body: UpdateEventBody) {
  const existing = await requireOrganiserEvent(ctx.organiserId, eventId);
  if (!EDITABLE_STATUSES.includes(existing.status)) {
    throw new ApiError(409, "EVENT_NOT_EDITABLE", `Event in status ${existing.status} cannot be edited`);
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.event.update({
      where: { id: eventId },
      data: {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.category !== undefined ? { category: body.category } : {}),
        ...(body.startsAt !== undefined ? { startsAt: new Date(body.startsAt) } : {}),
        ...(body.endsAt !== undefined ? { endsAt: new Date(body.endsAt) } : {}),
        ...(body.refundWindowHours !== undefined ? { refundWindowHours: body.refundWindowHours } : {}),
      },
    });
    await writeAuditLog(tx, {
      actorUserId: ctx.actorUserId,
      organiserId: ctx.organiserId,
      action: "EVENT_UPDATED",
      entityType: "Event",
      entityId: eventId,
      beforeData: existing,
      afterData: updated,
      requestId: ctx.requestId,
    });
    return updated;
  });
}

export async function publishEvent(ctx: ActionContext, eventId: string) {
  const existing = await requireOrganiserEvent(ctx.organiserId, eventId);

  if (!canTransitionEventStatus(existing.status, "PUBLISHED")) {
    throw new ApiError(
      409,
      "INVALID_STATUS_TRANSITION",
      `Cannot publish an event in status ${existing.status}`,
    );
  }

  const [tierCount, seatCount] = await Promise.all([
    prisma.ticketTier.count({ where: { eventId } }),
    prisma.eventSeat.count({ where: { eventId } }),
  ]);
  if (tierCount === 0 && seatCount === 0) {
    throw new ApiError(
      422,
      "EVENT_NOT_READY",
      "Event needs at least one ticket tier or a generated seat map before it can be published",
    );
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.event.update({ where: { id: eventId }, data: { status: "PUBLISHED" } });
    await writeAuditLog(tx, {
      actorUserId: ctx.actorUserId,
      organiserId: ctx.organiserId,
      action: "EVENT_PUBLISHED",
      entityType: "Event",
      entityId: eventId,
      beforeData: { status: existing.status },
      afterData: { status: updated.status },
      requestId: ctx.requestId,
    });
    return updated;
  });
}

export async function listPublicEvents(query: EventsCatalogueQuery) {
  // Built as an AND-of-conditions array, each condition its own object —
  // critically, this is what lets the text-search OR (title/description)
  // and the cursor's OR (createdAt/id tie-break) coexist without one
  // silently overwriting the other via object-spread key collision.
  const conditions: Prisma.EventWhereInput[] = [{ status: { in: CATALOGUE_VISIBLE_STATUSES } }];

  if (query.city) {
    conditions.push({ venue: { city: { equals: query.city, mode: "insensitive" } } });
  }
  if (query.category) {
    conditions.push({ category: { equals: query.category, mode: "insensitive" } });
  }
  if (query.from || query.to) {
    conditions.push({
      startsAt: {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      },
    });
  }
  if (query.q) {
    conditions.push({
      OR: [
        { title: { contains: query.q, mode: "insensitive" } },
        { description: { contains: query.q, mode: "insensitive" } },
      ],
    });
  }

  const cursor = query.cursor ? decodeCursor(query.cursor) : null;
  if (cursor) {
    conditions.push({
      OR: [
        { createdAt: { gt: cursor.createdAt } },
        { AND: [{ createdAt: cursor.createdAt }, { id: { gt: cursor.id } }] },
      ],
    });
  }

  const events = await prisma.event.findMany({
    where: { AND: conditions },
    include: { venue: { select: { id: true, name: true, city: true } }, tiers: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: query.limit + 1,
  });

  const hasMore = events.length > query.limit;
  const page = hasMore ? events.slice(0, query.limit) : events;

  const items = page.map((event) => {
    const prices = event.tiers.map((t) => t.priceMinor);
    const minPriceMinor = prices.length > 0 ? Math.min(...prices) : null;
    return {
      id: event.id,
      title: event.title,
      category: event.category,
      status: event.status,
      startsAt: event.startsAt,
      venue: event.venue,
      minPriceMinor,
    };
  });

  const last = page.at(-1);
  const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null;

  return { items, nextCursor };
}

export async function getPublicEventDetail(eventId: string) {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event || !DIRECT_VISIBLE_STATUSES.includes(event.status)) {
    throw new ApiError(404, "NOT_FOUND", "Event not found");
  }
  return buildEventDetail(eventId);
}
