import { Router } from "express";
import { z } from "zod";
import { requireAdmin } from "../../middleware/requireOrganiser.js";
import { validateBody } from "../../middleware/validate.js";
import { addMember, changeMemberRole, listMembers, removeMember } from "./service.js";

const roleSchema = z.enum(["ADMIN", "STAFF"]);
const addMemberBodySchema = z.object({ email: z.email(), role: roleSchema });
const changeRoleBodySchema = z.object({ role: roleSchema });

// Mounted at /organisers/:organiserId/members. "Manage staff" is admin-only.
export const membersRouter = Router({ mergeParams: true });

function ctx(req: { user?: { id: string }; membership?: { organiserId: string }; requestId: string }) {
  return { actorUserId: req.user!.id, organiserId: req.membership!.organiserId, requestId: req.requestId };
}

membersRouter.get("/", requireAdmin(), async (req, res) => {
  res.json({ items: await listMembers(req.membership!.organiserId) });
});

membersRouter.post("/", requireAdmin(), validateBody(addMemberBodySchema), async (req, res) => {
  res.status(201).json(await addMember(ctx(req), req.body));
});

membersRouter.patch("/:userId", requireAdmin(), validateBody(changeRoleBodySchema), async (req, res) => {
  res.json(await changeMemberRole(ctx(req), req.params.userId as string, req.body.role));
});

membersRouter.delete("/:userId", requireAdmin(), async (req, res) => {
  await removeMember(ctx(req), req.params.userId as string);
  res.status(204).end();
});
