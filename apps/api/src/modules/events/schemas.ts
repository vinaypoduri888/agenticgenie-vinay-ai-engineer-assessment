import { z } from "zod";

export const createEventBodySchema = z
  .object({
    venueId: z.string().min(1),
    title: z.string().trim().min(1).max(300),
    description: z.string().trim().min(1).max(5000),
    category: z.string().trim().min(1).max(100),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime().optional(),
    refundWindowHours: z.coerce.number().int().min(0).max(24 * 30).optional(),
  })
  .refine((body) => !body.endsAt || new Date(body.endsAt) > new Date(body.startsAt), {
    message: "endsAt must be after startsAt",
    path: ["endsAt"],
  });

export const updateEventBodySchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  description: z.string().trim().min(1).max(5000).optional(),
  category: z.string().trim().min(1).max(100).optional(),
  startsAt: z.iso.datetime().optional(),
  endsAt: z.iso.datetime().optional(),
  refundWindowHours: z.coerce.number().int().min(0).max(24 * 30).optional(),
});

export const eventsCatalogueQuerySchema = z.object({
  city: z.string().trim().min(1).optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  category: z.string().trim().min(1).optional(),
  q: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().min(1).optional(),
});

export type CreateEventBody = z.infer<typeof createEventBodySchema>;
export type UpdateEventBody = z.infer<typeof updateEventBodySchema>;
export type EventsCatalogueQuery = z.infer<typeof eventsCatalogueQuerySchema>;
