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

async function setupPaidOrder(opts?: { startsAt?: Date; totalQuantity?: number }) {
  const organiser = await createTestOrganiser();
  const venue = await createTestVenue(organiser.id);
  const event = await createTestEvent(organiser.id, venue.id, {
    status: "PUBLISHED",
    startsAt: opts?.startsAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });
  const tier = await createTestTicketTier(event.id, { totalQuantity: opts?.totalQuantity ?? 10, priceMinor: 50000 });
  const attendee = await createTestUser();
  const order = await purchaseGaTickets(app, attendee.id, event.id, tier.id, 1);
  return { organiser, venue, event, tier, attendee, order };
}

describe("attendee self-service refund", () => {
  it("refunds within the event's refund window and restores GA inventory", async () => {
    const { attendee, order, tier } = await setupPaidOrder();

    const response = await request(app)
      .post(`/orders/${order.id}/refund`)
      .set("Authorization", authFor(attendee.id))
      .set("Idempotency-Key", randomUUID())
      .send({ reason: "Can't make it anymore" });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("REFUNDED");

    // tier.remainingQuantity was captured at creation (10); the purchase
    // decremented it to 9, and the refund should bring it back to 10 — net
    // zero change versus the original, not +1 from it.
    const tierAfter = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
    expect(tierAfter.remainingQuantity).toBe(tier.remainingQuantity);
  });

  it("rejects a refund request once the event's refund window has closed", async () => {
    // startsAt in the past -> any positive refundWindowHours deadline has elapsed.
    const { attendee, order } = await setupPaidOrder({ startsAt: new Date(Date.now() - 60_000) });

    const response = await request(app)
      .post(`/orders/${order.id}/refund`)
      .set("Authorization", authFor(attendee.id))
      .set("Idempotency-Key", randomUUID())
      .send({ reason: "Too late" });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("REFUND_WINDOW_CLOSED");
  });

  it("rejects refunding someone else's order with 404 (cross-user isolation)", async () => {
    const { order } = await setupPaidOrder();
    const stranger = await createTestUser();

    const response = await request(app)
      .post(`/orders/${order.id}/refund`)
      .set("Authorization", authFor(stranger.id))
      .set("Idempotency-Key", randomUUID())
      .send({ reason: "Not my order" });

    expect(response.status).toBe(404);
  });

  it("never refunds the same ticket twice", async () => {
    const { attendee, order } = await setupPaidOrder();
    const key1 = randomUUID();
    const first = await request(app)
      .post(`/orders/${order.id}/refund`)
      .set("Authorization", authFor(attendee.id))
      .set("Idempotency-Key", key1)
      .send({ reason: "First" });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post(`/orders/${order.id}/refund`)
      .set("Authorization", authFor(attendee.id))
      .set("Idempotency-Key", randomUUID()) // a genuinely new request, not a replay
      .send({ reason: "Trying again" });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("ORDER_NOT_REFUNDABLE");
  });

  it("replays the same result for a repeated Idempotency-Key", async () => {
    const { attendee, order } = await setupPaidOrder();
    const key = randomUUID();
    const body = { reason: "Change of plans" };

    const first = await request(app).post(`/orders/${order.id}/refund`).set("Authorization", authFor(attendee.id)).set("Idempotency-Key", key).send(body);
    const replay = await request(app).post(`/orders/${order.id}/refund`).set("Authorization", authFor(attendee.id)).set("Idempotency-Key", key).send(body);

    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(replay.body.refund.id).toBe(first.body.refund.id);
  });
});

describe("organiser-side refunds and the self-refund rule", () => {
  it("lets staff refund another attendee's order", async () => {
    const { organiser, order } = await setupPaidOrder();
    const staff = await createTestUser();
    await createTestMembership(organiser.id, staff.id, "STAFF");

    const response = await request(app)
      .post(`/orders/${order.id}/refund`)
      .set("Authorization", authFor(staff.id))
      .set("Idempotency-Key", randomUUID())
      .send({ reason: "Organiser-initiated" });

    expect(response.status).toBe(200);
  });

  it("forbids staff from refunding their own order (403, policy-enforced)", async () => {
    const organiser = await createTestOrganiser();
    const venue = await createTestVenue(organiser.id);
    const event = await createTestEvent(organiser.id, venue.id, { status: "PUBLISHED" });
    const tier = await createTestTicketTier(event.id, { totalQuantity: 10 });
    const staffMember = await createTestUser();
    await createTestMembership(organiser.id, staffMember.id, "STAFF");
    const order = await purchaseGaTickets(app, staffMember.id, event.id, tier.id, 1);

    const response = await request(app)
      .post(`/orders/${order.id}/refund`)
      .set("Authorization", authFor(staffMember.id))
      .set("Idempotency-Key", randomUUID())
      .send({ reason: "Trying to refund myself" });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("allows admin to refund their own order (the documented exception), even past the window", async () => {
    const organiser = await createTestOrganiser();
    const venue = await createTestVenue(organiser.id);
    const event = await createTestEvent(organiser.id, venue.id, {
      status: "PUBLISHED",
      startsAt: new Date(Date.now() - 60_000), // window has closed for a plain attendee
    });
    const tier = await createTestTicketTier(event.id, { totalQuantity: 10 });
    const admin = await createTestUser();
    await createTestMembership(organiser.id, admin.id, "ADMIN");
    const order = await purchaseGaTickets(app, admin.id, event.id, tier.id, 1);

    const response = await request(app)
      .post(`/orders/${order.id}/refund`)
      .set("Authorization", authFor(admin.id))
      .set("Idempotency-Key", randomUUID())
      .send({ reason: "Admin self-refund" });

    expect(response.status).toBe(200);
  });

  it("returns 404 for staff of a different organiser probing an order", async () => {
    const { order } = await setupPaidOrder();
    const otherOrganiser = await createTestOrganiser();
    const otherStaff = await createTestUser();
    await createTestMembership(otherOrganiser.id, otherStaff.id, "STAFF");

    const response = await request(app)
      .post(`/orders/${order.id}/refund`)
      .set("Authorization", authFor(otherStaff.id))
      .set("Idempotency-Key", randomUUID())
      .send({ reason: "Probing" });

    expect(response.status).toBe(404);
  });
});

describe("refund inventory rules", () => {
  it("does not return a checked-in ticket's inventory to sale", async () => {
    const { organiser, order, tier } = await setupPaidOrder();
    const staff = await createTestUser();
    await createTestMembership(organiser.id, staff.id, "ADMIN");
    const ticket = order.tickets[0];

    await request(app).post(`/tickets/${ticket.code}/checkin`).set("Authorization", authFor(staff.id));
    const tierAfterCheckin = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });

    const response = await request(app)
      .post(`/orders/${order.id}/refund`)
      .set("Authorization", authFor(staff.id))
      .set("Idempotency-Key", randomUUID())
      .send({ reason: "Refund after check-in" });

    expect(response.status).toBe(200); // refund itself still allowed

    const tierAfterRefund = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
    expect(tierAfterRefund.remainingQuantity).toBe(tierAfterCheckin.remainingQuantity); // NOT incremented
  });
});
