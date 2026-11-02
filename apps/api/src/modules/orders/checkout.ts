import { randomUUID } from "node:crypto";
import { prisma } from "@agenticgenie/db";
import { Prisma, type Event, type Hold, type Order, type Payment } from "@prisma/client";
import { ApiError } from "../../lib/errors.js";
import { writeAuditLog } from "../../lib/audit.js";
import { computeRequestHash } from "../../lib/idempotency.js";
import { expireHold } from "../holds/sweeper.js";
import { HOLDABLE_EVENT_STATUSES } from "../holds/service.js";
import { chargeViaFakeProvider, lookupProviderOutcome, type PaymentScenario, type ProviderOutcome } from "../payments/fakeProvider.js";
import { markSoldOutIfExhausted } from "../events/soldOut.js";
import type { CreateOrderBody } from "./schemas.js";

const STALE_AFTER_MS = 30_000;
const ENDPOINT = "POST /orders";
const UNRESOLVED_PAYMENT_STATUSES = ["PENDING", "TIMED_OUT"] as const;

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

  if (loadedHold.status === "CONVERTED") {
    throw new ApiError(409, "HOLD_ALREADY_CONVERTED", "This hold has already been purchased");
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
    if (hold.status === "CONVERTED") {
      throw new ApiError(409, "HOLD_ALREADY_CONVERTED", "This hold has already been purchased");
    }
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
        await writeAuditLog(tx, {
          actorUserId: ctx.actorUserId,
          organiserId: event.organiserId,
          action: "ORDER_CREATED",
          entityType: "Order",
          entityId: order.id,
          afterData: order,
          requestId: ctx.requestId,
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

    // One charge at a time per order. The Event row lock above serializes this
    // check, so two checkouts of one hold under different Idempotency-Keys
    // can't both reach the provider. A timed-out attempt still counts as in
    // flight while its key is unresolved: its outcome is unknown, and charging
    // again would risk a double charge. It settles through a retry with the
    // same key or through reconciliation.
    const unresolved = await tx.payment.findMany({
      where: { orderId: order.id, status: { in: [...UNRESOLVED_PAYMENT_STATUSES] }, externalRef: { not: idemId } },
      select: { externalRef: true },
    });
    if (unresolved.length > 0) {
      const openClaims = await tx.idempotencyRecord.count({
        where: { id: { in: unresolved.map((p) => p.externalRef) }, status: "PROCESSING" },
      });
      if (openClaims > 0) {
        throw new ApiError(409, "CHECKOUT_IN_PROGRESS", "A payment for this hold is still being processed");
      }
    }

    // A crash can leave this same key's previous attempt PENDING. It is now
    // superseded, and only one PENDING row per order is allowed.
    await tx.payment.updateMany({
      where: { orderId: order.id, status: "PENDING", externalRef: idemId },
      data: { status: "TIMED_OUT", resolvedAt: new Date() },
    });

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
      // holdId must be cleared here too — the CHECK constraint
      // (event_seats_hold_id_matches_status) requires hold_id IS NULL
      // whenever status isn't 'HELD'. Caught by the seed script's first
      // real seated-ticket purchase; no prior test had exercised a seated
      // checkout success path end-to-end (all of Stage 2.4's own tests used
      // GA holds) — see docs/PROGRESS.md.
      await tx.eventSeat.update({ where: { id: seat.id }, data: { status: "SOLD", holdId: null } });
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

      // The conditional update is what decides who owns this hold's inventory.
      // If it matches nothing, the hold was released or expired while the
      // charge was in flight and its inventory is already back on sale, so
      // issuing tickets now would oversell.
      const holdConverted = stillSellable
        ? (await tx.hold.updateMany({ where: { id: params.hold.id, status: "ACTIVE" }, data: { status: "CONVERTED" } })).count === 1
        : false;

      if (!holdConverted) {
        // The charge is real but no inventory backs it, so refund it right
        // away rather than leave a "maybe paid" order behind.
        const reason = stillSellable
          ? "The hold expired or was released while payment was in progress"
          : "Event was cancelled while payment was in progress";
        const refund = await tx.refund.create({
          data: {
            orderId: params.order.id,
            amountMinor: params.order.totalAmountMinor,
            reason,
            requestedByUserId: params.ctx.actorUserId,
          },
        });
        const updatedOrder = await tx.order.update({
          where: { id: params.order.id },
          data: { status: "REFUNDED", paidByPaymentId: params.payment.id },
        });
        if (stillSellable) {
          responseStatus = 409;
          responseBody = {
            ...updatedOrder,
            refundId: refund.id,
            message: `${reason}; your payment has been refunded.`,
            error: { code: "HOLD_EXPIRED", message: `${reason}; your payment has been refunded.`, request_id: params.ctx.requestId },
          };
          auditAction = "ORDER_AUTO_REFUNDED_HOLD_LOST";
        } else {
          responseStatus = 200;
          responseBody = {
            ...updatedOrder,
            refundId: refund.id,
            message: "The event was cancelled during checkout; your payment has been refunded.",
          };
          auditAction = "ORDER_AUTO_REFUNDED_EVENT_CANCELLED";
        }
      } else {
        const tickets = await issueTickets(tx, params.order, params.hold);
        const updatedOrder = await tx.order.update({
          where: { id: params.order.id },
          data: { status: "PAID", paidByPaymentId: params.payment.id },
        });
        await markSoldOutIfExhausted(tx, params.ctx, params.event.id);
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
      organiserId: params.event.organiserId,
      action: auditAction,
      entityType: "Order",
      entityId: params.order.id,
      afterData: responseBody,
      requestId: params.ctx.requestId,
    });

    return { status: responseStatus, body: responseBody };
  });
}

/**
 * Takes a checkout whose outcome was never recorded to a definitive state, from
 * whatever the provider's ledger says. Reuses Phase 3, so its ownership gate,
 * the hold check and the auto-refund all apply. A provider with no record of
 * the charge means nothing was taken, which is a clean decline. Returns
 * undefined when another attempt resolved it first.
 */
async function settleOpenCheckout(idemId: string, requestId: string) {
  const record = await prisma.idempotencyRecord.findUnique({ where: { id: idemId } });
  if (!record || record.status !== "PROCESSING") return undefined;

  const payment = await prisma.payment.findFirst({
    where: { externalRef: idemId },
    orderBy: { createdAt: "desc" },
    include: { order: { include: { hold: true, event: true } } },
  });
  if (!payment) return undefined;

  const outcome = lookupProviderOutcome(idemId) ?? "DECLINE";
  try {
    return await runPhase3({
      ctx: { actorUserId: payment.order.userId, requestId },
      idemId,
      lockToken: record.lockToken,
      order: payment.order,
      payment,
      hold: payment.order.hold,
      event: payment.order.event,
      outcome,
    });
  } catch (err) {
    if (err instanceof ApiError && err.code === "REQUEST_SUPERSEDED") return undefined;
    throw err;
  }
}

/**
 * Finishes checkouts nobody came back for: a timed-out payment whose client
 * never retried, or a process that died mid-checkout. This is what stops an
 * order staying "maybe paid". Safe to run concurrently, because Phase 3's
 * compare-and-swap on the lock token lets only one settler win. Pass a userId
 * to settle lazily for one user on read.
 */
export async function reconcileStuckCheckouts(params?: { userId?: string; olderThanMs?: number }): Promise<number> {
  const cutoff = new Date(Date.now() - (params?.olderThanMs ?? STALE_AFTER_MS));
  const stuck = await prisma.idempotencyRecord.findMany({
    where: {
      endpoint: ENDPOINT,
      status: "PROCESSING",
      updatedAt: { lt: cutoff },
      ...(params?.userId ? { userId: params.userId } : {}),
    },
    select: { id: true, lockToken: true },
  });

  let settled = 0;
  for (const record of stuck) {
    const attempts = await prisma.payment.count({ where: { externalRef: record.id } });
    if (attempts === 0) {
      // Rejected before any charge was attempted, so there is nothing to settle.
      await prisma.idempotencyRecord.deleteMany({ where: { id: record.id, lockToken: record.lockToken, status: "PROCESSING" } });
      continue;
    }
    if (await settleOpenCheckout(record.id, "system-reconcile")) settled++;
  }
  return settled;
}

const SETTLEABLE_PHASE1_REJECTIONS = new Set(["HOLD_EXPIRED", "EVENT_NOT_ON_SALE"]);

export async function checkout(ctx: CheckoutContext, idempotencyKey: string, body: CreateOrderBody, scenario: PaymentScenario) {
  const requestHash = computeRequestHash(body);
  const claim = await claimOrReplay({ userId: ctx.actorUserId, key: idempotencyKey, endpoint: ENDPOINT, requestHash });
  if (claim.type === "replay") {
    return { status: claim.status, body: claim.body };
  }

  let phase1: Phase1Result;
  try {
    phase1 = await runPhase1(ctx, body.holdId, claim.idemId);
  } catch (err) {
    const attempts = await prisma.payment.count({ where: { externalRef: claim.idemId } });
    if (attempts === 0) {
      // Rejected before any money moved. Drop the claim so replaying this key
      // gets the same rejection rather than a misleading REQUEST_IN_PROGRESS.
      await prisma.idempotencyRecord.deleteMany({ where: { id: claim.idemId, lockToken: claim.lockToken, status: "PROCESSING" } });
    } else if (err instanceof ApiError && SETTLEABLE_PHASE1_REJECTIONS.has(err.code)) {
      // This key's earlier attempt timed out and the hold or event has since
      // gone. A provider may still have charged it, so answer with the settled
      // outcome rather than a bare 409 over money in an unknown state.
      const settled = await settleOpenCheckout(claim.idemId, ctx.requestId);
      if (settled) return settled;
    }
    throw err;
  }

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
    await prisma.$transaction(async (tx) => {
      const updated = await tx.payment.updateMany({
        where: { id: phase1.payment.id, status: "PENDING" },
        data: { status: "TIMED_OUT", resolvedAt: new Date() },
      });
      if (updated.count === 0) return;
      await writeAuditLog(tx, {
        actorUserId: ctx.actorUserId,
        organiserId: phase1.event.organiserId,
        action: "PAYMENT_TIMED_OUT",
        entityType: "Order",
        entityId: phase1.order.id,
        beforeData: { paymentStatus: "PENDING" },
        afterData: { paymentStatus: "TIMED_OUT", paymentId: phase1.payment.id },
        requestId: ctx.requestId,
      });
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
