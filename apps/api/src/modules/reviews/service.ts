import { prisma } from "@agenticgenie/db";
import { ApiError } from "../../lib/errors.js";
import { writeAuditLog } from "../../lib/audit.js";
import { toConflictError } from "../../lib/prismaErrors.js";
import { decodeCursor, encodeCursor } from "../../lib/pagination.js";
import type { CreateReviewBody, ReviewsQuery } from "./schemas.js";

export interface ReviewActionContext {
  actorUserId: string;
  requestId: string;
}

export async function listReviews(eventId: string, query: ReviewsQuery) {
  const cursor = query.cursor ? decodeCursor(query.cursor) : null;

  const reviews = await prisma.review.findMany({
    where: {
      eventId,
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

  const hasMore = reviews.length > query.limit;
  const page = hasMore ? reviews.slice(0, query.limit) : reviews;
  const last = page.at(-1);
  const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null;

  return { items: page, nextCursor };
}

export async function createReview(ctx: ReviewActionContext, eventId: string, body: CreateReviewBody) {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) {
    throw new ApiError(404, "NOT_FOUND", "Event not found");
  }
  if (event.status !== "COMPLETED") {
    throw new ApiError(409, "EVENT_NOT_COMPLETED", "You can only review events that have completed");
  }

  const attended = await prisma.ticket.findFirst({
    where: { eventId, order: { userId: ctx.actorUserId } },
  });
  if (!attended) {
    throw new ApiError(403, "NOT_ELIGIBLE", "You can only review events you attended");
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const review = await tx.review.create({
        data: { eventId, userId: ctx.actorUserId, rating: body.rating, text: body.text },
      });
      await writeAuditLog(tx, {
        actorUserId: ctx.actorUserId,
        organiserId: event.organiserId,
        action: "REVIEW_CREATED",
        entityType: "Review",
        entityId: review.id,
        afterData: review,
        requestId: ctx.requestId,
      });
      return review;
    });
  } catch (err) {
    return toConflictError(err, "You have already reviewed this event");
  }
}
