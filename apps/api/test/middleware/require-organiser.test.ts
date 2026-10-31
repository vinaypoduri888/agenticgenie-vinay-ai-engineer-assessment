import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { errorHandler } from "../../src/middleware/errorHandler.js";
import { requestId } from "../../src/middleware/requestId.js";
import { requireAuth } from "../../src/middleware/requireAuth.js";
import { requireAdmin, requireOrganiserMembership, requireOrganiserRole } from "../../src/middleware/requireOrganiser.js";
import { signAccessToken } from "../../src/modules/auth/jwt.js";
import { createTestMembership, createTestOrganiser, createTestUser, resetFixtures } from "../helpers/fixtures.js";

function buildTestApp() {
  const app = express();
  app.use(requestId);
  app.use(express.json());
  app.use(requireAuth);

  app.get("/organisers/:organiserId/any-member", requireOrganiserMembership(), (req, res) => {
    res.json({ organiserId: req.membership?.organiserId, role: req.membership?.role });
  });

  app.get("/organisers/:organiserId/staff-or-admin", requireOrganiserRole(["STAFF", "ADMIN"]), (req, res) => {
    res.json({ role: req.membership?.role });
  });

  app.get("/organisers/:organiserId/admin-only", requireAdmin(), (req, res) => {
    res.json({ role: req.membership?.role });
  });

  app.use(errorHandler);
  return app;
}

const app = buildTestApp();

afterEach(async () => {
  await resetFixtures();
});

async function authHeaderFor(userId: string) {
  return `Bearer ${signAccessToken(userId)}`;
}

describe("requireOrganiserMembership", () => {
  it("allows a member of the organiser, in any role", async () => {
    const user = await createTestUser();
    const organiser = await createTestOrganiser();
    await createTestMembership(organiser.id, user.id, "STAFF");

    const response = await request(app)
      .get(`/organisers/${organiser.id}/any-member`)
      .set("Authorization", await authHeaderFor(user.id));

    expect(response.status).toBe(200);
    expect(response.body.role).toBe("STAFF");
  });

  it("returns 404 (not 403) for a user with no membership at all — existence-hiding", async () => {
    const user = await createTestUser();
    const organiser = await createTestOrganiser();
    // Deliberately no membership created.

    const response = await request(app)
      .get(`/organisers/${organiser.id}/any-member`)
      .set("Authorization", await authHeaderFor(user.id));

    expect(response.status).toBe(404);
  });

  it("returns 404 for a user who belongs to a DIFFERENT organiser (cross-organiser rejection)", async () => {
    const user = await createTestUser();
    const ownOrganiser = await createTestOrganiser();
    const otherOrganiser = await createTestOrganiser();
    await createTestMembership(ownOrganiser.id, user.id, "ADMIN");

    const response = await request(app)
      .get(`/organisers/${otherOrganiser.id}/any-member`)
      .set("Authorization", await authHeaderFor(user.id));

    expect(response.status).toBe(404);
  });
});

describe("requireOrganiserRole — staff vs admin", () => {
  it("allows staff through a STAFF-or-ADMIN gate", async () => {
    const user = await createTestUser();
    const organiser = await createTestOrganiser();
    await createTestMembership(organiser.id, user.id, "STAFF");

    const response = await request(app)
      .get(`/organisers/${organiser.id}/staff-or-admin`)
      .set("Authorization", await authHeaderFor(user.id));

    expect(response.status).toBe(200);
  });

  it("forbids staff from an admin-only action with 403, not 404 — membership exists, role doesn't", async () => {
    const user = await createTestUser();
    const organiser = await createTestOrganiser();
    await createTestMembership(organiser.id, user.id, "STAFF");

    const response = await request(app)
      .get(`/organisers/${organiser.id}/admin-only`)
      .set("Authorization", await authHeaderFor(user.id));

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("allows admin through an admin-only gate", async () => {
    const user = await createTestUser();
    const organiser = await createTestOrganiser();
    await createTestMembership(organiser.id, user.id, "ADMIN");

    const response = await request(app)
      .get(`/organisers/${organiser.id}/admin-only`)
      .set("Authorization", await authHeaderFor(user.id));

    expect(response.status).toBe(200);
  });
});

describe("a user belonging to multiple organisers with different roles", () => {
  it("scopes role checks per-organiser — admin on one org does not imply admin on another", async () => {
    const user = await createTestUser();
    const orgWhereAdmin = await createTestOrganiser();
    const orgWhereStaff = await createTestOrganiser();
    await createTestMembership(orgWhereAdmin.id, user.id, "ADMIN");
    await createTestMembership(orgWhereStaff.id, user.id, "STAFF");
    const auth = await authHeaderFor(user.id);

    const adminOnOwnOrg = await request(app)
      .get(`/organisers/${orgWhereAdmin.id}/admin-only`)
      .set("Authorization", auth);
    const adminOnStaffOrg = await request(app)
      .get(`/organisers/${orgWhereStaff.id}/admin-only`)
      .set("Authorization", auth);

    expect(adminOnOwnOrg.status).toBe(200);
    expect(adminOnStaffOrg.status).toBe(403); // still a member, just not an admin there
  });
});
