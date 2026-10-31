import { Router } from "express";
import { requireOrganiserMembership } from "../../middleware/requireOrganiser.js";
import { validateQuery } from "../../middleware/validate.js";
import { salesReportQuerySchema, type SalesReportQuery } from "./schemas.js";
import { getSalesSummary } from "./service.js";

// Mounted at /organisers/:organiserId/reports/sales — any organiser member
// (staff or admin) may view their own organiser's sales.
export const reportsRouter = Router({ mergeParams: true });

reportsRouter.get("/sales", requireOrganiserMembership(), validateQuery(salesReportQuerySchema), async (req, res) => {
  const query = req.validatedQuery as SalesReportQuery;
  const summary = await getSalesSummary(req.membership!.organiserId, query);
  res.json(summary);
});
