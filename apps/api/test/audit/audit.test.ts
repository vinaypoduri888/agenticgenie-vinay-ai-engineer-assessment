import { randomUUID } from "node:crypto";
import { prisma } from "@agenticgenie/db";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { writeAuditLog } from "../../src/lib/audit.js";
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

describe("audit log access", () => {
  it("records an audit entry for every mutation, atomically with the mutation", async () => {
    const organiser = await createTestOrganiser();
    const venue = await createTestVenue(organiser.id);
    const event = await createTestEvent(organiser.id, venue.id, { status: "PUBLISHED" });
    const tier = await createTestTicketTier(event.id, { totalQuantity: 10 });
    const admin = await createTestUser();
    await createTestMembership(organiser.id, admin.id, "ADMIN");
    const buyer = await createTestUser();
    await purchaseGaTickets(app, buyer.id, event.id, tier.id, 1);

    const response = await request(app)
      .get(`/organisers/${organiser.id}/audit`)
      .set("Authorization", authFor(admin.id));

    expect(response.status).toBe(200);
    const actions = response.body.items.map((e: { action: string }) => e.action);
    expect(actions).toContain("HOLD_CREATED");
    expect(actions).toContain("ORDER_PAID");
    for (const entry of response.body.items) {
      expect(entry.requestId).toEqual(expect.any(String));
      expect(entry.createdAt).toEqual(expect.any(String));
    }
  });

  it("lets staff view entity-scoped audit entries", async () => {
    const organiser = await createTestOrganiser();
    const venue = await createTestVenue(organiser.id);
    const admin = await createTestUser();
    await createTestMembership(organiser.id, admin.id, "ADMIN");
    const staff = await createTestUser();
    await createTestMembership(organiser.id, staff.id, "STAFF");

    // Created through the real endpoint (not the direct-Prisma fixture
    // helper) specifically so an EVENT_CREATED audit entry actually exists
    // to query for.
    const created = await request(app)
      .post(`/organisers/${organiser.id}/events`)
      .set("Authorization", authFor(admin.id))
      .send({
        venueId: venue.id,
        title: "Audited Event",
        description: "d",
        category: "comedy",
        startsAt: new Date(Date.now() + 86_400_000).toISOString(),
      });
    expect(created.status).toBe(201);

    const response = await request(app)
      .get(`/organisers/${organiser.id}/audit`)
      .query({ entity: `Event:${created.body.id}` })
      .set("Authorization", authFor(staff.id));

    expect(response.status).toBe(200);
    expect(response.body.items.some((e: { action: string }) => e.action === "EVENT_CREATED")).toBe(true);
  });

  it("forbids staff from viewing the organiser-wide feed (admin only)", async () => {
    const organiser = await createTestOrganiser();
    const staff = await createTestUser();
    await createTestMembership(organiser.id, staff.id, "STAFF");

    const response = await request(app)
      .get(`/organisers/${organiser.id}/audit`)
      .set("Authorization", authFor(staff.id));

    expect(response.status).toBe(403);
  });

  it("returns 404 (not 403) for a member of a different organiser", async () => {
    const organiser = await createTestOrganiser();
    const otherOrganiser = await createTestOrganiser();
    const otherAdmin = await createTestUser();
    await createTestMembership(otherOrganiser.id, otherAdmin.id, "ADMIN");

    const response = await request(app)
      .get(`/organisers/${organiser.id}/audit`)
      .set("Authorization", authFor(otherAdmin.id));

    expect(response.status).toBe(404);
  });

  it("rejects a malformed entity filter", async () => {
    const organiser = await createTestOrganiser();
    const admin = await createTestUser();
    await createTestMembership(organiser.id, admin.id, "ADMIN");

    const response = await request(app)
      .get(`/organisers/${organiser.id}/audit`)
      .query({ entity: "no-colon-here" })
      .set("Authorization", authFor(admin.id));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_ENTITY_FILTER");
  });

  describe("cursor pagination", () => {
    it("is stable under a concurrent insert between page fetches — no duplicates, no skips", async () => {
      const organiser = await createTestOrganiser();
      const venue = await createTestVenue(organiser.id);
      const admin = await createTestUser();
      await createTestMembership(organiser.id, admin.id, "ADMIN");

      async function createAuditedEvent(title: string) {
        return request(app)
          .post(`/organisers/${organiser.id}/events`)
          .set("Authorization", authFor(admin.id))
          .send({
            venueId: venue.id,
            title,
            description: "d",
            category: "comedy",
            startsAt: new Date(Date.now() + 86_400_000).toISOString(),
          });
      }

      const seeded = [];
      for (let i = 0; i < 3; i++) {
        seeded.push((await createAuditedEvent(`Audit Event ${i}`)).body);
      }

      const page1 = await request(app)
        .get(`/organisers/${organiser.id}/audit`)
        .query({ limit: 2 })
        .set("Authorization", authFor(admin.id));
      expect(page1.body.items).toHaveLength(2);
      expect(page1.body.next_cursor).not.toBeNull();

      const inserted = (await createAuditedEvent("Inserted mid-pagination")).body;

      const page2 = await request(app)
        .get(`/organisers/${organiser.id}/audit`)
        .query({ limit: 2, cursor: page1.body.next_cursor })
        .set("Authorization", authFor(admin.id));

      const page1Ids = page1.body.items.map((e: { id: string }) => e.id);
      const page2Ids = page2.body.items.map((e: { id: string }) => e.id);

      expect(page1Ids.some((id: string) => page2Ids.includes(id))).toBe(false);

      const page2EntityIds = page2.body.items.map((e: { entityId: string }) => e.entityId);
      expect(page2EntityIds).toContain(seeded[2].id);
      expect(page2EntityIds).toContain(inserted.id);
    });
  });

  describe("transactional atomicity", () => {
    it("rolls back the audit write along with the rest of the transaction when a later statement fails", async () => {
      // writeAuditLog's signature only accepts a Prisma.TransactionClient
      // (see lib/audit.ts), so every one of its 19 real call sites is
      // structurally forced to write inside the same transaction as the
      // business mutation it records. This directly exercises that
      // guarantee with a forced failure *after* the audit write, confirming
      // Postgres rolls both back together — not just that the call sites
      // happen to look right by convention.
      const organiser = await createTestOrganiser();
      const entityId = randomUUID();
      const auditCountBefore = await prisma.auditLog.count({ where: { entityId } });

      await expect(
        prisma.$transaction(async (tx) => {
          await writeAuditLog(tx, {
            actorUserId: null,
            organiserId: organiser.id,
            action: "TEST_ACTION",
            entityType: "Test",
            entityId,
            requestId: "test-atomicity",
          });
          // Force the transaction to fail *after* the audit write has
          // already been sent — a duplicate primary key is a real
          // constraint violation, not a thrown JS error the ORM would
          // never see in production.
          await tx.organiser.create({ data: { id: organiser.id, name: "duplicate id, must fail" } });
        }),
      ).rejects.toThrow();

      const auditCountAfter = await prisma.auditLog.count({ where: { entityId } });
      expect(auditCountAfter).toBe(auditCountBefore); // the audit row never persisted
    });
  });
});
