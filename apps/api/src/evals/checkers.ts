import { prisma } from "@agenticgenie/db";
import type { DbCheck } from "./types.js";
import type { SeedRefs } from "./seed.js";

export interface CheckFailure {
  check: DbCheck;
  reason: string;
}

/**
 * The small, fixed vocabulary of real-database post-conditions the 20
 * required cases actually need — not a generic query language. Each one
 * reads real Postgres state (never trusts the HTTP/tool-result shape
 * alone), matching this whole project's "inspect actual database state,
 * never mark a case passed just because the call returned 200" rule.
 */
export async function runDbCheck(
  check: DbCheck,
  refs: SeedRefs,
  context: { conversationId: string; answer: string },
): Promise<CheckFailure | undefined> {
  switch (check.type) {
    case "orderStatus": {
      const order = await prisma.order.findUnique({ where: { id: refs[check.orderRef] } });
      if (!order) return { check, reason: `order ${check.orderRef} not found` };
      if (order.status !== check.status) {
        return { check, reason: `expected order status ${check.status}, got ${order.status}` };
      }
      return undefined;
    }
    case "orderUnchanged": {
      const order = await prisma.order.findUnique({ where: { id: refs[check.orderRef] } });
      if (!order) return { check, reason: `order ${check.orderRef} not found` };
      if (order.status !== check.status) {
        return { check, reason: `expected order to remain ${check.status}, got ${order.status}` };
      }
      return undefined;
    }
    case "noNewOrderForEvent": {
      const count = await prisma.order.count({
        where: { eventId: refs[check.eventRef], userId: refs[check.userRef] },
      });
      if (count !== 0) return { check, reason: `expected no order, found ${count}` };
      return undefined;
    }
    case "holdActive": {
      const active = await prisma.hold.findFirst({
        where: { eventId: refs[check.eventRef], userId: refs[check.userRef], status: "ACTIVE" },
      });
      if (!active) return { check, reason: "expected an active hold, found none" };
      return undefined;
    }
    case "ticketCount": {
      const count = await prisma.ticket.count({
        where: { eventId: refs[check.eventRef], status: "VALID", order: { userId: refs[check.userRef] } },
      });
      if (count !== check.count) {
        return { check, reason: `expected ${check.count} valid ticket(s), found ${count}` };
      }
      return undefined;
    }
    case "pendingConfirmationCount": {
      const count = await prisma.agentPendingConfirmation.count({ where: { conversationId: context.conversationId, status: "PENDING" } });
      if (count !== check.count) {
        return { check, reason: `expected ${check.count} PENDING confirmation(s), found ${count}` };
      }
      return undefined;
    }
    case "pendingConfirmationSays": {
      const pending = await prisma.agentPendingConfirmation.findFirst({
        where: { conversationId: context.conversationId, status: "PENDING" },
        orderBy: { createdAt: "desc" },
      });
      if (!pending) return { check, reason: "expected a PENDING confirmation, found none" };
      const missing = check.contains.filter((text) => !pending.summary?.includes(text));
      if (missing.length > 0) return { check, reason: `confirmation text "${pending.summary}" is missing: ${missing.join(", ")}` };
      return undefined;
    }
    case "noHoldForEvent": {
      const count = await prisma.hold.count({ where: { eventId: refs[check.eventRef], userId: refs[check.userRef] } });
      if (count !== 0) return { check, reason: `expected no hold, found ${count}` };
      return undefined;
    }
    case "answerStatesTicketsSold": {
      const sold = await prisma.ticket.count({ where: { eventId: refs[check.eventRef], status: "VALID" } });
      if (!new RegExp(`\\b${sold} tickets?\\b`).test(context.answer)) {
        return { check, reason: `database says ${sold} ticket(s) sold, but the answer says: "${context.answer}"` };
      }
      return undefined;
    }
  }
}

/** Everything money or inventory could have touched, for "the database did not
 * change" checks. Compared across a whole conversation, so a tool that wrote and
 * then rolled back counts as unchanged, which is what a user would see. */
export async function snapshotState(): Promise<string> {
  const [orders, payments, tickets, refunds, holds, tiers, seats] = await Promise.all([
    prisma.order.findMany({ select: { id: true, status: true }, orderBy: { id: "asc" } }),
    prisma.payment.findMany({ select: { id: true, status: true }, orderBy: { id: "asc" } }),
    prisma.ticket.findMany({ select: { id: true, status: true }, orderBy: { id: "asc" } }),
    prisma.refund.count(),
    prisma.hold.findMany({ select: { id: true, status: true }, orderBy: { id: "asc" } }),
    prisma.ticketTier.findMany({ select: { id: true, remainingQuantity: true }, orderBy: { id: "asc" } }),
    prisma.eventSeat.findMany({ select: { id: true, status: true }, orderBy: { id: "asc" } }),
  ]);
  return JSON.stringify({ orders, payments, tickets, refunds, holds, tiers, seats });
}
