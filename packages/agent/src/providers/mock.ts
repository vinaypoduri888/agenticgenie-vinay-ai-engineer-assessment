import type {
  ModelProvider,
  ProviderFailureCategory,
  ProviderRequest,
  ProviderResponse,
  TokenUsage,
  ToolCallRequest,
} from "./types.js";

export type MockStep =
  | { type: "final"; content: string; usage?: Partial<TokenUsage> }
  | { type: "tool_calls"; toolCalls: ToolCallRequest[]; usage?: Partial<TokenUsage> }
  | { type: "malformed"; reason?: string; usage?: Partial<TokenUsage> }
  /** Scripts a classified provider-level failure (429/5xx/timeout/network/
   * quota/auth) so B4's reliability tests can exercise the retry/fallback
   * path deterministically, with no real network and no real delay. */
  | { type: "provider_error"; category: ProviderFailureCategory; reason?: string; retryAfterMs?: number; usage?: Partial<TokenUsage> };

export interface MockProviderOptions {
  model?: string;
  /** The exact sequence of responses this provider returns, one per call to
   * `.complete()`. No randomness, no hidden state beyond a call counter —
   * the same script always produces the same sequence of responses, which
   * is what makes this usable for both unit tests and, later, the eval
   * harness. */
  script: MockStep[];
  /** What to do once the script is exhausted: repeat the last scripted
   * step forever (default — convenient for "always return tool calls"
   * step-limit tests), or throw (useful to catch a test that called the
   * provider more times than it meant to). */
  onExhausted?: "repeat-last" | "throw";
}

const DEFAULT_USAGE: TokenUsage = { promptTokens: 10, completionTokens: 10 };

export class MockProvider implements ModelProvider {
  readonly name = "mock";
  readonly model: string;

  private readonly script: MockStep[];
  private readonly onExhausted: "repeat-last" | "throw";
  private callIndex = 0;

  /** Every request this provider has ever received, in order — lets a test
   * assert on exactly what the loop sent (e.g. to prove a tool result was
   * appended, or that no caller-identity field ever appears in a message). */
  readonly calls: ProviderRequest[] = [];

  constructor(options: MockProviderOptions) {
    this.model = options.model ?? "mock-v1";
    this.script = options.script;
    this.onExhausted = options.onExhausted ?? "repeat-last";
  }

  async complete(request: ProviderRequest): Promise<ProviderResponse> {
    this.calls.push(request);

    const step =
      this.callIndex < this.script.length
        ? this.script[this.callIndex]
        : this.onExhausted === "repeat-last"
          ? this.script.at(-1)
          : undefined;

    if (this.callIndex < this.script.length) {
      this.callIndex += 1;
    }

    if (!step) {
      throw new Error("MockProvider: script exhausted and onExhausted is 'throw'");
    }

    const usage: TokenUsage = { ...DEFAULT_USAGE, ...step.usage };

    if (step.type === "final") {
      return { kind: "final", content: step.content, usage };
    }
    if (step.type === "tool_calls") {
      return { kind: "tool_calls", toolCalls: step.toolCalls, usage };
    }
    if (step.type === "provider_error") {
      return {
        kind: "provider_error",
        category: step.category,
        reason: step.reason ?? `scripted ${step.category}`,
        retryAfterMs: step.retryAfterMs,
        usage,
      };
    }
    return { kind: "malformed", reason: step.reason ?? "scripted malformed response", usage };
  }
}
