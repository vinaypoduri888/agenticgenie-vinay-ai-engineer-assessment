import { prisma } from "@agenticgenie/db";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { signAccessToken } from "../../src/modules/auth/jwt.js";
import {
  createTestMembership,
  createTestOrganiser,
  createTestSeatMap,
  createTestSection,
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
  return { user, organiser, auth: `Bearer ${signAccessToken(user.id)}` };
}

describe("venue creation and organiser isolation", () => {
  it("lets an admin create a venue for their own organiser", async () => {
    const { organiser, auth } = await adminSetup();

    const response = await request(app)
      .post(`/organisers/${organiser.id}/venues`)
      .set("Authorization", auth)
      .send({ name: "Laugh Factory", address: "1 Main St", city: "Pune" });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ name: "Laugh Factory", city: "Pune", organiserId: organiser.id });
  });

  it("writes an audit log entry in the same transaction as venue creation", async () => {
    const { organiser, auth } = await adminSetup();

    const response = await request(app)
      .post(`/organisers/${organiser.id}/venues`)
      .set("Authorization", auth)
      .send({ name: "Laugh Factory", address: "1 Main St", city: "Pune" });

    const log = await prisma.auditLog.findFirst({
      where: { entityType: "Venue", entityId: response.body.id, action: "VENUE_CREATED" },
    });
    expect(log).not.toBeNull();
    expect(log?.organiserId).toBe(organiser.id);
    expect((log?.afterData as { name: string }).name).toBe("Laugh Factory");
  });

  it("forbids staff from creating a venue (admin-only)", async () => {
    const user = await createTestUser();
    const organiser = await createTestOrganiser();
    await createTestMembership(organiser.id, user.id, "STAFF");

    const response = await request(app)
      .post(`/organisers/${organiser.id}/venues`)
      .set("Authorization", `Bearer ${signAccessToken(user.id)}`)
      .send({ name: "Laugh Factory", address: "1 Main St", city: "Pune" });

    expect(response.status).toBe(403);
  });

  it("lists only the calling organiser's own venues", async () => {
    const { organiser, auth } = await adminSetup();
    const otherOrganiser = await createTestOrganiser();
    await createTestVenue(organiser.id, { name: "Mine" });
    await createTestVenue(otherOrganiser.id, { name: "Not mine" });

    const response = await request(app).get(`/organisers/${organiser.id}/venues`).set("Authorization", auth);

    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0].name).toBe("Mine");
  });

  it("returns 404 (not 403) when fetching another organiser's venue", async () => {
    const { auth } = await adminSetup();
    const otherOrganiser = await createTestOrganiser();
    const otherVenue = await createTestVenue(otherOrganiser.id);
    // The caller is an admin of THEIR OWN organiser, which is a real,
    // existing membership — but the venue belongs to someone else's.
    const { organiser: ownOrganiser } = await adminSetup();

    const response = await request(app)
      .get(`/organisers/${ownOrganiser.id}/venues/${otherVenue.id}`)
      .set("Authorization", auth);

    expect(response.status).toBe(404);
  });

  it("updates a venue and records before/after audit state", async () => {
    const { organiser, auth } = await adminSetup();
    const venue = await createTestVenue(organiser.id, { name: "Old Name" });

    const response = await request(app)
      .patch(`/organisers/${organiser.id}/venues/${venue.id}`)
      .set("Authorization", auth)
      .send({ name: "New Name" });

    expect(response.status).toBe(200);
    expect(response.body.name).toBe("New Name");

    const log = await prisma.auditLog.findFirst({
      where: { entityType: "Venue", entityId: venue.id, action: "VENUE_UPDATED" },
    });
    expect((log?.beforeData as { name: string }).name).toBe("Old Name");
    expect((log?.afterData as { name: string }).name).toBe("New Name");
  });
});

describe("seat-map hierarchy creation", () => {
  it("creates a section, row, and seat, and returns the full seat map on venue detail", async () => {
    const { organiser, auth } = await adminSetup();
    const venue = await createTestVenue(organiser.id);

    const section = await request(app)
      .post(`/organisers/${organiser.id}/venues/${venue.id}/sections`)
      .set("Authorization", auth)
      .send({ name: "Orchestra" });
    expect(section.status).toBe(201);

    const row = await request(app)
      .post(`/organisers/${organiser.id}/venues/${venue.id}/sections/${section.body.id}/rows`)
      .set("Authorization", auth)
      .send({ label: "A" });
    expect(row.status).toBe(201);

    const seat = await request(app)
      .post(
        `/organisers/${organiser.id}/venues/${venue.id}/sections/${section.body.id}/rows/${row.body.id}/seats`,
      )
      .set("Authorization", auth)
      .send({ label: "12" });
    expect(seat.status).toBe(201);

    const detail = await request(app)
      .get(`/organisers/${organiser.id}/venues/${venue.id}`)
      .set("Authorization", auth);

    expect(detail.body.sections).toHaveLength(1);
    expect(detail.body.sections[0].rows[0].seats[0].label).toBe("12");
  });

  it("rejects a duplicate section name within the same venue with 409", async () => {
    const { organiser, auth } = await adminSetup();
    const venue = await createTestVenue(organiser.id);
    await createTestSection(venue.id, "Orchestra");

    const response = await request(app)
      .post(`/organisers/${organiser.id}/venues/${venue.id}/sections`)
      .set("Authorization", auth)
      .send({ name: "Orchestra" });

    expect(response.status).toBe(409);
  });

  it("rejects a duplicate seat label within the same row with 409", async () => {
    const { organiser, auth } = await adminSetup();
    const venue = await createTestVenue(organiser.id);
    const { row } = await createTestSeatMap(venue.id);

    const response = await request(app)
      .post(
        `/organisers/${organiser.id}/venues/${venue.id}/sections/${row.sectionId}/rows/${row.id}/seats`,
      )
      .set("Authorization", auth)
      .send({ label: "12" });
    expect(response.status).toBe(201);

    const duplicate = await request(app)
      .post(
        `/organisers/${organiser.id}/venues/${venue.id}/sections/${row.sectionId}/rows/${row.id}/seats`,
      )
      .set("Authorization", auth)
      .send({ label: "12" });
    expect(duplicate.status).toBe(409);
  });

  it("returns 404 when a row's sectionId doesn't match the URL's section", async () => {
    const { organiser, auth } = await adminSetup();
    const venue = await createTestVenue(organiser.id);
    const sectionA = await createTestSection(venue.id, "A");
    const sectionB = await createTestSection(venue.id, "B");
    const rowUnderA = await prisma.row.create({ data: { sectionId: sectionA.id, label: "1" } });

    const response = await request(app)
      .post(
        `/organisers/${organiser.id}/venues/${venue.id}/sections/${sectionB.id}/rows/${rowUnderA.id}/seats`,
      )
      .set("Authorization", auth)
      .send({ label: "1" });

    expect(response.status).toBe(404);
  });
});
