import Link from "next/link";
import type { ReactNode } from "react";
import type { UiMessage } from "./types";
import { EventCard, Icon, Notice } from "../ui";

const CITATION_PATTERN = /\[(event|review|order|sales):([a-zA-Z0-9_-]+)\]/g;

/** The tokens reaching here already passed the server's grounding check. Links go
 * to the real record, and anything else stays a plain label. */
function renderWithCitations(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  for (const match of text.matchAll(CITATION_PATTERN)) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    const [, type, id] = match;
    if (type === "event") {
      parts.push(
        <Link key={key++} href={`/events/${id}`} className="citation" title="Open this event">
          event
        </Link>,
      );
    } else if (type === "order") {
      parts.push(
        <Link key={key++} href="/orders" className="citation" title="See your orders">
          order
        </Link>,
      );
    } else {
      parts.push(
        <span key={key++} className="citation">
          {type}
        </span>,
      );
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

const TOOL_LABELS: Record<string, string> = {
  search_events: "Searched events",
  get_event: "Checked event details",
  get_reviews: "Read reviews",
  hold_seats: "Placed a temporary hold",
  purchase: "Worked on the purchase",
  cancel_order: "Worked on the cancellation",
  sales_summary: "Pulled sales figures",
  list_my_orders: "Looked up your orders",
};

function ToolActivity({ steps }: { steps: NonNullable<UiMessage["toolExecutionSummary"]> }) {
  const refused = steps.filter((s) => !s.success).length;
  return (
    <details className="tool-steps">
      <summary>
        <Icon name="tool" size={14} />
        {steps.length} step{steps.length === 1 ? "" : "s"}
        {refused > 0 ? `, ${refused} refused` : ""}
      </summary>
      {steps.map((step, index) => (
        <div key={index} className={`tool-step ${step.success ? "ok" : "failed"}`}>
          <Icon name={step.success ? "check" : "alert"} size={13} />
          <span>
            {TOOL_LABELS[step.name] ?? step.name}
            {step.errorCode ? ` (${step.errorCode.toLowerCase().replace(/_/g, " ")})` : ""}
          </span>
          <span>{step.durationMs} ms</span>
        </div>
      ))}
    </details>
  );
}

export function MessageBubble({ message, children }: { message: UiMessage; children?: ReactNode }) {
  if (message.role === "user") {
    return (
      <div className="msg msg-user">
        <div>{message.content}</div>
      </div>
    );
  }
  return (
    <div className="msg">
      {message.toolExecutionSummary && message.toolExecutionSummary.length > 0 && <ToolActivity steps={message.toolExecutionSummary} />}
      {message.suspiciousContentFlagged && (
        <Notice tone="warning">Some content here looked like an attempt to give the assistant instructions. It was treated as text and not acted on.</Notice>
      )}
      <div className="msg-body">{renderWithCitations(message.content)}</div>
      {message.degraded && <div className="small faint" style={{ marginTop: 8 }}>The assistant's model was unavailable, so this came from a direct lookup.</div>}
      {message.eventCards && message.eventCards.length > 0 && (
        <div className="msg-cards">
          {message.eventCards.map((event) => (
            <EventCard key={event.id} event={event} />
          ))}
        </div>
      )}
      {children}
    </div>
  );
}
