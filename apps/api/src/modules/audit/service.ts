import { prisma } from "@agenticgenie/db";
import type { MembershipRole } from "@prisma/client";
import { ApiError } from "../../lib/errors.js";
import { decodeCursor, encodeCursor } from "../../lib/pagination.js";
import type { AuditQuery } from "./schemas.js";

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
  let entityType: string | undefined;
  let entityId: string | undefined;
  if (query.entity) {
    const separatorIndex = query.entity.indexOf(":");
    if (separatorIndex === -1) {
      throw new ApiError(400, "INVALID_ENTITY_FILTER", "entity must be in the form 'Type:id'");
    }
    entityType = query.entity.slice(0, separatorIndex);
    entityId = query.entity.slice(separatorIndex + 1);
  } else if (callerRole !== "ADMIN") {
    throw new ApiError(403, "FORBIDDEN", "Only admins may view the organiser-wide audit feed");
  }

  const cursor = query.cursor ? decodeCursor(query.cursor) : null;

  const entries = await prisma.auditLog.findMany({
    where: {
      organiserId,
      ...(entityType && entityId ? { entityType, entityId } : {}),
      ...(cursor
        ? {
            OR: [
              { createdAt: { gt: cursor.createdAt } },
              { AND: [{ createdAt: cursor.createdAt }, { id: { gt: cursor.id } }] },
            ],
          }
        : {}),
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
