import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@agenticgenie/db";
import { Prisma } from "@prisma/client";
import { ApiError } from "./errors.js";

const STALE_AFTER_MS = 30_000;

export function computeRequestHash(body: unknown): string {
  return createHash("sha256").update(JSON.stringify(body ?? {})).digest("hex");
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

export interface IdempotentResult<T> {
  status: number;
  body: T;
}

/**
 * For operations that are a single database transaction with no external
 * call in between — holds, hold release, refunds. The idempotency claim,
 * the business logic, and marking the record COMPLETED all happen in one
 * transaction, so a stale PROCESSING row provably means the claiming
 * transaction never committed (atomicity guarantees it) — safe to discard
 * and retry fresh, no reconciliation of "what might have happened" needed.
 *
 * Orders/payments (checkout) cannot use this: the external provider call
 * must not happen inside an open transaction, so that flow needs its own
 * claim/finalize/stale-takeover primitives that preserve the record across
 * two separate transactions — see modules/orders/checkout.ts.
 */
export async function withIdempotency<T>(
  params: { userId: string; key: string; endpoint: string; requestBody: unknown },
  run: (tx: Prisma.TransactionClient) => Promise<IdempotentResult<T>>,
): Promise<IdempotentResult<T>> {
  const requestHash = computeRequestHash(params.requestBody);

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.idempotencyRecord.create({
          data: {
            userId: params.userId,
            key: params.key,
            endpoint: params.endpoint,
            requestHash,
            lockToken: randomUUID(),
          },
        });
        const result = await run(tx);
        await tx.idempotencyRecord.update({
          where: { userId_key_endpoint: { userId: params.userId, key: params.key, endpoint: params.endpoint } },
          data: {
            status: "COMPLETED",
            responseStatus: result.status,
            responseBody: result.body as Prisma.InputJsonValue,
          },
        });
        return result;
      });
    } catch (err) {
      if (!isUniqueViolation(err)) {
        throw err;
      }

      const existing = await prisma.idempotencyRecord.findUnique({
        where: { userId_key_endpoint: { userId: params.userId, key: params.key, endpoint: params.endpoint } },
      });
      if (!existing) {
        continue; // raced with the stale-cleanup delete below; retry the claim
      }
      if (existing.requestHash !== requestHash) {
        throw new ApiError(
          422,
          "IDEMPOTENCY_KEY_REUSED",
          "This Idempotency-Key was already used with a different request body",
        );
      }
      if (existing.status === "COMPLETED") {
        return { status: existing.responseStatus!, body: existing.responseBody as T };
      }
      const isStale = Date.now() - existing.updatedAt.getTime() > STALE_AFTER_MS;
      if (!isStale) {
        throw new ApiError(409, "REQUEST_IN_PROGRESS", "This request is already being processed");
      }
      await prisma.idempotencyRecord.deleteMany({ where: { id: existing.id, status: "PROCESSING" } });
      // loop and retry the claim fresh
    }
  }

  throw new ApiError(409, "REQUEST_IN_PROGRESS", "This request is already being processed, please retry shortly");
}
