import { Router } from "express";
import { healthResponseSchema } from "@agenticgenie/shared";
import { prisma } from "@agenticgenie/db";
import { ApiError } from "../lib/errors.js";

export const healthRouter = Router();

healthRouter.get("/", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    throw new ApiError(503, "DB_UNAVAILABLE", "Database connection failed");
  }

  res.json(
    healthResponseSchema.parse({
      status: "ok",
      service: "api",
      timestamp: new Date().toISOString(),
    }),
  );
});
