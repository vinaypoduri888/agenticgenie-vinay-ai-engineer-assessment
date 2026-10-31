import { Router } from "express";
import { requireOrganiserMembership } from "../../middleware/requireOrganiser.js";
import { validateQuery } from "../../middleware/validate.js";
import { auditQuerySchema, type AuditQuery } from "./schemas.js";
import { listAuditEntries } from "./service.js";

// Mounted at /organisers/:organiserId/audit.
export const auditRouter = Router({ mergeParams: true });

auditRouter.get("/", requireOrganiserMembership(), validateQuery(auditQuerySchema), async (req, res) => {
  const query = req.validatedQuery as AuditQuery;
  const { items, nextCursor } = await listAuditEntries(req.membership!.organiserId, req.membership!.role, query);
  res.json({ items, next_cursor: nextCursor });
});
