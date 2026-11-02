import type { FinalAnswer, ModelProvider, ProviderMessage } from "../providers/types.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { AgentTrace, ExecutionTracer, AgentOutcome } from "../tracing/tracer.js";

export interface AgentOptions {
  /** Hard ceiling on provider round-trips in one turn. Default 6, per the
   * PDF's "~6 steps" guidance. */
  maxSteps?: number;
  /** Cumulative prompt+completion tokens allowed in one turn before the
   * loop stops and returns a partial result. Default: unlimited. */
  tokenBudget?: number;
  /** Per-tool-call wall-clock timeout, unless a tool declares its own
   * override. */
  perToolTimeoutMs?: number;
  /** Max attempts per provider call (including the first) before a
   * retryable `provider_error` is treated as exhausted. */
  providerMaxAttempts?: number;
  /** Wall-clock deadline, per provider call, that bounds retries — backoff
   * never pushes a turn past what the caller is willing to wait. */
  providerRetryDeadlineMs?: number;
  /** Injectable sleep for the provider retry backoff — tests supply a
   * no-op so retry tests run instantly with no real timers. */
  providerRetrySleep?: (ms: number) => Promise<void>;
  /** Treat a final answer with no citations as a repairable grounding failure
   * when this turn's tools returned citable records. Off for scripted
   * providers; on for a real model, which can actually be corrected. */
  requireCitations?: boolean;
}

export interface AgentExecutionResult {
  outcome: AgentOutcome;
  /** Present whenever outcome !== "success" — a short machine-readable
   * reason ("step_limit_reached", "token_budget_exceeded",
   * "malformed_provider_response_unrepairable"), never a raw internal
   * error message. */
  reason?: string;
  /** Present only when outcome === "success" — the loop never fabricates a
   * best-effort answer for a partial/error outcome. */
  answer?: FinalAnswer;
  /** The full message history as of the end of this turn (including every
   * tool call and tool result), so a caller can persist it and continue
   * the conversation. */
  messages: ProviderMessage[];
  trace: AgentTrace;
}

export interface RunAgentTurnParams {
  /** The authenticated caller — the ONLY source of identity used to build
   * every tool's `ToolContext`. Never derived from provider output. */
  callerUserId: string;
  requestId: string;
  conversationId: string;
  messages: ProviderMessage[];
  provider: ModelProvider;
  registry: ToolRegistry;
  /** Supply an existing tracer to aggregate across multiple turns of the
   * same conversation; omit to get a fresh one scoped to this turn. */
  tracer?: ExecutionTracer;
  options?: AgentOptions;
}
