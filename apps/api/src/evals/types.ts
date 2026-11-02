import { z } from "zod";

/**
 * A fixed, small vocabulary of seed steps — not a generic fixture DSL.
 * Each `kind` maps directly to one existing `apps/api/test/helpers/fixtures.ts`
 * call (or, for "order", the existing `purchaseGaTickets` helper that drives
 * a real hold+checkout through the real HTTP app). Adding a new seed need
 * is adding one more `kind` here and one more `case` in `seed.ts`, never a
 * query language.
 */
export const seedStepSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("organiser"), ref: z.string(), name: z.string().optional() }),
  z.object({ kind: z.literal("venue"), ref: z.string(), organiser: z.string(), city: z.string().optional() }),
  z.object({
    kind: z.literal("event"),
    ref: z.string(),
    organiser: z.string(),
    venue: z.string(),
    status: z.enum(["DRAFT", "PUBLISHED", "ON_SALE", "SOLD_OUT", "CANCELLED", "COMPLETED"]).default("PUBLISHED"),
    title: z.string().optional(),
    category: z.string().optional(),
    /** ISO datetime, or a relative offset like "+7d" / "-1d" from the
     * moment the eval run starts — relative offsets are what almost every
     * case actually wants (a future on-sale event, or a past completed
     * one), so this is resolved once per run, not re-resolved per case. */
    startsAt: z.string().optional(),
  }),
  z.object({
    kind: z.literal("ticketTier"),
    ref: z.string(),
    event: z.string(),
    name: z.string().optional(),
    totalQuantity: z.number().int().positive().optional(),
    priceMinor: z.number().int().nonnegative().optional(),
  }),
  z.object({ kind: z.literal("user"), ref: z.string(), email: z.string().optional() }),
  z.object({
    kind: z.literal("membership"),
    user: z.string(),
    organiser: z.string(),
    role: z.enum(["ADMIN", "STAFF"]),
  }),
  z.object({
    kind: z.literal("review"),
    ref: z.string().optional(),
    event: z.string(),
    user: z.string(),
    rating: z.number().int().min(1).max(5),
    text: z.string(),
  }),
  z.object({
    kind: z.literal("order"),
    ref: z.string(),
    user: z.string(),
    event: z.string(),
    tier: z.string(),
    quantity: z.number().int().positive().default(1),
  }),
]);
export type SeedStep = z.infer<typeof seedStepSchema>;

const usageSchema = z.object({ promptTokens: z.number().optional(), completionTokens: z.number().optional() }).optional();

const mockStepSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("final"), content: z.string(), usage: usageSchema }),
  z.object({
    type: z.literal("tool_calls"),
    toolCalls: z.array(z.object({ id: z.string(), name: z.string(), arguments: z.record(z.string(), z.unknown()) })),
    usage: usageSchema,
  }),
  z.object({ type: z.literal("malformed"), reason: z.string().optional(), usage: usageSchema }),
  z.object({
    type: z.literal("provider_error"),
    category: z.enum(["rate_limited", "server_error", "timeout", "network", "quota_exceeded", "auth_error", "invalid_request"]),
    reason: z.string().optional(),
    retryAfterMs: z.number().optional(),
    usage: usageSchema,
  }),
]);
export type EvalMockStep = z.infer<typeof mockStepSchema>;

const toolCallExpectationSchema = z.object({
  name: z.string(),
  /** Whether this tool call is expected to have executed successfully
   * (dispatch-level success — a tool returning a clean NEEDS_CONFIRMATION
   * business result still counts as a successful dispatch). Omit to not
   * assert either way. */
  success: z.boolean().optional(),
  /** Error code the tool must have returned, for a policy refusal. */
  errorCode: z.string().optional(),
  /** Arguments the model must have sent. Subset match, so extra arguments are
   * fine. A wrong value fails, including a wrong max_price unit. */
  args: z.record(z.string(), z.unknown()).optional(),
});

const dbCheckSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("orderStatus"), orderRef: z.string(), status: z.string() }),
  z.object({ type: z.literal("noNewOrderForEvent"), eventRef: z.string(), userRef: z.string() }),
  z.object({ type: z.literal("holdActive"), eventRef: z.string(), userRef: z.string() }),
  z.object({ type: z.literal("ticketCount"), eventRef: z.string(), userRef: z.string(), count: z.number().int() }),
  z.object({ type: z.literal("orderUnchanged"), orderRef: z.string(), status: z.string() }),
  z.object({ type: z.literal("pendingConfirmationCount"), count: z.number().int() }),
  z.object({ type: z.literal("pendingConfirmationSays"), contains: z.array(z.string()) }),
  z.object({ type: z.literal("noHoldForEvent"), eventRef: z.string(), userRef: z.string() }),
  /** A figure stated in the answer must equal what the database says. */
  z.object({ type: z.literal("answerStatesTicketsSold"), eventRef: z.string() }),
]);
export type DbCheck = z.infer<typeof dbCheckSchema>;

/** `afterTurn` (1-indexed) runs this check right after that turn of the
 * conversation completes rather than only at the very end — needed for
 * cases that must prove an intermediate state (e.g. "no order exists yet
 * after the first, unconfirmed turn") rather than only the final one. */
const scopedDbCheckSchema = z.object({ afterTurn: z.number().int().positive().optional(), check: dbCheckSchema });
export type ScopedDbCheck = z.infer<typeof scopedDbCheckSchema>;

export const evalCaseSchema = z.object({
  id: z.string(),
  category: z.enum(["search", "aggregation", "actions", "grounding", "reliability", "adversarial"]),
  description: z.string(),
  /** Exercises scripted provider failures, so it can't run against a real model. */
  mockOnly: z.boolean().default(false),
  seed: z.array(seedStepSchema),
  /** Which seeded user (by `ref`) the conversation runs as. */
  persona: z.string(),
  /** One raw human message per turn of the conversation, in order. */
  conversation: z.array(z.string()).min(1),
  /** The full, flat sequence of scripted provider responses for the WHOLE
   * conversation (every turn shares one `MockProvider`, consumed call by
   * call — matching how `MockProvider` actually works) — `{{ref}}` tokens
   * anywhere in here are substituted with real seeded ids before use. */
  mockScript: z.array(mockStepSchema).min(1),
  expectations: z.object({
    toolCalls: z.array(toolCallExpectationSchema).default([]),
    outcome: z.enum(["success", "partial", "error"]).optional(),
    answerContains: z.array(z.string()).default([]),
    /** Regex, case-insensitive. For facts a real model may phrase its own way. */
    answerMatches: z.array(z.string()).default([]),
    answerNotContains: z.array(z.string()).default([]),
    needsConfirmation: z.boolean().optional(),
    degraded: z.boolean().optional(),
    citationsValid: z.boolean().optional(),
    minRetries: z.number().int().optional(),
    /** Tools that must not have been requested at all. */
    toolsForbidden: z.array(z.string()).default([]),
    /** Each prefix ("review:") must be cited by at least one grounded citation. */
    mustCitePrefix: z.array(z.string()).default([]),
    /** No order, payment, ticket, refund or hold changed from the seeded state. */
    dbUnchanged: z.boolean().default(false),
    /** The trace must show this safety check fired (substring match). */
    guardEvents: z.array(z.string()).default([]),
    suspiciousFlagged: z.boolean().optional(),
    dbChecks: z.array(scopedDbCheckSchema).default([]),
  }),
});
export type EvalCase = z.infer<typeof evalCaseSchema>;
