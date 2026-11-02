import type { ToolCallRequest } from "../providers/types.js";
import type { ToolRegistry } from "./registry.js";
import { ToolError, type ToolContext } from "./types.js";

export const DEFAULT_TOOL_TIMEOUT_MS = 10_000;

export interface ToolDispatchError {
  code: string;
  message: string;
}

export interface ToolDispatchResult {
  success: boolean;
  output?: unknown;
  error?: ToolDispatchError;
}

class ToolTimeoutError extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ToolTimeoutError(`timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * The single place a tool call actually executes. Every path through this
 * function is designed to never throw and never leak an internal error
 * message or stack trace back to the model — a thrown exception from a
 * tool's `execute` becomes a generic `TOOL_EXECUTION_FAILED`, not whatever
 * the underlying error object happened to say (which could, in principle,
 * include a database connection string, a file path, or similar).
 *
 * Args are validated with the tool's own Zod schema BEFORE `execute` is
 * ever called — a model's tool-call JSON is untrusted input no different
 * from an HTTP request body. The output is validated against the tool's
 * own declared output schema too: an `execute` that returns something
 * violating its own contract is a bug in that tool, not something to
 * forward to the model as if it were trustworthy.
 */
export async function dispatchToolCall(
  registry: ToolRegistry,
  ctx: ToolContext,
  call: Pick<ToolCallRequest, "name" | "arguments">,
  options?: { timeoutMs?: number },
): Promise<ToolDispatchResult> {
  const definition = registry.get(call.name);
  if (!definition) {
    return { success: false, error: { code: "UNKNOWN_TOOL", message: `No tool named "${call.name}" is registered` } };
  }

  const parsedArgs = definition.inputSchema.safeParse(call.arguments);
  if (!parsedArgs.success) {
    return {
      success: false,
      error: {
        code: "INVALID_ARGUMENTS",
        message: `Invalid arguments for tool "${call.name}": ${parsedArgs.error.issues.map((i) => i.message).join("; ")}`,
      },
    };
  }

  if (!definition.execute) {
    return {
      success: false,
      error: { code: "NOT_IMPLEMENTED", message: `Tool "${call.name}" is registered but not yet implemented` },
    };
  }

  const timeoutMs = options?.timeoutMs ?? definition.timeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;

  try {
    const rawOutput = await withTimeout(definition.execute(ctx, parsedArgs.data), timeoutMs);
    const parsedOutput = definition.outputSchema.safeParse(rawOutput);
    if (!parsedOutput.success) {
      return {
        success: false,
        error: { code: "INVALID_TOOL_OUTPUT", message: `Tool "${call.name}" returned an unexpected shape` },
      };
    }
    return { success: true, output: parsedOutput.data };
  } catch (err) {
    if (err instanceof ToolTimeoutError) {
      return { success: false, error: { code: "TOOL_TIMEOUT", message: `Tool "${call.name}" timed out after ${timeoutMs}ms` } };
    }
    if (err instanceof ToolError) {
      return { success: false, error: { code: err.code, message: err.message } };
    }
    return { success: false, error: { code: "TOOL_EXECUTION_FAILED", message: `Tool "${call.name}" failed unexpectedly` } };
  }
}
