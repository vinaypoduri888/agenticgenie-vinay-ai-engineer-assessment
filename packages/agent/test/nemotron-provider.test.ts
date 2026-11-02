import { describe, expect, it, vi } from "vitest";
import { NemotronProvider } from "../src/providers/nemotron.js";

function openAiResponse(body: unknown, init?: { ok?: boolean; status?: number; headers?: Record<string, string> }) {
  const headers = new Map(Object.entries(init?.headers ?? {}));
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    json: async () => body,
    headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null },
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe("NemotronProvider", () => {
  it("sends a correctly-shaped OpenAI-compatible request (no real network call)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      openAiResponse({
        choices: [{ message: { role: "assistant", content: JSON.stringify({ answer: "hi" }) } }],
        usage: { prompt_tokens: 12, completion_tokens: 4 },
      }),
    );
    const provider = new NemotronProvider({
      baseUrl: "https://example-nemotron.test/v1",
      apiKey: "not-a-real-key",
      model: "nemotron-test",
      fetchImpl,
    });

    await provider.complete({
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "hello" },
      ],
      tools: [{ name: "search_events", description: "search", parameters: { type: "object", properties: {} } }],
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://example-nemotron.test/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer not-a-real-key");
    const body = JSON.parse(init.body);
    expect(body.model).toBe("nemotron-test");
    expect(body.messages).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "hello" },
    ]);
    expect(body.tools).toEqual([
      { type: "function", function: { name: "search_events", description: "search", parameters: { type: "object", properties: {} } } },
    ]);
  });

  it("parses a plain-content response as a final answer", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      openAiResponse({
        choices: [{ message: { role: "assistant", content: JSON.stringify({ answer: "ok" }) } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
    );
    const provider = new NemotronProvider({ baseUrl: "https://x.test", apiKey: "k", model: "m", fetchImpl });

    const response = await provider.complete({ messages: [], tools: [] });

    expect(response.kind).toBe("final");
    if (response.kind === "final") {
      expect(JSON.parse(response.content)).toEqual({ answer: "ok" });
    }
    expect(response.usage).toEqual({ promptTokens: 1, completionTokens: 1 });
  });

  it("parses an OpenAI-style tool-call response, decoding each call's JSON-string arguments", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      openAiResponse({
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [{ id: "call_1", type: "function", function: { name: "get_event", arguments: '{"id":"evt_1"}' } }],
            },
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 5 },
      }),
    );
    const provider = new NemotronProvider({ baseUrl: "https://x.test", apiKey: "k", model: "m", fetchImpl });

    const response = await provider.complete({ messages: [], tools: [] });

    expect(response.kind).toBe("tool_calls");
    if (response.kind === "tool_calls") {
      expect(response.toolCalls).toEqual([{ id: "call_1", name: "get_event", arguments: { id: "evt_1" } }]);
    }
  });

  it("reports a malformed result for unparseable tool-call arguments JSON", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      openAiResponse({
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [{ id: "call_1", type: "function", function: { name: "get_event", arguments: "{not valid json" } }],
            },
          },
        ],
      }),
    );
    const provider = new NemotronProvider({ baseUrl: "https://x.test", apiKey: "k", model: "m", fetchImpl });

    const response = await provider.complete({ messages: [], tools: [] });

    expect(response.kind).toBe("malformed");
    if (response.kind === "malformed") {
      expect(response.reason).toBe("unparseable_tool_call_arguments");
    }
  });

  it("classifies a 503 as a retryable server_error provider_error, not a plain malformed", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(openAiResponse({}, { ok: false, status: 503 }));
    const provider = new NemotronProvider({ baseUrl: "https://x.test", apiKey: "k", model: "m", fetchImpl });

    const response = await provider.complete({ messages: [], tools: [] });

    expect(response.kind).toBe("provider_error");
    if (response.kind === "provider_error") {
      expect(response.category).toBe("server_error");
      expect(response.reason).toBe("http_503");
    }
  });

  it("classifies a 429 as rate_limited and parses a numeric Retry-After header", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      openAiResponse({}, { ok: false, status: 429, headers: { "retry-after": "2" } }),
    );
    const provider = new NemotronProvider({ baseUrl: "https://x.test", apiKey: "k", model: "m", fetchImpl });

    const response = await provider.complete({ messages: [], tools: [] });

    expect(response.kind).toBe("provider_error");
    if (response.kind === "provider_error") {
      expect(response.category).toBe("rate_limited");
      expect(response.retryAfterMs).toBe(2000);
    }
  });

  it("classifies a 401 as a non-retryable auth_error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(openAiResponse({}, { ok: false, status: 401 }));
    const provider = new NemotronProvider({ baseUrl: "https://x.test", apiKey: "k", model: "m", fetchImpl });

    const response = await provider.complete({ messages: [], tools: [] });

    expect(response.kind).toBe("provider_error");
    if (response.kind === "provider_error") {
      expect(response.category).toBe("auth_error");
    }
  });

  it("classifies a rejected request as invalid_request, which is never retried or repaired", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(openAiResponse({}, { ok: false, status: 400 }));
    const provider = new NemotronProvider({ baseUrl: "https://x.test", apiKey: "k", model: "m", fetchImpl });

    const response = await provider.complete({ messages: [], tools: [] });

    expect(response).toMatchObject({ kind: "provider_error", category: "invalid_request" });
  });

  it("classifies out-of-credit responses as quota_exceeded, including a 429 that says so", async () => {
    for (const init of [{ ok: false, status: 402 }, { ok: false, status: 429 }]) {
      const fetchImpl = vi.fn().mockResolvedValue(openAiResponse({ error: { code: "insufficient_quota" } }, init));
      const provider = new NemotronProvider({ baseUrl: "https://x.test", apiKey: "k", model: "m", fetchImpl });
      expect(await provider.complete({ messages: [], tools: [] })).toMatchObject({ kind: "provider_error", category: "quota_exceeded" });
    }
  });

  it("reports a hung request as a timeout", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(Object.assign(new Error("timed out"), { name: "TimeoutError" }));
    const provider = new NemotronProvider({ baseUrl: "https://x.test", apiKey: "k", model: "m", fetchImpl });
    expect(await provider.complete({ messages: [], tools: [] })).toMatchObject({ kind: "provider_error", category: "timeout" });
  });

  it("reports a malformed result when there are no choices in the response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(openAiResponse({ choices: [] }));
    const provider = new NemotronProvider({ baseUrl: "https://x.test", apiKey: "k", model: "m", fetchImpl });

    const response = await provider.complete({ messages: [], tools: [] });

    expect(response.kind).toBe("malformed");
    if (response.kind === "malformed") {
      expect(response.reason).toBe("no_choices_in_response");
    }
  });

  it("reports a retryable network provider_error on a network failure, without throwing", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const provider = new NemotronProvider({ baseUrl: "https://x.test", apiKey: "k", model: "m", fetchImpl });

    const response = await provider.complete({ messages: [], tools: [] });

    expect(response.kind).toBe("provider_error");
    if (response.kind === "provider_error") {
      expect(response.category).toBe("network");
      expect(response.reason).toBe("network_error");
    }
  });
});
