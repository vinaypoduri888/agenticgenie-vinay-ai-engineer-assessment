import {
  classifyConfirmationIntent,
  type ModelProvider,
  type ProviderMessage,
  type ProviderRequest,
  type ProviderResponse,
  type ToolCallRequest,
} from "@agenticgenie/agent";

/**
 * The "no real model configured" default (see `createConfiguredProvider`)
 * used to be a single static canned reply, which meant the live app —
 * including every manual demo and every Playwright screenshot of it —
 * never showed the agent actually doing anything, even though every real
 * tool/confirmation/security mechanism behind it works. This replaces that
 * with a small, honestly-limited, pattern-matching stand-in: it recognizes
 * a handful of plain-English intents (search, "book/hold that", an
 * unambiguous confirmation) and drives the exact same tool_calls/final
 * response shapes a real model would, so every downstream mechanism
 * (registry dispatch, confirmation gate, idempotency) runs completely for
 * real. It is NOT a general-purpose NLU — anything it doesn't recognize
 * gets an honest "I can't tell what you mean yet" answer, never a guess.
 * This is a UX/demo-quality concern (B6), not a security one: every tool
 * call it issues still goes through the full real authorization path.
 */
const SEARCH_PATTERN = /\b(events?|shows?|gigs?|concerts?|conferences?|festivals?)\b/i;
const BOOK_PATTERN = /\b(book|hold|reserve|get me)\b/i;
const CANCEL_PATTERN = /\b(cancel|refund)\b.*\b(order|booking|tickets?)\b/i;
const MY_ORDERS_PATTERN = /\b(my|show me my)\s+(orders?|tickets?|bookings?)\b/i;
const REVIEWS_PATTERN = /\b(reviews?|people say|people think|what do people)\b/i;
const SALES_PATTERN = /\b(sales|revenue|tickets sold)\b/i;
const CITY_PATTERN = /\b(?:in|near|at)\s+([A-Za-z][A-Za-z\s]{2,24}?)(?=[.?!,]|$|\s+(?:this|next|under|for|on))|\b([A-Z][a-z]+)\s+mein\b/;
const MAX_PRICE_PATTERN = /(?:under|below|less than|within|upto|up to)\s*₹?\s*([\d,]+)|([\d,]+)\s*ke andar/i;
const QUANTITY_PATTERN = /\b([1-8])\s*(?:tickets?|seats?)\b/i;
const ORDINALS: Record<string, number> = { first: 0, "1st": 0, second: 1, "2nd": 1, third: 2, "3rd": 2, last: -1 };
const PENDING_PATTERN = /Awaiting the user's confirmation for (purchase|cancel_order) on (\S+?):/;
const CATEGORY_WORDS = ["comedy", "music", "technology", "tech", "conference", "theatre", "theater", "sports", "family", "food"];

function findCity(text: string): string | undefined {
  const match = text.match(CITY_PATTERN);
  return (match?.[1] ?? match?.[2])?.trim();
}

function findMaxPrice(text: string): number | undefined {
  const match = text.match(MAX_PRICE_PATTERN);
  const raw = match?.[1] ?? match?.[2];
  return raw ? Number(raw.replace(/,/g, "")) : undefined;
}

/** Which result the user means: an ordinal word if there is one, otherwise the
 * first. "the second one" is the only reference resolution demo mode does. */
function pickFromResults<T>(items: T[], text: string): T | undefined {
  const word = Object.keys(ORDINALS).find((key) => new RegExp(`\\b${key}\\b`, "i").test(text));
  if (word === undefined) return items[0];
  const index = ORDINALS[word]!;
  return index < 0 ? items.at(-1) : items[index];
}

function rupees(amountMinor: number): string {
  return `₹${(amountMinor / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function findCategory(text: string): string | undefined {
  const lower = text.toLowerCase();
  return CATEGORY_WORDS.find((word) => lower.includes(word));
}

function toolCallResponse(toolCalls: ToolCallRequest[]): ProviderResponse {
  return { kind: "tool_calls", toolCalls, usage: { promptTokens: 20, completionTokens: 20 } };
}

function finalResponse(answer: Record<string, unknown>): ProviderResponse {
  return { kind: "final", content: JSON.stringify(answer), usage: { promptTokens: 20, completionTokens: 20 } };
}

function lastUserMessage(messages: ProviderMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === "user") return messages[i]!.content ?? "";
  }
  return "";
}

/** Which real tool a given "tool" result message is answering — found by
 * matching its toolCallId back to the assistant message that requested it. */
function toolNameForResult(messages: ProviderMessage[], toolMessage: ProviderMessage): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const call = messages[i]!.toolCalls?.find((c) => c.id === toolMessage.toolCallId);
    if (call) return call.name;
  }
  return undefined;
}

function lastToolResultFor(messages: ProviderMessage[], toolName: string): unknown {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;
    if (msg.role !== "tool") continue;
    if (toolNameForResult(messages, msg) !== toolName) continue;
    try {
      return JSON.parse(msg.content ?? "null");
    } catch {
      return null;
    }
  }
  return null;
}

export class DemoProvider implements ModelProvider {
  readonly name = "demo";
  readonly model = "demo-pattern-match-v1";

  async complete(request: ProviderRequest): Promise<ProviderResponse> {
    const { messages } = request;
    const last = messages[messages.length - 1];

    if (last?.role === "tool") {
      return this.continueChain(messages, last);
    }

    return this.startTurn(messages);
  }

  private startTurn(messages: ProviderMessage[]): ProviderResponse {
    const text = lastUserMessage(messages);

    if (classifyConfirmationIntent(text) === "confirm") {
      // The pinned note comes from the server's own pending-confirmation row.
      const pending = messages.filter((m) => m.role === "system").map((m) => m.content?.match(PENDING_PATTERN)).find(Boolean);
      if (!pending) return finalResponse({ answer: "There's nothing pending for me to confirm right now." });
      const args = pending[1] === "purchase" ? { hold_id: pending[2]!, confirm: true } : { order_id: pending[2]!, confirm: true };
      return toolCallResponse([{ id: "c1", name: pending[1]!, arguments: args }]);
    }

    if (classifyConfirmationIntent(text) === "deny") {
      return finalResponse({ answer: "Okay, I won't go ahead. Nothing was booked or charged." });
    }

    if (MY_ORDERS_PATTERN.test(text) && !CANCEL_PATTERN.test(text)) {
      return toolCallResponse([{ id: "c1", name: "list_my_orders", arguments: { limit: 10 } }]);
    }

    if (CANCEL_PATTERN.test(text)) {
      const orders = lastToolResultFor(messages, "list_my_orders") as { orders?: { id: string; status: string }[] } | null;
      const cancellable = orders?.orders?.filter((o) => o.status === "PAID" || o.status === "PARTIALLY_REFUNDED") ?? [];
      const target = pickFromResults(cancellable, text);
      if (!target) return toolCallResponse([{ id: "c1", name: "list_my_orders", arguments: { limit: 10 } }]);
      return toolCallResponse([{ id: "c1", name: "cancel_order", arguments: { order_id: target.id, confirm: false } }]);
    }

    if (SALES_PATTERN.test(text)) {
      return toolCallResponse([{ id: "c1", name: "sales_summary", arguments: { group_by: "event" } }]);
    }

    const search = lastToolResultFor(messages, "search_events") as { items?: { id: string }[] } | null;

    if (REVIEWS_PATTERN.test(text)) {
      const target = pickFromResults(search?.items ?? [], text);
      if (!target) return finalResponse({ answer: "Which event do you mean? Search for one first, then ask me about its reviews." });
      return toolCallResponse([{ id: "c1", name: "get_reviews", arguments: { event_id: target.id, limit: 10 } }]);
    }

    if (BOOK_PATTERN.test(text)) {
      const target = pickFromResults(search?.items ?? [], text);
      if (target) return toolCallResponse([{ id: "c1", name: "get_event", arguments: { id: target.id } }]);
      if (!findCategory(text) && !findCity(text)) {
        return finalResponse({
          answer: "I don't have a specific event in mind yet. Search for one first (e.g. \"comedy shows in Pune\"), then ask me to book it.",
        });
      }
    }

    if (SEARCH_PATTERN.test(text) || BOOK_PATTERN.test(text) || findMaxPrice(text) !== undefined) {
      const args: Record<string, unknown> = { limit: 10 };
      const city = findCity(text);
      const category = findCategory(text);
      const maxPrice = findMaxPrice(text);
      if (city) args.city = city;
      if (category) args.category = category === "tech" ? "technology" : category;
      if (maxPrice !== undefined) args.max_price = maxPrice;
      return toolCallResponse([{ id: "c1", name: "search_events", arguments: args }]);
    }

    return finalResponse({
      answer:
        "I'm running in demo mode, which understands a few simple requests. Try \"comedy shows in Pune\", \"book the first one\", \"show my orders\" or \"what do people say about the first one\". Set AI_PROVIDER=nemotron for open conversation.",
    });
  }

  private continueChain(messages: ProviderMessage[], toolMessage: ProviderMessage): ProviderResponse {
    const toolName = toolNameForResult(messages, toolMessage);
    const parsed = toolMessage.content ? safeParse(toolMessage.content) : null;
    const error = (parsed as { error?: { code?: string; message?: string } } | null)?.error;

    if (error?.code === "BLOCKED_AFTER_UNTRUSTED_CONTENT") {
      return finalResponse({ answer: "I can't do that in the same step as reading reviews. Ask me again in a new message and nothing will happen until you confirm." });
    }
    if (error) {
      return finalResponse({ answer: error.message ?? "That didn't work, and nothing was changed." });
    }

    if (toolName === "search_events") {
      const items = (parsed as { items?: { id: string; title: string; startsAt: string; venue?: { city: string }; minPriceMinor?: number | null }[] })?.items ?? [];
      if (items.length === 0) {
        return finalResponse({ answer: "I searched, but nothing matched. Try a different city or category." });
      }
      const asksToBook = BOOK_PATTERN.test(lastUserMessage(messages));
      return finalResponse({
        answer: `I found ${items.length} event${items.length === 1 ? "" : "s"}: ${items
          .slice(0, 3)
          .map((e) => `${e.title} [event:${e.id}]`)
          .join(", ")}.${asksToBook && items.length > 1 ? " Which one should I book?" : ""}`,
        citations: items.slice(0, 5).map((e) => ({ type: "event", id: e.id })),
        eventCards: items.slice(0, 5).map((e) => ({
          id: e.id,
          title: e.title,
          startsAt: e.startsAt,
          venueCity: e.venue?.city,
          minPriceMinor: e.minPriceMinor ?? null,
        })),
      });
    }

    if (toolName === "get_event") {
      const event = parsed as { id: string; tiers?: { id: string; remainingQuantity: number }[]; availableSeats?: { id: string }[] } | null;
      const quantity = Number(lastUserMessage(messages).match(QUANTITY_PATTERN)?.[1] ?? 1);
      const tier = event?.tiers?.find((t) => t.remainingQuantity >= quantity);
      if (event && tier) {
        return toolCallResponse([{ id: "c1", name: "hold_seats", arguments: { event_id: event.id, tier_id: tier.id, quantity } }]);
      }
      const seats = event?.availableSeats?.slice(0, quantity) ?? [];
      if (event && seats.length === quantity) {
        return toolCallResponse([{ id: "c1", name: "hold_seats", arguments: { event_id: event.id, seat_ids: seats.map((s) => s.id) } }]);
      }
      return finalResponse({ answer: "That event doesn't have enough tickets available right now." });
    }

    if (toolName === "hold_seats") {
      const hold = parsed as { id?: string } | null;
      if (!hold?.id) {
        return finalResponse({ answer: "I couldn't create a hold for that event. It may be sold out." });
      }
      return toolCallResponse([{ id: "c1", name: "purchase", arguments: { hold_id: hold.id, confirm: false } }]);
    }

    if (toolName === "purchase") {
      const result = parsed as { status?: string; orderId?: string; message?: string } | null;
      if (result?.status === "NEEDS_CONFIRMATION") {
        return finalResponse({ answer: result.message ?? "This purchase needs your confirmation before I proceed.", needsConfirmation: true });
      }
      if (result?.status === "PAID") {
        return finalResponse({ answer: "Done. Your order is confirmed, and your tickets are in My Orders.", actionTaken: true });
      }
      if (result?.status === "DECLINED") {
        return finalResponse({ answer: "The payment was declined, so nothing was charged. Your hold is still active if you'd like to try again." });
      }
      return finalResponse({ answer: result?.message ?? "I couldn't confirm the payment outcome yet. Check My Orders in a moment." });
    }

    if (toolName === "cancel_order") {
      const result = parsed as { status?: string; message?: string; refundedAmountMinor?: number } | null;
      if (result?.status === "NEEDS_CONFIRMATION") {
        return finalResponse({ answer: result.message ?? "This needs your confirmation before I proceed.", needsConfirmation: true });
      }
      return finalResponse({
        answer: `Done. Your order has been refunded${result?.refundedAmountMinor !== undefined ? ` (${rupees(result.refundedAmountMinor)})` : ""}.`,
        actionTaken: true,
      });
    }

    if (toolName === "list_my_orders") {
      const orders = (parsed as { orders?: { id: string; eventTitle: string; status: string; ticketCount: number }[] } | null)?.orders ?? [];
      if (orders.length === 0) return finalResponse({ answer: "You don't have any orders yet." });
      const wantsCancel = CANCEL_PATTERN.test(lastUserMessage(messages));
      const cancellable = orders.filter((o) => o.status === "PAID" || o.status === "PARTIALLY_REFUNDED");
      if (wantsCancel && cancellable.length === 1) {
        return toolCallResponse([{ id: "c1", name: "cancel_order", arguments: { order_id: cancellable[0]!.id, confirm: false } }]);
      }
      return finalResponse({
        answer: `${wantsCancel ? "Which order should I cancel? " : "Your orders: "}${orders
          .slice(0, 5)
          .map((o) => `${o.eventTitle}, ${o.ticketCount} ticket${o.ticketCount === 1 ? "" : "s"}, ${o.status.toLowerCase().replace(/_/g, " ")} [order:${o.id}]`)
          .join("; ")}.`,
        citations: orders.slice(0, 5).map((o) => ({ type: "order", id: o.id })),
      });
    }

    if (toolName === "get_reviews") {
      const items = (parsed as { items?: { id: string; rating: number; text: string; flaggedSuspicious?: boolean }[] } | null)?.items ?? [];
      if (items.length === 0) return finalResponse({ answer: "There are no reviews for that event yet." });
      const honest = items.filter((r) => !r.flaggedSuspicious);
      const average = honest.reduce((sum, r) => sum + r.rating, 0) / Math.max(honest.length, 1);
      const flagged = items.length - honest.length;
      const samples = honest.slice(0, 2).map((r) => `"${r.text.slice(0, 80)}" [review:${r.id}]`);
      return finalResponse({
        answer: `Across ${honest.length} review${honest.length === 1 ? "" : "s"}, the average rating is ${average.toFixed(1)} out of 5. ${samples.join(" ")}${
          flagged > 0 ? ` I ignored ${flagged} review${flagged === 1 ? "" : "s"} containing text that tried to give me instructions.` : ""
        }`,
        citations: honest.slice(0, 2).map((r) => ({ type: "review", id: r.id })),
      });
    }

    if (toolName === "sales_summary") {
      const summary = parsed as { status?: string; organiserOptions?: { name: string }[]; totalRevenueMinor?: number; totalTicketCount?: number; groups?: { key: string; label: string; revenueMinor: number; ticketCount: number }[] } | null;
      if (summary?.status === "NEEDS_CLARIFICATION") {
        return finalResponse({ answer: `You belong to several organisers: ${summary.organiserOptions?.map((o) => o.name).join(", ")}. Which one do you mean?` });
      }
      const groups = summary?.groups ?? [];
      return finalResponse({
        answer: `Net revenue is ${rupees(summary?.totalRevenueMinor ?? 0)} from ${summary?.totalTicketCount ?? 0} tickets. ${groups
          .slice(0, 5)
          .map((g) => `${g.label}: ${rupees(g.revenueMinor)} [sales:${g.key}]`)
          .join("; ")}`,
        citations: groups.slice(0, 5).map((g) => ({ type: "sales", id: g.key })),
      });
    }

    return finalResponse({ answer: "I'm not sure how to continue from here in demo mode." });
  }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
