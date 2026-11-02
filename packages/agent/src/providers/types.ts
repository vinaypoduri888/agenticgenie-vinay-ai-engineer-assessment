import { z } from "zod";

/**
 * The structured shape every "final answer" from the model must validate
 * against before the loop will accept it as a real result. `citations` lets
 * the UI (and, later, the eval harness) verify that every claim the model
 * makes is grounded in a record it actually fetched — see docs/DECISIONS.md.
 */
export const agentCitationSchema = z.object({
  type: z.string(),
  id: z.string(),
});
export type AgentCitation = z.infer<typeof agentCitationSchema>;

export const agentPendingConfirmationSummarySchema = z.object({
  toolName: z.string(),
  targetId: z.string(),
  expiresAt: z.string(),
  summary: z.string(),
});

export const agentEventCardSchema = z.object({
  id: z.string(),
  title: z.string(),
  startsAt: z.string(),
  venueCity: z.string().optional(),
  minPriceMinor: z.number().int().nullable().optional(),
});

/** All new fields are optional and additive on top of B1's shape so a B1
 * final-answer script/fixture keeps validating unchanged. */
export const finalAnswerSchema = z.object({
  answer: z.string(),
  citations: z.array(agentCitationSchema).optional(),
  actionTaken: z.boolean().optional(),
  needsConfirmation: z.boolean().optional(),
  /** Present when `needsConfirmation` is true — what exactly is pending,
   * for which tool/target, and until when. Built by the server from a real
   * `AgentPendingConfirmation` row, never by the model. */
  pendingConfirmation: agentPendingConfirmationSummarySchema.optional(),
  /** Structured event references for a UI to render as cards, independent
   * of the citation tokens embedded in `answer`'s prose. */
  eventCards: z.array(agentEventCardSchema).optional(),
  /** Set by code, never the model: a tool result this turn looked like an
   * attempted instruction injection. The UI shows it to the user. */
  suspiciousContentFlagged: z.boolean().optional(),
  /** True when this answer was produced by the deterministic fallback path
   * (provider unavailable) rather than the model — the loop never claims a
   * degraded answer came from the real model. */
  degraded: z.boolean().optional(),
});
export type FinalAnswer = z.infer<typeof finalAnswerSchema>;

/** One tool call the model has asked to make. `arguments` is already
 * parsed into a JS value (a provider implementation is responsible for
 * JSON-parsing its own wire format, e.g. OpenAI's string-encoded
 * `function.arguments`) — it is still fully untrusted until the tool
 * registry's Zod schema validates it. */
export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: unknown;
}

export interface ProviderMessage {
  role: "system" | "user" | "assistant" | "tool";
  /** Present for system/user/tool messages, and for a final assistant
   * answer. Omitted on an assistant message that only carries tool calls. */
  content?: string;
  /** Only meaningful on a "tool" message — correlates the result back to
   * the ToolCallRequest.id it answers. */
  toolCallId?: string;
  /** Only meaningful on an "assistant" message that is calling tools. */
  toolCalls?: ToolCallRequest[];
}

/** The tool-calling schema shape handed to a provider — a JSON Schema
 * `parameters` object (built from the tool's Zod input schema via
 * `z.toJSONSchema`, see tools/registry.ts), not a Zod schema itself, since
 * this is what actually crosses the wire to an OpenAI-compatible API. */
export interface ProviderToolSpec {
  name: string;
  description: string;
  parameters: unknown;
}

export interface ProviderRequest {
  messages: ProviderMessage[];
  tools: ProviderToolSpec[];
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
}

/**
 * Which of these the retry wrapper (`providers/retry.ts`) treats as worth
 * another attempt is a policy decision, not something this type encodes —
 * see `RETRYABLE_CATEGORIES` there. `rate_limited`/`server_error`/`timeout`/
 * `network` are transient and get bounded exponential backoff with jitter
 * (honoring `retryAfterMs` when the provider supplied one); `quota_exceeded`
 * and `auth_error` are permanent for this turn and are never retried —
 * retrying a billing or auth failure wastes the turn's time budget on
 * something that cannot succeed.
 */
export type ProviderFailureCategory =
  | "rate_limited"
  | "server_error"
  | "timeout"
  | "network"
  | "quota_exceeded"
  | "auth_error"
  /** Our request was rejected (a 400, say). That's a bug on our side: it gets
   * logged and isn't retried, because repeating it can't help. */
  | "invalid_request";

export type ProviderResponse =
  | { kind: "final"; content: string; usage: TokenUsage }
  | { kind: "tool_calls"; toolCalls: ToolCallRequest[]; usage: TokenUsage }
  /** The provider returned something the loop cannot work with at all
   * (no choices, unparseable tool-call arguments, etc). Distinct from a
   * "final" response whose `content` merely fails JSON/schema validation —
   * both are routed through the same one-repair-attempt-then-degrade path
   * in the loop, but this variant exists because some failures have no
   * `content` string to even attempt to repair. */
  | { kind: "malformed"; reason: string; usage: TokenUsage }
  /** A classified provider-level failure (rate limit, 5xx, timeout, network,
   * quota, auth) — handled by `providers/retry.ts` BEFORE the loop ever
   * sees it, except once retries are exhausted or the category is
   * non-retryable, in which case the loop treats it as "provider
   * unavailable" and tries the deterministic fallback before degrading. */
  | { kind: "provider_error"; category: ProviderFailureCategory; reason: string; retryAfterMs?: number; usage: TokenUsage };

export interface ModelProvider {
  readonly name: string;
  readonly model: string;
  complete(request: ProviderRequest): Promise<ProviderResponse>;
}
