import { z } from "zod";

export const registerBodySchema = z.object({
  email: z.email(),
  // bcrypt silently ignores bytes beyond 72 — capping input length avoids a
  // false sense of extra strength past that point.
  password: z.string().min(8, "Password must be at least 8 characters").max(72),
  name: z.string().trim().min(1, "Name is required").max(200),
});

export const loginBodySchema = z.object({
  email: z.email(),
  password: z.string().min(1, "Password is required"),
});

export type RegisterBody = z.infer<typeof registerBodySchema>;
export type LoginBody = z.infer<typeof loginBodySchema>;
