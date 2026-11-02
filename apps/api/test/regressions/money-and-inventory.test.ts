import { randomUUID } from "node:crypto";
import { prisma } from "@agenticgenie/db";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { signAccessToken } from "../../src/modules/auth/jwt.js";
import { reconcileStuckCheckouts } from "../../src/modules/orders/checkout.js";
import {
  createTestEvent,
  createTestMembership,
  createTestOrganiser,
  createTestRow,
  createTestSeat,
  createTestSection,
  createTestTicketTier,
  createTestUser,
  createTestVenue,
  purchaseGaTickets,
  resetFixtures,
} from "../helpers/fixtures.js";

// Each test here reproduced a real bug against the code as first submitted for
// review. Concurrent cases repeat because a single pass can hide a race.

afterEach(async () => {
  await resetFixtures();
});

const app = createApp();
const auth = (id: string) => `Bearer ${signAccessToken(id)}`;

async function gaEvent(total = 10) {
  const organiser = await createTestOrganiser();
  const venue = await createTestVenue(organiser.id);
  const event = await createTestEvent(organiser.id, venue.id, { status: "PUBLISHED" });
  const tier = await createTestTicketTier(event.id, { totalQuantity: total, priceMinor: 1000 });
  return { organiser, venue, event, tier };
}

async function seatedEvent(seatCount = 1) {
  const organiser = await createTestOrganiser();
  const venue = await createTestVenue(organiser.id);
  const section = await createTestSection(venue.id);
  const row = await createTestRow(section.id);
  const event = await createTestEvent(organiser.id, venue.id, { status: "PUBLISHED" });
  for (let i = 0; i < seatCount; i++) {
    const seat = await createTestSeat(row.id, `S${i}`);
    await prisma.eventSeat.create({ data: { eventId: event.id, seatId: seat.id, priceMinor: 1000 } });
  }
  return { organiser, venue, event };
}

async function placeHold(userId: string, body: Record<string, unknown>) {
  return request(app).post("/holds").set("Authorization", auth(userId)).set("Idempotency-Key", randomUUID()).send(body);
}

function pay(userId: string, holdId: string, key: string = randomUUID()) {
  return request(app).post("/orders").set("Authorization", auth(userId)).set("Idempotency-Key", key).send({ holdId });
}

describe("checkout concurrency", () => {
  it("charges once and issues one set of tickets when one hold is checked out under different keys at once", async () => {
    for (let trial = 0; trial < 8; trial++) {
      const { event, tier } = await gaEvent();
      const user = await createTestUser();
      const hold = await placeHold(user.id, { eventId: event.id, tierId: tier.id, quantity: 2 });

      const responses = await Promise.all(Array.from({ length: 4 }, () => pay(user.id, hold.body.id)));

      const succeeded = await prisma.payment.count({ where: { order: { eventId: event.id }, status: "SUCCEEDED" } });
      const tickets = await prisma.ticket.count({ where: { eventId: event.id } });
      expect(succeeded).toBe(1);
      expect(tickets).toBe(2);
      expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
      expect(responses.filter((r) => r.status === 409)).toHaveLength(3);
    }
  }, 60_000);

  it("never oversells when a hold is released while its checkout is running", async () => {
    for (let trial = 0; trial < 15; trial++) {
      const { event, tier } = await gaEvent(10);
      const user = await createTestUser();
      const hold = await placeHold(user.id, { eventId: event.id, tierId: tier.id, quantity: 2 });

      await Promise.all([
        pay(user.id, hold.body.id),
        request(app).delete(`/holds/${hold.body.id}`).set("Authorization", auth(user.id)),
      ]);

      const sold = await prisma.ticket.count({ where: { eventId: event.id, status: "VALID" } });
      const { remainingQuantity } = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
      expect(sold + remainingQuantity).toBe(10);
    }
  }, 60_000);

  it("refunds rather than issues tickets when the hold is gone by the time the charge lands", async () => {
    const { event, tier } = await gaEvent(10);
    const user = await createTestUser();
    const hold = await placeHold(user.id, { eventId: event.id, tierId: tier.id, quantity: 1 });
    const key = randomUUID();

    await request(app)
      .post("/orders")
      .set("Authorization", auth(user.id))
      .set("Idempotency-Key", key)
      .set("X-Payment-Scenario", "timeout_then_success")
      .send({ holdId: hold.body.id });

    await prisma.hold.update({ where: { id: hold.body.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await prisma.idempotencyRecord.updateMany({ where: { userId: user.id, key }, data: { updatedAt: new Date(Date.now() - 60_000) } });

    const retry = await pay(user.id, hold.body.id, key);

    expect(retry.status).toBe(409);
    expect(retry.body.status).toBe("REFUNDED");
    expect(await prisma.ticket.count({ where: { eventId: event.id } })).toBe(0);
    expect((await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } })).remainingQuantity).toBe(10);
    expect(await prisma.refund.count({ where: { order: { eventId: event.id } } })).toBe(1);
  });
});

describe("payment timeouts never leave an order maybe-paid", () => {
  it("settles a timed-out checkout that the client never retries", async () => {
    const { event, tier } = await gaEvent(10);
    const user = await createTestUser();
    const hold = await placeHold(user.id, { eventId: event.id, tierId: tier.id, quantity: 1 });
    const key = randomUUID();

    const first = await request(app)
      .post("/orders")
      .set("Authorization", auth(user.id))
      .set("Idempotency-Key", key)
      .set("X-Payment-Scenario", "timeout_then_success")
      .send({ holdId: hold.body.id });
    expect(first.status).toBe(202);

    await prisma.idempotencyRecord.updateMany({ where: { userId: user.id, key }, data: { updatedAt: new Date(Date.now() - 60_000) } });
    const settled = await reconcileStuckCheckouts({ userId: user.id });

    expect(settled).toBe(1);
    const order = await prisma.order.findFirstOrThrow({ where: { holdId: hold.body.id } });
    expect(order.status).toBe("PAID");
    expect(await prisma.ticket.count({ where: { orderId: order.id } })).toBe(1);
  });

  it("settles a timed-out decline to DECLINED, leaving the hold usable", async () => {
    const { event, tier } = await gaEvent(10);
    const user = await createTestUser();
    const hold = await placeHold(user.id, { eventId: event.id, tierId: tier.id, quantity: 1 });
    const key = randomUUID();

    await request(app)
      .post("/orders")
      .set("Authorization", auth(user.id))
      .set("Idempotency-Key", key)
      .set("X-Payment-Scenario", "timeout_then_decline")
      .send({ holdId: hold.body.id });
    await prisma.idempotencyRecord.updateMany({ where: { userId: user.id, key }, data: { updatedAt: new Date(Date.now() - 60_000) } });

    await reconcileStuckCheckouts({ userId: user.id });

    expect((await prisma.order.findFirstOrThrow({ where: { holdId: hold.body.id } })).status).toBe("DECLINED");
    expect((await pay(user.id, hold.body.id)).status).toBe(201);
  });

  it("blocks a second key from charging while a timed-out attempt is unresolved", async () => {
    const { event, tier } = await gaEvent(10);
    const user = await createTestUser();
    const hold = await placeHold(user.id, { eventId: event.id, tierId: tier.id, quantity: 1 });

    await request(app)
      .post("/orders")
      .set("Authorization", auth(user.id))
      .set("Idempotency-Key", randomUUID())
      .set("X-Payment-Scenario", "timeout_then_success")
      .send({ holdId: hold.body.id });

    const second = await pay(user.id, hold.body.id);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("CHECKOUT_IN_PROGRESS");
  });

  it("gives a rejected checkout's replay the same rejection instead of REQUEST_IN_PROGRESS", async () => {
    const { event, tier } = await gaEvent(10);
    const user = await createTestUser();
    const hold = await placeHold(user.id, { eventId: event.id, tierId: tier.id, quantity: 1 });
    await prisma.hold.update({ where: { id: hold.body.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const key = randomUUID();

    expect((await pay(user.id, hold.body.id, key)).body.error.code).toBe("HOLD_EXPIRED");
    expect((await pay(user.id, hold.body.id, key)).body.error.code).toBe("HOLD_EXPIRED");
  });
});

describe("seated purchases", () => {
  it("can hold, buy, refund and resell a seat using only ids the API returned", async () => {
    const { event } = await seatedEvent(1);
    const buyer = await createTestUser();

    const seats = await request(app).get(`/events/${event.id}/seats`);
    const seatId = seats.body.items[0].id;

    const hold = await placeHold(buyer.id, { eventId: event.id, seatIds: [seatId] });
    expect(hold.status).toBe(201);
    const order = await pay(buyer.id, hold.body.id);
    expect(order.status).toBe(201);
    expect(order.body.tickets).toHaveLength(1);

    const refund = await request(app)
      .post(`/orders/${order.body.id}/refund`)
      .set("Authorization", auth(buyer.id))
      .set("Idempotency-Key", randomUUID())
      .send({ reason: "can't make it" });
    expect(refund.status).toBe(200);

    const nextBuyer = await createTestUser();
    const secondHold = await placeHold(nextBuyer.id, { eventId: event.id, seatIds: [seatId] });
    expect(secondHold.status).toBe(201);
    const resale = await pay(nextBuyer.id, secondHold.body.id);
    expect(resale.status).toBe(201);
    expect(resale.body.tickets).toHaveLength(1);
  });

  it("reports a seated event's price in the catalogue and finds it by max_price", async () => {
    const { event } = await seatedEvent(2);

    const cheap = await request(app).get("/events?limit=50&max_price=10");
    const found = cheap.body.items.find((e: { id: string }) => e.id === event.id);
    expect(found.minPriceMinor).toBe(1000);
    expect(found.availability).toEqual({ remaining: 2, total: 2 });

    const tooCheap = await request(app).get("/events?limit=50&max_price=5");
    expect(tooCheap.body.items.some((e: { id: string }) => e.id === event.id)).toBe(false);
  });
});

describe("idempotency keys", () => {
  it("rejects a refund key reused on a different order instead of replaying the first order's refund", async () => {
    const { event, tier } = await gaEvent();
    const user = await createTestUser();
    const first = await purchaseGaTickets(app, user.id, event.id, tier.id, 1);
    const second = await purchaseGaTickets(app, user.id, event.id, tier.id, 1);
    const key = randomUUID();

    const refund = (orderId: string) =>
      request(app).post(`/orders/${orderId}/refund`).set("Authorization", auth(user.id)).set("Idempotency-Key", key).send({ reason: "x" });

    expect((await refund(first.id)).status).toBe(200);
    expect((await refund(second.id)).status).toBe(422);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: second.id } })).status).toBe("PAID");
  });
});

describe("hold expiry", () => {
  it("shows expired inventory as available on read, without waiting for a new hold", async () => {
    const { event, tier } = await gaEvent(10);
    const user = await createTestUser();
    const hold = await placeHold(user.id, { eventId: event.id, tierId: tier.id, quantity: 4 });
    await prisma.hold.update({ where: { id: hold.body.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const detail = await request(app).get(`/events/${event.id}`);

    expect(detail.body.tiers[0].remainingQuantity).toBe(10);
  });
});

describe("event lifecycle", () => {
  it("finishes refunding on a repeat cancel after an earlier run died between its two steps", async () => {
    const { organiser, event, tier } = await gaEvent();
    const admin = await createTestUser();
    await createTestMembership(organiser.id, admin.id, "ADMIN");
    const buyer = await createTestUser();
    const order = await purchaseGaTickets(app, buyer.id, event.id, tier.id, 1);
    await prisma.event.update({ where: { id: event.id }, data: { status: "CANCELLED" } });

    const res = await request(app).post(`/organisers/${organiser.id}/events/${event.id}/cancel`).set("Authorization", auth(admin.id));

    expect(res.body).toMatchObject({ alreadyCancelled: true, refundedOrderCount: 1 });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("REFUNDED");
  });

  it("marks an event sold out on the last sale and reopens it on a refund", async () => {
    const { event, tier } = await gaEvent(1);
    const buyer = await createTestUser();
    const order = await purchaseGaTickets(app, buyer.id, event.id, tier.id, 1);
    expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).status).toBe("SOLD_OUT");

    await request(app)
      .post(`/orders/${order.id}/refund`)
      .set("Authorization", auth(buyer.id))
      .set("Idempotency-Key", randomUUID())
      .send({ reason: "x" });

    expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).status).toBe("ON_SALE");
  });

  it("doesn't call an event sold out while a hold could still give inventory back", async () => {
    const { event, tier } = await gaEvent(2);
    const buyer = await createTestUser();
    const other = await createTestUser();
    await placeHold(other.id, { eventId: event.id, tierId: tier.id, quantity: 1 });
    await purchaseGaTickets(app, buyer.id, event.id, tier.id, 1);

    expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).status).toBe("PUBLISHED");
  });

  it("lets an admin put an event on sale and complete it, and refuses staff", async () => {
    const { organiser, event } = await gaEvent();
    const admin = await createTestUser();
    const staff = await createTestUser();
    await createTestMembership(organiser.id, admin.id, "ADMIN");
    await createTestMembership(organiser.id, staff.id, "STAFF");
    const path = `/organisers/${organiser.id}/events/${event.id}`;

    expect((await request(app).post(`${path}/on-sale`).set("Authorization", auth(staff.id))).status).toBe(403);
    expect((await request(app).post(`${path}/on-sale`).set("Authorization", auth(admin.id))).body.status).toBe("ON_SALE");
    expect((await request(app).post(`${path}/complete`).set("Authorization", auth(admin.id))).body.status).toBe("COMPLETED");
    expect((await request(app).post(`${path}/on-sale`).set("Authorization", auth(admin.id))).status).toBe(409);
  });
});

describe("the assessment's API contract, as written", () => {
  it("accepts snake_case hold and order bodies and returns hold_id and expires_at", async () => {
    const { event, tier } = await gaEvent();
    const user = await createTestUser();

    const hold = await request(app)
      .post("/holds")
      .set("Authorization", auth(user.id))
      .send({ event_id: event.id, tier_id: tier.id, qty: 1 });
    expect(hold.status).toBe(201);
    expect(hold.body.hold_id).toEqual(expect.any(String));
    expect(hold.body.expires_at).toEqual(expect.any(String));

    const order = await request(app)
      .post("/orders")
      .set("Authorization", auth(user.id))
      .set("Idempotency-Key", randomUUID())
      .send({ hold_id: hold.body.hold_id });
    expect(order.status).toBe(201);

    const refund = await request(app)
      .post(`/orders/${order.body.id}/refund`)
      .set("Authorization", auth(user.id))
      .set("Idempotency-Key", randomUUID())
      .send({ ticket_ids: [order.body.tickets[0].id], reason: "x" });
    expect(refund.status).toBe(200);
  });

  it("serves POST /events, PATCH /events/:id and POST /events/:id/cancel with the same role rules", async () => {
    const { organiser, venue, event } = await gaEvent();
    const admin = await createTestUser();
    const staff = await createTestUser();
    const outsider = await createTestUser();
    await createTestMembership(organiser.id, admin.id, "ADMIN");
    await createTestMembership(organiser.id, staff.id, "STAFF");

    const created = await request(app)
      .post("/events")
      .set("Authorization", auth(admin.id))
      .send({ venue_id: venue.id, title: "New", description: "d", category: "music", starts_at: new Date(Date.now() + 86_400_000).toISOString() });
    expect(created.status).toBe(201);
    expect(created.body.organiserId).toBe(organiser.id);

    expect((await request(app).post("/events").set("Authorization", auth(outsider.id)).send({})).status).toBe(403);
    expect((await request(app).patch(`/events/${event.id}`).set("Authorization", auth(outsider.id)).send({ title: "x" })).status).toBe(404);
    expect((await request(app).patch(`/events/${event.id}`).set("Authorization", auth(staff.id)).send({ title: "x" })).status).toBe(403);
    expect((await request(app).patch(`/events/${event.id}`).set("Authorization", auth(admin.id)).send({ title: "Renamed" })).body.title).toBe("Renamed");
    expect((await request(app).post(`/events/${event.id}/cancel`).set("Authorization", auth(staff.id))).status).toBe(403);
    expect((await request(app).post(`/events/${event.id}/cancel`).set("Authorization", auth(admin.id))).body.cancelled).toBe(true);
  });

  it("serves GET /audit scoped by role, without confirming another organiser's entities", async () => {
    const mine = await gaEvent();
    const theirs = await gaEvent();
    const admin = await createTestUser();
    const staff = await createTestUser();
    const attendee = await createTestUser();
    await createTestMembership(mine.organiser.id, admin.id, "ADMIN");
    await createTestMembership(mine.organiser.id, staff.id, "STAFF");
    const buyer = await createTestUser();
    const order = await purchaseGaTickets(app, buyer.id, mine.event.id, mine.tier.id, 1);
    const otherOrder = await purchaseGaTickets(app, buyer.id, theirs.event.id, theirs.tier.id, 1);

    const feed = await request(app).get("/audit").set("Authorization", auth(admin.id));
    expect(feed.status).toBe(200);
    expect(feed.body.items.every((e: { organiserId: string }) => e.organiserId === mine.organiser.id)).toBe(true);

    expect((await request(app).get("/audit").set("Authorization", auth(staff.id))).status).toBe(403);
    expect((await request(app).get("/audit").set("Authorization", auth(attendee.id))).status).toBe(403);

    const perOrder = await request(app).get(`/audit?entity=Order:${order.id}`).set("Authorization", auth(staff.id));
    expect(perOrder.body.items.map((e: { action: string }) => e.action)).toEqual(expect.arrayContaining(["ORDER_PAID", "HOLD_CREATED"]));

    const perEvent = await request(app).get(`/audit?entity=Event:${mine.event.id}`).set("Authorization", auth(staff.id));
    expect(perEvent.body.items.map((e: { action: string }) => e.action)).toContain("ORDER_PAID");

    const probe = await request(app).get(`/audit?entity=Order:${otherOrder.id}`).set("Authorization", auth(admin.id));
    expect(probe.status).toBe(200);
    expect(probe.body.items).toEqual([]);
  });
});

describe("audit coverage", () => {
  it("records order creation and a payment timeout, with actor and request id", async () => {
    const { event, tier } = await gaEvent();
    const user = await createTestUser();
    const hold = await placeHold(user.id, { eventId: event.id, tierId: tier.id, quantity: 1 });
    await request(app)
      .post("/orders")
      .set("Authorization", auth(user.id))
      .set("Idempotency-Key", randomUUID())
      .set("X-Payment-Scenario", "timeout_then_success")
      .send({ holdId: hold.body.id });

    const order = await prisma.order.findFirstOrThrow({ where: { holdId: hold.body.id } });
    const entries = await prisma.auditLog.findMany({ where: { entityType: "Order", entityId: order.id } });

    expect(entries.map((e) => e.action).sort()).toEqual(["ORDER_CREATED", "PAYMENT_TIMED_OUT"]);
    for (const entry of entries) {
      expect(entry.actorUserId).toBe(user.id);
      expect(entry.requestId).toBeTruthy();
    }
  });
});

describe("staff management", () => {
  it("lets an admin add, promote and remove members, audited, and protects the last admin", async () => {
    const { organiser } = await gaEvent();
    const admin = await createTestUser();
    await createTestMembership(organiser.id, admin.id, "ADMIN");
    const newcomer = await createTestUser();
    const path = `/organisers/${organiser.id}/members`;
    const asAdmin = auth(admin.id);

    const added = await request(app).post(path).set("Authorization", asAdmin).send({ email: newcomer.email, role: "STAFF" });
    expect(added.status).toBe(201);
    expect((await request(app).post(path).set("Authorization", asAdmin).send({ email: newcomer.email, role: "STAFF" })).status).toBe(409);
    expect((await request(app).post(path).set("Authorization", asAdmin).send({ email: "nobody@example.com", role: "STAFF" })).status).toBe(404);

    // Staff can't manage staff; outsiders can't see the organiser exists.
    expect((await request(app).get(path).set("Authorization", auth(newcomer.id))).status).toBe(403);
    const outsider = await createTestUser();
    expect((await request(app).get(path).set("Authorization", auth(outsider.id))).status).toBe(404);

    expect((await request(app).patch(`${path}/${admin.id}`).set("Authorization", asAdmin).send({ role: "STAFF" })).status).toBe(409);
    expect((await request(app).delete(`${path}/${admin.id}`).set("Authorization", asAdmin)).status).toBe(409);

    expect((await request(app).patch(`${path}/${newcomer.id}`).set("Authorization", asAdmin).send({ role: "ADMIN" })).body.role).toBe("ADMIN");
    expect((await request(app).delete(`${path}/${newcomer.id}`).set("Authorization", asAdmin)).status).toBe(204);

    const actions = await prisma.auditLog.findMany({ where: { organiserId: organiser.id, entityType: "Membership" }, select: { action: true } });
    expect(actions.map((a) => a.action).sort()).toEqual(["MEMBER_ADDED", "MEMBER_REMOVED", "MEMBER_ROLE_CHANGED"]);
  });
});

describe("reads added for the UI", () => {
  it("restores a user's own live hold after a reload, and never someone else's", async () => {
    const { event, tier } = await gaEvent();
    const user = await createTestUser();
    const stranger = await createTestUser();
    const hold = await placeHold(user.id, { eventId: event.id, tierId: tier.id, quantity: 2 });

    const mine = await request(app).get(`/holds?event_id=${event.id}`).set("Authorization", auth(user.id));
    expect(mine.body.items).toHaveLength(1);
    expect(mine.body.items[0]).toMatchObject({ id: hold.body.id, quantity: 2, totalMinor: 2000 });

    const theirs = await request(app).get(`/holds?event_id=${event.id}`).set("Authorization", auth(stranger.id));
    expect(theirs.body.items).toEqual([]);
  });

  it("shows an organiser's orders to its members only, including across organisers", async () => {
    const mine = await gaEvent();
    const theirs = await gaEvent();
    const staff = await createTestUser();
    await createTestMembership(mine.organiser.id, staff.id, "STAFF");
    const buyer = await createTestUser();
    const order = await purchaseGaTickets(app, buyer.id, mine.event.id, mine.tier.id, 1);
    const other = await purchaseGaTickets(app, buyer.id, theirs.event.id, theirs.tier.id, 1);

    const list = await request(app).get(`/organisers/${mine.organiser.id}/orders`).set("Authorization", auth(staff.id));
    expect(list.body.items.map((o: { id: string }) => o.id)).toEqual([order.id]);
    expect(list.body.items.map((o: { id: string }) => o.id)).not.toContain(other.id);

    expect((await request(app).get(`/organisers/${theirs.organiser.id}/orders`).set("Authorization", auth(staff.id))).status).toBe(404);
    expect((await request(app).get(`/organisers/${mine.organiser.id}/orders`).set("Authorization", auth(buyer.id))).status).toBe(404);

    const crossEvent = await request(app).get(`/organisers/${mine.organiser.id}/orders?event_id=${theirs.event.id}`).set("Authorization", auth(staff.id));
    expect(crossEvent.body.items).toEqual([]);
  });
});
