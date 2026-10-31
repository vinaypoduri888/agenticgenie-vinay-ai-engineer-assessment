import { prisma } from "@agenticgenie/db";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { signAccessToken } from "../../src/modules/auth/jwt.js";
import {
  createTestEvent,
  createTestMembership,
  createTestOrganiser,
  createTestSeatMap,
  createTestUser,
  createTestVenue,
  resetFixtures,
} from "../helpers/fixtures.js";

const app = createApp();

afterEach(async () => {
  await resetFixtures();
});

async function adminSetup() {
  const user = await createTestUser();
  const organiser = await createTestOrganiser();
  await createTestMembership(organiser.id, user.id, "ADMIN");
  const venue = await createTestVenue(organiser.id);
  const event = await createTestEvent(organiser.id, venue.id);
  return { organiser, venue, event, auth: `Bearer ${signAccessToken(user.id)}` };
}

describe("GA ticket tiers", () => {
  it("creates a tier with remainingQuantity seeded from totalQuantity", async () => {
    const { organiser, event, auth } = await adminSetup();

    const response = await request(app)
      .post(`/organisers/${organiser.id}/events/${event.id}/ticket-tiers`)
      .set("Authorization", auth)
      .send({ name: "General Admission", priceMinor: 80000, totalQuantity: 100 });

    expect(response.status).toBe(201);
    expect(response.body.totalQuantity).toBe(100);
    expect(response.body.remainingQuantity).toBe(100);
  });

  it("rejects a negative price or zero quantity at the validation layer", async () => {
    const { organiser, event, auth } = await adminSetup();

    const response = await request(app)
      .post(`/organisers/${organiser.id}/events/${event.id}/ticket-tiers`)
      .set("Authorization", auth)
      .send({ name: "Bad Tier", priceMinor: -1, totalQuantity: 0 });

    expect(response.status).toBe(400);
  });

  it("the DB rejects remaining_quantity outside [0, total_quantity] even bypassing the API", async () => {
    const { event } = await adminSetup();
    const tier = await prisma.ticketTier.create({
      data: { eventId: event.id, name: "X", priceMinor: 100, totalQuantity: 10, remainingQuantity: 10 },
    });

    await expect(
      prisma.ticketTier.update({ where: { id: tier.id }, data: { remainingQuantity: -1 } }),
    ).rejects.toThrow();
    await expect(
      prisma.ticketTier.update({ where: { id: tier.id }, data: { remainingQuantity: 11 } }),
    ).rejects.toThrow();
  });

  it("rejects a duplicate tier name for the same event", async () => {
    const { organiser, event, auth } = await adminSetup();
    await request(app)
      .post(`/organisers/${organiser.id}/events/${event.id}/ticket-tiers`)
      .set("Authorization", auth)
      .send({ name: "GA", priceMinor: 100, totalQuantity: 10 });

    const response = await request(app)
      .post(`/organisers/${organiser.id}/events/${event.id}/ticket-tiers`)
      .set("Authorization", auth)
      .send({ name: "GA", priceMinor: 200, totalQuantity: 5 });

    expect(response.status).toBe(409);
  });
});

describe("EventSeat generation", () => {
  it("generates one EventSeat per physical seat in the priced sections", async () => {
    const { organiser, venue, event, auth } = await adminSetup();
    const { section } = await createTestSeatMap(venue.id);

    const response = await request(app)
      .post(`/organisers/${organiser.id}/events/${event.id}/seats/generate`)
      .set("Authorization", auth)
      .send({ sectionPrices: [{ sectionId: section.id, priceMinor: 150000 }] });

    expect(response.status).toBe(201);
    expect(response.body.seatsCreated).toBe(1);

    const eventSeats = await prisma.eventSeat.findMany({ where: { eventId: event.id } });
    expect(eventSeats).toHaveLength(1);
    expect(eventSeats[0]!.priceMinor).toBe(150000);
    expect(eventSeats[0]!.status).toBe("AVAILABLE");
  });

  it("rejects generating a seat map twice for the same event (409)", async () => {
    const { organiser, venue, event, auth } = await adminSetup();
    const { section } = await createTestSeatMap(venue.id);
    const body = { sectionPrices: [{ sectionId: section.id, priceMinor: 100 }] };

    const first = await request(app)
      .post(`/organisers/${organiser.id}/events/${event.id}/seats/generate`)
      .set("Authorization", auth)
      .send(body);
    expect(first.status).toBe(201);

    const second = await request(app)
      .post(`/organisers/${organiser.id}/events/${event.id}/seats/generate`)
      .set("Authorization", auth)
      .send(body);
    expect(second.status).toBe(409);
  });

  it("the DB rejects a duplicate (eventId, seatId) EventSeat even bypassing the service layer", async () => {
    const { venue, event } = await adminSetup();
    const { seat } = await createTestSeatMap(venue.id);
    await prisma.eventSeat.create({ data: { eventId: event.id, seatId: seat.id, priceMinor: 100 } });

    await expect(
      prisma.eventSeat.create({ data: { eventId: event.id, seatId: seat.id, priceMinor: 200 } }),
    ).rejects.toThrow();
  });

  it("rejects seat generation referencing a section from a different venue", async () => {
    const { organiser, event, auth } = await adminSetup();
    const otherVenue = await createTestVenue(organiser.id);
    const { section: sectionOnOtherVenue } = await createTestSeatMap(otherVenue.id);

    const response = await request(app)
      .post(`/organisers/${organiser.id}/events/${event.id}/seats/generate`)
      .set("Authorization", auth)
      .send({ sectionPrices: [{ sectionId: sectionOnOtherVenue.id, priceMinor: 100 }] });

    expect(response.status).toBe(404);
  });
});
