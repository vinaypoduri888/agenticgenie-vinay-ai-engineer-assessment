import { randomUUID } from "node:crypto";
import { prisma } from "@agenticgenie/db";
import { Prisma, type Event, type Hold, type Order, type Payment } from "@prisma/client";
import { ApiError } from "../../lib/errors.js";
import { writeAuditLog } from "../../lib/audit.js";
import { computeRequestHash } from "../../lib/idempotency.js";
import { expireHold } from "../holds/sweeper.js";
import { HOLDABLE_EVENT_STATUSES } from "../holds/service.js";
import { chargeViaFakeProvider, type PaymentScenario, type ProviderOutcome } from "../payments/fakeProvider.js";
import type { CreateOrderBody } from "./schemas.js";

const STALE_AFTER_MS = 30_000;
const ENDPOINT = "POST /orders";

function isUniqueViolation(err: unknown, constraint?: string): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") {
    return false;
  }
  if (!constraint) return true;
  const target = err.meta?.target;
  return Array.isArray(target) ? target.join(",").includes(constraint) : String(target ?? "").includes(constraint);
}

export interface CheckoutContext {
  actorUserId: string;
  requestId: string;
}

interface OwnedClaim {
  type: "owned";
  idemId: string;
  lockToken: string;
}
interface ReplayClaim {
  type: "replay";
  status: number;
  body: unknown;
}

/**
 * Richer than lib/idempotency.ts's withIdempotency: this flow spans THREE
 * steps with an external call in the middle (never inside an open
 * transaction — see docs/DECISIONS.md D-012), so a stale PROCESSING row
 * might correspond to a still-in-flight external operation. Ownership is
 * handed off via lockToken (compare-and-swap on the *specific* old token),
 * never by deleting and re-claiming — the old owner's eventual write is
 * rejected (see finalizePhase3's own ownership-gated update), not raced.
 */
async function claimOrReplay(params: {
  userId: string;
  key: string;
  endpoint: string;
  requestHash: string;
}): Promise<OwnedClaim | ReplayClaim> {
  try {
    const record = await prisma.idempotencyRecord.create({
      data: {
        userId: params.userId,
        key: params.key,
        endpoint: params.endpoint,
        requestHash: params.requestHash,
        lockToken: randomUUID(),
      },
    });
    return { type: "owned", idemId: record.id, lockToken: record.lockToken };
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = await prisma.idempotencyRecord.findUnique({
      where: { userId_key_endpoint: { userId: params.userId, key: params.key, endpoint: params.endpoint } },
    });
    if (!existing) continue;

    if (existing.requestHash !== params.requestHash) {
      throw new ApiError(422, "IDEMPOTENCY_KEY_REUSED", "This Idempotency-Key was already used with a different request body");
    }
    if (existing.status === "COMPLETED") {
      return { type: "replay", status: existing.responseStatus!, body: existing.responseBody };
    }
    const isStale = Date.now() - existing.updatedAt.getTime() > STALE_AFTER_MS;
    if (!isStale) {
      throw new ApiError(409, "REQUEST_IN_PROGRESS", "This request is already being processed");
    }

    const takeover = await prisma.idempotencyRecord.updateMany({
      where: { id: existing.id, status: "PROCESSING", lockToken: existing.lockToken },
      data: { lockToken: randomUUID(), updatedAt: new Date() },
    });
    if (takeover.count === 0) {
      continue; // someone else's takeover (or completion) won the race — re-read and re-evaluate
    }
    const owned = await prisma.idempotencyRecord.findUniqueOrThrow({ where: { id: existing.id } });
    return { type: "owned", idemId: owned.id, lockToken: owned.lockToken };
  }

  throw new ApiError(409, "REQUEST_IN_PROGRESS", "This request is already being processed, please retry shortly");
}

async function computeHoldTotal(tx: Prisma.TransactionClient, hold: Hold): Promise<number> {
  if (hold.kind === "SEATED") {
    const seats = await tx.eventSeat.findMany({ where: { holdId: hold.id } });
    return seats.reduce((sum, s) => sum + s.priceMinor, 0);
  }
  const tier = await tx.ticketTier.findUniqueOrThrow({ where: { id: hold.gaTicketTierId! } });
  return tier.priceMinor * hold.gaQuantity!;
}

type Phase1Result =
  | { alreadyResolved: true }
  | { alreadyResolved: false; order: Order; hold: Hold; payment: Payment; event: Event };

/** Phase 1 — one short transaction: validate, create-or-reuse the order
 * (never a second Order for the same hold — Order.holdId is unique and is
 * also the lookup key for "did a prior attempt already get this far"), and
 * create a fresh Payment attempt row. No external call here. */
async function runPhase1(ctx: CheckoutContext, holdId: string, idemId: string): Promise<Phase1Result> {
  const loadedHold = await prisma.hold.findUnique({ where: { id: holdId } });
  if (!loadedHold || loadedHold.userId !== ctx.actorUserId) {
    throw new ApiError(404, "NOT_FOUND", "Hold not found");
  }

  // Lazy-expiry check runs in its OWN transaction, deliberately separate
  // from the one below: if the hold IS expired, releasing its inventory
  // must actually commit even though this whole checkout attempt is about
  // to be rejected with 409 — throwing inside the main phase-1 transaction
  // would roll back everything in it, including an expiry release
  // performed moments earlier in that same transaction. (Caught by this
  // stage's own tests, not left for later — see docs/PROGRESS.md.)
  const wasExpired = await prisma.$transaction((tx) => expireHold(tx, loadedHold));
  if (wasExpired || loadedHold.status !== "ACTIVE" || loadedHold.expiresAt <= new Date()) {
    throw new ApiError(409, "HOLD_EXPIRED", "This hold has expired");
  }

  return prisma.$transaction(async (tx) => {
    // Row lock on the Event, held for the rest of this transaction —
    // serializes against event cancellation's own lock (Stage 2.5) and
    // against Phase 3's re-lock below.
    await tx.$queryRaw`SELECT id FROM events WHERE id = ${loadedHold.eventId} FOR UPDATE`;
    const event = await tx.event.findUniqueOrThrow({ where: { id: loadedHold.eventId } });
    if (!HOLDABLE_EVENT_STATUSES.includes(event.status)) {
      throw new ApiError(409, "EVENT_NOT_ON_SALE", `Event in status ${event.status} cannot be checked out`);
    }

    // Re-verify ACTIVE status inside this transaction — the expiry check
    // above necessarily ran in a separate transaction, so re-confirm
    // nothing changed (e.g. the user released it) in the narrow gap between.
    const hold = await tx.hold.findUniqueOrThrow({ where: { id: holdId } });
    if (hold.status !== "ACTIVE") {
      throw new ApiError(409, "HOLD_EXPIRED", "This hold is no longer active");
    }

    let order = await tx.order.findUnique({ where: { holdId } });
    if (!order) {
      const totalAmountMinor = await computeHoldTotal(tx, hold);
      try {
        order = await tx.order.create({
          data: { userId: ctx.actorUserId, eventId: hold.eventId, holdId, status: "PENDING_PAYMENT", totalAmountMinor },
        });
      } catch (err) {
        if (isUniqueViolation(err, "hold_id")) {
          order = await tx.order.findUniqueOrThrow({ where: { holdId } }); // lost a create race — reuse it
        } else {
          throw err;
        }
      }
    }

    if (order.status === "PAID" || order.status === "PARTIALLY_REFUNDED" || order.status === "REFUNDED") {
      // Genuinely terminal — a prior attempt already resolved this checkout
      // to a state money actually moved (or was returned) under. Nothing
      // more for this attempt to do.
      return { alreadyResolved: true };
    }
    // PENDING_PAYMENT (normal continuation) or DECLINED (a clean decline
    // isn't terminal — the hold is still ACTIVE, so the attendee can retry
    // with a new payment attempt against this same order) both fall through
    // to create a fresh Payment row below.

    // externalRef = the owning IdempotencyRecord.id, stable across every
    // attempt (including a stale takeover) of this SAME logical checkout —
    // this is what lets the fake provider's ledger dedupe repeat charge
    // calls instead of double-charging. Each attempt still gets its own
    // Payment row for history; only the externalRef is shared.
    const payment = await tx.payment.create({
      data: { orderId: order.id, status: "PENDING", amountMinor: order.totalAmountMinor, externalRef: idemId },
    });

    return { alreadyResolved: false, order, hold, payment, event };
  });
}

function generateTicketCode(): string {
  return `TKT-${randomUUID()}`;
}

async function issueTickets(tx: Prisma.TransactionClient, order: Order, hold: Hold) {
  if (hold.kind === "SEATED") {
    const seats = await tx.eventSeat.findMany({ where: { holdId: hold.id } });
    const tickets = [];
    for (const seat of seats) {
      const ticket = await tx.ticket.create({
        data: {
          orderId: order.id,
          eventId: order.eventId,
          eventSeatId: seat.id,
          code: generateTicketCode(),
          priceMinor: seat.priceMinor,
        },
      });
      await tx.eventSeat.update({ where: { id: seat.id }, data: { status: "SOLD" } });
      tickets.push(ticket);
    }
    return tickets;
  }

  const tier = await tx.ticketTier.findUniqueOrThrow({ where: { id: hold.gaTicketTierId! } });
  const tickets = [];
  for (let i = 0; i < hold.gaQuantity!; i++) {
    tickets.push(
      await tx.ticket.create({
        data: {
          orderId: order.id,
          eventId: order.eventId,
          ticketTierId: tier.id,
          code: generateTicketCode(),
          priceMinor: tier.priceMinor,
        },
      }),
    );
  }
  return tickets;
}

/** Phase 3 — one short transaction, run only once Phase 2's external call
 * has produced a DEFINITIVE outcome (SUCCESS/DECLINE). A client-side
 * timeout never reaches this function at all (see checkout() below) — it's
 * handled by a much lighter, uncontested write to just that attempt's own
 * Payment row. */
async function runPhase3(params: {
  ctx: CheckoutContext;
  idemId: string;
  lockToken: string;
  order: Order;
  payment: Payment;
  hold: Hold;
  event: Event;
  outcome: "SUCCESS" | "DECLINE";
}) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM events WHERE id = ${params.event.id} FOR UPDATE`;

    // Ownership gate — the first write. If we've lost the lock (a takeover
    // happened while Phase 2 was in flight), this affects 0 rows and we
    // abort the WHOLE transaction here: nothing below ever executes, so an
    // abandoned attempt can never touch the authoritative Order/Ticket/Hold
    // state. Postgres holds this row's lock for the rest of the
    // transaction, so a concurrent takeover attempt blocks behind us until
    // we commit or roll back.
    const ownership = await tx.idempotencyRecord.updateMany({
      where: { id: params.idemId, lockToken: params.lockToken, status: "PROCESSING" },
      data: { status: "COMPLETED", updatedAt: new Date() },
    });
    if (ownership.count === 0) {
      throw new ApiError(409, "REQUEST_SUPERSEDED", "Another attempt already resolved this checkout");
    }

    const currentEvent = await tx.event.findUniqueOrThrow({ where: { id: params.event.id } });
    const stillSellable = HOLDABLE_EVENT_STATUSES.includes(currentEvent.status);

    let responseStatus: number;
    let responseBody: Record<string, unknown>;
    let auditAction: string;

    if (params.outcome === "SUCCESS") {
      await tx.payment.update({ where: { id: params.payment.id }, data: { status: "SUCCEEDED", resolvedAt: new Date() } });

      if (!stillSellable) {
        // Race: the event was cancelled while this checkout's external call
        // was in flight. The charge is real — refund it immediately rather
        // than let a cancelled event's order become PAID.
        const refund = await tx.refund.create({
          data: {
            orderId: params.order.id,
            amountMinor: params.order.totalAmountMinor,
            reason: "Event was cancelled while payment was in progress",
            requestedByUserId: params.ctx.actorUserId,
          },
        });
        const updatedOrder = await tx.order.update({
          where: { id: params.order.id },
          data: { status: "REFUNDED", paidByPaymentId: params.payment.id },
        });
        responseStatus = 200;
        responseBody = {
          ...updatedOrder,
          refundId: refund.id,
          message: "The event was cancelled during checkout; your payment has been refunded.",
        };
        auditAction = "ORDER_AUTO_REFUNDED_EVENT_CANCELLED";
      } else {
        await tx.hold.updateMany({ where: { id: params.hold.id, status: "ACTIVE" }, data: { status: "CONVERTED" } });
        const tickets = await issueTickets(tx, params.order, params.hold);
        const updatedOrder = await tx.order.update({
          where: { id: params.order.id },
          data: { status: "PAID", paidByPaymentId: params.payment.id },
        });
        responseStatus = 201;
        responseBody = { ...updatedOrder, tickets };
        auditAction = "ORDER_PAID";
      }
    } else {
      await tx.payment.update({ where: { id: params.payment.id }, data: { status: "DECLINED", resolvedAt: new Date() } });
      const updatedOrder = await tx.order.update({ where: { id: params.order.id }, data: { status: "DECLINED" } });
      responseStatus = 402;
      responseBody = { ...updatedOrder };
      auditAction = "ORDER_DECLINED";
    }

    await tx.idempotencyRecord.update({
      where: { id: params.idemId },
      data: { responseStatus, responseBody: responseBody as Prisma.InputJsonValue },
    });

    await writeAuditLog(tx, {
      actorUserId: params.ctx.actorUserId,
      organiserId: null,
      action: auditAction,
      entityType: "Order",
      entityId: params.order.id,
      afterData: responseBody,
      requestId: params.ctx.requestId,
    });

    return { status: responseStatus, body: responseBody };
  });
}

export async function checkout(ctx: CheckoutContext, idempotencyKey: string, body: CreateOrderBody, scenario: PaymentScenario) {
  const requestHash = computeRequestHash(body);
  const claim = await claimOrReplay({ userId: ctx.actorUserId, key: idempotencyKey, endpoint: ENDPOINT, requestHash });
  if (claim.type === "replay") {
    return { status: claim.status, body: claim.body };
  }

  const phase1 = await runPhase1(ctx, body.holdId, claim.idemId);
  if (phase1.alreadyResolved) {
    const record = await prisma.idempotencyRecord.findUnique({ where: { id: claim.idemId } });
    if (record?.status === "COMPLETED") {
      return { status: record.responseStatus!, body: record.responseBody };
    }
    throw new ApiError(409, "REQUEST_IN_PROGRESS", "This checkout is already being processed");
  }

  // Phase 2 — no open transaction, so the (simulated) external call never
  // holds a DB connection/lock for its duration.
  const externalRef = claim.idemId;
  const providerOutcome: ProviderOutcome = await chargeViaFakeProvider({ externalRef, scenario });

  if (providerOutcome === "TIMEOUT") {
    // We gave up waiting on the provider — not a definitive outcome, so
    // "Phase 3 proper" never runs: no Event lock, no IdempotencyRecord
    // touch. Only this attempt's own Payment row is updated (uniquely
    // owned, zero contention). Order stays PENDING_PAYMENT and the
    // IdempotencyRecord stays PROCESSING, untouched — eligible for a later
    // takeover once stale.
    await prisma.payment.updateMany({
      where: { id: phase1.payment.id, status: "PENDING" },
      data: { status: "TIMED_OUT", resolvedAt: new Date() },
    });
    return {
      status: 202,
      body: {
        orderId: phase1.order.id,
        status: "PENDING_PAYMENT",
        message: "Payment status could not be confirmed yet. Nothing has been charged with certainty — retry with the same Idempotency-Key shortly.",
      },
    };
  }

  return runPhase3({ ctx, idemId: claim.idemId, lockToken: claim.lockToken, ...phase1, outcome: providerOutcome });
}
