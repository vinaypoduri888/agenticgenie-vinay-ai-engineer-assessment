import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export function requestId(req: Request, res: Response, next: NextFunction): void {
  const id = randomUUID();
  req.requestId = id;
  res.setHeader("X-Request-Id", id);
  next();
}
