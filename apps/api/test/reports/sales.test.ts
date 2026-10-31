import { randomUUID } from "node:crypto";
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

describe("sales reports", () => {
  it("reports net revenue grouped by event", async () => {
    const organiser = await createTestOrganiser();
    const venue = await createTestVenue(organiser.id);
    const event = await createTestEvent(organiser.id, venue.id, { status: "PUBLISHED" });
    const tier = await createTestTicketTier(event.id, { totalQuantity: 10, priceMinor: 100000 });
    const admin = await createTestUser();
    await createTestMembership(organiser.id, admin.id, "ADMIN");
    const buyer = await createTestUser();
    await purchaseGaTickets(app, buyer.id, event.id, tier.id, 2);

    const response = await request(app)
      .get(`/organisers/${organiser.id}/reports/sales`)
      .query({ group_by: "event" })
      .set("Authorization", authFor(admin.id));

    expect(response.status).toBe(200);
    expect(response.body.totalRevenueMinor).toBe(200000);
    expect(response.body.totalTicketCount).toBe(2);
    expect(response.body.groups).toHaveLength(1);
    expect(response.body.groups[0].key).toBe(event.id);
  });

  it("excludes refunded tickets from net revenue automatically", async () => {
    const organiser = await createTestOrganiser();
    const venue = await createTestVenue(organiser.id);
    const event = await createTestEvent(organiser.id, venue.id, {
      status: "PUBLISHED",
      startsAt: new Date(Date.now() + 7 * 86_400_000),
    });
    const tier = await createTestTicketTier(event.id, { totalQuantity: 10, priceMinor: 100000 });
    const admin = await createTestUser();
    await createTestMembership(organiser.id, admin.id, "ADMIN");
    const buyer = await createTestUser();
    const order = await purchaseGaTickets(app, buyer.id, event.id, tier.id, 1);

    await request(app)
      .post(`/orders/${order.id}/refund`)
      .set("Authorization", authFor(buyer.id))
      .set("Idempotency-Key", randomUUID())
      .send({ reason: "Can't attend" });

    const response = await request(app)
      .get(`/organisers/${organiser.id}/reports/sales`)
      .query({ group_by: "event" })
      .set("Authorization", authFor(admin.id));

    expect(response.body.totalRevenueMinor).toBe(0);
    expect(response.body.groups).toHaveLength(0);
  });

  it("supports grouping by tier", async () => {
    const organiser = await createTestOrganiser();
    const venue = await createTestVenue(organiser.id);
    const event = await createTestEvent(organiser.id, venue.id, { status: "PUBLISHED" });
    const tier = await createTestTicketTier(event.id, { totalQuantity: 10, priceMinor: 50000 });
    const staff = await createTestUser();
    await createTestMembership(organiser.id, staff.id, "STAFF");
    const buyer = await createTestUser();
    await purchaseGaTickets(app, buyer.id, event.id, tier.id, 1);

    const response = await request(app)
      .get(`/organisers/${organiser.id}/reports/sales`)
      .query({ group_by: "tier" })
      .set("Authorization", authFor(staff.id)); // staff can view sales, per the assessment's role table

    expect(response.status).toBe(200);
    expect(response.body.groups[0].key).toBe(tier.id);
    expect(response.body.groups[0].label).toBe(tier.name);
  });

  it("returns 404 (not 403) for a member of a different organiser", async () => {
    const organiser = await createTestOrganiser();
    const otherOrganiser = await createTestOrganiser();
    const otherStaff = await createTestUser();
    await createTestMembership(otherOrganiser.id, otherStaff.id, "STAFF");

    const response = await request(app)
      .get(`/organisers/${organiser.id}/reports/sales`)
      .set("Authorization", authFor(otherStaff.id));

    expect(response.status).toBe(404);
  });
});
