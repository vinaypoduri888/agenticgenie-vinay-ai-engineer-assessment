import type {
  ModelProvider,
  ProviderRequest,
  ProviderResponse,
  TokenUsage,
  ToolCallRequest,
} from "@agenticgenie/agent";
import type { EvalMockStep } from "./types.js";

/** About 4 characters per token, the usual rule of thumb for English and JSON.
 * Measured on what this harness actually sends, so a schema or prompt change
 * moves the number, which is what makes it useful for optimising against. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Eval-only provider, deliberately NOT a change to `packages/agent`'s
 * `MockProvider` (which stays exactly what B1-B4 already reviewed and
 * tested). Behaves identically to `MockProvider` — same deterministic,
 * ordered script consumption, same `.calls` recording for retry-count
 * derivation — except a tool-call argument value may be the special marker
 * `{ "$lastToolResult": "fieldName" }`, resolved at call time from the
 * most recent "tool" role message already in the conversation (e.g. a
 * `purchase` eval case needs the REAL `hold_seats` result's id, which only
 * exists once that step has actually executed against the real database —
 * a static script can't hardcode it the way it hardcodes seeded ids).
 */
export class EvalProvider implements ModelProvider {
  readonly name = "eval-mock";
  readonly model = "eval-mock-v1";

  private readonly script: EvalMockStep[];
  private callIndex = 0;

  readonly calls: ProviderRequest[] = [];

  constructor(script: EvalMockStep[]) {
    this.script = script;
  }

  async complete(request: ProviderRequest): Promise<ProviderResponse> {
    this.calls.push(request);

    const step = this.script[this.callIndex] ?? this.script.at(-1);
    if (this.callIndex < this.script.length) this.callIndex += 1;
    if (!step) throw new Error("EvalProvider: script exhausted");

    const responseText =
      step.type === "final" ? step.content : step.type === "tool_calls" ? JSON.stringify(step.toolCalls) : "";
    const usage: TokenUsage = {
      promptTokens: estimateTokens(JSON.stringify(request.messages) + JSON.stringify(request.tools)),
      completionTokens: estimateTokens(responseText),
      ...step.usage,
    };

    if (step.type === "final") return { kind: "final", content: step.content, usage };
    if (step.type === "tool_calls") {
      const toolCalls: ToolCallRequest[] = step.toolCalls.map((call) => ({
        id: call.id,
        name: call.name,
        arguments: resolveArguments(call.arguments, request),
      }));
      return { kind: "tool_calls", toolCalls, usage };
    }
    if (step.type === "provider_error") {
      return { kind: "provider_error", category: step.category, reason: step.reason ?? `scripted ${step.category}`, retryAfterMs: step.retryAfterMs, usage };
    }
    return { kind: "malformed", reason: step.reason ?? "scripted malformed response", usage };
  }
}

function resolveArguments(args: Record<string, unknown>, request: ProviderRequest): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    resolved[key] = isLastToolResultMarker(value) ? readLastToolResultField(request, value.$lastToolResult) : value;
  }
  return resolved;
}

function isLastToolResultMarker(value: unknown): value is { $lastToolResult: string } {
  return !!value && typeof value === "object" && typeof (value as Record<string, unknown>).$lastToolResult === "string";
}

function readLastToolResultField(request: ProviderRequest, field: string): unknown {
  const lastTool = [...request.messages].reverse().find((m) => m.role === "tool");
  if (!lastTool?.content) {
    throw new Error(`EvalProvider: no prior tool result to resolve "$lastToolResult: ${field}" from`);
  }
  const parsed = JSON.parse(lastTool.content) as Record<string, unknown>;
  if (!(field in parsed)) {
    throw new Error(`EvalProvider: prior tool result has no field "${field}" (keys: ${Object.keys(parsed).join(", ")})`);
  }
  return parsed[field];
}
