import { z } from "zod";
import type { ProviderToolSpec } from "../providers/types.js";
import type { ToolDefinition } from "./types.js";

/**
 * Holds every tool the agent can call. Never exposes raw database access —
 * every entry is a named, schema-validated operation (see
 * tools/catalogue.ts for the seven required tools).
 */
export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition<any, any>>();

  register<TIn, TOut>(definition: ToolDefinition<TIn, TOut>): void {
    if (this.tools.has(definition.name)) {
      throw new Error(`Tool "${definition.name}" is already registered`);
    }
    this.tools.set(definition.name, definition);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  /** The tool-calling schema shape a `ModelProvider` sends across the wire
   * — a JSON Schema `parameters` object derived from each tool's Zod input
   * schema via Zod v4's built-in `z.toJSONSchema`, not the Zod schema
   * itself. */
  listForProvider(): ProviderToolSpec[] {
    return this.list().map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: z.toJSONSchema(tool.inputSchema),
    }));
  }
}
