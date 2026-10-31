import { randomUUID } from "node:crypto";
import { prisma } from "@agenticgenie/db";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { computeRequestHash } from "../../src/lib/idempotency.js";
import { signAccessToken } from "../../src/modules/auth/jwt.js";
import { _resetFakeProviderForTests } from "../../src/modules/payments/fakeProvider.js";
import {
  createTestEvent,
  createTestOrganiser,
  createTestTicketTier,
  createTestUser,
  createTestVenue,
  resetFixtures,
} from "../helpers/fixtures.js";

const app = createApp();

afterEach(async () => {
  _resetFakeProviderForTests();
  await resetFixtures();
});

function authFor(userId: string) {
  return `Bearer ${signAccessToken(userId)}`;
}

async function setupHold(opts?: { totalQuantity?: number; quantity?: number }) {
  const organiser = await createTestOrganiser();
  const venue = await createTestVenue(organiser.id);
  const event = await createTestEvent(organiser.id, venue.id, { status: "PUBLISHED" });
  const tier = await createTestTicketTier(event.id, {
    priceMinor: 50000,
    totalQuantity: opts?.totalQuantity ?? 10,
  });
  const user = await createTestUser();

  const holdResponse = await request(app)
    .post("/holds")
    .set("Authorization", authFor(user.id))
    .set("Idempotency-Key", randomUUID())
    .send({ eventId: event.id, tierId: tier.id, quantity: opts?.quantity ?? 2 });

  return { organiser, venue, event, tier, user, hold: holdResponse.body };
}

describe("checkout — success path", () => {
  it("pays the order, issues one ticket per GA unit, converts the hold", async () => {
    const { user, hold } = await setupHold({ quantity: 2 });
    const key = randomUUID();

    const response = await request(app)
      .post("/orders")
      .set("Authorization", authFor(user.id))
      .set("Idempotency-Key", key)
      .send({ holdId: hold.id });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe("PAID");
    expect(response.body.tickets).toHaveLength(2);
    expect(response.body.paidByPaymentId).toEqual(expect.any(String));

    const holdAfter = await prisma.hold.findUniqueOrThrow({ where: { id: hold.id } });
    expect(holdAfter.status).toBe("CONVERTED");

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: response.body.paidByPaymentId } });
    expect(payment.status).toBe("SUCCEEDED");

    const idemRecord = await prisma.idempotencyRecord.findUniqueOrThrow({
      where: { userId_key_endpoint: { userId: user.id, key, endpoint: "POST /orders" } },
    });
    expect(payment.externalRef).toBe(idemRecord.id); // externalRef = owning IdempotencyRecord.id

    const tickets = await prisma.ticket.findMany({ where: { orderId: response.body.id } });
    expect(tickets).toHaveLength(2);
    expect(new Set(tickets.map((t) => t.code)).size).toBe(2); // unique codes
  });

  it("enforces one order per hold — the DB unique constraint on Order.holdId", async () => {
    const { user, hold } = await setupHold({ quantity: 1 });
    await request(app).post("/orders").set("Authorization", authFor(user.id)).set("Idempotency-Key", randomUUID()).send({ holdId: hold.id });

    await expect(
      prisma.order.create({ data: { userId: user.id, eventId: hold.eventId, holdId: hold.id, status: "PENDING_PAYMENT", totalAmountMinor: 1 } }),
    ).rejects.toThrow();
  });
});

describe("checkout — decline path", () => {
  it("declines the order, keeps the hold ACTIVE for retry, issues no tickets", async () => {
    const { user, hold, tier } = await setupHold({ quantity: 2, totalQuantity: 10 });

    const response = await request(app)
      .post("/orders")
      .set("Authorization", authFor(user.id))
      .set("Idempotency-Key", randomUUID())
      .set("X-Payment-Scenario", "decline")
      .send({ holdId: hold.id });

    expect(response.status).toBe(402);
    expect(response.body.status).toBe("DECLINED");

    const holdAfter = await prisma.hold.findUniqueOrThrow({ where: { id: hold.id } });
    expect(holdAfter.status).toBe("ACTIVE"); // not released — retry with the same hold is allowed

    const tickets = await prisma.ticket.findMany({ where: { orderId: response.body.id } });
    expect(tickets).toHaveLength(0);

    // Inventory was decremented at HOLD time, not purchase time — a decline
    // doesn't touch it either way.
    const tierAfter = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
    expect(tierAfter.remainingQuantity).toBe(8);
  });

  it("lets the same hold be retried after a decline, this time succeeding", async () => {
    const { user, hold } = await setupHold({ quantity: 1 });

    const declined = await request(app)
      .post("/orders")
      .set("Authorization", authFor(user.id))
      .set("Idempotency-Key", randomUUID())
      .set("X-Payment-Scenario", "decline")
      .send({ holdId: hold.id });
    expect(declined.status).toBe(402);

    const retried = await request(app)
      .post("/orders")
      .set("Authorization", authFor(user.id))
      .set("Idempotency-Key", randomUUID()) // a genuinely new attempt uses a new key
      .send({ holdId: hold.id });

    expect(retried.status).toBe(201);
    expect(retried.body.status).toBe("PAID");
  });
});

describe("checkout — timeout and stale takeover", () => {
  it("recovers a timeout via takeover without double-charging or double-issuing tickets", async () => {
    const { user, hold } = await setupHold({ quantity: 1 });
    const key = randomUUID();

    const first = await request(app)
      .post("/orders")
      .set("Authorization", authFor(user.id))
      .set("Idempotency-Key", key)
      .set("X-Payment-Scenario", "timeout_then_success")
      .send({ holdId: hold.id });

    expect(first.status).toBe(202);
    expect(first.body.status).toBe("PENDING_PAYMENT");

    const orderAfterTimeout = await prisma.order.findUniqueOrThrow({ where: { holdId: hold.id } });
    expect(orderAfterTimeout.status).toBe("PENDING_PAYMENT");
    const paymentsAfterTimeout = await prisma.payment.findMany({ where: { orderId: orderAfterTimeout.id } });
    expect(paymentsAfterTimeout).toHaveLength(1);
    expect(paymentsAfterTimeout[0]!.status).toBe("TIMED_OUT");

    // Force staleness without a real 30s wait — simulates enough time
    // passing for a retry to be allowed to take over.
    await prisma.idempotencyRecord.updateMany({
      where: { userId: user.id, key, endpoint: "POST /orders" },
      data: { updatedAt: new Date(Date.now() - 60_000) },
    });

    const retry = await request(app)
      .post("/orders")
      .set("Authorization", authFor(user.id))
      .set("Idempotency-Key", key) // SAME key — this is a takeover, not a fresh attempt
      .set("X-Payment-Scenario", "decline") // irrelevant: the provider already resolved this externalRef to SUCCESS
      .send({ holdId: hold.id });

    expect(retry.status).toBe(201);
    expect(retry.body.status).toBe("PAID");

    const orderAfter = await prisma.order.findUniqueOrThrow({ where: { holdId: hold.id } });
    expect(orderAfter.status).toBe("PAID");
    expect(orderAfter.paidByPaymentId).not.toBe(paymentsAfterTimeout[0]!.id); // the SECOND attempt's payment is authoritative

    const payments = await prisma.payment.findMany({ where: { orderId: orderAfter.id } });
    expect(payments).toHaveLength(2); // one per attempt, for audit history
    expect(payments.find((p) => p.id === paymentsAfterTimeout[0]!.id)?.status).toBe("TIMED_OUT"); // untouched

    const tickets = await prisma.ticket.findMany({ where: { orderId: orderAfter.id } });
    expect(tickets).toHaveLength(1); // not doubled
  });

  it("a non-stale in-flight duplicate gets 409, not a second charge attempt", async () => {
    const { user, hold } = await setupHold({ quantity: 1 });
    const key = randomUUID();

    // Manually claim the key as "still processing" to simulate a genuinely
    // concurrent duplicate arriving while the first is mid-flight.
    await prisma.idempotencyRecord.create({
      data: {
        userId: user.id,
        key,
        endpoint: "POST /orders",
        requestHash: computeRequestHash({ holdId: hold.id }),
        lockToken: randomUUID(),
        status: "PROCESSING",
      },
    });

    const response = await request(app)
      .post("/orders")
      .set("Authorization", authFor(user.id))
      .set("Idempotency-Key", key)
      .send({ holdId: hold.id });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("REQUEST_IN_PROGRESS");
  });
});

describe("checkout — idempotency", () => {
  it("replays the exact original result for the same key and body", async () => {
    const { user, hold } = await setupHold({ quantity: 1 });
    const key = randomUUID();
    const body = { holdId: hold.id };

    const first = await request(app).post("/orders").set("Authorization", authFor(user.id)).set("Idempotency-Key", key).send(body);
    const replay = await request(app).post("/orders").set("Authorization", authFor(user.id)).set("Idempotency-Key", key).send(body);

    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(replay.body.id).toBe(first.body.id);

    const tickets = await prisma.ticket.findMany({ where: { orderId: first.body.id } });
    expect(tickets).toHaveLength(1); // not issued twice
  });

  it("returns 422 when the same key is reused with a different hold", async () => {
    const { user, hold } = await setupHold({ quantity: 1 });
    const { hold: otherHold } = await setupHold({ quantity: 1 });
    const key = randomUUID();

    const first = await request(app).post("/orders").set("Authorization", authFor(user.id)).set("Idempotency-Key", key).send({ holdId: hold.id });
    expect(first.status).toBe(201);

    const second = await request(app).post("/orders").set("Authorization", authFor(user.id)).set("Idempotency-Key", key).send({ holdId: otherHold.id });
    expect(second.status).toBe(422);
    expect(second.body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
  });
});

describe("checkout — cross-user and state guards", () => {
  it("rejects checking out someone else's hold (404)", async () => {
    const { hold } = await setupHold({ quantity: 1 });
    const stranger = await createTestUser();

    const response = await request(app)
      .post("/orders")
      .set("Authorization", authFor(stranger.id))
      .set("Idempotency-Key", randomUUID())
      .send({ holdId: hold.id });

    expect(response.status).toBe(404);
  });

  it("rejects checkout on an expired hold and releases its inventory", async () => {
    const { user, hold, tier } = await setupHold({ quantity: 2, totalQuantity: 10 });
    await prisma.hold.update({ where: { id: hold.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const response = await request(app)
      .post("/orders")
      .set("Authorization", authFor(user.id))
      .set("Idempotency-Key", randomUUID())
      .send({ holdId: hold.id });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("HOLD_EXPIRED");

    const tierAfter = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
    expect(tierAfter.remainingQuantity).toBe(10);
  });

  it("rejects starting a checkout against an already-cancelled event", async () => {
    const { user, hold, event } = await setupHold({ quantity: 1 });
    await prisma.event.update({ where: { id: event.id }, data: { status: "CANCELLED" } });

    const response = await request(app)
      .post("/orders")
      .set("Authorization", authFor(user.id))
      .set("Idempotency-Key", randomUUID())
      .send({ holdId: hold.id });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("EVENT_NOT_ON_SALE");
    // Note: Phase 1's own event-status check means a checkout can never even
    // START against an already-cancelled event, as this test shows. The
    // deeper race this design also defends against — the event being
    // cancelled WHILE a checkout's external payment call is already in
    // flight, requiring Phase 3's own re-check-and-auto-refund — needs a
    // real cancellation endpoint to interleave against realistically, and
    // is covered in Stage 2.5's cancellation test suite instead of here.
  });
});
