import { z } from "zod";

export const requestRefundBodySchema = z.object({
  ticketIds: z.array(z.string().min(1)).min(1).optional(),
  reason: z.string().trim().min(1).max(500),
});

export type RequestRefundBody = z.infer<typeof requestRefundBodySchema>;
