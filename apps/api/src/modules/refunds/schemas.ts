import { z } from "zod";
import { withSnakeCaseAliases } from "../../lib/aliases.js";

const refundBodySchema = z.object({
  ticketIds: z.array(z.string().min(1)).min(1).optional(),
  reason: z.string().trim().min(1).max(500),
});

export const requestRefundBodySchema = withSnakeCaseAliases(refundBodySchema, { ticket_ids: "ticketIds" });

export type RequestRefundBody = z.infer<typeof refundBodySchema>;
