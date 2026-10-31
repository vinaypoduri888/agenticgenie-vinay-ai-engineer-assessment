import express from "express";
import cors from "cors";
import swaggerUi from "swagger-ui-express";
import { env } from "./env.js";
import { openApiDocument } from "./openapi.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { requestId } from "./middleware/requestId.js";
import { requireAuth } from "./middleware/requireAuth.js";
import { authRouter } from "./modules/auth/router.js";
import { eventsRouter } from "./modules/events/router.js";
import { publicEventsRouter } from "./modules/events/publicRouter.js";
import { holdsRouter } from "./modules/holds/router.js";
import { myOrdersRouter, ordersRouter } from "./modules/orders/router.js";
import { venuesRouter } from "./modules/venues/router.js";
import { healthRouter } from "./routes/health.js";

export function createApp() {
  const app = express();

  app.use(requestId);
  app.use(cors({ origin: env.CORS_ORIGIN }));
  app.use(express.json());

  app.use("/docs", swaggerUi.serve, swaggerUi.setup(openApiDocument));
  app.use("/health", healthRouter);
  app.use("/auth", authRouter);
  app.use("/events", publicEventsRouter);
  app.use("/organisers/:organiserId/venues", requireAuth, venuesRouter);
  app.use("/organisers/:organiserId/events", requireAuth, eventsRouter);
  app.use("/holds", requireAuth, holdsRouter);
  app.use("/orders", requireAuth, ordersRouter);
  app.use("/me/orders", requireAuth, myOrdersRouter);

  // Must be registered last, and keep all 4 params (err, req, res, next) —
  // Express identifies error-handling middleware by that arity.
  app.use(errorHandler);

  return app;
}
