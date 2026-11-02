import type { AgentCitation } from "../providers/types.js";
import type { ProviderMessage } from "../providers/types.js";

export interface KnownRecord {
  type: string;
  id: string;
}

/**
 * A model is never trusted to have actually seen a record just because it
 * writes a citation token for it — every `[event:ID]`/`[review:ID]` claim
 * in a final answer is checked in code against the ids this conversation's
 * own tool calls actually returned. Walks every "tool" message in the
 * supplied history (not just the current turn — a continued conversation
 * can still cite something fetched several turns ago), parses its JSON
 * content, and collects any `.id` field found on direct items or on an
 * `items[]` array, tagged by the tool name that produced it.
 */
export function collectKnownRecords(messages: ProviderMessage[]): KnownRecord[] {
  const records: KnownRecord[] = [];

  for (const message of messages) {
    if (message.role !== "tool" || !message.content) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(message.content);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object") continue;

    const output = parsed as Record<string, unknown>;
    if (Array.isArray(output.groups)) {
      for (const group of output.groups as { key?: unknown }[]) {
        if (typeof group?.key === "string") records.push({ type: "sales", id: group.key });
      }
      continue;
    }
    if (Array.isArray(output.orders)) {
      for (const order of output.orders as { id?: unknown }[]) {
        if (typeof order?.id === "string") records.push({ type: "order", id: order.id });
      }
      continue;
    }

    const type = inferRecordType(output);
    if (!type) continue;

    const candidates: unknown[] = Array.isArray((parsed as Record<string, unknown>).items)
      ? ((parsed as Record<string, unknown>).items as unknown[])
      : [parsed];

    for (const candidate of candidates) {
      if (candidate && typeof candidate === "object" && typeof (candidate as Record<string, unknown>).id === "string") {
        records.push({ type, id: (candidate as Record<string, unknown>).id as string });
      }
    }
  }

  return records;
}

/**
 * A tool result's shape alone tells us whether it's carrying events or
 * reviews — `search_events`/`get_event` results have a `title`/`venue`
 * field, `get_reviews` results have a `rating`/`text` field. Good enough
 * for a citation-grounding check; not a general schema inference engine.
 */
function inferRecordType(output: Record<string, unknown>): string | undefined {
  const sample = Array.isArray(output.items) ? (output.items[0] as Record<string, unknown> | undefined) : output;
  if (!sample) return undefined;
  if ("rating" in sample || "text" in sample) return "review";
  if ("title" in sample || "venue" in sample) return "event";
  return undefined;
}

const CITATION_TOKEN_PATTERN = /\[(event|review|order|sales):([A-Za-z0-9_-]+)\]/g;

/** Extracts every `[type:id]` citation token actually written in an answer
 * string — a model claiming a citation in prose without this exact token
 * form produces no citation to validate, which is itself a grounding gap a
 * stricter eval could flag later, not something this function guesses at. */
export function extractCitationTokens(answerText: string): AgentCitation[] {
  const citations: AgentCitation[] = [];
  for (const match of answerText.matchAll(CITATION_TOKEN_PATTERN)) {
    citations.push({ type: match[1]!, id: match[2]! });
  }
  return citations;
}

export interface GroundingCheckResult {
  valid: AgentCitation[];
  invalid: AgentCitation[];
}

/** A citation is valid only if a tool actually returned a record of that
 * exact type+id in this conversation. Invented ids, prices, or dates never
 * pass — the model does not get credit for sounding grounded. */
export function checkGrounding(citations: AgentCitation[], known: KnownRecord[]): GroundingCheckResult {
  const valid: AgentCitation[] = [];
  const invalid: AgentCitation[] = [];
  for (const citation of citations) {
    const isKnown = known.some((k) => k.type === citation.type && k.id === citation.id);
    (isKnown ? valid : invalid).push(citation);
  }
  return { valid, invalid };
}
