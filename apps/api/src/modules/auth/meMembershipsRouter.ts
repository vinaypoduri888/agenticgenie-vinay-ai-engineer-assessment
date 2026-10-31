import { Router } from "express";
import { getMyMemberships } from "./memberships.js";

export const meMembershipsRouter = Router();

meMembershipsRouter.get("/", async (req, res) => {
  const memberships = await getMyMemberships(req.user!.id);
  res.json({ items: memberships });
});
