import { Prisma } from "@prisma/client";
import { ApiError } from "./errors.js";

/**
 * Converts a Prisma unique-constraint violation (P2002) into a clean 409,
 * instead of letting a raw database error reach the client. Rethrows
 * anything else unchanged.
 */
export function toConflictError(err: unknown, message: string): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    throw new ApiError(409, "CONFLICT", message);
  }
  throw err;
}
