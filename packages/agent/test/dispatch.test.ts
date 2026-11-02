import { z } from "zod";
import { describe, expect, it } from "vitest";
import { ToolRegistry } from "../src/tools/registry.js";
import { dispatchToolCall } from "../src/tools/dispatch.js";
import { ToolError, type ToolContext } from "../src/tools/types.js";
import { createDefaultToolRegistry } from "../src/tools/catalogue.js";

const ctx: ToolContext = { actorUserId: "user-1", requestId: "req-1", conversationId: "conv-1", latestUserMessage: "hi", turnStartedAt: new Date() };

function echoRegistry() {
  const registry = new ToolRegistry();
  registry.register({
    name: "echo",
    description: "echoes a message",
    inputSchema: z.object({ message: z.string() }),
    outputSchema: z.object({ echoed: z.string() }),
    sideEffecting: false,
    requiresConfirmation: false,
    organiserScoped: false,
    execute: async (_ctx, args) => ({ echoed: args.message }),
  });
  return registry;
}

describe("dispatchToolCall", () => {
  it("validates arguments, calls execute, and validates the output", async () => {
    const registry = echoRegistry();
    const result = await dispatchToolCall(registry, ctx, { name: "echo", arguments: { message: "hi" } });

    expect(result.success).toBe(true);
    expect(result.output).toEqual({ echoed: "hi" });
  });

  it("rejects an unknown tool with UNKNOWN_TOOL, without throwing", async () => {
    const registry = echoRegistry();
    const result = await dispatchToolCall(registry, ctx, { name: "nope", arguments: {} });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("UNKNOWN_TOOL");
  });

  it("rejects invalid arguments with INVALID_ARGUMENTS and never calls execute", async () => {
    const registry = new ToolRegistry();
    let executed = false;
    registry.register({
      name: "strict",
      description: "d",
      inputSchema: z.object({ count: z.number().int() }),
      outputSchema: z.object({}),
      sideEffecting: false,
      requiresConfirmation: false,
      organiserScoped: false,
      execute: async () => {
        executed = true;
        return {};
      },
    });

    const result = await dispatchToolCall(registry, ctx, { name: "strict", arguments: { count: "not-a-number" } });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("INVALID_ARGUMENTS");
    expect(executed).toBe(false);
  });

  it("returns NOT_IMPLEMENTED (not a crash) for a registered tool with no execute — proves every real Part B tool is a clean, honest stub in this stage", async () => {
    const registry = createDefaultToolRegistry();
    const result = await dispatchToolCall(registry, ctx, { name: "search_events", arguments: { limit: 5 } });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("NOT_IMPLEMENTED");
  });

  it("enforces a per-tool timeout and reports TOOL_TIMEOUT", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "slow",
      description: "d",
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      sideEffecting: false,
      requiresConfirmation: false,
      organiserScoped: false,
      timeoutMs: 30,
      execute: async () => {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return {};
      },
    });

    const result = await dispatchToolCall(registry, ctx, { name: "slow", arguments: {} });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("TOOL_TIMEOUT");
  });

  it("surfaces a thrown ToolError's code and message as-is", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "denies",
      description: "d",
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      sideEffecting: true,
      requiresConfirmation: false,
      organiserScoped: false,
      execute: async () => {
        throw new ToolError("FORBIDDEN", "Staff cannot refund their own order");
      },
    });

    const result = await dispatchToolCall(registry, ctx, { name: "denies", arguments: {} });

    expect(result.error).toEqual({ code: "FORBIDDEN", message: "Staff cannot refund their own order" });
  });

  it("never leaks a raw thrown error's message or stack to the caller", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "explodes",
      description: "d",
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      sideEffecting: false,
      requiresConfirmation: false,
      organiserScoped: false,
      execute: async () => {
        throw new Error("connection string: postgres://user:supersecret@internal-db:5432/prod");
      },
    });

    const result = await dispatchToolCall(registry, ctx, { name: "explodes", arguments: {} });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("TOOL_EXECUTION_FAILED");
    expect(result.error?.message).not.toContain("supersecret");
    expect(result.error?.message).not.toContain("postgres://");
  });

  it("rejects a tool whose execute returns a shape violating its own declared output schema", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "buggy",
      description: "d",
      inputSchema: z.object({}),
      outputSchema: z.object({ count: z.number() }),
      sideEffecting: false,
      requiresConfirmation: false,
      organiserScoped: false,
      execute: async () => ({ count: "not a number" }) as never,
    });

    const result = await dispatchToolCall(registry, ctx, { name: "buggy", arguments: {} });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("INVALID_TOOL_OUTPUT");
  });
});
