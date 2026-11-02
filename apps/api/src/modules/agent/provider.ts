import { NemotronProvider, type ModelProvider } from "@agenticgenie/agent";
import { env } from "../../env.js";
import { DemoProvider } from "./demoProvider.js";

/**
 * `AI_PROVIDER=mock` (the default — see `.env.example`) means the whole
 * application, including this real HTTP endpoint, runs with zero API key.
 * Switching to `nemotron` requires `NEMOTRON_BASE_URL`/`NEMOTRON_API_KEY`/
 * `NEMOTRON_MODEL` to be set; a missing one is a startup-time configuration
 * error, not a silent fallback to mock (so a deployment that THINKS it's
 * using the real model never silently isn't).
 *
 * The no-API-key default is `DemoProvider` — a small, honestly-limited,
 * pattern-matching stand-in (not the deterministic `MockProvider` used by
 * tests/evals, which is a fixed script with no awareness of the actual
 * conversation). It recognizes a handful of plain-English intents (search,
 * "book that", an unambiguous confirmation) and drives real tool_calls, so
 * the whole app — registry dispatch, the real confirmation gate, real
 * idempotency — is exercisable live, with zero API key, not just through
 * tests. See apps/api/src/modules/agent/demoProvider.ts. Eval scenarios
 * build their own precise `MockProvider` scripts directly against
 * `packages/agent`, independent of this default.
 */
export function createConfiguredProvider(): ModelProvider {
  if (env.AI_PROVIDER === "nemotron") {
    if (!env.NEMOTRON_BASE_URL || !env.NEMOTRON_API_KEY || !env.NEMOTRON_MODEL) {
      throw new Error(
        "AI_PROVIDER=nemotron requires NEMOTRON_BASE_URL, NEMOTRON_API_KEY, and NEMOTRON_MODEL to all be set",
      );
    }
    return new NemotronProvider({
      baseUrl: env.NEMOTRON_BASE_URL,
      apiKey: env.NEMOTRON_API_KEY,
      model: env.NEMOTRON_MODEL,
      timeoutMs: env.NEMOTRON_TIMEOUT_MS,
    });
  }

  return new DemoProvider();
}
