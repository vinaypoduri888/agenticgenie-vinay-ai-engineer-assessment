import type { AgentCitation, FinalAnswer, ProviderMessage } from "../providers/types.js";

/**
 * Checks on a model's final answer, in code, because anything left to the model
 * can be talked out of. None of these need the model's cooperation.
 */

/** Removes `[type:id]` tokens that failed grounding from the answer's prose.
 * Stripping only the citations array would leave a fabricated id in what the
 * user reads, rendered as a source. */
export function stripCitationTokens(answer: string, invalid: AgentCitation[]): string {
  let cleaned = answer;
  for (const citation of invalid) {
    cleaned = cleaned.split(`[${citation.type}:${citation.id}]`).join("");
  }
  return cleaned.replace(/[ \t]{2,}/g, " ").replace(/ +([.,;:!?])/g, "$1").trim();
}

const REPAIR_PREFIXES = [
  "Your previous response could not be parsed",
  "The following citations do not match",
  "Your answer states facts from tool results",
  "These amounts do not match",
];

/** The loop's own corrections to the model are sent as user-role messages, but
 * they aren't anything the human said. They mustn't count as human evidence,
 * be persisted, or be shown. */
export function isRepairInstruction(message: ProviderMessage): boolean {
  return message.role === "user" && REPAIR_PREFIXES.some((prefix) => message.content?.startsWith(prefix));
}

/** Drops each repair instruction and the rejected draft before it. */
export function withoutRepairExchanges(messages: ProviderMessage[]): ProviderMessage[] {
  return messages.filter((message, index) => !isRepairInstruction(message) && !(messages[index + 1] && isRepairInstruction(messages[index + 1]!)));
}

const RUPEE_FIGURE = /(?:₹|\bRs\.?|\bINR)\s?(\d[\d,]*(?:\.\d+)?)|\b(\d[\d,]*(?:\.\d+)?)\s?(?:rupees|rs\b)/gi;

function parseRupees(raw: string): number {
  return Number(raw.replace(/,/g, ""));
}

function collectMinorAmounts(value: unknown, into: Set<number>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectMinorAmounts(item, into);
  } else if (value && typeof value === "object") {
    for (const [key, val] of Object.entries(value)) {
      if (/minor$/i.test(key) && typeof val === "number") into.add(val / 100);
      else collectMinorAmounts(val, into);
    }
  }
}

/**
 * Rupee figures in an answer that no tool result backs. A tier price times a
 * ticket count is allowed, as is any figure the user said themselves ("under
 * ₹800"). Everything else is a number the model made up.
 */
export function findUnverifiedFigures(answer: string, messages: ProviderMessage[]): string[] {
  const known = new Set<number>();
  for (const message of withoutRepairExchanges(messages)) {
    if (message.role === "tool" && message.content) {
      try {
        collectMinorAmounts(JSON.parse(message.content), known);
      } catch {
        // A tool result that isn't JSON has no amounts to check against.
      }
    }
    if (message.role === "user" && message.content) {
      for (const match of message.content.matchAll(/\b(\d[\d,]*)\b/g)) known.add(parseRupees(match[1]!));
    }
  }

  const unverified: string[] = [];
  for (const match of answer.matchAll(RUPEE_FIGURE)) {
    const amount = parseRupees(match[1] ?? match[2]!);
    const backed = [...known].some((value) => {
      for (let quantity = 1; quantity <= 8; quantity++) {
        if (Math.abs(value * quantity - amount) < 0.005) return true;
      }
      return false;
    });
    if (!backed) unverified.push(match[0]);
  }
  return unverified;
}

export function maskFigures(answer: string, figures: string[]): string {
  let masked = answer;
  for (const figure of figures) masked = masked.split(figure).join("[price unverified]");
  return masked;
}

type EventCard = NonNullable<FinalAnswer["eventCards"]>[number];

/** A card shows a title, date and price as fact, so it must come from what a tool
 * returned, whatever the model put in it. The model only gets to choose which
 * events to show; a card for an event no tool returned is dropped. */
export function groundEventCards(cards: EventCard[], messages: ProviderMessage[]): EventCard[] {
  const known = new Map<string, EventCard>();
  for (const message of messages) {
    if (message.role !== "tool" || !message.content) continue;
    try {
      const output = JSON.parse(message.content) as Record<string, unknown>;
      const items = Array.isArray(output.items) ? (output.items as Record<string, unknown>[]) : [output];
      for (const item of items) {
        if (typeof item.id !== "string" || typeof item.title !== "string" || typeof item.startsAt !== "string") continue;
        const venue = item.venue as { city?: string } | undefined;
        known.set(item.id, {
          id: item.id,
          title: item.title,
          startsAt: item.startsAt,
          venueCity: venue?.city,
          minPriceMinor: typeof item.minPriceMinor === "number" ? item.minPriceMinor : null,
        });
      }
    } catch {
      // A tool result that isn't JSON has no events in it.
    }
  }
  return cards.flatMap((card) => {
    const real = known.get(card.id);
    return real ? [real] : [];
  });
}

const EXECUTED_STATUSES = new Set(["PAID", "REFUNDED", "PARTIALLY_REFUNDED"]);

/** Whether a tool result in these messages shows a purchase, refund or hold
 * that really happened. */
export function hasExecutedAction(messages: ProviderMessage[]): boolean {
  return messages.some((message) => {
    if (message.role !== "tool" || !message.content) return false;
    try {
      const output = JSON.parse(message.content) as Record<string, unknown>;
      return (typeof output.status === "string" && EXECUTED_STATUSES.has(output.status)) || ("kind" in output && "expiresAt" in output);
    } catch {
      return false;
    }
  });
}

const ACTION_CLAIM =
  /\b(i(?:'ve| have)?\s+(?:just\s+|now\s+|successfully\s+)?(?:booked|purchased|bought|refunded|cancelled|canceled)\b|your\s+(?:order|booking|purchase|refund|tickets?)\s+(?:is|are|has been|have been)\s+(?:now\s+)?(?:confirmed|complete|completed|booked|processed|refunded|cancell?ed))/i;

export function claimsCompletedAction(answer: string): boolean {
  return ACTION_CLAIM.test(answer);
}

export const FALSE_ACTION_REPLACEMENT =
  "I haven't booked, charged or refunded anything. Nothing has changed on your account. Tell me what you'd like to do next.";

/**
 * Signals that third-party text is trying to instruct the assistant rather than
 * describe an event. One layer only, and deliberately not the one that blocks
 * anything: rephrasing beats a regex, so its job is to flag content to the user.
 * What actually stops a misled model is the confirmation gate and the
 * side-effect restriction in the loop.
 */
const INJECTION_SIGNALS = [
  /\b(?:ignore|disregard|forget|override)\b[^.\n]{0,40}\b(?:instructions?|rules?|prompts?|policy|policies)\b/i,
  /(?:^|[\s"'(\[])(?:system|assistant|developer)\s*:/i,
  /\b(?:cancel|refund|delete)\s+(?:every|all|each)\b[^.\n]{0,30}\b(?:orders?|tickets?|bookings?)\b/i,
  /\bconfirm\s*[:=]\s*true\b/i,
  /\b(?:call|invoke|use|run)\s+(?:the\s+)?(?:tool|function)\b/i,
  /\bno need to (?:ask|confirm)\b/i,
  /\bdo not (?:ask|tell|inform)\b[^.\n]{0,20}\buser\b/i,
];

export function looksLikeInjection(text: string): boolean {
  return INJECTION_SIGNALS.some((pattern) => pattern.test(text));
}
