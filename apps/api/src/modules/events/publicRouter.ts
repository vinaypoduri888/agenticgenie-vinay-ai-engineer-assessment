import { Router } from "express";
import { validateQuery } from "../../middleware/validate.js";
import { eventsCatalogueQuerySchema, type EventsCatalogueQuery } from "./schemas.js";
import { getPublicEventDetail, listPublicEvents } from "./service.js";

// Mounted at /events — no auth. Attendees (and anyone else) browse freely.
export const publicEventsRouter = Router();

publicEventsRouter.get("/", validateQuery(eventsCatalogueQuerySchema), async (req, res) => {
  const query = req.validatedQuery as EventsCatalogueQuery;
  const { items, nextCursor } = await listPublicEvents(query);
  res.json({ items, next_cursor: nextCursor });
});

publicEventsRouter.get("/:eventId", async (req, res) => {
  const event = await getPublicEventDetail(req.params.eventId as string);
  res.json(event);
});
