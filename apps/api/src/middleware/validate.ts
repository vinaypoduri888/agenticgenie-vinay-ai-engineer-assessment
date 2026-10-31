import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";

/** Parses req.body against `schema`, replacing it with the parsed/coerced
 * value. Throws ZodError on failure — caught by Express 5's built-in
 * sync/async error forwarding and formatted by errorHandler. */
export function validateBody(schema: ZodType) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    req.body = schema.parse(req.body);
    next();
  };
}

export function validateParams(schema: ZodType) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    req.params = schema.parse(req.params) as typeof req.params;
    next();
  };
}

/** Express 5 makes req.query a read-only getter (reassigning it silently
 * no-ops), unlike req.body/req.params — so the parsed/coerced query goes on
 * req.validatedQuery instead of trying to overwrite req.query. */
export function validateQuery(schema: ZodType) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    req.validatedQuery = schema.parse(req.query);
    next();
  };
}
