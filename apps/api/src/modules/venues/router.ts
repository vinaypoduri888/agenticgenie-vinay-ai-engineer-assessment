import { Router } from "express";
import { requireAdmin, requireOrganiserMembership } from "../../middleware/requireOrganiser.js";
import { validateBody } from "../../middleware/validate.js";
import * as venues from "./service.js";
import {
  createRowBodySchema,
  createSeatBodySchema,
  createSectionBodySchema,
  createVenueBodySchema,
  updateVenueBodySchema,
} from "./schemas.js";

// Mounted at /organisers/:organiserId/venues with mergeParams so every
// route below can read req.params.organiserId from the parent path.
export const venuesRouter = Router({ mergeParams: true });

function ctx(req: { user?: { id: string }; membership?: { organiserId: string }; requestId: string }) {
  return {
    actorUserId: req.user!.id,
    organiserId: req.membership!.organiserId,
    requestId: req.requestId,
  };
}

venuesRouter.get("/", requireOrganiserMembership(), async (req, res) => {
  const list = await venues.listVenues(req.membership!.organiserId);
  res.json({ items: list });
});

venuesRouter.post("/", requireAdmin(), validateBody(createVenueBodySchema), async (req, res) => {
  const venue = await venues.createVenue(ctx(req), req.body);
  res.status(201).json(venue);
});

venuesRouter.get("/:venueId", requireOrganiserMembership(), async (req, res) => {
  const venue = await venues.getVenueDetail(req.membership!.organiserId, req.params.venueId as string);
  res.json(venue);
});

venuesRouter.patch("/:venueId", requireAdmin(), validateBody(updateVenueBodySchema), async (req, res) => {
  const venue = await venues.updateVenue(ctx(req), req.params.venueId as string, req.body);
  res.json(venue);
});

venuesRouter.post(
  "/:venueId/sections",
  requireAdmin(),
  validateBody(createSectionBodySchema),
  async (req, res) => {
    const section = await venues.createSection(ctx(req), req.params.venueId as string, req.body);
    res.status(201).json(section);
  },
);

venuesRouter.post(
  "/:venueId/sections/:sectionId/rows",
  requireAdmin(),
  validateBody(createRowBodySchema),
  async (req, res) => {
    const row = await venues.createRow(
      ctx(req),
      req.params.venueId as string,
      req.params.sectionId as string,
      req.body,
    );
    res.status(201).json(row);
  },
);

venuesRouter.post(
  "/:venueId/sections/:sectionId/rows/:rowId/seats",
  requireAdmin(),
  validateBody(createSeatBodySchema),
  async (req, res) => {
    const seat = await venues.createSeat(
      ctx(req),
      req.params.venueId as string,
      req.params.sectionId as string,
      req.params.rowId as string,
      req.body,
    );
    res.status(201).json(seat);
  },
);
