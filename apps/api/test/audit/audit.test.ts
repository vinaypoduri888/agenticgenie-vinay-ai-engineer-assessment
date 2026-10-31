import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { signAccessToken } from "../../src/modules/auth/jwt.js";
import {
  createTestEvent,
  createTestMembership,
  createTestOrganiser,
  createTestTicketTier,
  createTestUser,
  createTestVenue,
  purchaseGaTickets,
  resetFixtures,
} from "../helpers/fixtures.js";

const app = createApp();

afterEach(async () => {
  await resetFixtures();
});

function authFor(userId: string) {
  return `Bearer ${signAccessToken(userId)}`;
}

describe("audit log access", () => {
  it("records an audit entry for every mutation, atomically with the mutation", async () => {
    const organiser = await createTestOrganiser();
    const venue = await createTestVenue(organiser.id);
    const event = await createTestEvent(organiser.id, venue.id, { status: "PUBLISHED" });
    const tier = await createTestTicketTier(event.id, { totalQuantity: 10 });
    const admin = await createTestUser();
    await createTestMembership(organiser.id, admin.id, "ADMIN");
    const buyer = await createTestUser();
    await purchaseGaTickets(app, buyer.id, event.id, tier.id, 1);

    const response = await request(app)
      .get(`/organisers/${organiser.id}/audit`)
      .set("Authorization", authFor(admin.id));

    expect(response.status).toBe(200);
    const actions = response.body.items.map((e: { action: string }) => e.action);
    expect(actions).toContain("HOLD_CREATED");
    expect(actions).toContain("ORDER_PAID");
    for (const entry of response.body.items) {
      expect(entry.requestId).toEqual(expect.any(String));
      expect(entry.createdAt).toEqual(expect.any(String));
    }
  });

  it("lets staff view entity-scoped audit entries", async () => {
    const organiser = await createTestOrganiser();
    const venue = await createTestVenue(organiser.id);
    const admin = await createTestUser();
    await createTestMembership(organiser.id, admin.id, "ADMIN");
    const staff = await createTestUser();
    await createTestMembership(organiser.id, staff.id, "STAFF");

    // Created through the real endpoint (not the direct-Prisma fixture
    // helper) specifically so an EVENT_CREATED audit entry actually exists
    // to query for.
    const created = await request(app)
      .post(`/organisers/${organiser.id}/events`)
      .set("Authorization", authFor(admin.id))
      .send({
        venueId: venue.id,
        title: "Audited Event",
        description: "d",
        category: "comedy",
        startsAt: new Date(Date.now() + 86_400_000).toISOString(),
      });
    expect(created.status).toBe(201);

    const response = await request(app)
      .get(`/organisers/${organiser.id}/audit`)
      .query({ entity: `Event:${created.body.id}` })
      .set("Authorization", authFor(staff.id));

    expect(response.status).toBe(200);
    expect(response.body.items.some((e: { action: string }) => e.action === "EVENT_CREATED")).toBe(true);
  });

  it("forbids staff from viewing the organiser-wide feed (admin only)", async () => {
    const organiser = await createTestOrganiser();
    const staff = await createTestUser();
    await createTestMembership(organiser.id, staff.id, "STAFF");

    const response = await request(app)
      .get(`/organisers/${organiser.id}/audit`)
      .set("Authorization", authFor(staff.id));

    expect(response.status).toBe(403);
  });

  it("returns 404 (not 403) for a member of a different organiser", async () => {
    const organiser = await createTestOrganiser();
    const otherOrganiser = await createTestOrganiser();
    const otherAdmin = await createTestUser();
    await createTestMembership(otherOrganiser.id, otherAdmin.id, "ADMIN");

    const response = await request(app)
      .get(`/organisers/${organiser.id}/audit`)
      .set("Authorization", authFor(otherAdmin.id));

    expect(response.status).toBe(404);
  });

  it("rejects a malformed entity filter", async () => {
    const organiser = await createTestOrganiser();
    const admin = await createTestUser();
    await createTestMembership(organiser.id, admin.id, "ADMIN");

    const response = await request(app)
      .get(`/organisers/${organiser.id}/audit`)
      .query({ entity: "no-colon-here" })
      .set("Authorization", authFor(admin.id));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_ENTITY_FILTER");
  });
});
