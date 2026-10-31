import type { NextFunction, Request, Response } from "express";
import { prisma } from "@agenticgenie/db";
import type { MembershipRole } from "@prisma/client";
import { ApiError } from "../lib/errors.js";

export type OrganiserIdResolver = (req: Request) => string | undefined;

const fromRouteParam: OrganiserIdResolver = (req) => {
  const value = req.params.organiserId;
  return typeof value === "string" ? value : undefined;
};

async function lookupMembership(req: Request, resolveOrganiserId: OrganiserIdResolver) {
  if (!req.user) {
    // Programmer error, not a client-trust issue: these middlewares must be
    // composed after requireAuth.
    throw new ApiError(401, "UNAUTHORIZED", "Authentication required");
  }

  const organiserId = resolveOrganiserId(req);
  if (!organiserId) {
    throw new ApiError(400, "BAD_REQUEST", "organiserId could not be resolved for this request");
  }

  const membership = await prisma.organiserMembership.findUnique({
    where: { organiserId_userId: { organiserId, userId: req.user.id } },
  });

  return { organiserId, membership };
}

/**
 * Requires the authenticated user to belong to the resolved organiser, in
 * any role. Defaults to reading `req.params.organiserId`; pass a resolver
 * for routes where the organiser is implied by a loaded resource instead
 * (e.g. an event's organiser) rather than present directly in the URL.
 *
 * A non-member gets 404, not 403 — per the assessment's isolation rule,
 * this must not confirm whether the organiser (or a resource scoped to it)
 * exists for someone who isn't part of it.
 */
export function requireOrganiserMembership(resolveOrganiserId: OrganiserIdResolver = fromRouteParam) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const { organiserId, membership } = await lookupMembership(req, resolveOrganiserId);
    if (!membership) {
      throw new ApiError(404, "NOT_FOUND", "Not found");
    }
    req.membership = { organiserId, role: membership.role };
    next();
  };
}

/**
 * Requires membership AND one of the given roles. A non-member still gets
 * 404 (existence-hiding). A member with an insufficient role gets 403 —
 * that's a genuine permission shortfall for a relationship that's already
 * known to exist, not an existence probe, so hiding it would serve no
 * isolation purpose.
 */
export function requireOrganiserRole(
  allowedRoles: MembershipRole[],
  resolveOrganiserId: OrganiserIdResolver = fromRouteParam,
) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const { organiserId, membership } = await lookupMembership(req, resolveOrganiserId);
    if (!membership) {
      throw new ApiError(404, "NOT_FOUND", "Not found");
    }
    if (!allowedRoles.includes(membership.role)) {
      throw new ApiError(403, "FORBIDDEN", "You do not have permission to perform this action");
    }
    req.membership = { organiserId, role: membership.role };
    next();
  };
}

/** Convenience wrapper over requireOrganiserRole(['ADMIN'], ...). */
export function requireAdmin(resolveOrganiserId: OrganiserIdResolver = fromRouteParam) {
  return requireOrganiserRole(["ADMIN"], resolveOrganiserId);
}
