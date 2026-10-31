import { z } from "zod";

export const createOrderBodySchema = z.object({
  holdId: z.string().min(1),
});

export const paymentScenarioSchema = z
  .enum(["success", "decline", "timeout_then_success", "timeout_then_decline"])
  .default("success");

export const myOrdersQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().min(1).optional(),
});

export type CreateOrderBody = z.infer<typeof createOrderBodySchema>;
export type MyOrdersQuery = z.infer<typeof myOrdersQuerySchema>;
