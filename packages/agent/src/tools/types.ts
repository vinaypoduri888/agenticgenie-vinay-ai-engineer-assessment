import type { ZodType } from "zod";

/**
 * The only identity (and confirmation evidence) a tool's `execute` ever
 * receives. Built exclusively from the authenticated caller and the
 * server's own record of the conversation on the server side (see
 * core/loop.ts::runAgentTurn) — never from anything inside a tool-call's
 * `arguments`, even if the model's JSON includes a field that looks like a
 * user id or a confirmation flag. This is the structural enforcement of
 * "the authenticated calling user remains the security principal."
 *
 * `conversationId` and `latestUserMessage` were added in Stage B2 so that
 * `purchase`/`cancel_order` can verify a real, current, human confirmation
 * (see docs/PART_B_SECURITY.md) — both are still sourced only from the
 * loop's own authenticated inputs, never from a tool-call argument, so this
 * extends the B1 security boundary rather than weakening it.
 */
export interface ToolContext {
  actorUserId: string;
  requestId: string;
  /** The conversation this tool call is happening within. Required so a
   * `PendingConfirmation` can be scoped to (conversation, tool, target) and
   * never reused across conversations or users. */
  conversationId: string;
  /** The raw text of the CURRENT turn's actual human message — not
   * anything the model wrote, not an older message. Side-effecting tools
   * that require confirmation check this (via a deterministic classifier,
   * not an LLM judgment) instead of ever trusting a model-supplied
   * `confirm: true` tool-call argument on its own. */
  latestUserMessage: string;
  /** When this turn began. A pending confirmation only counts if it existed
   * before this moment. Otherwise the model could raise a confirmation and
   * immediately answer it, within one turn, using a "yes" the human said about
   * something else. */
  turnStartedAt: Date;
  /** This turn has read third-party free text, so a confirmed action may raise
   * or restate its confirmation but must not execute. Set by the loop. */
  untrustedContentRead?: boolean;
}

/** Mirrors `apps/api/src/lib/errors.ts`'s `ApiError` pattern (a code + a
 * safe, user-facing message) but is deliberately its own class: a tool
 * error must never carry a raw stack trace or an internal exception
 * message back to the model — see tools/dispatch.ts. */
export class ToolError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ToolError";
  }
}

export interface ToolDefinition<TIn = unknown, TOut = unknown> {
  name: string;
  description: string;
  inputSchema: ZodType<TIn>;
  outputSchema: ZodType<TOut>;
  /** Per-tool override of the loop's default timeout. */
  timeoutMs?: number;
  /** Whether this tool mutates state (holds/purchases/refunds) vs. being a
   * pure read (search/get). Read-only tools never require confirmation. */
  sideEffecting: boolean;
  /** Whether the model must have an explicit, user-confirmed intent tied to
   * this specific hold/order before the loop may call this tool for real.
   * Enforcement of the confirmation itself is Stage B2 (conversation-level
   * `PendingConfirmation` tracking) — this flag is tool-facing metadata the
   * confirmation layer will consult, not an invariant enforced in B1. */
  requiresConfirmation: boolean;
  /** True if this tool's underlying service call only makes sense (and
   * will only succeed) for a caller with an organiser membership — e.g.
   * `sales_summary`. Real permission enforcement always happens in the
   * Part A service layer the tool calls into (never trusted from the
   * model); this is documentation/provider-facing metadata, not a
   * second source of truth. */
  organiserScoped: boolean;
  /** Marks a tool that returns third-party free text the model may be misled
   * by. For the rest of the turn, "all_side_effects" refuses every side effect
   * outright, and "confirmed_actions" lets purchase and cancel_order ask for
   * confirmation but not execute. See core/loop.ts. */
  restrictsAfterRead?: "all_side_effects" | "confirmed_actions";
  /** Left undefined in Stage B1 for all seven required tools — the
   * registry and dispatcher are built to make "tool exists but isn't
   * wired to a real service yet" an honest, typed outcome (a clean
   * NOT_IMPLEMENTED ToolError) rather than a crash or a silently-faked
   * success. Stage B2 supplies these by calling the real Part A service
   * layer with the caller's own identity. */
  execute?: (ctx: ToolContext, args: TIn) => Promise<TOut>;
}
