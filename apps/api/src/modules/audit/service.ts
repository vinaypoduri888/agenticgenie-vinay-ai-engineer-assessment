import { prisma } from "@agenticgenie/db";
import type { MembershipRole, Prisma } from "@prisma/client";
import { ApiError } from "../../lib/errors.js";
import { decodeCursor, encodeCursor } from "../../lib/pagination.js";
import type { AuditQuery } from "./schemas.js";

/**
 * "The audit trail of an event" means everything that happened under it, not
 * only rows whose entity is the Event itself, and likewise for an order and its
 * tickets. Other entities match exactly.
 */
async function entityScope(entityType: string, entityId: string): Promise<Prisma.AuditLogWhereInput> {
  const exact = { entityType, entityId };
  if (entityType === "Event") {
    const [orders, holds, tickets] = await Promise.all([
      prisma.order.findMany({ where: { eventId: entityId }, select: { id: true } }),
      prisma.hold.findMany({ where: { eventId: entityId }, select: { id: true } }),
      prisma.ticket.findMany({ where: { eventId: entityId }, select: { id: true } }),
    ]);
    return {
      OR: [
        exact,
        { entityType: "Order", entityId: { in: orders.map((o) => o.id) } },
        { entityType: "Hold", entityId: { in: holds.map((h) => h.id) } },
        { entityType: "Ticket", entityId: { in: tickets.map((t) => t.id) } },
      ],
    };
  }
  if (entityType === "Order") {
    const order = await prisma.order.findUnique({
      where: { id: entityId },
      select: { holdId: true, tickets: { select: { id: true } } },
    });
    return {
      OR: [
        exact,
        ...(order ? [{ entityType: "Hold", entityId: order.holdId }] : []),
        { entityType: "Ticket", entityId: { in: order?.tickets.map((t) => t.id) ?? [] } },
      ],
    };
  }
  return exact;
}

function parseEntity(entity: string) {
  const separatorIndex = entity.indexOf(":");
  if (separatorIndex === -1) {
    throw new ApiError(400, "INVALID_ENTITY_FILTER", "entity must be in the form 'Type:id'");
  }
  return { entityType: entity.slice(0, separatorIndex), entityId: entity.slice(separatorIndex + 1) };
}

async function pageOfEntries(where: Prisma.AuditLogWhereInput, query: AuditQuery) {
  const cursor = query.cursor ? decodeCursor(query.cursor) : null;
  const entries = await prisma.auditLog.findMany({
    where: {
      AND: [
        where,
        ...(cursor
          ? [
              {
                OR: [
                  { createdAt: { gt: cursor.createdAt } },
                  { AND: [{ createdAt: cursor.createdAt }, { id: { gt: cursor.id } }] },
                ],
              },
            ]
          : []),
      ],
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: query.limit + 1,
  });

  const hasMore = entries.length > query.limit;
  const page = hasMore ? entries.slice(0, query.limit) : entries;
  const last = page.at(-1);
  const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null;

  return { items: page, nextCursor };
}

/**
 * GET /audit, scoped by the caller's own roles. An entity query covers every
 * organiser they belong to, and comes back empty rather than 403 for anything
 * outside them, so it can't confirm that the entity exists. The unfiltered feed
 * covers only organisers they administer.
 */
export async function listAuditEntriesForUser(userId: string, query: AuditQuery & { organiser_id?: string }) {
  const memberships = await prisma.organiserMembership.findMany({ where: { userId } });

  if (query.organiser_id) {
    const membership = memberships.find((m) => m.organiserId === query.organiser_id);
    if (!membership) throw new ApiError(404, "NOT_FOUND", "Not found");
    return listAuditEntries(membership.organiserId, membership.role, query);
  }

  if (query.entity) {
    const { entityType, entityId } = parseEntity(query.entity);
    return pageOfEntries(
      { AND: [{ organiserId: { in: memberships.map((m) => m.organiserId) } }, await entityScope(entityType, entityId)] },
      query,
    );
  }

  const adminOf = memberships.filter((m) => m.role === "ADMIN").map((m) => m.organiserId);
  if (adminOf.length === 0) {
    throw new ApiError(403, "FORBIDDEN", "Only admins may view the organiser-wide audit feed");
  }
  return pageOfEntries({ organiserId: { in: adminOf } }, query);
}

/**
 * Entity-scoped (`?entity=Type:id`) is viewable by any organiser member —
 * it's "can you see the history of this one thing you already have access
 * to." The full organiser-wide feed (no entity filter) is admin-only, per
 * the PDF. Enforced here rather than via static route middleware because
 * the required role depends on the query string, not just the route.
 */
export async function listAuditEntries(
  organiserId: string,
  callerRole: MembershipRole,
  query: AuditQuery,
) {
  if (!query.entity && callerRole !== "ADMIN") {
    throw new ApiError(403, "FORBIDDEN", "Only admins may view the organiser-wide audit feed");
  }
  const scope = query.entity
    ? await (async () => {
        const { entityType, entityId } = parseEntity(query.entity!);
        return entityScope(entityType, entityId);
      })()
    : {};
  return pageOfEntries({ AND: [{ organiserId }, scope] }, query);
}
