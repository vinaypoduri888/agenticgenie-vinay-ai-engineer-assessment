import { prisma } from "@agenticgenie/db";
import type { MembershipRole, Prisma } from "@prisma/client";
import { ApiError } from "../../lib/errors.js";
import { writeAuditLog } from "../../lib/audit.js";
import { toConflictError } from "../../lib/prismaErrors.js";
import type { ActionContext } from "../../lib/actionContext.js";

const MEMBER_SELECT = {
  userId: true,
  role: true,
  createdAt: true,
  user: { select: { id: true, name: true, email: true } },
} as const;

export async function listMembers(organiserId: string) {
  return prisma.organiserMembership.findMany({
    where: { organiserId },
    select: MEMBER_SELECT,
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
  });
}

export async function addMember(ctx: ActionContext, body: { email: string; role: MembershipRole }) {
  const user = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
  if (!user) {
    throw new ApiError(404, "USER_NOT_FOUND", "No account uses that email. Ask them to register first.");
  }
  try {
    return await prisma.$transaction(async (tx) => {
      const member = await tx.organiserMembership.create({
        data: { organiserId: ctx.organiserId, userId: user.id, role: body.role },
        select: MEMBER_SELECT,
      });
      await writeAuditLog(tx, {
        actorUserId: ctx.actorUserId,
        organiserId: ctx.organiserId,
        action: "MEMBER_ADDED",
        entityType: "Membership",
        entityId: user.id,
        afterData: { userId: user.id, role: body.role },
        requestId: ctx.requestId,
      });
      return member;
    });
  } catch (err) {
    return toConflictError(err, "That person is already a member of this organiser");
  }
}

/** Locks the organiser row first, so two admins demoting or removing each other
 * at once can't both pass the check and leave the organiser with no admin. */
async function assertNotLastAdmin(tx: Prisma.TransactionClient, organiserId: string, userId: string) {
  await tx.$queryRaw`SELECT id FROM organisers WHERE id = ${organiserId} FOR UPDATE`;
  const otherAdmins = await tx.organiserMembership.count({
    where: { organiserId, role: "ADMIN", userId: { not: userId } },
  });
  if (otherAdmins === 0) {
    throw new ApiError(409, "LAST_ADMIN", "An organiser must keep at least one admin");
  }
}

export async function changeMemberRole(ctx: ActionContext, userId: string, role: MembershipRole) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.organiserMembership.findUnique({
      where: { organiserId_userId: { organiserId: ctx.organiserId, userId } },
    });
    if (!existing) throw new ApiError(404, "NOT_FOUND", "Member not found");
    if (existing.role === "ADMIN" && role !== "ADMIN") await assertNotLastAdmin(tx, ctx.organiserId, userId);

    const member = await tx.organiserMembership.update({
      where: { organiserId_userId: { organiserId: ctx.organiserId, userId } },
      data: { role },
      select: MEMBER_SELECT,
    });
    await writeAuditLog(tx, {
      actorUserId: ctx.actorUserId,
      organiserId: ctx.organiserId,
      action: "MEMBER_ROLE_CHANGED",
      entityType: "Membership",
      entityId: userId,
      beforeData: { role: existing.role },
      afterData: { role },
      requestId: ctx.requestId,
    });
    return member;
  });
}

export async function removeMember(ctx: ActionContext, userId: string) {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.organiserMembership.findUnique({
      where: { organiserId_userId: { organiserId: ctx.organiserId, userId } },
    });
    if (!existing) throw new ApiError(404, "NOT_FOUND", "Member not found");
    if (existing.role === "ADMIN") await assertNotLastAdmin(tx, ctx.organiserId, userId);

    await tx.organiserMembership.delete({ where: { organiserId_userId: { organiserId: ctx.organiserId, userId } } });
    await writeAuditLog(tx, {
      actorUserId: ctx.actorUserId,
      organiserId: ctx.organiserId,
      action: "MEMBER_REMOVED",
      entityType: "Membership",
      entityId: userId,
      beforeData: { role: existing.role },
      requestId: ctx.requestId,
    });
  });
}
