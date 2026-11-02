import { describe, expect, it } from "vitest";
import { checkGrounding, collectKnownRecords, extractCitationTokens } from "../src/core/grounding.js";
import type { ProviderMessage } from "../src/providers/types.js";

describe("extractCitationTokens", () => {
  it("extracts [event:id] and [review:id] tokens from free text", () => {
    const tokens = extractCitationTokens("Check out [event:evt_1] — one reviewer said great things [review:rev_9].");
    expect(tokens).toEqual([
      { type: "event", id: "evt_1" },
      { type: "review", id: "rev_9" },
    ]);
  });

  it("returns an empty array when there are no citation tokens", () => {
    expect(extractCitationTokens("No citations here.")).toEqual([]);
  });
});

describe("collectKnownRecords", () => {
  it("collects event ids from a search_events-shaped tool result", () => {
    const messages: ProviderMessage[] = [
      {
        role: "tool",
        toolCallId: "c1",
        content: JSON.stringify({ items: [{ id: "evt_1", title: "Show", venue: { city: "Pune" } }] }),
      },
    ];
    expect(collectKnownRecords(messages)).toEqual([{ type: "event", id: "evt_1" }]);
  });

  it("collects review ids from a get_reviews-shaped tool result", () => {
    const messages: ProviderMessage[] = [
      { role: "tool", toolCallId: "c1", content: JSON.stringify({ items: [{ id: "rev_1", rating: 5, text: "Great" }] }) },
    ];
    expect(collectKnownRecords(messages)).toEqual([{ type: "review", id: "rev_1" }]);
  });

  it("collects an id from a single (non-items-array) tool result too", () => {
    const messages: ProviderMessage[] = [
      { role: "tool", toolCallId: "c1", content: JSON.stringify({ id: "evt_1", title: "Show" }) },
    ];
    expect(collectKnownRecords(messages)).toEqual([{ type: "event", id: "evt_1" }]);
  });

  it("ignores non-tool messages and unparseable tool content", () => {
    const messages: ProviderMessage[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
      { role: "tool", toolCallId: "c1", content: "not json" },
    ];
    expect(collectKnownRecords(messages)).toEqual([]);
  });
});

describe("checkGrounding", () => {
  it("accepts a citation that matches a known record and rejects one that doesn't", () => {
    const known = [{ type: "event", id: "evt_1" }];
    const result = checkGrounding(
      [
        { type: "event", id: "evt_1" },
        { type: "event", id: "evt_invented" },
      ],
      known,
    );
    expect(result.valid).toEqual([{ type: "event", id: "evt_1" }]);
    expect(result.invalid).toEqual([{ type: "event", id: "evt_invented" }]);
  });
});
