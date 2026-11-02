import { z } from "zod";
import { withSnakeCaseAliases } from "../../lib/aliases.js";

const orderBodySchema = z.object({
  holdId: z.string().min(1),
});

export const createOrderBodySchema = withSnakeCaseAliases(orderBodySchema, { hold_id: "holdId" });

export const paymentScenarioSchema = z.enum(["success", "decline", "timeout_then_success", "timeout_then_decline"]);

export const myOrdersQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().min(1).optional(),
});

export const organiserOrdersQuerySchema = myOrdersQuerySchema.extend({
  event_id: z.string().min(1).optional(),
  q: z.string().trim().min(1).max(200).optional(),
});

export type CreateOrderBody = z.infer<typeof orderBodySchema>;
export type MyOrdersQuery = z.infer<typeof myOrdersQuerySchema>;
