import { Router } from "express";
import { checkInTicket } from "./service.js";

export const ticketsRouter = Router();

ticketsRouter.post("/:code/checkin", async (req, res) => {
  const ticket = await checkInTicket(
    { actorUserId: req.user!.id, requestId: req.requestId },
    req.params.code as string,
  );
  res.json(ticket);
});
