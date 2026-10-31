import { Router } from "express";
import { ApiError } from "../../lib/errors.js";
import { validateBody } from "../../middleware/validate.js";
import { createHoldBodySchema } from "./schemas.js";
import { createHold, releaseHold } from "./service.js";

export const holdsRouter = Router();

holdsRouter.post("/", validateBody(createHoldBodySchema), async (req, res) => {
  const idempotencyKey = req.headers["idempotency-key"];
  if (typeof idempotencyKey !== "string" || idempotencyKey.length === 0) {
    throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "An Idempotency-Key header is required");
  }

  const result = await createHold(
    { actorUserId: req.user!.id, requestId: req.requestId },
    idempotencyKey,
    req.body,
  );
  res.status(result.status).json(result.body);
});

holdsRouter.delete("/:id", async (req, res) => {
  const result = await releaseHold(
    { actorUserId: req.user!.id, requestId: req.requestId },
    req.params.id as string,
  );
  res.json(result);
});
