import express from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { env } from "../../src/env.js";
import { errorHandler } from "../../src/middleware/errorHandler.js";
import { requestId } from "../../src/middleware/requestId.js";
import { requireAuth } from "../../src/middleware/requireAuth.js";
import { signAccessToken } from "../../src/modules/auth/jwt.js";
import { createTestUser, resetFixtures } from "../helpers/fixtures.js";

function buildTestApp() {
  const app = express();
  app.use(requestId);
  app.use(express.json());
  app.get("/whoami", requireAuth, (req, res) => {
    res.json({ id: req.user?.id, email: req.user?.email });
  });
  app.post("/whoami", requireAuth, (req, res) => {
    // Proves identity comes from the verified token, not the request body —
    // even if the body claims to be a different user.
    res.json({ id: req.user?.id, claimedUserId: req.body.userId });
  });
  app.use(errorHandler);
  return app;
}

const app = buildTestApp();

afterEach(async () => {
  await resetFixtures();
});

describe("requireAuth", () => {
  it("rejects a request with no Authorization header", async () => {
    const response = await request(app).get("/whoami");
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("rejects a malformed Authorization header", async () => {
    const response = await request(app).get("/whoami").set("Authorization", "garbage-not-bearer");
    expect(response.status).toBe(401);
  });

  it("rejects a syntactically malformed token", async () => {
    const response = await request(app).get("/whoami").set("Authorization", "Bearer not-a-real-jwt");
    expect(response.status).toBe(401);
  });

  it("rejects an expired token", async () => {
    const user = await createTestUser();
    const expired = jwt.sign({ sub: user.id }, env.JWT_SECRET, { expiresIn: "-1h" });
    const response = await request(app).get("/whoami").set("Authorization", `Bearer ${expired}`);
    expect(response.status).toBe(401);
  });

  it("rejects a token with an invalid signature", async () => {
    const user = await createTestUser();
    const forged = jwt.sign({ sub: user.id }, "wrong-secret-entirely", { expiresIn: "1h" });
    const response = await request(app).get("/whoami").set("Authorization", `Bearer ${forged}`);
    expect(response.status).toBe(401);
  });

  it("rejects a validly-signed token for a user that no longer exists", async () => {
    const forgedButWellSignedForNoOne = jwt.sign({ sub: "user-that-does-not-exist" }, env.JWT_SECRET, {
      expiresIn: "1h",
    });
    const response = await request(app)
      .get("/whoami")
      .set("Authorization", `Bearer ${forgedButWellSignedForNoOne}`);
    expect(response.status).toBe(401);
  });

  it("establishes identity for a valid token — plain attendee, no organiser membership needed", async () => {
    const user = await createTestUser();
    const token = signAccessToken(user.id);
    const response = await request(app).get("/whoami").set("Authorization", `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(response.body.id).toBe(user.id);
    expect(response.body.email).toBe(user.email);
  });

  it("never trusts a client-supplied userId over the verified token's identity", async () => {
    const realUser = await createTestUser();
    const someoneElse = await createTestUser();
    const token = signAccessToken(realUser.id);

    const response = await request(app)
      .post("/whoami")
      .set("Authorization", `Bearer ${token}`)
      .send({ userId: someoneElse.id });

    expect(response.status).toBe(200);
    expect(response.body.id).toBe(realUser.id);
    expect(response.body.id).not.toBe(someoneElse.id);
  });
});
