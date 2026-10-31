import { z } from "zod";

export const createReviewBodySchema = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  // Untrusted content — stored verbatim via a parameterized query (no
  // injection risk), never interpreted as instructions by anything in Part
  // A. Part B's agent layer is responsible for treating it as untrusted
  // data when it reaches a model.
  text: z.string().trim().min(1).max(5000),
});

export const reviewsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().min(1).optional(),
});

export type CreateReviewBody = z.infer<typeof createReviewBodySchema>;
export type ReviewsQuery = z.infer<typeof reviewsQuerySchema>;
