import { ApiError } from "./errors.js";

export interface Cursor {
  createdAt: Date;
  id: string;
}

/** Opaque, base64-encoded (createdAt, id) keyset cursor — see
 * docs/DECISIONS.md D-013 for why this shape instead of an autoincrement
 * sequence, and its honest limitations. */
export function encodeCursor(cursor: Cursor): string {
  const payload = JSON.stringify({ createdAt: cursor.createdAt.toISOString(), id: cursor.id });
  return Buffer.from(payload, "utf8").toString("base64url");
}

export function decodeCursor(raw: string): Cursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw new ApiError(400, "INVALID_CURSOR", "The cursor is not valid");
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>).createdAt !== "string" ||
    typeof (parsed as Record<string, unknown>).id !== "string"
  ) {
    throw new ApiError(400, "INVALID_CURSOR", "The cursor is not valid");
  }

  const { createdAt, id } = parsed as { createdAt: string; id: string };
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) {
    throw new ApiError(400, "INVALID_CURSOR", "The cursor is not valid");
  }

  return { createdAt: date, id };
}
