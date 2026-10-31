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
  return { user, organiser, venue, auth: `Bearer ${signAccessToken(user.id)}` };
}

describe("event creation", () => {
  it("creates an event as DRAFT", async () => {
    const { organiser, venue, auth } = await adminSetup();

    const response = await request(app)
      .post(`/organisers/${organiser.id}/events`)
      .set("Authorization", auth)
      .send({
        venueId: venue.id,
        title: "Comedy Night",
        description: "Stand-up comedy",
        category: "comedy",
        startsAt: new Date(Date.now() + 86_400_000).toISOString(),
      });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe("DRAFT");

    const log = await prisma.auditLog.findFirst({
      where: { entityType: "Event", entityId: response.body.id, action: "EVENT_CREATED" },
    });
    expect(log).not.toBeNull();
  });

  it("rejects creating an event against another organiser's venue (composite FK + service check)", async () => {
    const { organiser, auth } = await adminSetup();
    const otherOrganiser = await createTestOrganiser();
    const otherVenue = await createTestVenue(otherOrganiser.id);

    const response = await request(app)
      .post(`/organisers/${organiser.id}/events`)
      .set("Authorization", auth)
      .send({
        venueId: otherVenue.id,
        title: "Comedy Night",
        description: "Stand-up comedy",
        category: "comedy",
        startsAt: new Date(Date.now() + 86_400_000).toISOString(),
      });

    expect(response.status).toBe(404);
  });

  it("forbids staff from creating an event (admin-only)", async () => {
    const user = await createTestUser();
    const organiser = await createTestOrganiser();
    await createTestMembership(organiser.id, user.id, "STAFF");
    const venue = await createTestVenue(organiser.id);

    const response = await request(app)
      .post(`/organisers/${organiser.id}/events`)
      .set("Authorization", `Bearer ${signAccessToken(user.id)}`)
      .send({
        venueId: venue.id,
        title: "Comedy Night",
        description: "Stand-up comedy",
        category: "comedy",
        startsAt: new Date(Date.now() + 86_400_000).toISOString(),
      });

    expect(response.status).toBe(403);
  });

  it("returns 404 for another organiser's event", async () => {
    const { auth } = await adminSetup();
    const { organiser: otherOrganiser, venue: otherVenue } = await adminSetup();
    const otherEvent = await createTestEvent(otherOrganiser.id, otherVenue.id);
    const { organiser: ownOrganiser } = await adminSetup();

    const response = await request(app)
      .get(`/organisers/${ownOrganiser.id}/events/${otherEvent.id}`)
      .set("Authorization", auth);

    expect(response.status).toBe(404);
  });
});

describe("event update", () => {
  it("updates title/description while DRAFT", async () => {
    const { organiser, venue, auth } = await adminSetup();
    const event = await createTestEvent(organiser.id, venue.id, { title: "Old Title" });

    const response = await request(app)
      .patch(`/organisers/${organiser.id}/events/${event.id}`)
      .set("Authorization", auth)
      .send({ title: "New Title" });

    expect(response.status).toBe(200);
    expect(response.body.title).toBe("New Title");
  });

  it("rejects updates to a COMPLETED event", async () => {
    const { organiser, venue, auth } = await adminSetup();
    const event = await createTestEvent(organiser.id, venue.id, { status: "COMPLETED" });

    const response = await request(app)
      .patch(`/organisers/${organiser.id}/events/${event.id}`)
      .set("Authorization", auth)
      .send({ title: "New Title" });

    expect(response.status).toBe(409);
  });
});

describe("event publishing and status transitions", () => {
  it("rejects publishing an event with no inventory configured", async () => {
    const { organiser, venue, auth } = await adminSetup();
    const event = await createTestEvent(organiser.id, venue.id);

    const response = await request(app)
      .post(`/organisers/${organiser.id}/events/${event.id}/publish`)
      .set("Authorization", auth);

    expect(response.status).toBe(422);
  });

  it("publishes a DRAFT event once it has a ticket tier", async () => {
    const { organiser, venue, auth } = await adminSetup();
    const event = await createTestEvent(organiser.id, venue.id);
    await createTestTicketTier(event.id);

    const response = await request(app)
      .post(`/organisers/${organiser.id}/events/${event.id}/publish`)
      .set("Authorization", auth);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("PUBLISHED");

    const log = await prisma.auditLog.findFirst({
      where: { entityType: "Event", entityId: event.id, action: "EVENT_PUBLISHED" },
    });
    expect((log?.beforeData as { status: string }).status).toBe("DRAFT");
    expect((log?.afterData as { status: string }).status).toBe("PUBLISHED");
  });

  it("rejects publishing an already-published event (invalid transition)", async () => {
    const { organiser, venue, auth } = await adminSetup();
    const event = await createTestEvent(organiser.id, venue.id, { status: "PUBLISHED" });
    await createTestTicketTier(event.id);

    const response = await request(app)
      .post(`/organisers/${organiser.id}/events/${event.id}/publish`)
      .set("Authorization", auth);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("INVALID_STATUS_TRANSITION");
  });

  it("rejects publishing a CANCELLED event", async () => {
    const { organiser, venue, auth } = await adminSetup();
    const event = await createTestEvent(organiser.id, venue.id, { status: "CANCELLED" });
    await createTestTicketTier(event.id);

    const response = await request(app)
      .post(`/organisers/${organiser.id}/events/${event.id}/publish`)
      .set("Authorization", auth);

    expect(response.status).toBe(409);
  });
});

describe("listing an organiser's own events", () => {
  it("returns only the calling organiser's own events", async () => {
    const { organiser, venue, auth } = await adminSetup();
    const { organiser: otherOrganiser, venue: otherVenue } = await adminSetup();
    await createTestEvent(organiser.id, venue.id, { title: "Mine" });
    await createTestEvent(otherOrganiser.id, otherVenue.id, { title: "Not mine" });

    const response = await request(app).get(`/organisers/${organiser.id}/events`).set("Authorization", auth);

    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0].title).toBe("Mine");
  });

  it("returns 404 for a non-member", async () => {
    const { organiser } = await adminSetup();
    const outsider = await createTestUser();

    const response = await request(app)
      .get(`/organisers/${organiser.id}/events`)
      .set("Authorization", `Bearer ${signAccessToken(outsider.id)}`);

    expect(response.status).toBe(404);
  });
});
