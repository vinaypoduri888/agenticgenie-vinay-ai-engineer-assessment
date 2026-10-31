import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { signAccessToken } from "../../src/modules/auth/jwt.js";
import { createTestMembership, createTestOrganiser, createTestUser, resetFixtures } from "../helpers/fixtures.js";

const app = createApp();

afterEach(async () => {
  await resetFixtures();
});

describe("GET /me/memberships", () => {
  it("lists every organiser the user belongs to, with role", async () => {
    const user = await createTestUser();
    const orgA = await createTestOrganiser();
    const orgB = await createTestOrganiser();
    await createTestMembership(orgA.id, user.id, "ADMIN");
    await createTestMembership(orgB.id, user.id, "STAFF");

    const response = await request(app)
      .get("/me/memberships")
      .set("Authorization", `Bearer ${signAccessToken(user.id)}`);

    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(2);
    const roles = response.body.items.map((m: { role: string }) => m.role).sort();
    expect(roles).toEqual(["ADMIN", "STAFF"]);
  });

  it("returns an empty list for a plain attendee", async () => {
    const user = await createTestUser();
    const response = await request(app)
      .get("/me/memberships")
      .set("Authorization", `Bearer ${signAccessToken(user.id)}`);

    expect(response.status).toBe(200);
    expect(response.body.items).toEqual([]);
  });
});
