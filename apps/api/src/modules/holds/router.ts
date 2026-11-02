import { randomUUID } from "node:crypto";
import { Router } from "express";
import { validateBody } from "../../middleware/validate.js";
import { createHoldBodySchema } from "./schemas.js";
import { createHold, listMyActiveHolds, releaseHold } from "./service.js";

export const holdsRouter = Router();

holdsRouter.post("/", validateBody(createHoldBodySchema), async (req, res) => {
  // Optional here, unlike orders and refunds: the API contract only requires
  // it for those two, and a duplicate hold is already stopped by the
  // one-active-hold rule. When sent, it gets the full replay semantics.
  const header = req.headers["idempotency-key"];
  const idempotencyKey = typeof header === "string" && header.length > 0 ? header : randomUUID();

  const result = await createHold(
    { actorUserId: req.user!.id, requestId: req.requestId },
    idempotencyKey,
    req.body,
  );
  const hold = result.body as { id: string; expiresAt: Date | string };
  res.status(result.status).json({ ...result.body, hold_id: hold.id, expires_at: hold.expiresAt });
});

holdsRouter.get("/", async (req, res) => {
  const eventId = typeof req.query.event_id === "string" ? req.query.event_id : undefined;
  res.json({ items: await listMyActiveHolds(req.user!.id, eventId) });
});

holdsRouter.delete("/:id", async (req, res) => {
  const result = await releaseHold(
    { actorUserId: req.user!.id, requestId: req.requestId },
    req.params.id as string,
  );
  res.json(result);
});
