import { z } from "zod";
import { describe, expect, it } from "vitest";
import { runAgentTurn } from "../src/core/loop.js";
import { MockProvider } from "../src/providers/mock.js";
import { ToolRegistry } from "../src/tools/registry.js";

const requestId = "req-1";
const conversationId = "conv-1";

function registryWithNoopTool() {
  const registry = new ToolRegistry();
  registry.register({
    name: "noop",
    description: "does nothing",
    inputSchema: z.object({}),
    outputSchema: z.object({ ok: z.boolean() }),
    sideEffecting: false,
    requiresConfirmation: false,
    organiserScoped: false,
    execute: async () => ({ ok: true }),
  });
  return registry;
}

describe("runAgentTurn", () => {
  it("returns a success outcome with the parsed final answer", async () => {
    const provider = new MockProvider({ script: [{ type: "final", content: JSON.stringify({ answer: "Here are some events." }) }] });
    const result = await runAgentTurn({
      callerUserId: "user-1",
      requestId,
      conversationId,
      messages: [{ role: "user", content: "find me a show" }],
      provider,
      registry: new ToolRegistry(),
    });

    expect(result.outcome).toBe("success");
    expect(result.answer?.answer).toBe("Here are some events.");
    expect(result.trace.outcome).toBe("success");
  });

  it("dispatches a tool call, feeds the result back, and reaches a final answer", async () => {
    const provider = new MockProvider({
      script: [
        { type: "tool_calls", toolCalls: [{ id: "c1", name: "noop", arguments: {} }] },
        { type: "final", content: JSON.stringify({ answer: "done" }) },
      ],
    });
    const result = await runAgentTurn({
      callerUserId: "user-1",
      requestId,
      conversationId,
      messages: [{ role: "user", content: "do the thing" }],
      provider,
      registry: registryWithNoopTool(),
    });

    expect(result.outcome).toBe("success");
    const toolMessage = result.messages.find((m) => m.role === "tool");
    expect(toolMessage?.toolCallId).toBe("c1");
    expect(JSON.parse(toolMessage!.content!)).toEqual({ ok: true });
    expect(result.trace.steps[0]?.toolCalls).toEqual([
      expect.objectContaining({ name: "noop", success: true, retryCount: 0 }),
    ]);
  });

  it("enforces the max-step limit and returns a partial result, never looping forever", async () => {
    const provider = new MockProvider({
      script: [{ type: "tool_calls", toolCalls: [{ id: "c1", name: "noop", arguments: {} }] }],
      onExhausted: "repeat-last",
    });
    const result = await runAgentTurn({
      callerUserId: "user-1",
      requestId,
      conversationId,
      messages: [{ role: "user", content: "keep going forever" }],
      provider,
      registry: registryWithNoopTool(),
      options: { maxSteps: 3 },
    });

    expect(result.outcome).toBe("partial");
    expect(result.reason).toBe("step_limit_reached");
    expect(result.trace.stepCount).toBe(3);
    expect(provider.calls).toHaveLength(3);
  });

  it("enforces the token budget and stops before honoring a final answer that would exceed it", async () => {
    const provider = new MockProvider({
      script: [{ type: "final", content: JSON.stringify({ answer: "expensive" }), usage: { promptTokens: 5000, completionTokens: 5000 } }],
    });
    const result = await runAgentTurn({
      callerUserId: "user-1",
      requestId,
      conversationId,
      messages: [{ role: "user", content: "hi" }],
      provider,
      registry: new ToolRegistry(),
      options: { tokenBudget: 1000 },
    });

    expect(result.outcome).toBe("partial");
    expect(result.reason).toBe("token_budget_exceeded");
    expect(result.answer).toBeUndefined(); // never silently claims success
  });

  it("attempts exactly one repair on malformed output, then succeeds if the repair is valid", async () => {
    const provider = new MockProvider({
      script: [
        { type: "final", content: "this is not json at all" },
        { type: "final", content: JSON.stringify({ answer: "fixed" }) },
      ],
    });
    const result = await runAgentTurn({
      callerUserId: "user-1",
      requestId,
      conversationId,
      messages: [{ role: "user", content: "hi" }],
      provider,
      registry: new ToolRegistry(),
    });

    expect(result.outcome).toBe("success");
    expect(result.answer?.answer).toBe("fixed");
    expect(provider.calls).toHaveLength(2); // original + exactly one repair
  });

  it("degrades gracefully (never throws) when the repair attempt is also malformed", async () => {
    const provider = new MockProvider({
      script: [
        { type: "final", content: "still not json" },
        { type: "final", content: "nope, still broken" },
      ],
    });
    const result = await runAgentTurn({
      callerUserId: "user-1",
      requestId,
      conversationId,
      messages: [{ role: "user", content: "hi" }],
      provider,
      registry: new ToolRegistry(),
    });

    expect(result.outcome).toBe("error");
    expect(result.reason).toBe("malformed_provider_response_unrepairable");
    expect(provider.calls).toHaveLength(2); // never retries beyond the one bounded repair
  });

  it("degrades gracefully on a transport-level 'malformed' provider response, not just bad JSON", async () => {
    const provider = new MockProvider({
      script: [
        { type: "malformed", reason: "upstream 500" },
        { type: "malformed", reason: "upstream 500 again" },
      ],
    });
    const result = await runAgentTurn({
      callerUserId: "user-1",
      requestId,
      conversationId,
      messages: [{ role: "user", content: "hi" }],
      provider,
      registry: new ToolRegistry(),
    });

    expect(result.outcome).toBe("error");
    expect(result.reason).toBe("malformed_provider_response_unrepairable");
  });

  it("records a trace with all the documented fields after a full run", async () => {
    const provider = new MockProvider({ script: [{ type: "final", content: JSON.stringify({ answer: "ok" }) }] });
    const result = await runAgentTurn({
      callerUserId: "user-1",
      requestId: "req-trace",
      conversationId: "conv-trace",
      messages: [{ role: "user", content: "hi" }],
      provider,
      registry: new ToolRegistry(),
    });

    const trace = result.trace;
    expect(trace.requestId).toBe("req-trace");
    expect(trace.conversationId).toBe("conv-trace");
    expect(trace.provider).toBe("mock");
    expect(trace.model).toBe(provider.model);
    expect(typeof trace.startedAt).toBe("string");
    expect(typeof trace.endedAt).toBe("string");
    expect(trace.latencyMs).toBeGreaterThanOrEqual(0);
    expect(trace.stepCount).toBe(1);
    expect(trace.steps).toHaveLength(1);
    expect(trace.totalTokensIn).toBeGreaterThan(0);
    expect(trace.totalTokensOut).toBeGreaterThan(0);
    expect(trace.outcome).toBe("success");
  });

  it("never records raw tool-call arguments in the trace (redaction policy)", async () => {
    const provider = new MockProvider({
      script: [
        { type: "tool_calls", toolCalls: [{ id: "c1", name: "noop", arguments: { secretSeatId: "seat-private-123" } }] },
        { type: "final", content: JSON.stringify({ answer: "done" }) },
      ],
    });
    const result = await runAgentTurn({
      callerUserId: "user-1",
      requestId,
      conversationId,
      messages: [{ role: "user", content: "hold a seat" }],
      provider,
      registry: registryWithNoopTool(),
    });

    const serializedTrace = JSON.stringify(result.trace);
    expect(serializedTrace).not.toContain("seat-private-123");
  });

  it("builds every tool's ToolContext from the authenticated caller only — never from a model-supplied identity field in tool-call arguments", async () => {
    let capturedCtx: { actorUserId: string; requestId: string; conversationId: string; latestUserMessage: string; turnStartedAt: Date } | undefined;
    const registry = new ToolRegistry();
    registry.register({
      name: "records_ctx",
      description: "d",
      inputSchema: z.object({ message: z.string() }),
      outputSchema: z.object({ ok: z.boolean() }),
      sideEffecting: false,
      requiresConfirmation: false,
      organiserScoped: false,
      execute: async (ctx) => {
        capturedCtx = ctx;
        return { ok: true };
      },
    });

    const provider = new MockProvider({
      script: [
        {
          type: "tool_calls",
          // The model hallucinates an identity-looking field. It isn't part
          // of the tool's declared input schema, so Zod strips it before
          // `execute` ever sees it — and even if it hadn't been stripped,
          // the loop never reads anything from `call.arguments` to build
          // ctx in the first place.
          toolCalls: [{ id: "c1", name: "records_ctx", arguments: { message: "hi", userId: "attacker-supplied-id" } }],
        },
        { type: "final", content: JSON.stringify({ answer: "done" }) },
      ],
    });

    const result = await runAgentTurn({
      callerUserId: "the-real-authenticated-user",
      requestId: "req-identity",
      conversationId,
      messages: [{ role: "user", content: "do it" }],
      provider,
      registry,
    });

    expect(result.outcome).toBe("success");
    expect(capturedCtx).toEqual({
      actorUserId: "the-real-authenticated-user",
      requestId: "req-identity",
      conversationId,
      latestUserMessage: "do it",
      turnStartedAt: expect.any(Date),
    });
    // The hallucinated field never reached ctx, confirming it isn't just
    // that Zod stripped it before `execute` — the loop never reads
    // `call.arguments` to build ctx at all.
    expect(capturedCtx).not.toHaveProperty("userId");
  });
});
