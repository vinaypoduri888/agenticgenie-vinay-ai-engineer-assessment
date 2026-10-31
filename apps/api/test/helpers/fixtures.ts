import { randomUUID } from "node:crypto";
import { prisma } from "@agenticgenie/db";
import type { EventStatus, MembershipRole } from "@prisma/client";
import { hashPassword } from "../../src/modules/auth/password.js";

// Tracks organisers and users created via these helpers. Cleanup is scoped
// by organiserId/userId (not by individually-tracked venue/event/etc. row
// ids) specifically because tests exercise the real HTTP endpoints — a test
// that POSTs /organisers/:id/events creates an Event this file never
// constructed directly, so there's no row id to track for it. Scoping by
// organiserId catches every descendant (venues, events, and anything they
// cascade to) regardless of which code path created it.
const createdUserIds: string[] = [];
const createdOrganiserIds: string[] = [];

export async function createTestUser(overrides?: { email?: string; password?: string; name?: string }) {
  const plainPassword = overrides?.password ?? "correct-horse-battery-staple";
  const email = overrides?.email ?? `test-auth-${randomUUID()}@example.com`;
  const user = await prisma.user.create({
    data: {
      email,
      name: overrides?.name ?? "Test User",
      passwordHash: await hashPassword(plainPassword),
    },
  });
  createdUserIds.push(user.id);
  return { ...user, plainPassword };
}

export async function createTestOrganiser(name?: string) {
  const organiser = await prisma.organiser.create({
    data: { name: name ?? `Test Organiser ${randomUUID()}` },
  });
  createdOrganiserIds.push(organiser.id);
  return organiser;
}

export async function createTestMembership(organiserId: string, userId: string, role: MembershipRole) {
  return prisma.organiserMembership.create({ data: { organiserId, userId, role } });
}

export async function createTestVenue(organiserId: string, overrides?: { name?: string; city?: string }) {
  return prisma.venue.create({
    data: {
      organiserId,
      name: overrides?.name ?? `Test Venue ${randomUUID()}`,
      address: "123 Test Street",
      city: overrides?.city ?? "Pune",
    },
  });
}

export async function createTestSection(venueId: string, name?: string) {
  return prisma.section.create({ data: { venueId, name: name ?? `Section ${randomUUID()}` } });
}

export async function createTestRow(sectionId: string, label?: string) {
  return prisma.row.create({ data: { sectionId, label: label ?? `Row-${randomUUID().slice(0, 6)}` } });
}

export async function createTestSeat(rowId: string, label?: string) {
  return prisma.seat.create({ data: { rowId, label: label ?? `Seat-${randomUUID().slice(0, 6)}` } });
}

/** Convenience: builds one section with one row with one seat under the
 * given venue, returning every id a test typically needs. */
export async function createTestSeatMap(venueId: string) {
  const section = await createTestSection(venueId);
  const row = await createTestRow(section.id);
  const seat = await createTestSeat(row.id);
  return { section, row, seat };
}

export async function createTestEvent(
  organiserId: string,
  venueId: string,
  overrides?: { title?: string; category?: string; city?: string; status?: EventStatus; startsAt?: Date },
) {
  return prisma.event.create({
    data: {
      organiserId,
      venueId,
      title: overrides?.title ?? `Test Event ${randomUUID()}`,
      description: "A test event",
      category: overrides?.category ?? "comedy",
      status: overrides?.status ?? "DRAFT",
      startsAt: overrides?.startsAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });
}

export async function createTestTicketTier(
  eventId: string,
  overrides?: { name?: string; priceMinor?: number; totalQuantity?: number },
) {
  const totalQuantity = overrides?.totalQuantity ?? 10;
  return prisma.ticketTier.create({
    data: {
      eventId,
      name: overrides?.name ?? `Tier ${randomUUID()}`,
      priceMinor: overrides?.priceMinor ?? 50000,
      totalQuantity,
      remainingQuantity: totalQuantity,
    },
  });
}

export async function resetFixtures(): Promise<void> {
  if (createdOrganiserIds.length > 0) {
    const organiserId = { in: createdOrganiserIds };
    const eventWhere = { organiserId };
    // Event/Venue -> Organiser are onDelete: Restrict, so descendants go
    // first. Ticket/Refund -> Order and Order -> Event/Hold are ALSO
    // Restrict, so Orders (and what references them) must be cleared before
    // Event can be deleted — otherwise Event's own cascade to Hold is
    // blocked by Order's Restrict reference to that same Hold. Event itself
    // still cascades away its TicketTiers/EventSeats; Venue cascades away
    // its Sections/Rows/Seats. Scoped by organiserId (not individually-
    // tracked row ids) so this also cleans up anything created through the
    // real HTTP endpoints under test, not just direct fixture-helper inserts.
    await prisma.ticket.deleteMany({ where: { event: eventWhere } });
    await prisma.refund.deleteMany({ where: { order: { event: eventWhere } } });
    await prisma.order.deleteMany({ where: { event: eventWhere } });
    await prisma.event.deleteMany({ where: eventWhere });
    await prisma.venue.deleteMany({ where: { organiserId } });
    await prisma.organiserMembership.deleteMany({ where: { organiserId } });
    await prisma.organiser.deleteMany({ where: { id: { in: createdOrganiserIds } } });
    createdOrganiserIds.length = 0;
  }
  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdUserIds.length = 0;
  }
}
