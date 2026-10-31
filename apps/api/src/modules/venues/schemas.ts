import { z } from "zod";

export const createVenueBodySchema = z.object({
  name: z.string().trim().min(1).max(200),
  address: z.string().trim().min(1).max(500),
  city: z.string().trim().min(1).max(100),
});

export const updateVenueBodySchema = createVenueBodySchema.partial();

export const createSectionBodySchema = z.object({
  name: z.string().trim().min(1).max(100),
});

export const createRowBodySchema = z.object({
  label: z.string().trim().min(1).max(50),
});

export const createSeatBodySchema = z.object({
  label: z.string().trim().min(1).max(50),
});

export type CreateVenueBody = z.infer<typeof createVenueBodySchema>;
export type UpdateVenueBody = z.infer<typeof updateVenueBodySchema>;
export type CreateSectionBody = z.infer<typeof createSectionBodySchema>;
export type CreateRowBody = z.infer<typeof createRowBodySchema>;
export type CreateSeatBody = z.infer<typeof createSeatBodySchema>;
