"use client";

import { Suspense, useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch, errorMessage } from "../../lib/api";
import { useSession } from "../../lib/useSession";
import { Button, Chip, EmptyState, ErrorBanner, Icon } from "../../components/ui";
import { MessageBubble } from "../../components/chat/MessageBubble";
import { ConfirmationCard } from "../../components/chat/ConfirmationCard";
import type { ChatResponse, PendingConfirmationSummary, UiMessage } from "../../components/chat/types";

interface ConversationSummary {
  id: string;
  title: string | null;
  updatedAt: string;
}

interface ConversationDetail {
  id: string;
  display: { role: "user" | "assistant"; content: string; eventCards: UiMessage["eventCards"] }[];
  pendingConfirmation?: PendingConfirmationSummary;
}

const SUGGESTIONS = ["Comedy shows in Pune", "Music events under ₹2,000", "Show my orders", "What's on in Mumbai?"];

let messageSeq = 0;
const nextId = () => `m${++messageSeq}`;

/** Follow-ups a person is likely to want next, from what just happened. */
function followUpsFor(message: UiMessage | undefined, pending: PendingConfirmationSummary | null): string[] {
  if (!message || message.role !== "assistant" || pending) return [];
  if (message.eventCards && message.eventCards.length > 0) {
    return message.eventCards.length > 1 ? ["Book the first one", "Book the second one", "What do people say about the first one?"] : ["Book it", "What do people say about it?"];
  }
  if (message.actionTaken) return ["Show my orders"];
  return [];
}

function Composer({ value, onChange, onSend, disabled, placeholder }: { value: string; onChange: (value: string) => void; onSend: () => void; disabled: boolean; placeholder: string }) {
  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  }
  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        onSend();
      }}
    >
      <textarea rows={2} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={onKeyDown} aria-label="Message the assistant" />
      <div className="composer-foot">
        <span className="small faint">Nothing is booked or charged until you confirm.</span>
        <button type="submit" className="composer-send" disabled={disabled || !value.trim()} aria-label="Send message">
          <Icon name="send" size={17} />
        </button>
      </div>
    </form>
  );
}

function AssistantPageInner() {
  const { user } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const prefillPrompt = searchParams.get("prompt") ?? "";

  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null);
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [pending, setPending] = useState<PendingConfirmationSummary | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const autoSentRef = useRef(false);

  const loadConversations = useCallback(async () => {
    try {
      const res = await apiFetch<{ items: ConversationSummary[] }>("/me/conversations");
      setConversations(res.items);
    } catch {
      setConversations([]);
    }
  }, []);

  useEffect(() => {
    if (user) loadConversations();
  }, [user, loadConversations]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || sending) return;
      setError(null);
      setInput("");
      setSending(true);
      setPending(null);
      setMessages((previous) => [...previous, { id: nextId(), role: "user", content: trimmed }]);

      try {
        const res = await apiFetch<ChatResponse>("/agent/chat", { method: "POST", body: { conversationId, message: trimmed } });
        setConversationId(res.conversationId);
        setPending(res.pendingConfirmation ?? null);
        setMessages((previous) => [
          ...previous,
          {
            id: nextId(),
            role: "assistant",
            content: res.answer,
            eventCards: res.eventCards,
            toolExecutionSummary: res.toolExecutionSummary,
            degraded: res.degraded,
            suspiciousContentFlagged: res.suspiciousContentFlagged,
            actionTaken: res.actionTaken,
          },
        ]);
        loadConversations();
      } catch (err) {
        setError(errorMessage(err, "Could not reach the assistant. Nothing was booked."));
      } finally {
        setSending(false);
      }
    },
    [conversationId, sending, loadConversations],
  );

  useEffect(() => {
    if (prefillPrompt && !autoSentRef.current && user) {
      autoSentRef.current = true;
      sendMessage(prefillPrompt);
      router.replace("/assistant");
    }
  }, [prefillPrompt, user, sendMessage, router]);

  async function openConversation(id: string) {
    setConversationId(id);
    setMessages([]);
    setPending(null);
    setError(null);
    setSidebarOpen(false);
    try {
      const res = await apiFetch<ConversationDetail>(`/me/conversations/${id}`);
      setMessages(res.display.map((m) => ({ id: nextId(), role: m.role, content: m.content, eventCards: m.eventCards })));
      setPending(res.pendingConfirmation ?? null);
    } catch (err) {
      setError(errorMessage(err, "Could not load that conversation."));
    }
  }

  function startNewConversation() {
    setConversationId(undefined);
    setMessages([]);
    setPending(null);
    setError(null);
    setSidebarOpen(false);
  }

  if (user === undefined) return null;
  if (user === null) {
    return (
      <div className="container" style={{ paddingTop: 48 }}>
        <EmptyState
          title="Log in to use the assistant"
          description="It acts as you, with your permissions, so your conversations and bookings are tied to your account."
          action={<Button onClick={() => router.push("/login?next=/assistant")}>Log in</Button>}
        />
      </div>
    );
  }

  const lastMessage = messages.at(-1);
  const followUps = sending ? [] : followUpsFor(lastMessage, pending);
  const placeholder = pending ? 'Reply "yes" to confirm, or tell me what to do instead' : "Ask about events, availability or your orders";

  return (
    <div className="assistant">
      <aside className={`assistant-sidebar${sidebarOpen ? " open" : ""}`} aria-label="Conversations">
        <Button variant="secondary" size="sm" block onClick={startNewConversation}>
          New chat
        </Button>
        <div className="assistant-recents-label">Recent</div>
        {conversations?.length === 0 && <p className="small faint" style={{ padding: "0 8px" }}>Your chats will show up here.</p>}
        {conversations?.map((conversation) => (
          <button key={conversation.id} className={`assistant-recent${conversation.id === conversationId ? " active" : ""}`} aria-current={conversation.id === conversationId} onClick={() => openConversation(conversation.id)}>
            {conversation.title || "Untitled chat"}
          </button>
        ))}
      </aside>

      <section className="assistant-main">
        <div className="assistant-mobile-bar">
          <Button variant="ghost" size="sm" onClick={() => setSidebarOpen((open) => !open)} aria-expanded={sidebarOpen}>
            {sidebarOpen ? "Close" : "Chats"}
          </Button>
          <Button variant="ghost" size="sm" onClick={startNewConversation}>
            New chat
          </Button>
        </div>

        {messages.length === 0 && !sending ? (
          <div className="assistant-welcome">
            <div className="assistant-column">
              <h1>What can I find for you?</h1>
              <p>I search live listings, check availability and can book for you, once you've confirmed.</p>
              {error && <ErrorBanner message={error} />}
              <Composer value={input} onChange={setInput} onSend={() => sendMessage(input)} disabled={sending} placeholder={placeholder} />
              <div className="suggestion-list">
                <div className="suggestion-list-label">Try asking</div>
                {SUGGESTIONS.map((suggestion) => (
                  <button key={suggestion} className="suggestion" onClick={() => sendMessage(suggestion)}>
                    <Icon name="arrow" size={14} />
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="assistant-thread" ref={threadRef} aria-live="polite">
              <div className="assistant-column">
                {messages.map((message) => (
                  <MessageBubble key={message.id} message={message}>
                    {message === lastMessage && pending && <ConfirmationCard pending={pending} disabled={sending} onRespond={(reply) => sendMessage(reply)} />}
                  </MessageBubble>
                ))}
                {sending && (
                  <div className="typing" role="status" aria-label="The assistant is working">
                    <i />
                    <i />
                    <i />
                  </div>
                )}
              </div>
            </div>
            <div className="composer-dock">
              <div className="assistant-column">
                {error && <ErrorBanner message={error} />}
                {followUps.length > 0 && (
                  <div className="follow-ups">
                    {followUps.map((followUp) => (
                      <Chip key={followUp} onClick={() => sendMessage(followUp)}>
                        {followUp}
                      </Chip>
                    ))}
                  </div>
                )}
                <Composer value={input} onChange={setInput} onSend={() => sendMessage(input)} disabled={sending} placeholder={placeholder} />
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

export default function AssistantPage() {
  return (
    <Suspense fallback={null}>
      <AssistantPageInner />
    </Suspense>
  );
}
