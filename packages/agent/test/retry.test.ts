import { describe, expect, it, vi } from "vitest";
import { callProviderWithRetry } from "../src/providers/retry.js";
import type { ModelProvider, ProviderResponse } from "../src/providers/types.js";

function fakeProvider(responses: ProviderResponse[]): ModelProvider & { calls: number } {
  let i = 0;
  return {
    name: "fake",
    model: "fake-v1",
    calls: 0,
    async complete() {
      this.calls++;
      const r = responses[Math.min(i, responses.length - 1)]!;
      i++;
      return r;
    },
  };
}

const USAGE = { promptTokens: 1, completionTokens: 1 };
const noopSleep = async () => {};

describe("callProviderWithRetry", () => {
  it("retries a rate_limited failure and returns the eventual success", async () => {
    const provider = fakeProvider([
      { kind: "provider_error", category: "rate_limited", reason: "429", usage: USAGE },
      { kind: "final", content: "ok", usage: USAGE },
    ]);

    const result = await callProviderWithRetry(provider, { messages: [], tools: [] }, { sleep: noopSleep });

    expect(result.kind).toBe("final");
    expect(provider.calls).toBe(2);
  });

  it("retries server_error, timeout, and network failures", async () => {
    for (const category of ["server_error", "timeout", "network"] as const) {
      const provider = fakeProvider([
        { kind: "provider_error", category, reason: "x", usage: USAGE },
        { kind: "final", content: "ok", usage: USAGE },
      ]);
      const result = await callProviderWithRetry(provider, { messages: [], tools: [] }, { sleep: noopSleep });
      expect(result.kind).toBe("final");
    }
  });

  it("never retries quota_exceeded", async () => {
    const provider = fakeProvider([{ kind: "provider_error", category: "quota_exceeded", reason: "x", usage: USAGE }]);

    const result = await callProviderWithRetry(provider, { messages: [], tools: [] }, { sleep: noopSleep });

    expect(result.kind).toBe("provider_error");
    expect(provider.calls).toBe(1);
  });

  it("never retries auth_error", async () => {
    const provider = fakeProvider([{ kind: "provider_error", category: "auth_error", reason: "x", usage: USAGE }]);

    const result = await callProviderWithRetry(provider, { messages: [], tools: [] }, { sleep: noopSleep });

    expect(result.kind).toBe("provider_error");
    expect(provider.calls).toBe(1);
  });

  it("does not retry a plain malformed or a final/tool_calls response", async () => {
    const malformed = fakeProvider([{ kind: "malformed", reason: "bad json", usage: USAGE }]);
    expect((await callProviderWithRetry(malformed, { messages: [], tools: [] }, { sleep: noopSleep })).kind).toBe("malformed");
    expect(malformed.calls).toBe(1);

    const final = fakeProvider([{ kind: "final", content: "hi", usage: USAGE }]);
    await callProviderWithRetry(final, { messages: [], tools: [] }, { sleep: noopSleep });
    expect(final.calls).toBe(1);
  });

  it("is bounded by maxAttempts — gives up and returns the last provider_error", async () => {
    const provider = fakeProvider([{ kind: "provider_error", category: "server_error", reason: "x", usage: USAGE }]);

    const result = await callProviderWithRetry(
      provider,
      { messages: [], tools: [] },
      { sleep: noopSleep, maxAttempts: 3 },
    );

    expect(result.kind).toBe("provider_error");
    expect(provider.calls).toBe(3);
  });

  it("is bounded by the turn deadline even if maxAttempts hasn't been reached", async () => {
    const provider = fakeProvider([{ kind: "provider_error", category: "server_error", reason: "x", usage: USAGE }]);
    let elapsed = 0;
    const fakeSleep = async (ms: number) => {
      elapsed += ms;
    };
    // deadlineMs is tiny — the real clock inside callProviderWithRetry will
    // exceed it almost immediately after the first attempt, independent of
    // maxAttempts, since Date.now() keeps advancing for real.
    const result = await callProviderWithRetry(
      provider,
      { messages: [], tools: [] },
      { sleep: fakeSleep, maxAttempts: 100, deadlineMs: 0 },
    );

    expect(result.kind).toBe("provider_error");
    expect(provider.calls).toBe(1);
  });

  it("honors a provider-supplied retryAfterMs instead of computing its own backoff", async () => {
    const provider = fakeProvider([
      { kind: "provider_error", category: "rate_limited", reason: "429", retryAfterMs: 1234, usage: USAGE },
      { kind: "final", content: "ok", usage: USAGE },
    ]);
    const sleepCalls: number[] = [];
    const recordingSleep = async (ms: number) => {
      sleepCalls.push(ms);
    };

    await callProviderWithRetry(provider, { messages: [], tools: [] }, { sleep: recordingSleep });

    expect(sleepCalls).toEqual([1234]);
  });
});
