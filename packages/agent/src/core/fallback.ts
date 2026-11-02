import { dispatchToolCall } from "../tools/dispatch.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { ToolContext } from "../tools/types.js";
import type { FinalAnswer } from "../providers/types.js";

/**
 * A simple, confidently-recognizable read-only intent the harness can
 * satisfy WITHOUT the model when the provider is unavailable. Deliberately
 * NOT a general-purpose intent classifier — plain pattern matching, no
 * guessing, and only ever a direct call to one of the already-authorized
 * tools via the same registry/dispatch path the model itself would use.
 * Never covers a side-effecting tool (`hold_seats`/`purchase`/
 * `cancel_order`) — the fallback path must never create a side effect or
 * bypass confirmation.
 */
interface FallbackIntent {
  name: string;
  match(text: string): { toolName: string; args: unknown } | undefined;
  format(output: unknown): string;
}

const SEARCH_INTENT: FallbackIntent = {
  name: "search_events",
  match(text) {
    if (!/\b(search|show|find|list|what'?s on)\b.*\bevents?\b|\bevents?\b.*\b(in|near)\b/i.test(text)) {
      return undefined;
    }
    const cityMatch = text.match(/\b(?:in|near)\s+([A-Za-z][A-Za-z\s]*?)(?:[.?!]|$)/i);
    const args: Record<string, unknown> = { limit: 10 };
    if (cityMatch) args.city = cityMatch[1]!.trim();
    return { toolName: "search_events", args };
  },
  format(output) {
    const items = (output as { items?: { title?: string; startsAt?: string }[] } | undefined)?.items ?? [];
    if (items.length === 0) {
      return "I couldn't reach the assistant just now, and a direct search found no matching events.";
    }
    const lines = items.slice(0, 5).map((e) => `- ${e.title ?? "Untitled event"} (${e.startsAt ?? "date unknown"})`);
    return `I couldn't reach the assistant just now, but here's what a direct search found:\n${lines.join("\n")}`;
  },
};

const MY_ORDERS_INTENT: FallbackIntent = {
  name: "list_my_orders",
  match(text) {
    return /\b(my|show me my)\s+(orders?|tickets?|bookings?)\b/i.test(text) ? { toolName: "list_my_orders", args: { limit: 10 } } : undefined;
  },
  format(output) {
    const orders = (output as { orders?: { eventTitle?: string; status?: string; ticketCount?: number }[] } | undefined)?.orders ?? [];
    if (orders.length === 0) {
      return "I couldn't reach the assistant just now, but I checked directly and you have no orders.";
    }
    const lines = orders.slice(0, 5).map((o) => `- ${o.eventTitle ?? "Event"}: ${o.ticketCount ?? 0} ticket(s), ${o.status ?? "unknown"}`);
    return `I couldn't reach the assistant just now, but here are your orders:\n${lines.join("\n")}`;
  },
};

// Only intents reliably matchable from plain text without the model are
// included. "Show event details" needs a specific event id, which is reference
// resolution and needs the model. Anything else degrades honestly instead.
const FALLBACK_INTENTS: FallbackIntent[] = [MY_ORDERS_INTENT, SEARCH_INTENT];

/** What a user sees when a turn stops early, covering what did and didn't
 * happen. Never claims an action: anything real shows up in the tool results. */
export function buildPartialAnswer(reason: string | undefined, actionCompleted: boolean): string {
  const nothingBooked = actionCompleted ? "" : " Nothing was booked, charged or refunded.";
  if (reason?.startsWith("provider_unavailable_quota_exceeded") || reason?.startsWith("provider_unavailable_auth_error")) {
    return `The assistant is temporarily unavailable.${nothingBooked} You can still browse events and manage your orders directly.`;
  }
  if (reason?.startsWith("provider_unavailable")) {
    return `I couldn't reach the assistant just now, even after retrying.${nothingBooked} Please try again in a moment.`;
  }
  if (reason === "token_budget_exceeded" || reason === "step_limit_reached") {
    return `That took more work than I'm allowed in one turn, so I stopped here.${nothingBooked} Try asking for one thing at a time.`;
  }
  return `Something went wrong while answering that.${nothingBooked} Please try rephrasing.`;
}

/**
 * Tries every known deterministic intent against the raw user message and,
 * on a match, calls the matching tool directly through the real registry —
 * the same authorization/validation path a model-driven tool call would
 * go through, just without a model in the loop. Returns `undefined` (not a
 * guessed answer) when nothing matches, so the caller can degrade honestly
 * instead of inventing a response.
 */
export async function runDeterministicFallback(
  registry: ToolRegistry,
  ctx: ToolContext,
  latestUserMessage: string,
): Promise<FinalAnswer | undefined> {
  for (const intent of FALLBACK_INTENTS) {
    const match = intent.match(latestUserMessage);
    if (!match) continue;

    const result = await dispatchToolCall(registry, ctx, { name: match.toolName, arguments: match.args });
    if (!result.success) continue;

    return { answer: intent.format(result.output), degraded: true, actionTaken: false };
  }
  return undefined;
}
