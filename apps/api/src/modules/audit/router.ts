import { Router } from "express";
import { requireOrganiserMembership } from "../../middleware/requireOrganiser.js";
import { validateQuery } from "../../middleware/validate.js";
import { auditQuerySchema, myAuditQuerySchema, type AuditQuery } from "./schemas.js";
import { listAuditEntries, listAuditEntriesForUser } from "./service.js";

// Mounted at /organisers/:organiserId/audit.
export const auditRouter = Router({ mergeParams: true });

auditRouter.get("/", requireOrganiserMembership(), validateQuery(auditQuerySchema), async (req, res) => {
  const query = req.validatedQuery as AuditQuery;
  const { items, nextCursor } = await listAuditEntries(req.membership!.organiserId, req.membership!.role, query);
  res.json({ items, next_cursor: nextCursor });
});

// GET /audit, the assessment's contract path. Scoped from the caller's own
// memberships. See listAuditEntriesForUser.
export const myAuditRouter = Router();

myAuditRouter.get("/", validateQuery(myAuditQuerySchema), async (req, res) => {
  const query = req.validatedQuery as AuditQuery & { organiser_id?: string };
  const { items, nextCursor } = await listAuditEntriesForUser(req.user!.id, query);
  res.json({ items, next_cursor: nextCursor });
});
