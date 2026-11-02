import { prisma } from "@agenticgenie/db";
import type { ProviderMessage } from "@agenticgenie/agent";
import { ApiError } from "../../lib/errors.js";

/** A conversation's message history, replayed back into
 * `ProviderMessage[]` so a continued conversation gives the loop (and this
 * turn's grounding check) the full prior context — including every past
 * tool result — not just the new message. Context-size limiting (B3's
 * "context limits and summarisation/truncation") keeps only the most
 * recent messages once a conversation grows past a bound, rather than
 * sending an ever-growing, unbounded history to the provider on every
 * turn. */
const MAX_REPLAYED_MESSAGES = 40;

const MAX_TITLE_LENGTH = 48;

/** A short, readable label for the conversation-history sidebar — derived
 * once from the opening message, never re-derived later (a conversation's
 * topic can legitimately drift). Purely cosmetic metadata, not a business
 * rule: an empty/odd first message just falls back to no title, which the
 * UI already renders as "Untitled conversation". */
function titleFromFirstMessage(message: string): string | undefined {
  const trimmed = message.trim().replace(/\s+/g, " ");
  if (!trimmed) return undefined;
  return trimmed.length > MAX_TITLE_LENGTH ? `${trimmed.slice(0, MAX_TITLE_LENGTH - 1)}…` : trimmed;
}

export async function createConversation(userId: string, firstMessage: string): Promise<string> {
  const conversation = await prisma.agentConversation.create({
    data: { userId, title: titleFromFirstMessage(firstMessage) },
  });
  return conversation.id;
}

/** Scoped strictly to the caller — a cross-user id guess gets 404, the same
 * isolation convention every other resource in this project uses. */
export async function getOwnConversationOrThrow(userId: string, conversationId: string) {
  const conversation = await prisma.agentConversation.findUnique({ where: { id: conversationId } });
  if (!conversation || conversation.userId !== userId) {
    throw new ApiError(404, "NOT_FOUND", "Conversation not found");
  }
  return conversation;
}

export async function listOwnConversations(userId: string) {
  return prisma.agentConversation.findMany({
    where: { userId },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    select: { id: true, title: true, createdAt: true, updatedAt: true },
  });
}

export async function loadReplayMessages(conversationId: string): Promise<ProviderMessage[]> {
  const rows = await prisma.agentMessage.findMany({
    where: { conversationId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  // Never start the window mid-exchange. A tool result without the assistant
  // call before it is rejected outright by OpenAI-compatible APIs, so walk
  // forward to the next human message.
  let recent = rows.slice(-MAX_REPLAYED_MESSAGES);
  if (rows.length > MAX_REPLAYED_MESSAGES) {
    const firstUser = recent.findIndex((row) => row.role === "USER");
    if (firstUser > 0) recent = recent.slice(firstUser);
  }

  return recent.map((row): ProviderMessage => {
    if (row.role === "TOOL") {
      const toolCallId = (row.toolResults as { toolCallId?: string } | null)?.toolCallId;
      return { role: "tool", toolCallId, content: row.content };
    }
    if (row.role === "ASSISTANT" && row.toolCalls) {
      return { role: "assistant", toolCalls: row.toolCalls as unknown as ProviderMessage["toolCalls"] };
    }
    return { role: row.role === "USER" ? "user" : "assistant", content: row.content };
  });
}

export interface PersistMessageInput {
  role: "USER" | "ASSISTANT" | "TOOL";
  content: string;
  /** Only meaningful for an ASSISTANT message that is calling tools. */
  toolCalls?: unknown;
  /** Only meaningful for a TOOL message — `{ toolCallId }`, so it can be
   * replayed back into a `ProviderMessage` correctly. */
  toolResults?: unknown;
  citations?: unknown;
}

/** Converts a finished turn's full `ProviderMessage[]` (as returned by
 * `runAgentTurn`) back into persistable rows, skipping whatever portion of
 * the array was already persisted (the replayed history this turn started
 * from). */
export function toPersistableMessages(messages: ProviderMessage[], skip: number): PersistMessageInput[] {
  return messages.slice(skip).map((m): PersistMessageInput => {
    if (m.role === "tool") {
      return { role: "TOOL", content: m.content ?? "", toolResults: { toolCallId: m.toolCallId } };
    }
    if (m.role === "assistant" && m.toolCalls) {
      return { role: "ASSISTANT", content: "", toolCalls: m.toolCalls };
    }
    return { role: m.role === "user" ? "USER" : "ASSISTANT", content: m.content ?? "" };
  });
}

export async function appendMessages(conversationId: string, messages: PersistMessageInput[]): Promise<void> {
  if (messages.length === 0) return;

  // Postgres's now() is frozen for the whole transaction, so every row in
  // one createMany would otherwise share an identical created_at — and
  // cuid2 ids are only approximately time-sortable, not a reliable
  // same-millisecond tie-break. Unlike catalogue pagination (where
  // same-batch ordering among unrelated rows doesn't matter, see
  // docs/DECISIONS.md D-013), getting a conversation's USER/ASSISTANT/TOOL
  // messages out of order would corrupt what gets replayed back to the
  // model as context — so each row in this batch gets an explicit,
  // strictly increasing timestamp instead of relying on the database's own
  // default.
  const base = Date.now();

  await prisma.$transaction([
    prisma.agentMessage.createMany({
      data: messages.map((m, i) => ({
        conversationId,
        role: m.role,
        content: m.content,
        toolCalls: m.toolCalls as never,
        toolResults: m.toolResults as never,
        citations: m.citations as never,
        createdAt: new Date(base + i),
      })),
    }),
    prisma.agentConversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } }),
  ]);
}

/** Turns stored messages into what the chat UI shows on reload: the human's
 * words and the assistant's answers with their citations, without tool traffic. */
export function toDisplayMessages(messages: ProviderMessage[]) {
  const display: { role: "user" | "assistant"; content: string; citations: unknown[]; eventCards: unknown[] }[] = [];
  for (const message of messages) {
    if (message.role === "user" && message.content) {
      display.push({ role: "user", content: message.content, citations: [], eventCards: [] });
    } else if (message.role === "assistant" && message.content) {
      const parsed = safeParseAnswer(message.content);
      display.push({
        role: "assistant",
        content: parsed?.answer ?? message.content,
        citations: parsed?.citations ?? [],
        eventCards: parsed?.eventCards ?? [],
      });
    }
  }
  return display;
}

function safeParseAnswer(content: string): { answer?: string; citations?: unknown[]; eventCards?: unknown[] } | undefined {
  try {
    const parsed = JSON.parse(content) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as { answer?: string; citations?: unknown[]; eventCards?: unknown[] }) : undefined;
  } catch {
    return undefined;
  }
}
