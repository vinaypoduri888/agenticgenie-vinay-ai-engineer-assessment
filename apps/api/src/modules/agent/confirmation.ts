import { randomUUID } from "node:crypto";
import { prisma } from "@agenticgenie/db";
import { classifyConfirmationIntent } from "@agenticgenie/agent";
import { computeRequestHash } from "../../lib/idempotency.js";

const CONFIRMATION_TTL_MS = 5 * 60_000;

export type ConfirmationGateResult =
  | { kind: "needs_confirmation"; summary: string; expiresAt: Date }
  | { kind: "confirmed"; idempotencyKey: string };

export interface EvaluateConfirmationParams {
  conversationId: string;
  userId: string;
  toolName: "purchase" | "cancel_order";
  targetType: "Hold" | "Order";
  targetId: string;
  /** The tool-call arguments, hashed to detect "this is a different action
   * on the same target" — the `confirm` flag itself is excluded from the
   * hash since it legitimately differs between the "ask" and "execute"
   * calls for what is otherwise the exact same action. */
  args: Record<string, unknown>;
  /** The CURRENT turn's raw human message — never anything the model wrote.
   * Passed straight through from `ToolContext.latestUserMessage`. */
  latestUserMessage: string;
  /** When the current turn began. Only a confirmation raised BEFORE this can be
   * answered by this turn's human message. */
  turnStartedAt?: Date;
  /** This turn read third-party text: the action can be asked about, not run. */
  executionForbidden?: boolean;
  /** What the user is agreeing to, in their terms. Stored with the row. */
  summary?: string;
  /** The confirmation can't outlive what it's about, e.g. the hold's expiry. */
  targetExpiresAt?: Date;
}

function hashRelevantArgs(args: Record<string, unknown>): string {
  const { confirm: _confirm, ...rest } = args;
  return computeRequestHash(rest);
}

function summarize(toolName: string, targetType: string, targetId: string): string {
  const action = toolName === "purchase" ? "purchase this hold" : "cancel this order (full refund)";
  return `About to ${action} (${targetType.toLowerCase()} ${targetId}). Reply "yes" to confirm, or anything else to not proceed.`;
}

/**
 * The server-verified half of the confirmation gate for `purchase`/
 * `cancel_order` — see docs/PART_B_SECURITY.md for the full state machine.
 * A model's own `confirm: true` tool-call argument never reaches this
 * function at all; it is deliberately not a parameter here, so there is
 * nothing for a model to self-attest with.
 *
 * Every mutation below is an atomic conditional `updateMany` keyed on the
 * current status, never a read-then-write — the same pattern as every
 * other inventory/payment state change in this project. Concurrency safety
 * for the actual execution does NOT depend on exactly one caller winning a
 * race here: both branches of a genuine race return the identical
 * `idempotencyKey`, and it is reuse of that one key against Part A's
 * already-regression-tested idempotency primitives (see
 * apps/api/src/lib/idempotency.ts) that makes a double execution
 * impossible, not anything in this function.
 */
export async function evaluateConfirmation(params: EvaluateConfirmationParams): Promise<ConfirmationGateResult> {
  const now = new Date();
  const turnStartedAt = params.turnStartedAt ?? now;
  const argsHash = hashRelevantArgs(params.args);

  const existing = await prisma.agentPendingConfirmation.findFirst({
    where: {
      conversationId: params.conversationId,
      userId: params.userId,
      toolName: params.toolName,
      targetId: params.targetId,
      status: "PENDING",
    },
    orderBy: { createdAt: "desc" },
  });

  if (existing && existing.expiresAt < now) {
    await prisma.agentPendingConfirmation.updateMany({
      where: { id: existing.id, status: "PENDING" },
      data: { status: "EXPIRED", resolvedAt: now },
    });
  }

  const liveMatch = existing && existing.expiresAt >= now && existing.argsHash === argsHash ? existing : undefined;
  const intent = classifyConfirmationIntent(params.latestUserMessage);

  // Raised during this very turn: this turn's human message can't be a reply
  // to something the human hasn't seen yet, however affirmative it looks.
  if (liveMatch && (liveMatch.createdAt >= turnStartedAt || params.executionForbidden)) {
    return {
      kind: "needs_confirmation",
      summary: liveMatch.summary ?? summarize(params.toolName, params.targetType, params.targetId),
      expiresAt: liveMatch.expiresAt,
    };
  }

  if (liveMatch && intent === "confirm") {
    // Whichever of two genuinely-concurrent confirmations updates this row
    // first "wins" it — but both already captured the same idempotencyKey
    // above, so the loser reusing it is exactly as safe as the winner using
    // it: Part A's idempotency store, not this update, is what prevents a
    // double execution.
    await prisma.agentPendingConfirmation.updateMany({
      where: { id: liveMatch.id, status: "PENDING" },
      data: { status: "CONSUMED", resolvedAt: now },
    });
    return { kind: "confirmed", idempotencyKey: liveMatch.idempotencyKey };
  }

  // No live, matching pending action — or the message wasn't an
  // unambiguous confirmation of one. Invalidate any other live pending
  // confirmation for this (conversation, tool) pair first: one pending
  // action per tool at a time, so an old "confirm the Pune show hold"
  // can never be answered by a "yes" aimed at a brand-new request.
  await prisma.agentPendingConfirmation.updateMany({
    where: { conversationId: params.conversationId, userId: params.userId, toolName: params.toolName, status: "PENDING" },
    data: { status: "INVALIDATED", resolvedAt: now },
  });

  const idempotencyKey = randomUUID();
  const ttlExpiry = now.getTime() + CONFIRMATION_TTL_MS;
  const expiresAt = new Date(Math.min(ttlExpiry, params.targetExpiresAt?.getTime() ?? ttlExpiry));
  const summary = params.summary ?? summarize(params.toolName, params.targetType, params.targetId);
  await prisma.agentPendingConfirmation.create({
    data: {
      summary,
      createdAt: now,
      conversationId: params.conversationId,
      userId: params.userId,
      toolName: params.toolName,
      targetType: params.targetType,
      targetId: params.targetId,
      idempotencyKey,
      argsHash,
      status: "PENDING",
      expiresAt,
    },
  });

  return { kind: "needs_confirmation", summary, expiresAt };
}

/**
 * Called at the start of every turn with the human's new message. Anything other
 * than a clear "yes" ends what was pending: a "no", or a change of topic, must
 * not leave a confirmation alive for a later, unrelated "yes" to answer.
 */
export async function closePendingUnlessConfirmed(conversationId: string, userId: string, message: string): Promise<void> {
  if (classifyConfirmationIntent(message) === "confirm") return;
  await prisma.agentPendingConfirmation.updateMany({
    where: { conversationId, userId, status: "PENDING" },
    data: { status: "INVALIDATED", resolvedAt: new Date() },
  });
}

/** What the server itself says is awaiting confirmation. This, not anything the
 * model wrote, is what the API reports and the UI's confirm card shows. */
export async function getLivePendingConfirmation(conversationId: string, userId: string) {
  const pending = await prisma.agentPendingConfirmation.findFirst({
    where: { conversationId, userId, status: "PENDING", expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!pending) return undefined;
  return {
    toolName: pending.toolName,
    targetId: pending.targetId,
    expiresAt: pending.expiresAt.toISOString(),
    summary: pending.summary ?? summarize(pending.toolName, pending.targetType, pending.targetId),
  };
}
