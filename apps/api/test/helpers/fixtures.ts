import { randomUUID } from "node:crypto";
import { prisma } from "@agenticgenie/db";
import type { MembershipRole } from "@prisma/client";
import { hashPassword } from "../../src/modules/auth/password.js";

// Tracks everything created via these helpers so resetFixtures() can delete
// exactly what a test created, in FK-safe order, without touching anything
// else that might exist in the (shared, real) test database.
const createdMembershipIds: string[] = [];
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
  const membership = await prisma.organiserMembership.create({
    data: { organiserId, userId, role },
  });
  createdMembershipIds.push(membership.id);
  return membership;
}

export async function resetFixtures(): Promise<void> {
  if (createdMembershipIds.length > 0) {
    await prisma.organiserMembership.deleteMany({ where: { id: { in: createdMembershipIds } } });
    createdMembershipIds.length = 0;
  }
  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdUserIds.length = 0;
  }
  if (createdOrganiserIds.length > 0) {
    await prisma.organiser.deleteMany({ where: { id: { in: createdOrganiserIds } } });
    createdOrganiserIds.length = 0;
  }
}
