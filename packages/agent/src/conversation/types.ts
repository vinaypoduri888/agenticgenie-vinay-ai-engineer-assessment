import type { ProviderMessage } from "../providers/types.js";
import type { AgentOutcome } from "../tracing/tracer.js";

export interface Turn {
  id: string;
  createdAt: string;
  messages: ProviderMessage[];
  outcome?: AgentOutcome;
}

/**
 * Ties a model's stated intent to confirm a purchase/cancellation to one
 * specific hold or order — a confirmation for hold `h_1` must never be
 * treated as confirming a purchase of hold `h_2`, and a confirmation
 * naturally goes stale once its hold expires or the conversation moves on
 * to a different topic. Type shape only in Stage B1: the agent loop does
 * not yet create, check, or expire these — that enforcement (plus wiring
 * `purchase`/`cancel_order`'s `requiresConfirmation` metadata to it) is
 * Stage B2.
 */
export interface PendingConfirmation {
  id: string;
  toolName: "purchase" | "cancel_order";
  targetId: string;
  createdAt: string;
  expiresAt?: string;
}

export interface ConversationState {
  id: string;
  userId: string;
  turns: Turn[];
  pendingConfirmation?: PendingConfirmation;
}
