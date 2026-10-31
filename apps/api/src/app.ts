import express from "express";
import cors from "cors";
import swaggerUi from "swagger-ui-express";
import { env } from "./env.js";
import { openApiDocument } from "./openapi.js";
import { healthRouter } from "./routes/health.js";

export function createApp() {
  const app = express();

  app.use(cors({ origin: env.CORS_ORIGIN }));
  app.use(express.json());

  app.use("/docs", swaggerUi.serve, swaggerUi.setup(openApiDocument));
  app.use("/health", healthRouter);

  return app;
}
