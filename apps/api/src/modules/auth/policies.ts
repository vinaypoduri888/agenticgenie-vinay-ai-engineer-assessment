import type { MembershipRole } from "@prisma/client";

/**
 * "Staff can issue refunds, but not on orders they placed themselves;
 * admins can refund their own orders (the only exception)." Pure decision
 * function — no Order/refund endpoint exists yet (that's a later stage),
 * but the rule is an authorization concern and belongs here; the refund
 * route will call this directly once it exists.
 */
export function canRefundOrder(params: { actorRole: MembershipRole; isOwnOrder: boolean }): boolean {
  if (params.actorRole === "ADMIN") {
    return true;
  }
  return !params.isOwnOrder;
}
