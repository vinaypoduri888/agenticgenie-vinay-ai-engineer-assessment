import { ToolError } from "@agenticgenie/agent";
import { ApiError } from "../../lib/errors.js";

/**
 * Every real tool `execute` wraps its call into Part A's service layer with
 * this — Part A's `ApiError`s already carry a safe code and a safe,
 * user-facing message (the same ones its HTTP routes return), so mapping
 * them straight across to a `ToolError` is correct and leaks nothing new.
 * Anything else (a genuine bug) is rethrown untouched and caught by
 * `dispatchToolCall`'s generic handler, which reports it to the model as an
 * opaque `TOOL_EXECUTION_FAILED` rather than forwarding whatever the
 * original error object happened to say.
 */
export async function callService<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ApiError) {
      throw new ToolError(err.code, err.message);
    }
    throw err;
  }
}
