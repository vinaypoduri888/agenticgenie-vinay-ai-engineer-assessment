/**
 * Deterministic fake payment provider — see docs/DECISIONS.md D-012. Keyed
 * by externalRef (the owning IdempotencyRecord.id, shared across every
 * attempt of the same logical checkout), deliberately an in-memory module-
 * level map rather than a Prisma table: it stands in for a *third-party
 * system's* ledger, not our own durable record, and a mock has no need for
 * that durability.
 *
 * The first call for a given externalRef decides the outcome; every later
 * call for the same externalRef replays it — this is what makes a
 * stale-takeover's reconciliation call safe: it can't cause a second,
 * independent charge decision.
 *
 * "timeout_then_success"/"timeout_then_decline" simulate a call that times
 * out from OUR side while the provider itself still resolves normally —
 * resolved synchronously (no real delay) so tests stay fast and
 * deterministic, per the PDF's explicit requirement.
 */
export type PaymentScenario = "success" | "decline" | "timeout_then_success" | "timeout_then_decline";
export type ProviderOutcome = "SUCCESS" | "DECLINE" | "TIMEOUT";

const ledger = new Map<string, "SUCCESS" | "DECLINE">();

export async function chargeViaFakeProvider(params: {
  externalRef: string;
  scenario: PaymentScenario;
}): Promise<ProviderOutcome> {
  const existing = ledger.get(params.externalRef);
  if (existing) {
    return existing;
  }

  switch (params.scenario) {
    case "success":
      ledger.set(params.externalRef, "SUCCESS");
      return "SUCCESS";
    case "decline":
      ledger.set(params.externalRef, "DECLINE");
      return "DECLINE";
    case "timeout_then_success":
      ledger.set(params.externalRef, "SUCCESS");
      return "TIMEOUT";
    case "timeout_then_decline":
      ledger.set(params.externalRef, "DECLINE");
      return "TIMEOUT";
  }
}

/** Refunds are synchronous in this model (no simulated timeout — see
 * D-012); still keyed and deduped the same way so a retried refund call
 * for the same refundRef never double-refunds at the "provider" level. */
const refundLedger = new Set<string>();

export async function refundViaFakeProvider(refundRef: string): Promise<"REFUNDED"> {
  refundLedger.add(refundRef);
  return "REFUNDED";
}

/** Test-only escape hatch — the ledger is module-level state that would
 * otherwise leak between test files reusing the same externalRef pattern. */
export function _resetFakeProviderForTests(): void {
  ledger.clear();
  refundLedger.clear();
}
