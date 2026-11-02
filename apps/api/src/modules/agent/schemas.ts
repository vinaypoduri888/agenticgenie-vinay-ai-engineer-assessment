import { z } from "zod";

export const chatRequestBodySchema = z.object({
  conversationId: z.string().min(1).optional(),
  message: z.string().min(1).max(4_000),
});
export type ChatRequestBody = z.infer<typeof chatRequestBodySchema>;
