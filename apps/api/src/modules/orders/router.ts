import { Router } from "express";
import { ApiError } from "../../lib/errors.js";
import { validateBody, validateQuery } from "../../middleware/validate.js";
import { requestRefundBodySchema } from "../refunds/schemas.js";
import { requestRefund } from "../refunds/service.js";
import { checkout } from "./checkout.js";
import { createOrderBodySchema, myOrdersQuerySchema, paymentScenarioSchema, type MyOrdersQuery } from "./schemas.js";
import { listMyOrders } from "./service.js";

export const ordersRouter = Router();

ordersRouter.post("/", validateBody(createOrderBodySchema), async (req, res) => {
  const idempotencyKey = req.headers["idempotency-key"];
  if (typeof idempotencyKey !== "string" || idempotencyKey.length === 0) {
    throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "An Idempotency-Key header is required");
  }

  // Test/demo-only escape hatch for deterministically exercising the fake
  // provider's SUCCESS/DECLINE/TIMEOUT paths — never a real payment
  // instrument, so this is safe to accept as a plain header.
  const scenario = paymentScenarioSchema.parse(req.headers["x-payment-scenario"]);

  const result = await checkout(
    { actorUserId: req.user!.id, requestId: req.requestId },
    idempotencyKey,
    req.body,
    scenario,
  );
  res.status(result.status).json(result.body);
});

ordersRouter.post("/:id/refund", validateBody(requestRefundBodySchema), async (req, res) => {
  const idempotencyKey = req.headers["idempotency-key"];
  if (typeof idempotencyKey !== "string" || idempotencyKey.length === 0) {
    throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "An Idempotency-Key header is required");
  }

  const result = await requestRefund(
    { actorUserId: req.user!.id, requestId: req.requestId },
    idempotencyKey,
    req.params.id as string,
    req.body,
  );
  res.status(result.status).json(result.body);
});

export const myOrdersRouter = Router();

myOrdersRouter.get("/", validateQuery(myOrdersQuerySchema), async (req, res) => {
  const query = req.validatedQuery as MyOrdersQuery;
  const { items, nextCursor } = await listMyOrders(req.user!.id, query);
  res.json({ items, next_cursor: nextCursor });
});
