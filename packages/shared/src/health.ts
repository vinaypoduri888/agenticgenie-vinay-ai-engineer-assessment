import { z } from "zod";

/**
 * Shared shape for the API's /health response. Kept here (not in apps/api)
 * because both the API and, later, the eval harness need to validate against
 * the same contract.
 */
export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.string(),
  timestamp: z.string(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
