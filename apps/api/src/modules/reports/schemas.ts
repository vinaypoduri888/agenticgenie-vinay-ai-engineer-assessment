import { z } from "zod";

export const salesReportQuerySchema = z.object({
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  group_by: z.enum(["event", "day", "tier"]).default("event"),
});

export type SalesReportQuery = z.infer<typeof salesReportQuerySchema>;
