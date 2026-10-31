import { z } from "zod";

export const createTicketTierBodySchema = z.object({
  name: z.string().trim().min(1).max(100),
  priceMinor: z.coerce.number().int().min(0),
  totalQuantity: z.coerce.number().int().min(1).max(1_000_000),
});

export const generateEventSeatsBodySchema = z.object({
  sectionPrices: z
    .array(
      z.object({
        sectionId: z.string().min(1),
        priceMinor: z.coerce.number().int().min(0),
      }),
    )
    .min(1, "At least one section must be priced to generate a seat map"),
});

export type CreateTicketTierBody = z.infer<typeof createTicketTierBodySchema>;
export type GenerateEventSeatsBody = z.infer<typeof generateEventSeatsBodySchema>;
