import { z } from "zod";
import { describe, expect, it } from "vitest";
import { runAgentTurn } from "../src/core/loop.js";
import { MockProvider } from "../src/providers/mock.js";
import { ToolRegistry } from "../src/tools/registry.js";

const requestId = "req-1";
const conversationId = "conv-1";
const noopSleep = async () => {};

function registryWithSearchEvents(output: unknown) {
  const registry = new ToolRegistry();
  registry.register({
    name: "search_events",
    description: "search",
    inputSchema: z.object({ city: z.string().optional(), limit: z.number().optional() }),
    outputSchema: z.object({ items: z.array(z.any()) }),
    sideEffecting: false,
    requiresConfirmation: false,
    organiserScoped: false,
    execute: async () => output,
  });
  return registry;
}

describe("runAgentTurn — provider reliability", () => {
  it("retries a transient 429 and still succeeds once the provider recovers", async () => {
    const provider = new MockProvider({
      script: [
        { type: "provider_error", category: "rate_limited", retryAfterMs: 1 },
        { type: "final", content: JSON.stringify({ answer: "ok" }) },
      ],
    });

    const result = await runAgentTurn({
      callerUserId: "user-1",
      requestId,
      conversationId,
      messages: [{ role: "user", content: "hi" }],
      provider,
      registry: new ToolRegistry(),
      options: { providerRetrySleep: noopSleep },
    });

    expect(result.outcome).toBe("success");
    expect(provider.calls.length).toBe(2);
  });

  it("never retries a quota_exceeded failure and degrades via fallback when the intent matches", async () => {
    const provider = new MockProvider({ script: [{ type: "provider_error", category: "quota_exceeded" }] });
    const registry = registryWithSearchEvents({ items: [{ id: "evt_1", title: "Comedy Night", startsAt: "2026-12-01" }] });

    const result = await runAgentTurn({
      callerUserId: "user-1",
      requestId,
      conversationId,
      messages: [{ role: "user", content: "show me events in Pune" }],
      provider,
      registry,
      options: { providerRetrySleep: noopSleep },
    });

    expect(provider.calls.length).toBe(1); // never retried
    expect(result.outcome).toBe("success");
    expect(result.answer?.degraded).toBe(true);
    expect(result.answer?.answer).toContain("Comedy Night");
  });

  it("degrades honestly (no invented answer) when the provider is unavailable and no fallback intent matches", async () => {
    const provider = new MockProvider({ script: [{ type: "provider_error", category: "server_error" }] });

    const result = await runAgentTurn({
      callerUserId: "user-1",
      requestId,
      conversationId,
      messages: [{ role: "user", content: "what is the meaning of life?" }],
      provider,
      registry: new ToolRegistry(),
      options: { providerRetrySleep: noopSleep, providerMaxAttempts: 2 },
    });

    expect(result.outcome).toBe("partial");
    expect(result.reason).toBe("provider_unavailable_server_error");
    expect(result.answer).toBeUndefined();
  });

  it("strips an ungrounded citation after one repair attempt instead of failing the whole answer", async () => {
    const provider = new MockProvider({
      script: [
        { type: "tool_calls", toolCalls: [{ id: "c1", name: "search_events", arguments: { city: "Pune" } }] },
        {
          type: "final",
          content: JSON.stringify({
            answer: "Try [event:evt_invented] — it's great.",
            citations: [{ type: "event", id: "evt_invented" }],
          }),
        },
        {
          type: "final",
          content: JSON.stringify({ answer: "Try [event:evt_1] — it's great.", citations: [{ type: "event", id: "evt_1" }] }),
        },
      ],
    });
    const registry = registryWithSearchEvents({ items: [{ id: "evt_1", title: "Comedy Night" }] });

    const result = await runAgentTurn({
      callerUserId: "user-1",
      requestId,
      conversationId,
      messages: [{ role: "user", content: "find a comedy show" }],
      provider,
      registry,
      options: { providerRetrySleep: noopSleep },
    });

    expect(result.outcome).toBe("success");
    expect(result.answer?.citations).toEqual([{ type: "event", id: "evt_1" }]);
    expect(provider.calls.length).toBe(3); // tool_calls step, first (ungrounded) final, repaired final
  });
});
