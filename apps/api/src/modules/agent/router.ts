import { Router } from "express";
import {
  buildPartialAnswer,
  createDefaultToolRegistry,
  hasExecutedAction,
  runAgentTurn,
  withoutRepairExchanges,
  type ModelProvider,
  type ProviderMessage,
} from "@agenticgenie/agent";
import { env } from "../../env.js";
import { validateBody } from "../../middleware/validate.js";
import { partAToolExecutors } from "./tools.js";
import { buildSystemPrompt } from "./systemPrompt.js";
import { chatRequestBodySchema } from "./schemas.js";
import { agentChatRateLimiter } from "./rateLimiter.js";
import { closePendingUnlessConfirmed, getLivePendingConfirmation } from "./confirmation.js";
import {
  appendMessages,
  createConversation,
  getOwnConversationOrThrow,
  listOwnConversations,
  loadReplayMessages,
  toDisplayMessages,
  toPersistableMessages,
} from "./conversation.js";

export const myConversationsRouter = Router();

myConversationsRouter.get("/", async (req, res) => {
  const conversations = await listOwnConversations(req.user!.id);
  res.json({ items: conversations });
});

myConversationsRouter.get("/:id", async (req, res) => {
  const conversation = await getOwnConversationOrThrow(req.user!.id, req.params.id as string);
  const messages = await loadReplayMessages(conversation.id);
  const pendingConfirmation = await getLivePendingConfirmation(conversation.id, req.user!.id);
  res.json({
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt,
    messages,
    display: toDisplayMessages(messages),
    pendingConfirmation,
  });
});

/**
 * A factory, not a module-level singleton, specifically so tests can pass
 * their own deterministic `MockProvider` script through the REAL HTTP
 * endpoint (real DB, real confirmation/idempotency/permission enforcement)
 * instead of only unit-testing `packages/agent`'s loop in isolation. The
 * tool registry is always the real one wired to Part A's service layer —
 * only the model provider is swappable.
 */
export function createAgentRouter(provider: ModelProvider): Router {
  const agentRouter = Router();
  const registry = createDefaultToolRegistry(partAToolExecutors);

  agentRouter.post("/chat", agentChatRateLimiter, validateBody(chatRequestBodySchema), async (req, res) => {
    const userId = req.user!.id;
    const conversationId = req.body.conversationId
      ? (await getOwnConversationOrThrow(userId, req.body.conversationId)).id
      : await createConversation(userId, req.body.message);

    await closePendingUnlessConfirmed(conversationId, userId, req.body.message);

    const replayed = req.body.conversationId ? await loadReplayMessages(conversationId) : [];
    const userMessage: ProviderMessage = { role: "user", content: req.body.message };

    // Pinned fact: survives the history window being trimmed, and comes from the
    // database rather than from what the model remembers.
    const stillPending = await getLivePendingConfirmation(conversationId, userId);
    const pinned: ProviderMessage[] = stillPending
      ? [{ role: "system", content: `Awaiting the user's confirmation for ${stillPending.toolName} on ${stillPending.targetId}: ${stillPending.summary}` }]
      : [];
    const messagesForLoop: ProviderMessage[] = [{ role: "system", content: buildSystemPrompt() }, ...pinned, ...replayed, userMessage];

    const result = await runAgentTurn({
      callerUserId: userId,
      requestId: req.requestId,
      conversationId,
      messages: messagesForLoop,
      provider,
      registry,
      options: {
        maxSteps: env.AGENT_MAX_STEPS,
        tokenBudget: env.AGENT_TOKEN_BUDGET,
        perToolTimeoutMs: env.AGENT_TOOL_TIMEOUT_MS,
        requireCitations: env.AI_PROVIDER === "nemotron",
      },
    });

    // One structured line per turn: tokens, latency, retries, tool outcomes and
    // guard events, never arguments or message content. See tracing/tracer.ts.
    if (env.NODE_ENV !== "test") console.log(JSON.stringify({ type: "agent_turn", ...result.trace }));

    const appendedDuringTurn = result.messages.slice(messagesForLoop.length);
    await appendMessages(conversationId, toPersistableMessages([userMessage, ...withoutRepairExchanges(appendedDuringTurn)], 0));

    const toolExecutionSummary = result.trace.steps.flatMap((step) =>
      step.toolCalls.map((call) => ({
        name: call.name,
        durationMs: call.durationMs,
        success: call.success,
        errorCode: call.errorCode,
      })),
    );

    // Anything about state comes from the server's own records, not the model's
    // claims: what's pending from the database, what happened from tool results.
    const pendingConfirmation = await getLivePendingConfirmation(conversationId, userId);
    const actionTaken = hasExecutedAction(appendedDuringTurn);

    res.json({
      conversationId,
      outcome: result.outcome,
      reason: result.reason,
      answer: result.answer?.answer ?? buildPartialAnswer(result.reason, actionTaken),
      citations: result.answer?.citations ?? [],
      eventCards: result.answer?.eventCards ?? [],
      actionTaken,
      needsConfirmation: pendingConfirmation !== undefined,
      pendingConfirmation,
      degraded: result.answer?.degraded ?? result.outcome !== "success",
      suspiciousContentFlagged: result.answer?.suspiciousContentFlagged ?? false,
      toolExecutionSummary,
    });
  });

  return agentRouter;
}
