import { dispatchToolCall } from "../tools/dispatch.js";
import { finalAnswerSchema, type AgentCitation, type FinalAnswer, type ProviderMessage, type ProviderResponse } from "../providers/types.js";
import { callProviderWithRetry } from "../providers/retry.js";
import { checkGrounding, collectKnownRecords, extractCitationTokens } from "./grounding.js";
import {
  FALSE_ACTION_REPLACEMENT,
  claimsCompletedAction,
  findUnverifiedFigures,
  groundEventCards,
  hasExecutedAction,
  looksLikeInjection,
  maskFigures,
  stripCitationTokens,
} from "./guards.js";
import { runDeterministicFallback } from "./fallback.js";
import { ExecutionTracer, type ToolCallTrace } from "../tracing/tracer.js";
import type { AgentExecutionResult, RunAgentTurnParams } from "./types.js";

const DEFAULT_MAX_STEPS = 6;
const DEFAULT_PER_TOOL_TIMEOUT_MS = 10_000;

const REPAIR_INSTRUCTION: ProviderMessage = {
  role: "user",
  content:
    "Your previous response could not be parsed. Reply again with ONLY a single valid JSON object " +
    'matching the required schema ({"answer": string, "citations"?: [...], "actionTaken"?: boolean, ' +
    '"needsConfirmation"?: boolean}) — no prose, no markdown fences, no extra text.',
};

function groundingRepairInstruction(invalid: AgentCitation[]): ProviderMessage {
  const list = invalid.map((c) => `[${c.type}:${c.id}]`).join(", ");
  return {
    role: "user",
    content:
      `The following citations do not match any record actually returned by a tool call in this ` +
      `conversation: ${list}. Never invent an id, price, availability, or date. Reply again, ` +
      `removing or correcting every unsupported citation.`,
  };
}

const UNCITED_REPAIR_INSTRUCTION: ProviderMessage = {
  role: "user",
  content:
    "Your answer states facts from tool results without citing them. Reply again with the same JSON shape, " +
    "citing each record you rely on inline as [event:ID], [review:ID], [order:ID] or [sales:KEY].",
};

function figuresRepairInstruction(figures: string[]): ProviderMessage {
  return {
    role: "user",
    content: `These amounts do not match anything a tool returned: ${figures.join(", ")}. Reply again using only amounts from tool results.`,
  };
}

/** Real models often wrap JSON in a markdown fence despite being told not to. */
function stripCodeFence(content: string): string {
  const fenced = content.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1]! : content;
}

function tryParseFinalAnswer(content: string): FinalAnswer | undefined {
  const cleaned = stripCodeFence(content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim());
  let json: unknown;
  try {
    json = JSON.parse(cleaned);
  } catch {
    // Real models often wrap the object in a sentence. Worth one cheap attempt
    // before spending a whole repair turn on it.
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end <= start) return undefined;
    try {
      json = JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      return undefined;
    }
  }
  const result = finalAnswerSchema.safeParse(json);
  return result.success ? result.data : undefined;
}

function allCitationsOf(answer: FinalAnswer): AgentCitation[] {
  return [...extractCitationTokens(answer.answer), ...(answer.citations ?? [])];
}

/**
 * The custom tool-calling loop. Every exit path below returns a typed
 * `AgentExecutionResult` — this function does not throw for any of the
 * documented stop conditions (step limit, token budget, unrepairable
 * malformed output, provider unavailable). "Never silently claim success"
 * is enforced structurally: the only way `outcome` becomes `"success"` is a
 * final answer that both parsed as JSON and validated against
 * `finalAnswerSchema`, AND whose citations (if any) are grounded in a
 * record a tool actually returned this conversation — an answer produced
 * by the deterministic fallback path also reaches `"success"`, but always
 * with `answer.degraded === true`, never silently presented as the model's
 * own words.
 */
export async function runAgentTurn(params: RunAgentTurnParams): Promise<AgentExecutionResult> {
  const { callerUserId, requestId, conversationId, provider, registry } = params;
  const maxSteps = params.options?.maxSteps ?? DEFAULT_MAX_STEPS;
  const tokenBudget = params.options?.tokenBudget ?? Number.POSITIVE_INFINITY;
  const perToolTimeoutMs = params.options?.perToolTimeoutMs ?? DEFAULT_PER_TOOL_TIMEOUT_MS;
  const requireCitations = params.options?.requireCitations ?? false;
  let stepRetries = 0;
  const retryOptions = {
    maxAttempts: params.options?.providerMaxAttempts,
    deadlineMs: params.options?.providerRetryDeadlineMs,
    sleep: params.options?.providerRetrySleep,
    onRetry: () => {
      stepRetries += 1;
    },
  };

  const tracer =
    params.tracer ?? new ExecutionTracer({ requestId, conversationId, provider: provider.name, model: provider.model });
  const messages: ProviderMessage[] = [...params.messages];
  const turnStartIndex = messages.length;
  const toolSpecs = registry.listForProvider();

  // The ONLY source of identity (and confirmation evidence) every tool call
  // this turn receives — built once, from the authenticated inputs this
  // function was called with, never from anything inside a tool-call's
  // `arguments`, regardless of what the model's JSON contains.
  const latestUserMessage = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const toolCtx = { actorUserId: callerUserId, requestId, conversationId, latestUserMessage, turnStartedAt: new Date() };

  let totalTokens = 0;
  let repairUsed = false;
  // Privilege separation: once this turn has read third-party text, the model
  // that read it can't spend the user's money in the same turn, whatever it now
  // believes it was told to do. The next human message clears this.
  let sideEffectsRestricted: "all_side_effects" | "confirmed_actions" | undefined;
  let suspiciousContentFlagged = false;

  const figureProblems = (answer: FinalAnswer) => findUnverifiedFigures(answer.answer, messages);
  const isUncited = (answer: FinalAnswer) =>
    requireCitations &&
    allCitationsOf(answer).length === 0 &&
    collectKnownRecords(messages.slice(turnStartIndex)).length > 0;

  /** The last checks on an answer about to be returned, once repair is spent. */
  const finalizeAnswer = (answer: FinalAnswer, ungrounded: AgentCitation[]): FinalAnswer => {
    let result = answer;
    if (ungrounded.length > 0) {
      result = {
        ...result,
        answer: stripCitationTokens(result.answer, ungrounded),
        citations: result.citations?.filter((c) => !ungrounded.some((bad) => bad.type === c.type && bad.id === c.id)),
      };
    }
    if (result.eventCards) {
      const cards = groundEventCards(result.eventCards, messages);
      if (cards.length < result.eventCards.length) tracer.recordGuardEvent("ungrounded_event_cards_dropped");
      result = { ...result, eventCards: cards };
    }
    const figures = figureProblems(result);
    if (figures.length > 0) {
      tracer.recordGuardEvent("unverified_figures_masked");
      result = { ...result, answer: maskFigures(result.answer, figures) };
    }
    const executedThisTurn = hasExecutedAction(messages.slice(turnStartIndex));
    if (result.actionTaken && !executedThisTurn) {
      tracer.recordGuardEvent("false_action_flag_cleared");
      result = { ...result, actionTaken: false };
    }
    // History counts here: recapping an earlier, real purchase isn't a false claim.
    if (claimsCompletedAction(result.answer) && !hasExecutedAction(messages)) {
      tracer.recordGuardEvent("false_action_claim_replaced");
      result = { ...result, answer: FALSE_ACTION_REPLACEMENT, actionTaken: false, citations: [] };
    }
    if (isUncited(result)) tracer.recordGuardEvent("uncited_answer");
    return suspiciousContentFlagged ? { ...result, suspiciousContentFlagged: true } : result;
  };

  for (let step = 1; step <= maxSteps; step++) {
    let tokensIn = 0;
    let tokensOut = 0;
    let providerCallMs = 0;
    stepRetries = 0;

    const firstCallStart = Date.now();
    let response = await callProviderWithRetry(provider, { messages, tools: toolSpecs }, retryOptions);
    providerCallMs += Date.now() - firstCallStart;
    tokensIn += response.usage.promptTokens;
    tokensOut += response.usage.completionTokens;

    // A provider_error here has already exhausted retries (or was a
    // non-retryable category like quota/auth) — try the deterministic,
    // same-authorized-tools fallback before degrading, per "do not
    // silently invent successful results when the provider fails."
    if (response.kind === "provider_error") {
      totalTokens += tokensIn + tokensOut;
      tracer.recordStep({ stepNumber: step, providerCallMs, tokensIn, tokensOut, providerRetries: stepRetries, toolCalls: [] });

      const fallbackAnswer = await runDeterministicFallback(registry, toolCtx, latestUserMessage);
      if (fallbackAnswer) {
        messages.push({ role: "assistant", content: JSON.stringify(fallbackAnswer) });
        tracer.finish("success", `provider_unavailable_${response.category}_fallback_used`);
        return { outcome: "success", answer: fallbackAnswer, messages, trace: tracer.getTrace() };
      }

      tracer.finish("partial", `provider_unavailable_${response.category}`);
      return { outcome: "partial", reason: `provider_unavailable_${response.category}`, messages, trace: tracer.getTrace() };
    }

    const parseFailure = (r: ProviderResponse): boolean => r.kind === "malformed" || (r.kind === "final" && !tryParseFinalAnswer(r.content));

    let groundingFailure: AgentCitation[] = [];
    let unverifiedFigures: string[] = [];
    let uncited = false;
    if (response.kind === "final" && !parseFailure(response)) {
      const parsed = tryParseFinalAnswer(response.content)!;
      const known = collectKnownRecords(messages);
      groundingFailure = checkGrounding(allCitationsOf(parsed), known).invalid;
      unverifiedFigures = figureProblems(parsed);
      uncited = isUncited(parsed);
    }

    const needsRepair = parseFailure(response) || groundingFailure.length > 0 || unverifiedFigures.length > 0 || uncited;

    // Exactly one bounded repair attempt per turn (not per step, and shared
    // between "couldn't parse JSON" and "cited something ungrounded") — a
    // model that can't self-correct once after an explicit correction
    // prompt shouldn't get unlimited extra tries that quietly burn the
    // step/token budget it's already being held to.
    if (needsRepair && !repairUsed) {
      repairUsed = true;
      messages.push({ role: "assistant", content: response.kind === "final" ? response.content : "" });
      messages.push(
        parseFailure(response)
          ? REPAIR_INSTRUCTION
          : groundingFailure.length > 0
            ? groundingRepairInstruction(groundingFailure)
            : unverifiedFigures.length > 0
              ? figuresRepairInstruction(unverifiedFigures)
              : UNCITED_REPAIR_INSTRUCTION,
      );

      const repairStart = Date.now();
      response = await callProviderWithRetry(provider, { messages, tools: toolSpecs }, retryOptions);
      providerCallMs += Date.now() - repairStart;
      tokensIn += response.usage.promptTokens;
      tokensOut += response.usage.completionTokens;

      if (response.kind === "provider_error") {
        totalTokens += tokensIn + tokensOut;
        tracer.recordStep({ stepNumber: step, providerCallMs, tokensIn, tokensOut, providerRetries: stepRetries, toolCalls: [] });
        const fallbackAnswer = await runDeterministicFallback(registry, toolCtx, latestUserMessage);
        if (fallbackAnswer) {
          messages.push({ role: "assistant", content: JSON.stringify(fallbackAnswer) });
          tracer.finish("success", `provider_unavailable_${response.category}_fallback_used`);
          return { outcome: "success", answer: fallbackAnswer, messages, trace: tracer.getTrace() };
        }
        tracer.finish("partial", `provider_unavailable_${response.category}`);
        return { outcome: "partial", reason: `provider_unavailable_${response.category}`, messages, trace: tracer.getTrace() };
      }

      groundingFailure = [];
      if (response.kind === "final" && !parseFailure(response)) {
        const parsed = tryParseFinalAnswer(response.content)!;
        const known = collectKnownRecords(messages);
        groundingFailure = checkGrounding(allCitationsOf(parsed), known).invalid;
      }
    }

    totalTokens += tokensIn + tokensOut;

    if (parseFailure(response)) {
      tracer.recordStep({ stepNumber: step, providerCallMs, tokensIn, tokensOut, providerRetries: stepRetries, toolCalls: [] });
      tracer.finish("error", "malformed_provider_response_unrepairable");
      return { outcome: "error", reason: "malformed_provider_response_unrepairable", messages, trace: tracer.getTrace() };
    }

    // Checked AFTER malformed-handling but BEFORE acting on the response —
    // even a well-formed final answer must not be honored once the budget
    // this turn was given is already spent, per "never silently claim
    // success" when a resource limit has been hit.
    if (totalTokens > tokenBudget) {
      tracer.recordStep({ stepNumber: step, providerCallMs, tokensIn, tokensOut, providerRetries: stepRetries, toolCalls: [] });
      tracer.finish("partial", "token_budget_exceeded");
      return { outcome: "partial", reason: "token_budget_exceeded", messages, trace: tracer.getTrace() };
    }

    if (response.kind === "final") {
      // A citation STILL ungrounded after the one repair attempt is removed,
      // from the prose as well as the list, rather than failing the whole,
      // otherwise-useful answer. The model gets no credit for an unsupported
      // claim, and the user still gets the rest of the answer.
      const parsedFinal = finalizeAnswer(tryParseFinalAnswer(response.content)!, groundingFailure);

      // What's persisted is what the user saw, so a later turn replays the
      // checked answer and not the rejected one.
      messages.push({ role: "assistant", content: JSON.stringify(parsedFinal) });
      tracer.recordStep({ stepNumber: step, providerCallMs, tokensIn, tokensOut, providerRetries: stepRetries, toolCalls: [] });
      tracer.finish("success", groundingFailure.length > 0 ? "ungrounded_citations_stripped" : undefined);
      return { outcome: "success", answer: parsedFinal, messages, trace: tracer.getTrace() };
    }

    if (response.kind === "malformed") {
      // Unreachable: parseFailure() above already returns for any
      // "malformed" response. Kept as an explicit guard purely so
      // TypeScript narrows `response` to "tool_calls" below, and as a
      // safety net if the logic above is ever restructured.
      tracer.recordStep({ stepNumber: step, providerCallMs, tokensIn, tokensOut, providerRetries: stepRetries, toolCalls: [] });
      tracer.finish("error", "malformed_provider_response_unrepairable");
      return { outcome: "error", reason: "malformed_provider_response_unrepairable", messages, trace: tracer.getTrace() };
    }

    // response.kind === "tool_calls"
    messages.push({ role: "assistant", toolCalls: response.toolCalls });

    const toolCallTraces: ToolCallTrace[] = [];
    for (const call of response.toolCalls) {
      const toolStart = Date.now();
      const definition = registry.get(call.name);
      const blocked = definition?.sideEffecting && sideEffectsRestricted === "all_side_effects";
      // After reading organiser text, a confirmed action may still ASK: a normal
      // booking reads the event, holds and then asks. It just can't execute this
      // turn, whatever the human's latest message says.
      const callCtx = sideEffectsRestricted ? { ...toolCtx, untrustedContentRead: true } : toolCtx;

      const result = blocked
        ? {
            success: false as const,
            error: {
              code: "BLOCKED_AFTER_UNTRUSTED_CONTENT",
              message:
                "This turn already read third-party text, so this action can't run in the same turn. Tell the user what you would do and ask them to confirm in a new message.",
            },
          }
        : await dispatchToolCall(registry, callCtx, call, { timeoutMs: perToolTimeoutMs });

      if (blocked) tracer.recordGuardEvent(`blocked_after_untrusted_read:${call.name}`);
      if (result.success && definition?.restrictsAfterRead) {
        sideEffectsRestricted =
          sideEffectsRestricted === "all_side_effects" ? sideEffectsRestricted : definition.restrictsAfterRead;
        if (looksLikeInjection(JSON.stringify(result.output))) {
          suspiciousContentFlagged = true;
          tracer.recordGuardEvent(`suspicious_content:${call.name}`);
        }
      }
      toolCallTraces.push({
        name: call.name,
        durationMs: Date.now() - toolStart,
        success: result.success,
        retryCount: 0,
        errorCode: result.error?.code,
      });
      messages.push({
        role: "tool",
        toolCallId: call.id,
        content: JSON.stringify(result.success ? result.output : { error: result.error }),
      });
    }

    tracer.recordStep({ stepNumber: step, providerCallMs, tokensIn, tokensOut, providerRetries: stepRetries, toolCalls: toolCallTraces });
  }

  tracer.finish("partial", "step_limit_reached");
  return { outcome: "partial", reason: "step_limit_reached", messages, trace: tracer.getTrace() };
}
