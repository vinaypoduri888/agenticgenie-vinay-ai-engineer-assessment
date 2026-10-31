import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { signAccessToken } from "../../src/modules/auth/jwt.js";
import {
  createTestEvent,
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

describe("GET /me/orders", () => {
  it("lists only the caller's own orders, not a stranger's", async () => {
    const organiser = await createTestOrganiser();
    const venue = await createTestVenue(organiser.id);
    const event = await createTestEvent(organiser.id, venue.id, { status: "PUBLISHED" });
    const tier = await createTestTicketTier(event.id, { totalQuantity: 10 });
    const buyer = await createTestUser();
    const stranger = await createTestUser();
    const order = await purchaseGaTickets(app, buyer.id, event.id, tier.id, 1);
    await purchaseGaTickets(app, stranger.id, event.id, tier.id, 1);

    const response = await request(app).get("/me/orders").set("Authorization", authFor(buyer.id));

    expect(response.status).toBe(200);
    const ids = response.body.items.map((o: { id: string }) => o.id);
    expect(ids).toEqual([order.id]);
  });

  describe("cursor pagination", () => {
    it("is stable under a concurrent insert between page fetches — no duplicates, no skips", async () => {
      const organiser = await createTestOrganiser();
      const venue = await createTestVenue(organiser.id);
      const event = await createTestEvent(organiser.id, venue.id, { status: "PUBLISHED" });
      const tier = await createTestTicketTier(event.id, { totalQuantity: 20 });
      const buyer = await createTestUser();

      const seeded = [];
      for (let i = 0; i < 3; i++) {
        seeded.push(await purchaseGaTickets(app, buyer.id, event.id, tier.id, 1));
      }

      const page1 = await request(app)
        .get("/me/orders")
        .query({ limit: 2 })
        .set("Authorization", authFor(buyer.id));
      expect(page1.body.items).toHaveLength(2);
      expect(page1.body.next_cursor).not.toBeNull();

      const inserted = await purchaseGaTickets(app, buyer.id, event.id, tier.id, 1);

      const page2 = await request(app)
        .get("/me/orders")
        .query({ limit: 2, cursor: page1.body.next_cursor })
        .set("Authorization", authFor(buyer.id));

      const page1Ids = page1.body.items.map((o: { id: string }) => o.id);
      const page2Ids = page2.body.items.map((o: { id: string }) => o.id);

      expect(page1Ids.some((id: string) => page2Ids.includes(id))).toBe(false);
      expect(page2Ids).toContain(seeded[2]!.id);
      expect(page2Ids).toContain(inserted.id);
    });
  });
});
