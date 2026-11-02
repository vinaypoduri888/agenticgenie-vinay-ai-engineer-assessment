import type { EventCardData } from "../ui";

export interface ChatCitation {
  type: string;
  id: string;
}

export interface PendingConfirmationSummary {
  toolName: string;
  targetId: string;
  expiresAt: string;
  summary: string;
}

export interface ToolExecutionEntry {
  name: string;
  durationMs: number;
  success: boolean;
  errorCode?: string;
}

/** The exact shape POST /agent/chat returns. See apps/api/src/modules/agent/router.ts. */
export interface ChatResponse {
  conversationId: string;
  outcome: "success" | "partial" | "error";
  reason?: string;
  answer: string;
  citations: ChatCitation[];
  eventCards: EventCardData[];
  actionTaken: boolean;
  needsConfirmation: boolean;
  pendingConfirmation?: PendingConfirmationSummary;
  degraded: boolean;
  suspiciousContentFlagged: boolean;
  toolExecutionSummary: ToolExecutionEntry[];
}

export interface UiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  eventCards?: EventCardData[];
  toolExecutionSummary?: ToolExecutionEntry[];
  degraded?: boolean;
  suspiciousContentFlagged?: boolean;
  actionTaken?: boolean;
}
