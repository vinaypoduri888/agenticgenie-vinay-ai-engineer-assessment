import { z } from "zod";
import { withSnakeCaseAliases } from "../../lib/aliases.js";

const holdBodySchema = z
  .object({
    eventId: z.string().min(1),
    seatIds: z.array(z.string().min(1)).min(1).max(8).optional(),
    tierId: z.string().min(1).optional(),
    quantity: z.coerce.number().int().min(1).max(8).optional(),
  })
  .refine(
    (body) =>
      (body.seatIds !== undefined && body.tierId === undefined && body.quantity === undefined) ||
      (body.seatIds === undefined && body.tierId !== undefined && body.quantity !== undefined),
    { message: "Provide either seatIds[] or tierId + quantity, not both and not neither" },
  );

export const createHoldBodySchema = withSnakeCaseAliases(holdBodySchema, {
  event_id: "eventId",
  seat_ids: "seatIds",
  tier_id: "tierId",
  qty: "quantity",
});

export type CreateHoldBody = z.infer<typeof holdBodySchema>;
