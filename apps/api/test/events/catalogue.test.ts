import { prisma } from "@agenticgenie/db";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import {
  createTestEvent,
  createTestOrganiser,
  createTestVenue,
  resetFixtures,
} from "../helpers/fixtures.js";

const app = createApp();

afterEach(async () => {
  await resetFixtures();
});

describe("public event catalogue visibility", () => {
  it("does not show DRAFT events", async () => {
    const organiser = await createTestOrganiser();
    const venue = await createTestVenue(organiser.id, { city: "Pune" });
    const draft = await createTestEvent(organiser.id, venue.id, { status: "DRAFT", title: "Hidden Draft" });

    const response = await request(app).get("/events").query({ city: "Pune" });

    expect(response.status).toBe(200);
    expect(response.body.items.find((e: { id: string }) => e.id === draft.id)).toBeUndefined();
  });

  it("shows PUBLISHED events in the catalogue", async () => {
    const organiser = await createTestOrganiser();
    const venue = await createTestVenue(organiser.id, { city: "Pune" });
    const published = await createTestEvent(organiser.id, venue.id, {
      status: "PUBLISHED",
      title: "Visible Show",
    });

    const response = await request(app).get("/events").query({ city: "Pune" });

    expect(response.body.items.map((e: { id: string }) => e.id)).toContain(published.id);
  });

  it("GET /events/:id hides a DRAFT event (404) but shows a CANCELLED one", async () => {
    const organiser = await createTestOrganiser();
    const venue = await createTestVenue(organiser.id);
    const draft = await createTestEvent(organiser.id, venue.id, { status: "DRAFT" });
    const cancelled = await createTestEvent(organiser.id, venue.id, { status: "CANCELLED" });

    const draftResponse = await request(app).get(`/events/${draft.id}`);
    const cancelledResponse = await request(app).get(`/events/${cancelled.id}`);

    expect(draftResponse.status).toBe(404);
    expect(cancelledResponse.status).toBe(200);
  });
});

describe("public catalogue filters", () => {
  it("filters by city", async () => {
    const organiser = await createTestOrganiser();
    const puneVenue = await createTestVenue(organiser.id, { city: "Pune" });
    const mumbaiVenue = await createTestVenue(organiser.id, { city: "Mumbai" });
    await createTestEvent(organiser.id, puneVenue.id, { status: "PUBLISHED", title: "Pune Show" });
    await createTestEvent(organiser.id, mumbaiVenue.id, { status: "PUBLISHED", title: "Mumbai Show" });

    const response = await request(app).get("/events").query({ city: "Pune" });

    const titles = response.body.items.map((e: { title: string }) => e.title);
    expect(titles).toContain("Pune Show");
    expect(titles).not.toContain("Mumbai Show");
  });

  it("filters by category", async () => {
    const organiser = await createTestOrganiser();
    const venue = await createTestVenue(organiser.id);
    await createTestEvent(organiser.id, venue.id, { status: "PUBLISHED", category: "comedy", title: "C1" });
    await createTestEvent(organiser.id, venue.id, { status: "PUBLISHED", category: "music", title: "M1" });

    const response = await request(app).get("/events").query({ category: "comedy" });

    const titles = response.body.items.map((e: { title: string }) => e.title);
    expect(titles).toContain("C1");
    expect(titles).not.toContain("M1");
  });

  it("filters by date range", async () => {
    const organiser = await createTestOrganiser();
    const venue = await createTestVenue(organiser.id);
    const soon = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    const farFuture = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
    await createTestEvent(organiser.id, venue.id, { status: "PUBLISHED", title: "Soon", startsAt: soon });
    await createTestEvent(organiser.id, venue.id, {
      status: "PUBLISHED",
      title: "Far",
      startsAt: farFuture,
    });

    const response = await request(app)
      .get("/events")
      .query({ from: new Date().toISOString(), to: new Date(Date.now() + 5 * 86_400_000).toISOString() });

    const titles = response.body.items.map((e: { title: string }) => e.title);
    expect(titles).toContain("Soon");
    expect(titles).not.toContain("Far");
  });

  it("filters by free-text search across title and description, combined with other filters", async () => {
    const organiser = await createTestOrganiser();
    const venue = await createTestVenue(organiser.id, { city: "Pune" });
    const match = await createTestEvent(organiser.id, venue.id, {
      status: "PUBLISHED",
      title: "Stand-up Spectacular",
      category: "comedy",
    });
    await createTestEvent(organiser.id, venue.id, { status: "PUBLISHED", title: "Jazz Night", category: "music" });

    // Exercises the fix where combining `q` (OR) with other filters (AND)
    // must not let one silently drop the other.
    const response = await request(app).get("/events").query({ city: "Pune", q: "Spectacular" });

    const ids = response.body.items.map((e: { id: string }) => e.id);
    expect(ids).toEqual([match.id]);
  });
});

describe("cursor pagination", () => {
  it("is stable under a concurrent insert between page fetches — no duplicates, no skips", async () => {
    const organiser = await createTestOrganiser();
    const venue = await createTestVenue(organiser.id, { city: "StableCity" });

    const seeded = [];
    for (let i = 0; i < 3; i++) {
      seeded.push(
        await createTestEvent(organiser.id, venue.id, { status: "PUBLISHED", title: `Seed ${i}` }),
      );
    }

    const page1 = await request(app).get("/events").query({ city: "StableCity", limit: 2 });
    expect(page1.body.items).toHaveLength(2);
    expect(page1.body.next_cursor).not.toBeNull();

    // Simulate a new event being published while the client is mid-pagination.
    const inserted = await createTestEvent(organiser.id, venue.id, {
      status: "PUBLISHED",
      title: "Inserted mid-pagination",
    });

    const page2 = await request(app)
      .get("/events")
      .query({ city: "StableCity", limit: 2, cursor: page1.body.next_cursor });

    const page1Ids = page1.body.items.map((e: { id: string }) => e.id);
    const page2Ids = page2.body.items.map((e: { id: string }) => e.id);

    // No id appears on both pages.
    expect(page1Ids.some((id: string) => page2Ids.includes(id))).toBe(false);
    // The 3rd originally-seeded event is still reachable on page 2 (not
    // skipped because of the insert).
    expect(page2Ids).toContain(seeded[2]!.id);
    // The newly-inserted event sorts after the cursor position (created
    // later) and so appears on page 2, not silently dropped.
    expect(page2Ids).toContain(inserted.id);
  });

  it("rejects a malformed cursor with 400", async () => {
    const response = await request(app).get("/events").query({ cursor: "not-valid-base64-json" });
    expect(response.status).toBe(400);
  });

  it("rejects a page size above the max with a validation error", async () => {
    const response = await request(app).get("/events").query({ limit: 500 });
    expect(response.status).toBe(400);
  });
});
