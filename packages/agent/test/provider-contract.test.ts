import { describe, expect, it } from "vitest";
import { MockProvider } from "../src/providers/mock.js";
import type { ModelProvider, ProviderRequest } from "../src/providers/types.js";

/** A second, minimal `ModelProvider` implementation — exists purely to
 * prove the interface itself is implementable by more than one provider
 * and that the loop only ever depends on the interface, never on
 * `MockProvider`-specific behavior. */
class StubEchoProvider implements ModelProvider {
  readonly name = "stub-echo";
  readonly model = "stub-v1";

  async complete(_request: ProviderRequest) {
    return {
      kind: "final" as const,
      content: JSON.stringify({ answer: "stub" }),
      usage: { promptTokens: 1, completionTokens: 1 },
    };
  }
}

const providers: { label: string; make: () => ModelProvider }[] = [
  { label: "MockProvider", make: () => new MockProvider({ script: [{ type: "final", content: JSON.stringify({ answer: "ok" }) }] }) },
  { label: "StubEchoProvider", make: () => new StubEchoProvider() },
];

describe.each(providers)("ModelProvider contract: $label", ({ make }) => {
  it("exposes a non-empty name and model", () => {
    const provider = make();
    expect(provider.name.length).toBeGreaterThan(0);
    expect(provider.model.length).toBeGreaterThan(0);
  });

  it("resolves .complete() to a response with a valid 'kind' and numeric usage", async () => {
    const provider = make();
    const response = await provider.complete({ messages: [{ role: "user", content: "hi" }], tools: [] });

    expect(["final", "tool_calls", "malformed"]).toContain(response.kind);
    expect(typeof response.usage.promptTokens).toBe("number");
    expect(typeof response.usage.completionTokens).toBe("number");
  });
});
