import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth.js";
import { validateBody, validateQuery } from "../../middleware/validate.js";
import { createReviewBodySchema, reviewsQuerySchema, type ReviewsQuery } from "./schemas.js";
import { createReview, listReviews } from "./service.js";

// Mounted at /events/:eventId/reviews — GET is public; POST requires auth,
// applied per-route (not at mount level) so browsing reviews stays open.
export const reviewsRouter = Router({ mergeParams: true });

reviewsRouter.get("/", validateQuery(reviewsQuerySchema), async (req, res) => {
  const query = req.validatedQuery as ReviewsQuery;
  const { items, nextCursor } = await listReviews(req.params.eventId as string, query);
  res.json({ items, next_cursor: nextCursor });
});

reviewsRouter.post("/", requireAuth, validateBody(createReviewBodySchema), async (req, res) => {
  const review = await createReview(
    { actorUserId: req.user!.id, requestId: req.requestId },
    req.params.eventId as string,
    req.body,
  );
  res.status(201).json(review);
});
