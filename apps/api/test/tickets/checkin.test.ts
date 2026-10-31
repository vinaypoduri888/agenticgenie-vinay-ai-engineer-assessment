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

async function setupPaidTicket() {
  const organiser = await createTestOrganiser();
  const venue = await createTestVenue(organiser.id);
  const event = await createTestEvent(organiser.id, venue.id, { status: "PUBLISHED" });
  const tier = await createTestTicketTier(event.id, { totalQuantity: 10 });
  const attendee = await createTestUser();
  const staff = await createTestUser();
  await createTestMembership(organiser.id, staff.id, "STAFF");

  const order = await purchaseGaTickets(app, attendee.id, event.id, tier.id, 1);
  return { organiser, event, attendee, staff, ticket: order.tickets[0] };
}

describe("ticket check-in", () => {
  it("lets staff of the owning organiser check in a valid ticket", async () => {
    const { staff, ticket } = await setupPaidTicket();

    const response = await request(app).post(`/tickets/${ticket.code}/checkin`).set("Authorization", authFor(staff.id));

    expect(response.status).toBe(200);
    expect(response.body.checkedInAt).not.toBeNull();
    expect(response.body.checkedInByUserId).toBe(staff.id);
  });

  it("rejects checking in the same ticket twice", async () => {
    const { staff, ticket } = await setupPaidTicket();
    await request(app).post(`/tickets/${ticket.code}/checkin`).set("Authorization", authFor(staff.id));

    const second = await request(app).post(`/tickets/${ticket.code}/checkin`).set("Authorization", authFor(staff.id));
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("ALREADY_CHECKED_IN");
  });

  it("is concurrency-safe: 10 simultaneous check-in attempts on one code yield exactly 1 success", async () => {
    const { staff, ticket } = await setupPaidTicket();

    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        request(app).post(`/tickets/${ticket.code}/checkin`).set("Authorization", authFor(staff.id)),
      ),
    );

    expect(responses.filter((r) => r.status === 200)).toHaveLength(1);
    expect(responses.filter((r) => r.status === 409)).toHaveLength(9);
  });

  it("returns 404 (not 403) for staff of a different organiser", async () => {
    const { ticket } = await setupPaidTicket();
    const otherOrganiser = await createTestOrganiser();
    const otherStaff = await createTestUser();
    await createTestMembership(otherOrganiser.id, otherStaff.id, "STAFF");

    const response = await request(app).post(`/tickets/${ticket.code}/checkin`).set("Authorization", authFor(otherStaff.id));
    expect(response.status).toBe(404);
  });

  it("returns 404 (not 403) for a plain attendee with no organiser membership", async () => {
    const { ticket } = await setupPaidTicket();
    const randomAttendee = await createTestUser();

    const response = await request(app).post(`/tickets/${ticket.code}/checkin`).set("Authorization", authFor(randomAttendee.id));
    expect(response.status).toBe(404);
  });

  it("rejects check-in for a cancelled event", async () => {
    const { organiser, event, staff, ticket } = await setupPaidTicket();
    await prisma.event.update({ where: { id: event.id }, data: { status: "CANCELLED" } });

    const response = await request(app).post(`/tickets/${ticket.code}/checkin`).set("Authorization", authFor(staff.id));
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("EVENT_CANCELLED");
    expect(organiser.id).toBeDefined();
  });

  it("returns 404 for an unknown ticket code", async () => {
    const { staff } = await setupPaidTicket();
    const response = await request(app).post("/tickets/NOT-A-REAL-CODE/checkin").set("Authorization", authFor(staff.id));
    expect(response.status).toBe(404);
  });
});
