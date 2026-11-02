export interface ToolCallTrace {
  name: string;
  durationMs: number;
  success: boolean;
  retryCount: number;
  errorCode?: string;
}

export interface StepTrace {
  stepNumber: number;
  providerCallMs: number;
  tokensIn: number;
  tokensOut: number;
  /** Extra provider attempts this step needed beyond the first. */
  providerRetries?: number;
  toolCalls: ToolCallTrace[];
}

export type AgentOutcome = "success" | "partial" | "error";

export interface AgentTrace {
  requestId: string;
  conversationId: string;
  provider: string;
  model: string;
  startedAt: string;
  endedAt?: string;
  latencyMs?: number;
  steps: StepTrace[];
  totalTokensIn: number;
  totalTokensOut: number;
  stepCount: number;
  outcome?: AgentOutcome;
  outcomeReason?: string;
  /** Every time a safety check changed what happened this turn, e.g.
   * "blocked_after_untrusted_read:purchase" or "false_action_claim_replaced". */
  guardEvents: string[];
}

// Matches common secret shapes well enough to redact them from any free-text
// string this tracer records (error messages, mostly) — not a general
// secrets scanner, just a defensive backstop. See the redaction note below
// for why tool-call *arguments* are never recorded here in the first place,
// which matters more than this pattern list.
const SECRET_LIKE_PATTERN =
  /(sk-[A-Za-z0-9]{10,}|ghp_[A-Za-z0-9]{10,}|xox[baprs]-[A-Za-z0-9-]{10,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|Bearer\s+[A-Za-z0-9._-]{10,})/g;

export function redact(value: string): string {
  return value.replace(SECRET_LIKE_PATTERN, "[REDACTED]");
}

/**
 * Collects a single agent turn's execution trace. Deliberately NOT an
 * audit log — Part A's `writeAuditLog` (apps/api/src/lib/audit.ts) already
 * owns the durable, access-controlled, transactional record of what state
 * actually changed. This is diagnostic telemetry for operating the agent
 * itself (latency, token spend, which tools got called, how it ended).
 *
 * Redaction policy: raw tool-call arguments and raw provider message
 * content are never recorded here — only tool name, duration, success,
 * retry count, and an error *code* (never a raw error message or stack).
 * Arguments can carry things a user would reasonably consider private
 * (a specific seat id, an order id) that don't need to sit in telemetry
 * once the call is done; the application's own audit log (if the tool
 * mutates anything) is the right place for that record, scoped and
 * access-controlled like every other Part A audit entry. Any string that
 * IS recorded is passed through `redact()` first, in case a misbehaving
 * dependency ever interpolates a bearer token or JWT into an error message.
 */
export class ExecutionTracer {
  private readonly trace: AgentTrace;

  constructor(params: { requestId: string; conversationId: string; provider: string; model: string }) {
    this.trace = {
      requestId: params.requestId,
      conversationId: params.conversationId,
      provider: params.provider,
      model: params.model,
      startedAt: new Date().toISOString(),
      steps: [],
      totalTokensIn: 0,
      totalTokensOut: 0,
      stepCount: 0,
      guardEvents: [],
    };
  }

  recordStep(step: StepTrace): void {
    this.trace.steps.push(step);
    this.trace.totalTokensIn += step.tokensIn;
    this.trace.totalTokensOut += step.tokensOut;
    this.trace.stepCount += 1;
  }

  recordGuardEvent(event: string): void {
    this.trace.guardEvents.push(redact(event));
  }

  finish(outcome: AgentOutcome, reason?: string): void {
    this.trace.endedAt = new Date().toISOString();
    this.trace.latencyMs = Date.parse(this.trace.endedAt) - Date.parse(this.trace.startedAt);
    this.trace.outcome = outcome;
    this.trace.outcomeReason = reason ? redact(reason) : undefined;
  }

  getTrace(): AgentTrace {
    return this.trace;
  }
}
