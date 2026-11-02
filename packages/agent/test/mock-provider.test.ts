import { describe, expect, it } from "vitest";
import { MockProvider } from "../src/providers/mock.js";

describe("MockProvider", () => {
  it("replays a scripted final answer deterministically across repeated calls", async () => {
    const provider = new MockProvider({
      script: [{ type: "final", content: JSON.stringify({ answer: "hello" }) }],
    });

    const request = { messages: [{ role: "user" as const, content: "hi" }], tools: [] };
    const first = await provider.complete(request);
    const second = await provider.complete(request);

    expect(first).toEqual(second);
    expect(first.kind).toBe("final");
  });

  it("returns each scripted step in order", async () => {
    const provider = new MockProvider({
      script: [
        { type: "tool_calls", toolCalls: [{ id: "c1", name: "search_events", arguments: { limit: 5 } }] },
        { type: "final", content: JSON.stringify({ answer: "done" }) },
      ],
    });

    const request = { messages: [], tools: [] };
    const step1 = await provider.complete(request);
    const step2 = await provider.complete(request);

    expect(step1.kind).toBe("tool_calls");
    expect(step2.kind).toBe("final");
  });

  it("repeats the last step forever by default once the script is exhausted", async () => {
    const provider = new MockProvider({
      script: [{ type: "final", content: JSON.stringify({ answer: "only one" }) }],
    });
    const request = { messages: [], tools: [] };

    await provider.complete(request);
    const extra = await provider.complete(request);
    const extraAgain = await provider.complete(request);

    expect(extra.kind).toBe("final");
    expect(extraAgain).toEqual(extra);
  });

  it("throws once exhausted when onExhausted is 'throw'", async () => {
    const provider = new MockProvider({
      script: [{ type: "final", content: JSON.stringify({ answer: "x" }) }],
      onExhausted: "throw",
    });
    const request = { messages: [], tools: [] };

    await provider.complete(request);
    await expect(provider.complete(request)).rejects.toThrow(/script exhausted/);
  });

  it("applies default usage but allows a script step to override it", async () => {
    const provider = new MockProvider({
      script: [{ type: "final", content: "{}", usage: { completionTokens: 9999 } }],
    });

    const response = await provider.complete({ messages: [], tools: [] });

    expect(response.usage.completionTokens).toBe(9999);
    expect(response.usage.promptTokens).toBeGreaterThan(0); // default, not overridden
  });

  it("records every request it receives, in order", async () => {
    const provider = new MockProvider({ script: [{ type: "final", content: "{}" }] });
    const requestA = { messages: [{ role: "user" as const, content: "a" }], tools: [] };
    const requestB = { messages: [{ role: "user" as const, content: "b" }], tools: [] };

    await provider.complete(requestA);
    await provider.complete(requestB);

    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[0]).toBe(requestA);
    expect(provider.calls[1]).toBe(requestB);
  });

  it("returns a 'malformed' response for a scripted malformed step", async () => {
    const provider = new MockProvider({ script: [{ type: "malformed", reason: "simulated 429" }] });

    const response = await provider.complete({ messages: [], tools: [] });

    expect(response.kind).toBe("malformed");
    if (response.kind === "malformed") {
      expect(response.reason).toBe("simulated 429");
    }
  });
});
