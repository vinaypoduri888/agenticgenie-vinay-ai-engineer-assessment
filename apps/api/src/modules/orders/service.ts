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
