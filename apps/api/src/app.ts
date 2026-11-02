import express from "express";
import cors from "cors";
import swaggerUi from "swagger-ui-express";
import { env } from "./env.js";
import { openApiDocument } from "./openapi.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { requestId } from "./middleware/requestId.js";
import { requireAuth } from "./middleware/requireAuth.js";
import type { ModelProvider } from "@agenticgenie/agent";
import { auditRouter, myAuditRouter } from "./modules/audit/router.js";
import { eventContractRouter } from "./modules/events/contractRouter.js";
import { membersRouter } from "./modules/members/router.js";
import { createAgentRouter, myConversationsRouter } from "./modules/agent/router.js";
import { createConfiguredProvider } from "./modules/agent/provider.js";
import { authRouter } from "./modules/auth/router.js";
import { meMembershipsRouter } from "./modules/auth/meMembershipsRouter.js";
import { eventsRouter } from "./modules/events/router.js";
import { publicEventsRouter } from "./modules/events/publicRouter.js";
import { holdsRouter } from "./modules/holds/router.js";
import { myOrdersRouter, ordersRouter, organiserOrdersRouter } from "./modules/orders/router.js";
import { reportsRouter } from "./modules/reports/router.js";
import { reviewsRouter } from "./modules/reviews/router.js";
import { ticketsRouter } from "./modules/tickets/router.js";
import { venuesRouter } from "./modules/venues/router.js";
import { healthRouter } from "./routes/health.js";

export interface CreateAppOverrides {
  /** Test-only seam: inject a deterministic MockProvider so a test can
   * drive the REAL HTTP endpoint (real DB, real confirmation/idempotency/
   * permission enforcement) with a scripted model, instead of only
   * exercising packages/agent's loop in isolation. Defaults to the real
   * env-configured provider (mock by default — no API key required). */
  agentProvider?: ModelProvider;
}

export function createApp(overrides?: CreateAppOverrides) {
  const app = express();

  app.use(requestId);
  app.use(cors({ origin: env.CORS_ORIGIN }));
  app.use(express.json());

  app.use("/docs", swaggerUi.serve, swaggerUi.setup(openApiDocument));
  app.use("/health", healthRouter);
  app.use("/auth", authRouter);
  app.use("/events", publicEventsRouter);
  app.use("/events", eventContractRouter);
  // requireAuth is applied inside reviewsRouter per-route (GET is public,
  // POST requires it) — not mounted here, which would force auth on GET too.
  app.use("/events/:eventId/reviews", reviewsRouter);
  app.use("/organisers/:organiserId/venues", requireAuth, venuesRouter);
  app.use("/organisers/:organiserId/events", requireAuth, eventsRouter);
  app.use("/organisers/:organiserId/reports", requireAuth, reportsRouter);
  app.use("/organisers/:organiserId/audit", requireAuth, auditRouter);
  app.use("/organisers/:organiserId/members", requireAuth, membersRouter);
  app.use("/organisers/:organiserId/orders", requireAuth, organiserOrdersRouter);
  app.use("/audit", requireAuth, myAuditRouter);
  app.use("/holds", requireAuth, holdsRouter);
  app.use("/orders", requireAuth, ordersRouter);
  app.use("/me/orders", requireAuth, myOrdersRouter);
  app.use("/me/memberships", requireAuth, meMembershipsRouter);
  app.use("/me/conversations", requireAuth, myConversationsRouter);
  app.use("/tickets", requireAuth, ticketsRouter);
  app.use("/agent", requireAuth, createAgentRouter(overrides?.agentProvider ?? createConfiguredProvider()));

  // Must be registered last, and keep all 4 params (err, req, res, next) —
  // Express identifies error-handling middleware by that arity.
  app.use(errorHandler);

  return app;
}
