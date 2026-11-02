import { Router } from "express";
import { validateBody } from "../../middleware/validate.js";
import { loginBodySchema, registerBodySchema } from "./schemas.js";
import { loginUser, registerUser } from "./service.js";

export const authRouter = Router();

// Extension beyond the PDF's minimum (which only requires seeded users +
// login) — useful for a self-contained, testable auth system. Seed data
// still inserts users directly for determinism.
authRouter.post("/register", validateBody(registerBodySchema), async (req, res) => {
  const result = await registerUser(req.body, req.requestId);
  res.status(201).json(result);
});

authRouter.post("/login", validateBody(loginBodySchema), async (req, res) => {
  const result = await loginUser(req.body);
  res.status(200).json(result);
});
