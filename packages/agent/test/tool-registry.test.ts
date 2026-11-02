import { z } from "zod";
import { describe, expect, it } from "vitest";
import { ToolRegistry } from "../src/tools/registry.js";
import { createDefaultToolRegistry } from "../src/tools/catalogue.js";

const REQUIRED_TOOL_NAMES = [
  "search_events",
  "get_event",
  "get_reviews",
  "hold_seats",
  "purchase",
  "cancel_order",
  "sales_summary",
];

describe("ToolRegistry", () => {
  it("registers and looks up a tool by name", () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "echo",
      description: "echoes input",
      inputSchema: z.object({ message: z.string() }),
      outputSchema: z.object({ message: z.string() }),
      sideEffecting: false,
      requiresConfirmation: false,
      organiserScoped: false,
    });

    expect(registry.has("echo")).toBe(true);
    expect(registry.get("echo")?.name).toBe("echo");
  });

  it("returns undefined for an unknown tool (unknown-tool rejection happens here, not via a thrown error)", () => {
    const registry = new ToolRegistry();
    expect(registry.get("does_not_exist")).toBeUndefined();
    expect(registry.has("does_not_exist")).toBe(false);
  });

  it("refuses to register the same tool name twice", () => {
    const registry = new ToolRegistry();
    const def = {
      name: "dup",
      description: "d",
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      sideEffecting: false,
      requiresConfirmation: false,
      organiserScoped: false,
    };
    registry.register(def);
    expect(() => registry.register(def)).toThrow(/already registered/);
  });

  it("lists every registered tool", () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "a",
      description: "d",
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      sideEffecting: false,
      requiresConfirmation: false,
      organiserScoped: false,
    });
    registry.register({
      name: "b",
      description: "d",
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      sideEffecting: false,
      requiresConfirmation: false,
      organiserScoped: false,
    });

    expect(registry.list().map((t) => t.name).sort()).toEqual(["a", "b"]);
  });

  it("produces a JSON-Schema 'parameters' object per tool for a provider's tool-calling spec", () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "echo",
      description: "echoes input",
      inputSchema: z.object({ message: z.string(), limit: z.number().int().max(20).default(10) }),
      outputSchema: z.object({ message: z.string() }),
      sideEffecting: false,
      requiresConfirmation: false,
      organiserScoped: false,
    });

    const specs = registry.listForProvider();
    expect(specs).toHaveLength(1);
    expect(specs[0]?.name).toBe("echo");
    expect(specs[0]?.description).toBe("echoes input");
    const parameters = specs[0]?.parameters as { type: string; properties: Record<string, unknown> };
    expect(parameters.type).toBe("object");
    expect(Object.keys(parameters.properties)).toEqual(["message", "limit"]);
  });
});

describe("createDefaultToolRegistry (the seven required Part B tools)", () => {
  it("registers the seven required tools plus list_my_orders", () => {
    const registry = createDefaultToolRegistry();
    expect(registry.list().map((t) => t.name).sort()).toEqual([...REQUIRED_TOOL_NAMES, "list_my_orders"].sort());
  });

  it("marks the side-effecting tools correctly", () => {
    const registry = createDefaultToolRegistry();
    expect(registry.get("search_events")?.sideEffecting).toBe(false);
    expect(registry.get("get_event")?.sideEffecting).toBe(false);
    expect(registry.get("get_reviews")?.sideEffecting).toBe(false);
    expect(registry.get("hold_seats")?.sideEffecting).toBe(true);
    expect(registry.get("purchase")?.sideEffecting).toBe(true);
    expect(registry.get("cancel_order")?.sideEffecting).toBe(true);
    expect(registry.get("sales_summary")?.sideEffecting).toBe(false);
  });

  it("requires confirmation only for purchase and cancel_order", () => {
    const registry = createDefaultToolRegistry();
    for (const name of REQUIRED_TOOL_NAMES) {
      const expected = name === "purchase" || name === "cancel_order";
      expect(registry.get(name)?.requiresConfirmation).toBe(expected);
    }
  });

  it("marks sales_summary as organiser-scoped and nothing else", () => {
    const registry = createDefaultToolRegistry();
    for (const name of REQUIRED_TOOL_NAMES) {
      const expected = name === "sales_summary";
      expect(registry.get(name)?.organiserScoped).toBe(expected);
    }
  });

  it("leaves every tool's execute undefined in this stage (implementations are Stage B2)", () => {
    const registry = createDefaultToolRegistry();
    for (const name of REQUIRED_TOOL_NAMES) {
      expect(registry.get(name)?.execute).toBeUndefined();
    }
  });

  it("rejects an unknown tool-name-ish input field: no tool schema accepts a caller-identity field", () => {
    const registry = createDefaultToolRegistry();
    for (const name of REQUIRED_TOOL_NAMES) {
      const schema = registry.get(name)!.inputSchema;
      // None of the seven tools' input schemas should declare a userId/
      // actorUserId field — identity must only ever come from the
      // authenticated caller via ToolContext, never from model-supplied
      // arguments. z.toJSONSchema's "properties" lists exactly the
      // declared fields, so absence here is a structural guarantee.
      const jsonSchema = registry.listForProvider().find((t) => t.name === name)!.parameters as {
        properties: Record<string, unknown>;
      };
      expect(Object.keys(jsonSchema.properties)).not.toContain("userId");
      expect(Object.keys(jsonSchema.properties)).not.toContain("actorUserId");
      void schema;
    }
  });
});
