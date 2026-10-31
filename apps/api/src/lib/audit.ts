import type { Prisma } from "@prisma/client";

export interface AuditLogInput {
  actorUserId: string | null;
  organiserId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  beforeData?: unknown;
  afterData?: unknown;
  requestId: string;
}

/**
 * Writes one append-only audit row. Takes a Prisma transaction client so the
 * audit write is always part of the same transaction as the business
 * mutation it records — never a separate, best-effort write after the fact.
 * Deliberately just this one function, not a generic "audit framework" —
 * see docs/DECISIONS.md.
 */
export async function writeAuditLog(tx: Prisma.TransactionClient, input: AuditLogInput): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorUserId: input.actorUserId,
      organiserId: input.organiserId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      beforeData: input.beforeData === undefined ? undefined : (input.beforeData as Prisma.InputJsonValue),
      afterData: input.afterData === undefined ? undefined : (input.afterData as Prisma.InputJsonValue),
      requestId: input.requestId,
    },
  });
}
