import type {
  ModelProvider,
  ProviderFailureCategory,
  ProviderMessage,
  ProviderRequest,
  ProviderResponse,
  TokenUsage,
  ToolCallRequest,
} from "./types.js";

/**
 * OpenAI-compatible chat-completions provider (works against NVIDIA
 * Nemotron's OpenAI-compatible endpoint, or any other compatible host,
 * including a local Ollama instance exposing the same wire format).
 *
 * Deliberately constructor-configured rather than reading `process.env`
 * itself — env resolution is `apps/api`'s job (Stage B2), so this package
 * stays usable in any host, including tests, without environment coupling.
 * Never required to run the application: the mock provider is the default
 * everywhere this isn't explicitly constructed.
 */
export interface NemotronProviderOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Injectable for tests — never a real network call in this package's own
   * test suite. Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Per-request wall clock. Without one, a hung connection hangs the turn. */
  timeoutMs?: number;
  /** Lower is steadier for evals. Omitted from the request when undefined. */
  temperature?: number;
}

const ZERO_USAGE: TokenUsage = { promptTokens: 0, completionTokens: 0 };

export class NemotronProvider implements ModelProvider {
  readonly name = "nemotron";
  readonly model: string;

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly temperature?: number;

  constructor(options: NemotronProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.temperature = options.temperature;
  }

  async complete(request: ProviderRequest): Promise<ProviderResponse> {
    const body = {
      model: this.model,
      messages: request.messages.map(toOpenAiMessage),
      ...(this.temperature !== undefined ? { temperature: this.temperature } : {}),
      ...(request.tools.length > 0
        ? {
            tools: request.tools.map((t) => ({
              type: "function" as const,
              function: { name: t.name, description: t.description, parameters: t.parameters },
            })),
          }
        : {}),
    };

    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      return timedOut
        ? { kind: "provider_error", category: "timeout", reason: "request_timeout", usage: ZERO_USAGE }
        : { kind: "provider_error", category: "network", reason: "network_error", usage: ZERO_USAGE };
    }

    if (!res.ok) {
      const errorBody = await res.text().catch(() => "");
      const category = classifyHttpFailure(res.status, errorBody);
      if (category) {
        const retryAfterHeader = res.headers.get("retry-after");
        const retryAfterMs = retryAfterHeader ? parseRetryAfterMs(retryAfterHeader) : undefined;
        return { kind: "provider_error", category, reason: `http_${res.status}`, retryAfterMs, usage: ZERO_USAGE };
      }
      return { kind: "malformed", reason: `http_${res.status}`, usage: ZERO_USAGE };
    }

    let json: OpenAiChatCompletionResponse;
    try {
      json = (await res.json()) as OpenAiChatCompletionResponse;
    } catch {
      return { kind: "malformed", reason: "invalid_json_response", usage: ZERO_USAGE };
    }

    const usage: TokenUsage = {
      promptTokens: json.usage?.prompt_tokens ?? 0,
      completionTokens: json.usage?.completion_tokens ?? 0,
    };

    const message = json.choices?.[0]?.message;
    if (!message) {
      return { kind: "malformed", reason: "no_choices_in_response", usage };
    }

    if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
      const toolCalls: ToolCallRequest[] = [];
      for (const tc of message.tool_calls) {
        let args: unknown;
        try {
          args = JSON.parse(tc.function.arguments);
        } catch {
          return { kind: "malformed", reason: "unparseable_tool_call_arguments", usage };
        }
        toolCalls.push({ id: tc.id, name: tc.function.name, arguments: args });
      }
      return { kind: "tool_calls", toolCalls, usage };
    }

    if (typeof message.content === "string") {
      return { kind: "final", content: message.content, usage };
    }

    return { kind: "malformed", reason: "empty_message_content", usage };
  }
}

interface OpenAiToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface OpenAiChatMessage {
  role: string;
  content: string | null;
  tool_calls?: OpenAiToolCall[];
  tool_call_id?: string;
}

interface OpenAiChatCompletionResponse {
  choices?: { message: OpenAiChatMessage }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

function toOpenAiMessage(m: ProviderMessage): OpenAiChatMessage {
  if (m.role === "tool") {
    return { role: "tool", content: m.content ?? "", tool_call_id: m.toolCallId };
  }
  if (m.role === "assistant" && m.toolCalls) {
    return {
      role: "assistant",
      content: m.content ?? null,
      tool_calls: m.toolCalls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
      })),
    };
  }
  return { role: m.role, content: m.content ?? "" };
}

/** Billing and auth failures can't be fixed by trying again, so neither is
 * retried. A 429 is usually a rate limit and is retried, unless its body says
 * the account is out of quota, which many OpenAI-compatible APIs report the
 * same way. 5xx is transient. A 4xx rejection means our request is wrong, which
 * is a bug to log rather than something to retry or "repair". */
function classifyHttpFailure(status: number, body: string): ProviderFailureCategory | undefined {
  if (status === 402) return "quota_exceeded";
  if (status === 429) return /insufficient_quota|quota|billing|credit/i.test(body) ? "quota_exceeded" : "rate_limited";
  if (status === 401 || status === 403) return "auth_error";
  if (status === 408) return "timeout";
  if (status >= 500) return "server_error";
  if (status >= 400) return "invalid_request";
  return undefined;
}

/** `Retry-After` is either a delay in seconds or an HTTP-date; only the
 * seconds form is handled (the form any real rate-limited API in this
 * project's scope will send) — an HTTP-date is ignored in favor of the
 * retry wrapper's own default backoff rather than risk parsing it wrong. */
function parseRetryAfterMs(headerValue: string): number | undefined {
  const seconds = Number(headerValue);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
}
