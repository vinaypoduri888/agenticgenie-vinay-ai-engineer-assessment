import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../../lib/errors.js";

/**
 * Simple per-user, per-process sliding window — deliberately NOT
 * distributed-safe (a multi-instance deployment would let each instance
 * enforce its own independent limit). Redis is provisioned in this project
 * but genuinely unused elsewhere (see docs/DECISIONS.md); building a
 * Redis-backed limiter for one endpoint in this stage would be
 * infrastructure the assessment doesn't call for. Documented honestly as a
 * known limitation in docs/PART_B_RELIABILITY.md, not hidden.
 */
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 20;

const hits = new Map<string, number[]>();

export function agentChatRateLimiter(req: Request, _res: Response, next: NextFunction): void {
  const userId = req.user?.id;
  if (!userId) {
    // Composed after requireAuth in every real route; absent only in a
    // misconfigured test.
    next();
    return;
  }

  const now = Date.now();
  const windowStart = now - WINDOW_MS;
  const recent = (hits.get(userId) ?? []).filter((t) => t > windowStart);

  if (recent.length >= MAX_REQUESTS_PER_WINDOW) {
    throw new ApiError(429, "RATE_LIMITED", "Too many assistant requests — please wait a moment and try again");
  }

  recent.push(now);
  hits.set(userId, recent);
  next();
}
