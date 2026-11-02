import { Router, type NextFunction, type Request, type Response } from "express";
import { prisma } from "@agenticgenie/db";
import { ApiError } from "../../lib/errors.js";
import { withSnakeCaseAliases } from "../../lib/aliases.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { validateBody } from "../../middleware/validate.js";
import { cancelEvent } from "./cancellation.js";
import { createEventBodySchema, updateEventBodySchema } from "./schemas.js";
import { createEvent, updateEvent } from "./service.js";

/**
 * The assessment's API contract spells these three without an organiser in the
 * path. They share their services with /organisers/:organiserId/events, so
 * there is one implementation of each rule; the organiser just comes from the
 * event (or the caller's memberships) rather than the URL. A non-member gets
 * 404 and a staff member 403, matching the nested routes.
 */
export const eventContractRouter = Router();

const EVENT_FIELD_ALIASES = {
  venue_id: "venueId",
  starts_at: "startsAt",
  ends_at: "endsAt",
  refund_window_hours: "refundWindowHours",
};

function ctx(req: Request) {
  return { actorUserId: req.user!.id, organiserId: req.membership!.organiserId, requestId: req.requestId };
}

async function requireAdminOfEvent(req: Request, _res: Response, next: NextFunction) {
  const event = await prisma.event.findUnique({ where: { id: req.params.eventId as string }, select: { organiserId: true } });
  const membership = event
    ? await prisma.organiserMembership.findUnique({
        where: { organiserId_userId: { organiserId: event.organiserId, userId: req.user!.id } },
      })
    : null;
  if (!event || !membership) throw new ApiError(404, "NOT_FOUND", "Event not found");
  if (membership.role !== "ADMIN") throw new ApiError(403, "FORBIDDEN", "You do not have permission to perform this action");
  req.membership = { organiserId: event.organiserId, role: membership.role };
  next();
}

/** The organiser is named in the body, or implied when the caller administers
 * exactly one. Naming one the caller doesn't belong to is a 404. */
async function requireAdminForNewEvent(req: Request, _res: Response, next: NextFunction) {
  const named: unknown = req.body?.organiser_id ?? req.body?.organiserId;
  const memberships = await prisma.organiserMembership.findMany({ where: { userId: req.user!.id } });

  let organiserId: string;
  if (typeof named === "string") {
    organiserId = named;
  } else {
    const adminOf = memberships.filter((m) => m.role === "ADMIN");
    if (adminOf.length !== 1) {
      if (adminOf.length === 0) throw new ApiError(403, "FORBIDDEN", "Only an organiser admin can create events");
      throw new ApiError(422, "ORGANISER_REQUIRED", "You administer more than one organiser; name one with organiser_id");
    }
    organiserId = adminOf[0]!.organiserId;
  }

  const membership = memberships.find((m) => m.organiserId === organiserId);
  if (!membership) throw new ApiError(404, "NOT_FOUND", "Organiser not found");
  if (membership.role !== "ADMIN") throw new ApiError(403, "FORBIDDEN", "Only an organiser admin can create events");
  req.membership = { organiserId, role: membership.role };
  next();
}

eventContractRouter.post(
  "/",
  requireAuth,
  requireAdminForNewEvent,
  validateBody(withSnakeCaseAliases(createEventBodySchema, EVENT_FIELD_ALIASES)),
  async (req, res) => {
    const event = await createEvent(ctx(req), req.body);
    res.status(201).json(event);
  },
);

eventContractRouter.patch(
  "/:eventId",
  requireAuth,
  requireAdminOfEvent,
  validateBody(withSnakeCaseAliases(updateEventBodySchema, EVENT_FIELD_ALIASES)),
  async (req, res) => {
    const event = await updateEvent(ctx(req), req.params.eventId as string, req.body);
    res.json(event);
  },
);

eventContractRouter.post("/:eventId/cancel", requireAuth, requireAdminOfEvent, async (req, res) => {
  const result = await cancelEvent(ctx(req), req.params.eventId as string);
  res.json(result);
});
