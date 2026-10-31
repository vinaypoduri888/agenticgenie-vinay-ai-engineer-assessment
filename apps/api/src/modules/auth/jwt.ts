import jwt from "jsonwebtoken";
import { env } from "../../env.js";

export interface AccessTokenPayload {
  sub: string; // userId — the only claim the token carries
}

/** The token carries identity only (the user id), never a role or
 * organiserId — permissions are always re-checked against the database on
 * every request (see requireOrganiserMembership/Role), so a membership
 * change takes effect immediately instead of waiting for a stale token to
 * expire. */
export function signAccessToken(userId: string): string {
  return jwt.sign({ sub: userId }, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"],
  });
}

/** Throws on any failure: expired, malformed, wrong signature, or an
 * algorithm other than HS256 (explicitly pinned to prevent algorithm-
 * confusion attacks against jsonwebtoken's verify). Callers should treat
 * every failure identically (generic 401) rather than branching on which
 * check failed, to avoid handing an attacker a validation oracle. */
export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: ["HS256"] });
  if (typeof decoded === "string" || typeof decoded.sub !== "string") {
    throw new Error("Invalid token payload");
  }
  return { sub: decoded.sub };
}
