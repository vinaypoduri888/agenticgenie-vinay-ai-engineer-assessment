import { describe, expect, it, vi } from "vitest";
import request from "supertest";

vi.mock("@agenticgenie/db", () => ({
  prisma: { $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]) },
}));

const { createApp } = await import("../src/app.js");

describe("GET /health", () => {
  it("returns ok when the database is reachable", async () => {
    const app = createApp();
    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: "ok", service: "api" });
  });

  it("returns 503 when the database is unreachable", async () => {
    const { prisma } = await import("@agenticgenie/db");
    vi.mocked(prisma.$queryRaw).mockRejectedValueOnce(new Error("connection refused"));

    const app = createApp();
    const response = await request(app).get("/health");

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe("DB_UNAVAILABLE");
  });
});
