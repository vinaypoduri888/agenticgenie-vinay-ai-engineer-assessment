import { z, type ZodType } from "zod";

/**
 * The assessment's API contract names fields in snake_case; the rest of this
 * API uses camelCase. Accepting both keeps one schema, and one set of service
 * types, per endpoint. If a request sends both spellings, camelCase wins.
 */
export function withSnakeCaseAliases<T extends ZodType>(schema: T, aliases: Record<string, string>) {
  return z.preprocess((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
    const body: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
    for (const [alias, field] of Object.entries(aliases)) {
      if (alias in body) {
        body[field] ??= body[alias];
        delete body[alias];
      }
    }
    return body;
  }, schema);
}
