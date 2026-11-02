import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import type { ModelProvider, ProviderMessage, runAgentTurn as RunAgentTurnType } from "@agenticgenie/agent";
import type { EvalCase } from "./types.js";

// Same pattern as `src/seed.ts` — `tsx src/evals/runner.ts` is a plain Node
// entrypoint, not routed through Vitest's `setupFiles`, so it has to load
// the root `.env` itself, and BEFORE anything that transitively imports
// `../env.js` (which validates `process.env` eagerly at module-load time).
// ES module imports are hoisted ahead of any top-level statement regardless
// of source order, so every such import below is a dynamic `await import()`
// performed only after `dotenv.config()` has already run — a plain static
// `import` here would run before this line no matter where it's written.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../../.env") });

const CASES_DIR = path.resolve(__dirname, "../../../../evals/cases");
const RESULTS_DIR = path.resolve(__dirname, "../../../../evals/results");

// The price table the cost column assumes. No real bill backs these figures, and
// they're stated in every report. Override them to model a specific provider.
const PRICE_PER_MILLION = {
  input: Number(process.env.EVAL_PRICE_INPUT_PER_M ?? 0.5),
  output: Number(process.env.EVAL_PRICE_OUTPUT_PER_M ?? 1.5),
};

function estimatedCostUsd(tokensIn: number, tokensOut: number): number {
  return (tokensIn * PRICE_PER_MILLION.input + tokensOut * PRICE_PER_MILLION.output) / 1_000_000;
}

interface CaseResult {
  id: string;
  category: string;
  description: string;
  passed: boolean;
  /** Fraction of this case's checks that held, from 0 to 1. */
  score: number;
  checksPassed: number;
  checksTotal: number;
  failures: string[];
  latencyMs: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  stepCount: number;
  /** Provider attempts retried after a transient failure. */
  retryCount: number;
  /** Extra model turns spent correcting malformed or ungrounded output. */
  repairCount: number;
  toolOutcomes: { name: string; success: boolean; errorCode?: string }[];
  guardEvents: string[];
  outcome: string;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)]!;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function buildMarkdownReport(results: CaseResult[], timestamp: string, providerLabel: string, skipped: string[], isMock: boolean): string {
  const passed = results.filter((r) => r.passed);
  const byCategory = new Map<string, CaseResult[]>();
  for (const r of results) {
    byCategory.set(r.category, [...(byCategory.get(r.category) ?? []), r]);
  }
  const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
  const totalRetries = results.reduce((sum, r) => sum + Math.max(0, r.retryCount), 0);
  const toolCalls = results.flatMap((r) => r.toolOutcomes);
  const totalCost = results.reduce((sum, r) => sum + r.costUsd, 0);

  const lines: string[] = [];
  lines.push(`# Agent evaluation report`);
  lines.push(``);
  lines.push(`Run: ${timestamp}. Provider: **${providerLabel}**.`);
  lines.push(``);
  if (isMock) {
    lines.push(`> **What this run proves.** The mock's responses are scripted, so this measures the harness: tools, permissions, confirmation, grounding, retries, and database effects. It does not measure how well a model understands language.`);
    lines.push(``);
  }
  lines.push(`## Summary`);
  lines.push(``);
  lines.push(`| Metric | Value |`);
  lines.push(`|---|---:|`);
  lines.push(`| Accuracy (cases passed) | **${passed.length}/${results.length}** (${((passed.length / results.length) * 100).toFixed(1)}%) |`);
  lines.push(`| Mean score | ${mean(results.map((r) => r.score)).toFixed(3)} |`);
  lines.push(`| Latency p50 / p95 | ${percentile(latencies, 50)} ms / ${percentile(latencies, 95)} ms |`);
  lines.push(`| Mean tokens per case (in / out) | ${Math.round(mean(results.map((r) => r.tokensIn)))} / ${Math.round(mean(results.map((r) => r.tokensOut)))} |`);
  lines.push(`| Mean steps per case | ${mean(results.map((r) => r.stepCount)).toFixed(1)} |`);
  lines.push(`| Estimated cost, whole suite | $${totalCost.toFixed(5)} |`);
  lines.push(`| Provider retries / repair turns | ${totalRetries} / ${results.reduce((sum, r) => sum + r.repairCount, 0)} |`);
  lines.push(`| Tool calls succeeded | ${toolCalls.filter((t) => t.success).length}/${toolCalls.length} (the rest include intended refusals) |`);
  lines.push(``);
  lines.push(`Assumed prices: $${PRICE_PER_MILLION.input} per million input tokens, $${PRICE_PER_MILLION.output} per million output tokens. ${
    isMock
      ? "Token counts are estimated at 4 characters per token from the payloads actually sent, so they respond to prompt and schema changes."
      : "Token counts are what the provider reported."
  }`);
  lines.push(``);
  lines.push(`## Pass rate by category`);
  lines.push(``);
  lines.push(`| Category | Passed | Total | p95 latency | Mean tokens |`);
  lines.push(`|---|---:|---:|---:|---:|`);
  for (const [category, rows] of [...byCategory.entries()].sort()) {
    const sorted = rows.map((r) => r.latencyMs).sort((a, b) => a - b);
    lines.push(`| ${category} | ${rows.filter((r) => r.passed).length} | ${rows.length} | ${percentile(sorted, 95)} ms | ${Math.round(mean(rows.map((r) => r.tokensIn + r.tokensOut)))} |`);
  }
  lines.push(``);
  lines.push(`## Cases`);
  lines.push(``);
  lines.push(`| ID | Result | Score | Tokens in | Tokens out | Est. cost | Latency | Steps | Retries | Repairs | Tools | Safety checks fired |`);
  lines.push(`|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|`);
  for (const r of results) {
    const tools = r.toolOutcomes.map((t) => (t.success ? t.name : `${t.name} (${t.errorCode ?? "failed"})`)).join(", ") || "none";
    lines.push(`| ${r.id} | ${r.passed ? "PASS" : "**FAIL**"} | ${r.score.toFixed(2)} | ${r.tokensIn} | ${r.tokensOut} | $${r.costUsd.toFixed(5)} | ${r.latencyMs} ms | ${r.stepCount} | ${r.retryCount} | ${r.repairCount} | ${tools} | ${r.guardEvents.join(", ") || "none"} |`);
  }
  if (skipped.length > 0) {
    lines.push(``);
    lines.push(`Skipped because they script provider failures a real model can't reproduce: ${skipped.join(", ")}.`);
  }
  const failed = results.filter((r) => !r.passed);
  if (failed.length > 0) {
    lines.push(``);
    lines.push(`## Failure details`);
    lines.push(``);
    for (const r of failed) {
      lines.push(`### ${r.id}`);
      for (const f of r.failures) lines.push(`- ${f}`);
    }
  }
  lines.push(``);
  lines.push(`## What each case checks`);
  lines.push(``);
  for (const r of results) lines.push(`- **${r.id}**: ${r.description}`);
  return lines.join("\n") + "\n";
}

async function main() {
  const args = process.argv.slice(2);
  const useRealModel = args.includes("--real");
  const writeSample = args.includes("--sample");
  const only = args.find((arg) => !arg.startsWith("--"));

  // A real-model run must really be one: failing here beats silently scoring the mock.
  if (useRealModel) process.env.AI_PROVIDER = "nemotron";

  // Deferred until after dotenv.config() above — see the comment at the top
  // of this file for why these cannot be ordinary static imports.
  const agentPkg = await import("@agenticgenie/agent");
  const { createApp } = await import("../app.js");
  const { partAToolExecutors } = await import("../modules/agent/tools.js");
  const { buildSystemPrompt } = await import("../modules/agent/systemPrompt.js");
  const { createConversation } = await import("../modules/agent/conversation.js");
  const { closePendingUnlessConfirmed } = await import("../modules/agent/confirmation.js");
  const { createConfiguredProvider } = await import("../modules/agent/provider.js");
  const { env } = await import("../env.js");
  const { resetFixtures } = await import("../../test/helpers/fixtures.js");
  const { applySeed, substituteRefs } = await import("./seed.js");
  const { runDbCheck, snapshotState } = await import("./checkers.js");
  const { EvalProvider } = await import("./provider.js");
  const { evalCaseSchema } = await import("./types.js");

  function loadCases(): EvalCase[] {
    const files = readdirSync(CASES_DIR).filter((f) => f.endsWith(".json"));
    return files
      .map((file) => {
        const raw = JSON.parse(readFileSync(path.join(CASES_DIR, file), "utf-8"));
        const parsed = evalCaseSchema.safeParse(raw);
        if (!parsed.success) {
          throw new Error(`Invalid eval case ${file}: ${JSON.stringify(parsed.error.flatten())}`);
        }
        return parsed.data as EvalCase;
      })
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  /** Wraps a provider so the runner sees every tool call the model asked for,
   * including ones later refused. The trace deliberately doesn't keep arguments. */
  function recordingProvider(inner: ModelProvider) {
    const requested: { name: string; arguments: unknown }[] = [];
    let attempts = 0;
    const wrapped: ModelProvider = {
      name: inner.name,
      model: inner.model,
      async complete(request) {
        attempts += 1;
        const response = await inner.complete(request);
        if (response.kind === "tool_calls") requested.push(...response.toolCalls);
        return response;
      },
    };
    return { wrapped, requested, attempts: () => attempts };
  }

  function isSubset(expected: Record<string, unknown>, actual: unknown): boolean {
    if (!actual || typeof actual !== "object") return false;
    // Case doesn't matter in strings: the catalogue filters are case-insensitive.
    const normalise = (value: unknown) => (typeof value === "string" ? value.toLowerCase() : JSON.stringify(value));
    return Object.entries(expected).every(([key, value]) => normalise((actual as Record<string, unknown>)[key]) === normalise(value));
  }

  async function runCase(evalCase: EvalCase): Promise<CaseResult> {
    const failures: string[] = [];
    let checksTotal = 0;
    const check = (ok: boolean, message: string) => {
      checksTotal += 1;
      if (!ok) failures.push(message);
    };
    const app = createApp();

    const { refs, now } = await applySeed(app, evalCase.seed);
    const script = substituteRefs(evalCase.mockScript, refs, now);
    const expectations = substituteRefs(evalCase.expectations, refs, now);
    const conversation = substituteRefs(evalCase.conversation, refs, now);

    const recorder = recordingProvider(useRealModel ? createConfiguredProvider() : new EvalProvider(script));
    const registry = agentPkg.createDefaultToolRegistry(partAToolExecutors);
    const callerUserId = refs[evalCase.persona];
    if (!callerUserId) {
      throw new Error(`Eval case ${evalCase.id}: persona "${evalCase.persona}" is not a seeded user ref`);
    }
    const conversationId = await createConversation(callerUserId, conversation[0] ?? "");
    const stateBefore = await snapshotState();

    let messages: ProviderMessage[] = [{ role: "system", content: buildSystemPrompt() }];
    let lastResult: Awaited<ReturnType<typeof RunAgentTurnType>> | undefined;
    const startedAt = Date.now();
    let totalTokensIn = 0;
    let totalTokensOut = 0;
    let totalStepCount = 0;
    let totalRetries = 0;
    const toolOutcomes: CaseResult["toolOutcomes"] = [];
    const guardEvents: string[] = [];

    for (const [turnIndex, userMessage] of conversation.entries()) {
      const turnNumber = turnIndex + 1;
      await closePendingUnlessConfirmed(conversationId, callerUserId, userMessage);
      messages = [...messages, { role: "user", content: userMessage }];
      lastResult = await agentPkg.runAgentTurn({
        callerUserId,
        requestId: randomUUID(),
        conversationId,
        messages,
        provider: recorder.wrapped,
        registry,
        options: {
          maxSteps: env.AGENT_MAX_STEPS,
          tokenBudget: useRealModel ? env.AGENT_TOKEN_BUDGET : undefined,
          perToolTimeoutMs: env.AGENT_TOOL_TIMEOUT_MS,
          requireCitations: useRealModel,
        },
      });
      messages = lastResult.messages;
      totalTokensIn += lastResult.trace.totalTokensIn;
      totalTokensOut += lastResult.trace.totalTokensOut;
      totalStepCount += lastResult.trace.stepCount;
      guardEvents.push(...lastResult.trace.guardEvents);
      for (const step of lastResult.trace.steps) {
        totalRetries += step.providerRetries ?? 0;
        for (const call of step.toolCalls) {
          toolOutcomes.push({ name: call.name, success: call.success, errorCode: call.errorCode });
        }
      }

      for (const scoped of expectations.dbChecks) {
        if (scoped.afterTurn === turnNumber) {
          const failure = await runDbCheck(scoped.check, refs, { conversationId, answer: lastResult.answer?.answer ?? "" });
          check(!failure, `db check ${scoped.check.type} (after turn ${turnNumber}): ${failure?.reason}`);
        }
      }
    }

    const latencyMs = Date.now() - startedAt;
    if (!lastResult) throw new Error(`Eval case ${evalCase.id}: empty conversation`);

    // --- tool-call expectations ---
    for (const expected of expectations.toolCalls) {
      const matches = toolOutcomes.filter((t) => t.name === expected.name);
      check(matches.length > 0, `expected a call to tool "${expected.name}", none occurred`);
      if (matches.length === 0) continue;
      if (expected.success !== undefined) {
        check(
          matches.some((m) => m.success === expected.success),
          `expected tool "${expected.name}" to report success=${expected.success}, got ${matches.map((m) => m.success).join(",")}`,
        );
      }
      if (expected.errorCode !== undefined) {
        check(
          matches.some((m) => m.errorCode === expected.errorCode),
          `expected tool "${expected.name}" to be refused with ${expected.errorCode}, got ${matches.map((m) => m.errorCode ?? "no error").join(",")}`,
        );
      }
      if (expected.args !== undefined) {
        const calls = recorder.requested.filter((c) => c.name === expected.name);
        check(
          calls.some((c) => isSubset(expected.args!, c.arguments)),
          `expected "${expected.name}" arguments to include ${JSON.stringify(expected.args)}, got ${JSON.stringify(calls.map((c) => c.arguments))}`,
        );
      }
    }
    for (const forbidden of expectations.toolsForbidden) {
      check(!recorder.requested.some((c) => c.name === forbidden), `tool "${forbidden}" must not be called, but was`);
    }

    // --- outcome / answer expectations ---
    if (expectations.outcome) {
      check(lastResult.outcome === expectations.outcome, `expected outcome "${expectations.outcome}", got "${lastResult.outcome}"`);
    }
    const answerText = lastResult.answer?.answer ?? "";
    for (const substr of expectations.answerContains) {
      check(answerText.includes(substr), `expected final answer to contain "${substr}", got "${answerText}"`);
    }
    for (const pattern of expectations.answerMatches) {
      check(new RegExp(pattern, "i").test(answerText), `expected final answer to match /${pattern}/, got "${answerText}"`);
    }
    for (const substr of expectations.answerNotContains) {
      check(!answerText.includes(substr), `expected final answer NOT to contain "${substr}"`);
    }
    if (expectations.needsConfirmation !== undefined) {
      const got = lastResult.answer?.needsConfirmation ?? false;
      check(got === expectations.needsConfirmation, `expected needsConfirmation=${expectations.needsConfirmation}, got ${got}`);
    }
    if (expectations.degraded !== undefined) {
      const got = lastResult.answer?.degraded ?? false;
      check(got === expectations.degraded, `expected degraded=${expectations.degraded}, got ${got}`);
    }
    if (expectations.suspiciousFlagged !== undefined) {
      const got = lastResult.answer?.suspiciousContentFlagged ?? false;
      check(got === expectations.suspiciousFlagged, `expected suspiciousContentFlagged=${expectations.suspiciousFlagged}, got ${got}`);
    }
    const cited = [...agentPkg.extractCitationTokens(answerText), ...(lastResult.answer?.citations ?? [])];
    const known = agentPkg.collectKnownRecords(messages);
    const { invalid, valid } = agentPkg.checkGrounding(cited, known);
    if (expectations.citationsValid !== undefined) {
      check(
        (invalid.length === 0) === expectations.citationsValid,
        expectations.citationsValid
          ? `expected all citations grounded, found invalid: ${JSON.stringify(invalid)}`
          : "expected at least one ungrounded citation to be caught, none were",
      );
    }
    for (const prefix of expectations.mustCitePrefix) {
      const [type] = prefix.split(":");
      check(valid.some((c) => c.type === type), `expected at least one grounded "${prefix}" citation, got ${JSON.stringify(cited)}`);
    }
    for (const event of expectations.guardEvents) {
      check(guardEvents.some((g) => g.includes(event)), `expected safety check "${event}" to fire, saw ${JSON.stringify(guardEvents)}`);
    }
    if (expectations.minRetries !== undefined) {
      check(totalRetries >= expectations.minRetries, `expected at least ${expectations.minRetries} provider retries, observed ${totalRetries}`);
    }

    // --- db checks (end-of-conversation only; per-turn ones already ran above) ---
    for (const scoped of expectations.dbChecks) {
      if (scoped.afterTurn !== undefined) continue;
      const failure = await runDbCheck(scoped.check, refs, { conversationId, answer: answerText });
      check(!failure, `db check ${scoped.check.type}: ${failure?.reason}`);
    }
    if (expectations.dbUnchanged) {
      check((await snapshotState()) === stateBefore, "expected no change to orders, payments, tickets, refunds, holds or inventory");
    }

    await resetFixtures();

    return {
      id: evalCase.id,
      category: evalCase.category,
      description: evalCase.description,
      passed: failures.length === 0,
      score: checksTotal === 0 ? 1 : (checksTotal - failures.length) / checksTotal,
      checksPassed: checksTotal - failures.length,
      checksTotal,
      failures,
      latencyMs,
      tokensIn: totalTokensIn,
      tokensOut: totalTokensOut,
      costUsd: estimatedCostUsd(totalTokensIn, totalTokensOut),
      stepCount: totalStepCount,
      retryCount: totalRetries,
      repairCount: Math.max(0, recorder.attempts() - totalStepCount - totalRetries),
      toolOutcomes,
      guardEvents,
      outcome: lastResult.outcome,
    };
  }

  const allCases = loadCases();
  const selected = only ? allCases.filter((c) => c.id === only) : allCases;
  const cases = useRealModel ? selected.filter((c) => !c.mockOnly) : selected;
  const skipped = useRealModel ? selected.filter((c) => c.mockOnly).map((c) => c.id) : [];
  if (cases.length === 0) {
    console.error(only ? `No eval case with id "${only}" found.` : "No eval cases found.");
    process.exitCode = 1;
    return;
  }

  const providerLabel = useRealModel
    ? `real model: ${env.NEMOTRON_MODEL} via ${env.NEMOTRON_BASE_URL}`
    : "deterministic mock, no API key";

  const results: CaseResult[] = [];
  for (const evalCase of cases) {
    process.stdout.write(`Running ${evalCase.id} ... `);
    try {
      const result = await runCase(evalCase);
      results.push(result);
      console.log(result.passed ? "PASS" : `FAIL (${result.failures.join("; ")})`);
    } catch (err) {
      console.log(`ERROR (${err instanceof Error ? err.message : String(err)})`);
      await resetFixtures().catch(() => undefined);
      results.push({
        id: evalCase.id,
        category: evalCase.category,
        description: evalCase.description,
        passed: false,
        score: 0,
        checksPassed: 0,
        checksTotal: 1,
        failures: [`threw: ${err instanceof Error ? err.message : String(err)}`],
        latencyMs: 0,
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
        stepCount: 0,
        retryCount: 0,
        repairCount: 0,
        toolOutcomes: [],
        guardEvents: [],
        outcome: "error",
      });
    }
  }

  const timestamp = new Date().toISOString();
  mkdirSync(RESULTS_DIR, { recursive: true });
  const stem = writeSample ? (useRealModel ? "real-model-run" : "sample-run") : `run-${timestamp.replace(/[:.]/g, "-")}`;
  const jsonPath = path.join(RESULTS_DIR, `${stem}.json`);
  const mdPath = path.join(RESULTS_DIR, `${stem}.md`);
  writeFileSync(jsonPath, JSON.stringify({ timestamp, provider: providerLabel, pricePerMillion: PRICE_PER_MILLION, results }, null, 2));
  writeFileSync(mdPath, buildMarkdownReport(results, timestamp, providerLabel, skipped, !useRealModel));

  const passed = results.filter((r) => r.passed).length;
  console.log(`\n${passed}/${results.length} cases passed. Report: ${mdPath}`);

  if (passed !== results.length) {
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    const { prisma } = await import("@agenticgenie/db");
    await prisma.$disconnect();
  });
