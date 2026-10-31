import { randomUUID } from "node:crypto";
import { prisma } from "@agenticgenie/db";
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

async function setupEventWithAdmin() {
  const organiser = await createTestOrganiser();
  const venue = await createTestVenue(organiser.id);
  const event = await createTestEvent(organiser.id, venue.id, { status: "PUBLISHED" });
  const admin = await createTestUser();
  await createTestMembership(organiser.id, admin.id, "ADMIN");
  return { organiser, venue, event, admin };
}

describe("event cancellation", () => {
  it("cancels the event and resolves an active hold, restoring GA inventory", async () => {
    const { organiser, event, admin } = await setupEventWithAdmin();
    const tier = await createTestTicketTier(event.id, { totalQuantity: 10 });
    const attendee = await createTestUser();

    const hold = await request(app)
      .post("/holds")
      .set("Authorization", authFor(attendee.id))
      .set("Idempotency-Key", randomUUID())
      .send({ eventId: event.id, tierId: tier.id, quantity: 3 });
    expect(hold.status).toBe(201);

    const response = await request(app)
      .post(`/organisers/${organiser.id}/events/${event.id}/cancel`)
      .set("Authorization", authFor(admin.id));

    expect(response.status).toBe(200);
    expect(response.body.cancelled).toBe(true);

    const eventAfter = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(eventAfter.status).toBe("CANCELLED");

    const holdAfter = await prisma.hold.findUniqueOrThrow({ where: { id: hold.body.id } });
    expect(holdAfter.status).toBe("CANCELLED");

    const tierAfter = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
    expect(tierAfter.remainingQuantity).toBe(10);
  });

  it("refunds every paid order for the event exactly once", async () => {
    const { organiser, event, admin } = await setupEventWithAdmin();
    const tier = await createTestTicketTier(event.id, { totalQuantity: 10 });
    const buyer1 = await createTestUser();
    const buyer2 = await createTestUser();
    const order1 = await purchaseGaTickets(app, buyer1.id, event.id, tier.id, 1);
    const order2 = await purchaseGaTickets(app, buyer2.id, event.id, tier.id, 1);

    const response = await request(app)
      .post(`/organisers/${organiser.id}/events/${event.id}/cancel`)
      .set("Authorization", authFor(admin.id));

    expect(response.status).toBe(200);
    expect(response.body.refundedOrderCount).toBe(2);

    const order1After = await prisma.order.findUniqueOrThrow({ where: { id: order1.id } });
    const order2After = await prisma.order.findUniqueOrThrow({ where: { id: order2.id } });
    expect(order1After.status).toBe("REFUNDED");
    expect(order2After.status).toBe("REFUNDED");

    const refundCount = await prisma.refund.count({ where: { orderId: { in: [order1.id, order2.id] } } });
    expect(refundCount).toBe(2); // exactly one refund per order, not duplicated
  });

  it("repeated cancellation is safe — second call is a no-op, no double refund", async () => {
    const { organiser, event, admin } = await setupEventWithAdmin();
    const tier = await createTestTicketTier(event.id, { totalQuantity: 10 });
    const buyer = await createTestUser();
    const order = await purchaseGaTickets(app, buyer.id, event.id, tier.id, 1);

    const first = await request(app)
      .post(`/organisers/${organiser.id}/events/${event.id}/cancel`)
      .set("Authorization", authFor(admin.id));
    expect(first.status).toBe(200);
    expect(first.body.refundedOrderCount).toBe(1);

    const second = await request(app)
      .post(`/organisers/${organiser.id}/events/${event.id}/cancel`)
      .set("Authorization", authFor(admin.id));
    expect(second.status).toBe(200);
    expect(second.body.alreadyCancelled).toBe(true);
    expect(second.body.refundedOrderCount).toBe(0);

    const refundCount = await prisma.refund.count({ where: { orderId: order.id } });
    expect(refundCount).toBe(1); // not doubled
  });

  it("forbids staff from cancelling an event (admin-only)", async () => {
    const { organiser, event } = await setupEventWithAdmin();
    const staff = await createTestUser();
    await createTestMembership(organiser.id, staff.id, "STAFF");

    const response = await request(app)
      .post(`/organisers/${organiser.id}/events/${event.id}/cancel`)
      .set("Authorization", authFor(staff.id));

    expect(response.status).toBe(403);
  });

  it("rejects cancelling a COMPLETED event (terminal, no outgoing transition)", async () => {
    const { organiser, admin } = await setupEventWithAdmin();
    const venue = await createTestVenue(organiser.id);
    const completedEvent = await createTestEvent(organiser.id, venue.id, { status: "COMPLETED" });

    const response = await request(app)
      .post(`/organisers/${organiser.id}/events/${completedEvent.id}/cancel`)
      .set("Authorization", authFor(admin.id));

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("INVALID_STATUS_TRANSITION");
  });

  it("prevents new checkouts against a cancelled event", async () => {
    const { organiser, event, admin } = await setupEventWithAdmin();
    const tier = await createTestTicketTier(event.id, { totalQuantity: 10 });
    const buyer = await createTestUser();

    const hold = await request(app)
      .post("/holds")
      .set("Authorization", authFor(buyer.id))
      .set("Idempotency-Key", randomUUID())
      .send({ eventId: event.id, tierId: tier.id, quantity: 1 });

    await request(app).post(`/organisers/${organiser.id}/events/${event.id}/cancel`).set("Authorization", authFor(admin.id));

    const checkout = await request(app)
      .post("/orders")
      .set("Authorization", authFor(buyer.id))
      .set("Idempotency-Key", randomUUID())
      .send({ holdId: hold.body.id });

    expect(checkout.status).toBe(409);
  });
});
