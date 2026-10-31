import { Router } from "express";
import { requireAdmin, requireOrganiserMembership } from "../../middleware/requireOrganiser.js";
import { validateBody } from "../../middleware/validate.js";
import * as events from "./service.js";
import * as inventory from "../inventory/service.js";
import { createEventBodySchema, updateEventBodySchema } from "./schemas.js";
import { createTicketTierBodySchema, generateEventSeatsBodySchema } from "../inventory/schemas.js";

// Mounted at /organisers/:organiserId/events with mergeParams.
export const eventsRouter = Router({ mergeParams: true });

function ctx(req: { user?: { id: string }; membership?: { organiserId: string }; requestId: string }) {
  return {
    actorUserId: req.user!.id,
    organiserId: req.membership!.organiserId,
    requestId: req.requestId,
  };
}

eventsRouter.post("/", requireAdmin(), validateBody(createEventBodySchema), async (req, res) => {
  const event = await events.createEvent(ctx(req), req.body);
  res.status(201).json(event);
});

eventsRouter.get("/:eventId", requireOrganiserMembership(), async (req, res) => {
  const event = await events.getEventForOrganiser(req.membership!.organiserId, req.params.eventId as string);
  res.json(event);
});

eventsRouter.patch(
  "/:eventId",
  requireAdmin(),
  validateBody(updateEventBodySchema),
  async (req, res) => {
    const event = await events.updateEvent(ctx(req), req.params.eventId as string, req.body);
    res.json(event);
  },
);

eventsRouter.post("/:eventId/publish", requireAdmin(), async (req, res) => {
  const event = await events.publishEvent(ctx(req), req.params.eventId as string);
  res.json(event);
});

eventsRouter.post(
  "/:eventId/ticket-tiers",
  requireAdmin(),
  validateBody(createTicketTierBodySchema),
  async (req, res) => {
    const tier = await inventory.createTicketTier(ctx(req), req.params.eventId as string, req.body);
    res.status(201).json(tier);
  },
);

eventsRouter.post(
  "/:eventId/seats/generate",
  requireAdmin(),
  validateBody(generateEventSeatsBodySchema),
  async (req, res) => {
    const result = await inventory.generateEventSeats(ctx(req), req.params.eventId as string, req.body);
    res.status(201).json(result);
  },
);
