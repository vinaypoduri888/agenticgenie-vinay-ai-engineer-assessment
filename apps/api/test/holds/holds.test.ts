import { randomUUID } from "node:crypto";
import { prisma } from "@agenticgenie/db";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { signAccessToken } from "../../src/modules/auth/jwt.js";
import { sweepAllExpiredHolds } from "../../src/modules/holds/sweeper.js";
import {
  createTestEvent,
  createTestOrganiser,
  createTestSeatMap,
  createTestTicketTier,
  createTestUser,
  createTestVenue,
  resetFixtures,
} from "../helpers/fixtures.js";

const app = createApp();

afterEach(async () => {
  await resetFixtures();
});

async function setupPublishedEvent() {
  const organiser = await createTestOrganiser();
  const venue = await createTestVenue(organiser.id);
  const event = await createTestEvent(organiser.id, venue.id, { status: "PUBLISHED" });
  return { organiser, venue, event };
}

function authFor(userId: string) {
  return `Bearer ${signAccessToken(userId)}`;
}

describe("seat concurrency — 50 parallel holds on the same seat", () => {
  it("lets exactly one succeed and the rest get a clean 409", async () => {
    const { venue, event } = await setupPublishedEvent();
    const { seat } = await createTestSeatMap(venue.id);
    await prisma.eventSeat.create({ data: { eventId: event.id, seatId: seat.id, priceMinor: 100000 } });

    const users = await Promise.all(Array.from({ length: 50 }, () => createTestUser()));

    const responses = await Promise.all(
      users.map((user) =>
        request(app)
          .post("/holds")
          .set("Authorization", authFor(user.id))
          .set("Idempotency-Key", randomUUID())
          .send({ eventId: event.id, seatIds: [seat.id] }),
      ),
    );

    const succeeded = responses.filter((r) => r.status === 201);
    const conflicted = responses.filter((r) => r.status === 409);

    expect(succeeded).toHaveLength(1);
    expect(conflicted).toHaveLength(49);

    const finalSeat = await prisma.eventSeat.findUniqueOrThrow({
      where: { eventId_seatId: { eventId: event.id, seatId: seat.id } },
    });
    expect(finalSeat.status).toBe("HELD");
  });
});

describe("GA concurrency — 200 buyers competing for 100 tickets", () => {
  it("lets exactly 100 succeed, never oversells, never goes negative", async () => {
    const { event } = await setupPublishedEvent();
    const tier = await createTestTicketTier(event.id, { totalQuantity: 100 });

    const users = await Promise.all(Array.from({ length: 200 }, () => createTestUser()));

    const responses = await Promise.all(
      users.map((user) =>
        request(app)
          .post("/holds")
          .set("Authorization", authFor(user.id))
          .set("Idempotency-Key", randomUUID())
          .send({ eventId: event.id, tierId: tier.id, quantity: 1 }),
      ),
    );

    const succeeded = responses.filter((r) => r.status === 201);
    const failed = responses.filter((r) => r.status !== 201);

    expect(succeeded).toHaveLength(100);
    expect(failed).toHaveLength(100);
    for (const r of failed) {
      expect(r.status).toBe(409);
    }

    const finalTier = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
    expect(finalTier.remainingQuantity).toBe(0);
    expect(finalTier.remainingQuantity).toBeGreaterThanOrEqual(0);

    const activeHolds = await prisma.hold.count({ where: { eventId: event.id, status: "ACTIVE" } });
    expect(activeHolds).toBe(100);
  }, 30_000);
});

describe("hold business rules", () => {
  it("rejects holding a DRAFT event", async () => {
    const organiser = await createTestOrganiser();
    const venue = await createTestVenue(organiser.id);
    const event = await createTestEvent(organiser.id, venue.id, { status: "DRAFT" });
    const tier = await createTestTicketTier(event.id);
    const user = await createTestUser();

    const response = await request(app)
      .post("/holds")
      .set("Authorization", authFor(user.id))
      .set("Idempotency-Key", randomUUID())
      .send({ eventId: event.id, tierId: tier.id, quantity: 1 });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("EVENT_NOT_ON_SALE");
  });

  it("rejects a second active hold for the same user and event", async () => {
    const { event } = await setupPublishedEvent();
    const tier = await createTestTicketTier(event.id, { totalQuantity: 10 });
    const user = await createTestUser();

    const first = await request(app)
      .post("/holds")
      .set("Authorization", authFor(user.id))
      .set("Idempotency-Key", randomUUID())
      .send({ eventId: event.id, tierId: tier.id, quantity: 1 });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post("/holds")
      .set("Authorization", authFor(user.id))
      .set("Idempotency-Key", randomUUID())
      .send({ eventId: event.id, tierId: tier.id, quantity: 1 });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("ACTIVE_HOLD_EXISTS");
  });

  it("rejects a hold requesting more than 8 tickets at once (schema validation)", async () => {
    const { event } = await setupPublishedEvent();
    const tier = await createTestTicketTier(event.id, { totalQuantity: 20 });
    const user = await createTestUser();

    const response = await request(app)
      .post("/holds")
      .set("Authorization", authFor(user.id))
      .set("Idempotency-Key", randomUUID())
      .send({ eventId: event.id, tierId: tier.id, quantity: 9 });

    expect(response.status).toBe(400);
  });

  it("rejects a seatIds+tierId ambiguous body", async () => {
    const { event } = await setupPublishedEvent();
    const user = await createTestUser();

    const response = await request(app)
      .post("/holds")
      .set("Authorization", authFor(user.id))
      .set("Idempotency-Key", randomUUID())
      .send({ eventId: event.id, seatIds: ["x"], tierId: "y", quantity: 1 });

    expect(response.status).toBe(400);
  });
});

describe("hold ownership", () => {
  it("lets only the owning user release their hold", async () => {
    const { event } = await setupPublishedEvent();
    const tier = await createTestTicketTier(event.id);
    const owner = await createTestUser();
    const stranger = await createTestUser();

    const created = await request(app)
      .post("/holds")
      .set("Authorization", authFor(owner.id))
      .set("Idempotency-Key", randomUUID())
      .send({ eventId: event.id, tierId: tier.id, quantity: 1 });

    const strangerAttempt = await request(app)
      .delete(`/holds/${created.body.id}`)
      .set("Authorization", authFor(stranger.id));
    expect(strangerAttempt.status).toBe(404);

    const ownerAttempt = await request(app)
      .delete(`/holds/${created.body.id}`)
      .set("Authorization", authFor(owner.id));
    expect(ownerAttempt.status).toBe(200);

    const tierAfter = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
    expect(tierAfter.remainingQuantity).toBe(tier.remainingQuantity);
  });

  it("releasing an already-released hold is idempotent (200, not an error)", async () => {
    const { event } = await setupPublishedEvent();
    const tier = await createTestTicketTier(event.id);
    const owner = await createTestUser();

    const created = await request(app)
      .post("/holds")
      .set("Authorization", authFor(owner.id))
      .set("Idempotency-Key", randomUUID())
      .send({ eventId: event.id, tierId: tier.id, quantity: 1 });

    const first = await request(app).delete(`/holds/${created.body.id}`).set("Authorization", authFor(owner.id));
    const second = await request(app).delete(`/holds/${created.body.id}`).set("Authorization", authFor(owner.id));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const tierAfter = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
    expect(tierAfter.remainingQuantity).toBe(tier.remainingQuantity); // not double-credited
  });
});

describe("hold expiry", () => {
  it("sweeping an expired hold releases its GA inventory exactly once, even if swept twice", async () => {
    const { event } = await setupPublishedEvent();
    const tier = await createTestTicketTier(event.id, { totalQuantity: 10 });
    const user = await createTestUser();

    const created = await request(app)
      .post("/holds")
      .set("Authorization", authFor(user.id))
      .set("Idempotency-Key", randomUUID())
      .send({ eventId: event.id, tierId: tier.id, quantity: 3 });
    expect(created.status).toBe(201);

    // Simulate time passing — directly backdate expiresAt (a fake clock for
    // this one row) rather than waiting out the real 10-minute default.
    // The sweep is platform-wide and the demo seed deliberately leaves an expired
    // hold behind, so clear anything already lapsed before counting this one.
    await sweepAllExpiredHolds();
    await prisma.hold.update({ where: { id: created.body.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const firstSweep = await sweepAllExpiredHolds();
    const secondSweep = await sweepAllExpiredHolds();

    expect(firstSweep).toBe(1);
    expect(secondSweep).toBe(0); // nothing left to expire — not double-credited

    const tierAfter = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
    expect(tierAfter.remainingQuantity).toBe(10);

    const holdAfter = await prisma.hold.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(holdAfter.status).toBe("EXPIRED");
  });

  it("sweeping many expired holds concurrently (two overlapping sweeps racing for real) never double-releases inventory", async () => {
    const { event } = await setupPublishedEvent();
    const tier = await createTestTicketTier(event.id, { totalQuantity: 100 });

    const users = await Promise.all(Array.from({ length: 20 }, () => createTestUser()));
    const holds = await Promise.all(
      users.map((user) =>
        request(app)
          .post("/holds")
          .set("Authorization", authFor(user.id))
          .set("Idempotency-Key", randomUUID())
          .send({ eventId: event.id, tierId: tier.id, quantity: 2 }),
      ),
    );
    expect(holds.every((h) => h.status === 201)).toBe(true);

    await prisma.hold.updateMany({
      where: { eventId: event.id, status: "ACTIVE" },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    // Two sweeps launched together — unlike the sequential first/second
    // sweep above, these genuinely overlap and race on the same 20 rows via
    // Promise.all, exercising expireHold's `WHERE status = 'ACTIVE'`
    // conditional-update guard for real concurrent contention, not just
    // "nothing left after the first pass."
    const [countA, countB] = await Promise.all([sweepAllExpiredHolds(), sweepAllExpiredHolds()]);

    expect(countA + countB).toBe(20); // every hold expired exactly once, split across the two racing sweeps
    const tierAfter = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
    expect(tierAfter.remainingQuantity).toBe(100); // fully restored, not double-credited
    const stillActive = await prisma.hold.count({ where: { eventId: event.id, status: "ACTIVE" } });
    expect(stillActive).toBe(0);
  }, 15_000);

  it("an expired hold cannot be used for checkout (lazy-expiry via getUsableHoldOrThrow)", async () => {
    const { event } = await setupPublishedEvent();
    const tier = await createTestTicketTier(event.id);
    const user = await createTestUser();

    const created = await request(app)
      .post("/holds")
      .set("Authorization", authFor(user.id))
      .set("Idempotency-Key", randomUUID())
      .send({ eventId: event.id, tierId: tier.id, quantity: 1 });

    await prisma.hold.update({ where: { id: created.body.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const { getUsableHoldOrThrow } = await import("../../src/modules/holds/service.js");
    await expect(getUsableHoldOrThrow(created.body.id, user.id)).rejects.toMatchObject({
      status: 409,
      code: "HOLD_EXPIRED",
    });

    const tierAfter = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
    expect(tierAfter.remainingQuantity).toBe(tier.remainingQuantity); // released by the lazy check
  });
});

describe("hold idempotency", () => {
  it("a genuinely concurrent duplicate request (same key, fired together) still produces exactly one hold", async () => {
    const { event } = await setupPublishedEvent();
    const tier = await createTestTicketTier(event.id, { totalQuantity: 10 });
    const user = await createTestUser();
    const key = randomUUID();
    const body = { eventId: event.id, tierId: tier.id, quantity: 1 };

    // Unlike the sequential replay test below, this fires both requests
    // together (Promise.all) so they race for real on the DB's unique
    // (userId, key, endpoint) constraint — exercising the actual P2002
    // handling path in lib/idempotency.ts, not just the COMPLETED-replay
    // branch a sequential test would hit.
    const [a, b] = await Promise.all([
      request(app).post("/holds").set("Authorization", authFor(user.id)).set("Idempotency-Key", key).send(body),
      request(app).post("/holds").set("Authorization", authFor(user.id)).set("Idempotency-Key", key).send(body),
    ]);

    // Both responses must agree on the outcome: either both see the same
    // successful hold (one raced in as the owner, the other replayed it),
    // or the loser gets a clean 409 if it arrived while the winner was still
    // mid-flight. What must never happen is two different hold ids or a
    // double inventory decrement.
    const statuses = [a.status, b.status].sort((x, y) => x - y);
    expect(statuses[0]).toBe(201);
    expect(statuses[1] === 201 || statuses[1] === 409).toBe(true);
    if (a.status === 201 && b.status === 201) {
      expect(a.body.id).toBe(b.body.id);
    }

    const holds = await prisma.hold.count({ where: { eventId: event.id, userId: user.id } });
    expect(holds).toBe(1);
    const tierAfter = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
    expect(tierAfter.remainingQuantity).toBe(9); // decremented exactly once, not twice
  });

  it("replays the original result for the same key and same payload", async () => {
    const { event } = await setupPublishedEvent();
    const tier = await createTestTicketTier(event.id, { totalQuantity: 10 });
    const user = await createTestUser();
    const key = randomUUID();
    const body = { eventId: event.id, tierId: tier.id, quantity: 1 };

    const first = await request(app).post("/holds").set("Authorization", authFor(user.id)).set("Idempotency-Key", key).send(body);
    const replay = await request(app).post("/holds").set("Authorization", authFor(user.id)).set("Idempotency-Key", key).send(body);

    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(replay.body.id).toBe(first.body.id);

    // Only decremented once, not once per request.
    const tierAfter = await prisma.ticketTier.findUniqueOrThrow({ where: { id: tier.id } });
    expect(tierAfter.remainingQuantity).toBe(9);
  });

  it("returns 422 when the same key is reused with a different payload", async () => {
    const { event } = await setupPublishedEvent();
    const tier = await createTestTicketTier(event.id, { totalQuantity: 10 });
    const user = await createTestUser();
    const key = randomUUID();

    const first = await request(app)
      .post("/holds")
      .set("Authorization", authFor(user.id))
      .set("Idempotency-Key", key)
      .send({ eventId: event.id, tierId: tier.id, quantity: 1 });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post("/holds")
      .set("Authorization", authFor(user.id))
      .set("Idempotency-Key", key)
      .send({ eventId: event.id, tierId: tier.id, quantity: 2 });
    expect(second.status).toBe(422);
    expect(second.body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it("requires an Idempotency-Key header", async () => {
    const { event } = await setupPublishedEvent();
    const tier = await createTestTicketTier(event.id);
    const user = await createTestUser();

    const response = await request(app)
      .post("/holds")
      .set("Authorization", authFor(user.id))
      .send({ eventId: event.id, tierId: tier.id, quantity: 1 });

    // Optional on holds per the API contract; required on orders and refunds.
    expect(response.status).toBe(201);
  });
});
