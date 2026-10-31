import { z } from "zod";
import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../lib/errors.js";

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Express identifies error
// middleware by arity (4 params); `next` must stay in the signature even though it's unused.
export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void {
  const requestId = req.requestId ?? "unknown";

  if (err instanceof ApiError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, request_id: requestId },
    });
    return;
  }

  if (err instanceof z.ZodError) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        request_id: requestId,
        details: z.flattenError(err).fieldErrors,
      },
    });
    return;
  }

  console.error(err);
  res.status(500).json({
    error: { code: "INTERNAL_ERROR", message: "Something went wrong", request_id: requestId },
  });
}
