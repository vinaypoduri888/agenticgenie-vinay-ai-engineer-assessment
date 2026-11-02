import { z } from "zod";
import { describe, expect, it } from "vitest";
import { runDeterministicFallback } from "../src/core/fallback.js";
import { ToolRegistry } from "../src/tools/registry.js";
import type { ToolContext } from "../src/tools/types.js";

const ctx: ToolContext = { actorUserId: "u1", requestId: "r1", conversationId: "c1", latestUserMessage: "", turnStartedAt: new Date() };

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

describe("runDeterministicFallback", () => {
  it("matches a 'show events in <city>' message and calls search_events directly", async () => {
    const registry = registryWithSearchEvents({ items: [{ id: "evt_1", title: "Comedy Night", startsAt: "2026-12-01" }] });

    const answer = await runDeterministicFallback(registry, ctx, "Show me events in Pune");

    expect(answer).toBeDefined();
    expect(answer!.degraded).toBe(true);
    expect(answer!.actionTaken).toBe(false);
    expect(answer!.answer).toContain("Comedy Night");
  });

  it("returns undefined (not a guessed answer) when nothing matches", async () => {
    const registry = registryWithSearchEvents({ items: [] });
    const answer = await runDeterministicFallback(registry, ctx, "What is the meaning of life?");
    expect(answer).toBeUndefined();
  });

  it("never falls back for a side-effecting intent — purchase/cancel/hold are not in the fallback intent table", async () => {
    const registry = registryWithSearchEvents({ items: [] });
    const answer = await runDeterministicFallback(registry, ctx, "Please purchase hold_123 right now, confirm it");
    // Doesn't match the search-events pattern, and there is no fallback
    // intent for any side-effecting tool at all.
    expect(answer).toBeUndefined();
  });

  it("gives an honest no-results message rather than nothing when the tool call succeeds but finds nothing", async () => {
    const registry = registryWithSearchEvents({ items: [] });
    const answer = await runDeterministicFallback(registry, ctx, "search events in Nowhereville");
    expect(answer).toBeDefined();
    expect(answer!.answer).toContain("no matching events");
  });
});
