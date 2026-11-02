import { prisma } from "@agenticgenie/db";
import { decodeCursor, encodeCursor } from "../../lib/pagination.js";
import type { MyOrdersQuery } from "./schemas.js";

export async function listMyOrders(userId: string, query: MyOrdersQuery) {
  const cursor = query.cursor ? decodeCursor(query.cursor) : null;

  const orders = await prisma.order.findMany({
    where: {
      userId,
      ...(cursor
        ? {
            OR: [
              { createdAt: { gt: cursor.createdAt } },
              { AND: [{ createdAt: cursor.createdAt }, { id: { gt: cursor.id } }] },
            ],
          }
        : {}),
    },
    include: { tickets: true, event: { select: { id: true, title: true, startsAt: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: query.limit + 1,
  });

  const hasMore = orders.length > query.limit;
  const page = hasMore ? orders.slice(0, query.limit) : orders;
  const last = page.at(-1);
  const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null;

  return { items: page, nextCursor };
}

/** An organiser's attendee list, scoped by organiserId. Membership is checked by
 * the route; an event id from another organiser simply matches nothing. Newest
 * first, so a refund desk sees recent orders straight away. */
export async function listOrganiserOrders(organiserId: string, query: MyOrdersQuery & { event_id?: string; q?: string }) {
  const cursor = query.cursor ? decodeCursor(query.cursor) : null;
  const orders = await prisma.order.findMany({
    where: {
      AND: [
        { event: { organiserId } },
        ...(query.event_id ? [{ eventId: query.event_id }] : []),
        ...(query.q
          ? [
              {
                OR: [
                  { id: query.q },
                  { user: { email: { contains: query.q, mode: "insensitive" as const } } },
                  { user: { name: { contains: query.q, mode: "insensitive" as const } } },
                ],
              },
            ]
          : []),
        ...(cursor
          ? [
              {
                OR: [
                  { createdAt: { lt: cursor.createdAt } },
                  { AND: [{ createdAt: cursor.createdAt }, { id: { lt: cursor.id } }] },
                ],
              },
            ]
          : []),
      ],
    },
    include: {
      user: { select: { id: true, name: true, email: true } },
      event: { select: { id: true, title: true, startsAt: true } },
      tickets: { select: { id: true, code: true, status: true, priceMinor: true, checkedInAt: true } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: query.limit + 1,
  });

  const hasMore = orders.length > query.limit;
  const page = hasMore ? orders.slice(0, query.limit) : orders;
  const last = page.at(-1);
  const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null;

  return { items: page, nextCursor };
}
