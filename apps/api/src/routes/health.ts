import { Router } from "express";
import { healthResponseSchema } from "@agenticgenie/shared";
import { prisma } from "@agenticgenie/db";

export const healthRouter = Router();

healthRouter.get("/", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    res.status(503).json({
      error: {
        code: "DB_UNAVAILABLE",
        message: "Database connection failed",
        request_id: null,
      },
    });
    return;
  }

  res.json(
    healthResponseSchema.parse({
      status: "ok",
      service: "api",
      timestamp: new Date().toISOString(),
    }),
  );
});
