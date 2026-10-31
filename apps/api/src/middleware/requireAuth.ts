import type { NextFunction, Request, Response } from "express";
import { prisma } from "@agenticgenie/db";
import { ApiError } from "../lib/errors.js";
import { verifyAccessToken } from "../modules/auth/jwt.js";

/**
 * Establishes req.user from a verified Bearer token — never from a
 * client-supplied userId in the body/params/headers. Re-fetches the user
 * from the database on every request (rather than trusting the token's
 * claims as current) so a deleted account's still-unexpired token stops
 * working immediately; there's no separate revocation list in this design
 * (documented auth shortcut), so this re-fetch is what stands in for one.
 */
export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw new ApiError(401, "UNAUTHORIZED", "Missing or malformed Authorization header");
  }

  const token = header.slice("Bearer ".length);
  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    throw new ApiError(401, "UNAUTHORIZED", "Invalid or expired token");
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, email: true, name: true },
  });
  if (!user) {
    throw new ApiError(401, "UNAUTHORIZED", "Invalid or expired token");
  }

  req.user = user;
  next();
}
