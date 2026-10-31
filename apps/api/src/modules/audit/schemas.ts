import { z } from "zod";

export const auditQuerySchema = z.object({
  entity: z.string().min(1).optional(), // "EntityType:entityId", e.g. "Event:abc123"
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).optional(),
});

export type AuditQuery = z.infer<typeof auditQuerySchema>;
