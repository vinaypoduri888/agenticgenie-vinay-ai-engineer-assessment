import type { ModelProvider, ProviderRequest, ProviderResponse } from "./types.js";

const RETRYABLE_CATEGORIES = new Set(["rate_limited", "server_error", "timeout", "network"]);

export interface RetryOptions {
  /** Hard cap on attempts for one provider call, including the first. */
  maxAttempts?: number;
  /** Base delay for exponential backoff (doubled per attempt, plus jitter),
   * used when the provider didn't supply its own `retryAfterMs`. */
  baseDelayMs?: number;
  /** Wall-clock deadline for this whole call (including every retry) —
   * retries never push a turn past what the caller is willing to wait,
   * independent of the attempt-count cap. */
  deadlineMs?: number;
  /** Injectable for tests — never a real timer wait in this package's own
   * test suite. */
  sleep?: (ms: number) => Promise<void>;
  /** Called once per retry, so the single tracing point can record it. */
  onRetry?: () => void;
}

const DEFAULT_MAX_ATTEMPTS = 4;
const DEFAULT_BASE_DELAY_MS = 200;
const DEFAULT_DEADLINE_MS = 30_000;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Full jitter: a random delay in [0, cappedExponentialDelay] — avoids the
 * thundering-herd pattern plain exponential backoff produces when many
 * callers retry in lockstep. */
function backoffDelayMs(attempt: number, baseDelayMs: number, retryAfterMs?: number): number {
  if (retryAfterMs !== undefined) return retryAfterMs;
  const exponential = baseDelayMs * 2 ** (attempt - 1);
  return Math.floor(Math.random() * exponential);
}

/**
 * Wraps a single `ModelProvider.complete()` call with bounded exponential
 * backoff + jitter for transient failures. Deliberately lives here, not
 * around tool execution: tool calls are NEVER blindly retried by this
 * harness (a retried `purchase`/`cancel_order` could double a financial
 * side effect) — safety there comes from idempotency key reuse, not retry
 * suppression. Only the read-only "ask the model again" step is a safe
 * thing to retry.
 *
 * Non-retryable categories (`quota_exceeded`, `auth_error`) and a plain
 * `malformed`/`final`/`tool_calls` response are returned immediately,
 * untouched — this function's only job is deciding whether to try again,
 * never reinterpreting what the response means.
 */
export async function callProviderWithRetry(
  provider: ModelProvider,
  request: ProviderRequest,
  options?: RetryOptions,
): Promise<ProviderResponse> {
  const maxAttempts = options?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const baseDelayMs = options?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const deadlineMs = options?.deadlineMs ?? DEFAULT_DEADLINE_MS;
  const sleep = options?.sleep ?? defaultSleep;

  const startedAt = Date.now();
  let lastResponse: ProviderResponse | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await provider.complete(request);
    lastResponse = response;

    const isRetryable = response.kind === "provider_error" && RETRYABLE_CATEGORIES.has(response.category);
    if (!isRetryable) {
      return response;
    }

    const elapsed = Date.now() - startedAt;
    if (attempt === maxAttempts || elapsed >= deadlineMs) {
      return response;
    }

    options?.onRetry?.();
    const delay = backoffDelayMs(attempt, baseDelayMs, response.retryAfterMs);
    const remaining = deadlineMs - elapsed;
    await sleep(Math.min(delay, Math.max(remaining, 0)));
  }

  // Unreachable given maxAttempts >= 1, but keeps the return type total.
  return lastResponse!;
}
