"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { apiFetch, errorMessage, formatDateTime, formatMinor, formatShortDate, statusLabel } from "../../lib/api";
import { useSession } from "../../lib/useSession";
import { Badge, Button, Dialog, EmptyState, ErrorBanner, Field, Icon, LinkButton, Notice, PageHeader, SkeletonCard, TextInput, gradientFor, statusTone } from "../../components/ui";

interface Ticket {
  id: string;
  code: string;
  status: string;
  priceMinor: number;
  checkedInAt: string | null;
}

interface Order {
  id: string;
  status: string;
  totalAmountMinor: number;
  createdAt: string;
  event: { id: string; title: string; startsAt: string };
  tickets: Ticket[];
}

function CopyCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="icon-btn"
      aria-label={copied ? "Copied" : `Copy ticket code ${code}`}
      title={copied ? "Copied" : "Copy code"}
      onClick={async () => {
        await navigator.clipboard?.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      <Icon name={copied ? "check" : "copy"} size={15} />
    </button>
  );
}

function RefundDialog({ order, onClose, onDone }: { order: Order | null; onClose: () => void; onDone: (message: string) => void }) {
  const refundable = useMemo(() => order?.tickets.filter((t) => t.status === "VALID" && !t.checkedInAt) ?? [], [order]);
  const [selected, setSelected] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSelected(refundable.map((t) => t.id));
    setReason("");
    setError(null);
  }, [refundable]);

  const total = refundable.filter((t) => selected.includes(t.id)).reduce((sum, t) => sum + t.priceMinor, 0);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!order) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/orders/${order.id}/refund`, {
        method: "POST",
        body: { reason, ticketIds: selected },
        idempotencyKey: crypto.randomUUID(),
      });
      onDone(`Refunded ${formatMinor(total)} for ${order.event.title}.`);
    } catch (err) {
      setError(errorMessage(err, "Could not process that refund."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={order !== null} title="Cancel tickets" onClose={onClose}>
      {order && (
        <form onSubmit={submit}>
          <p>
            Choose which tickets to cancel for <strong>{order.event.title}</strong>.
          </p>
          {refundable.map((ticket, index) => (
            <label key={ticket.id} className="check-row">
              <input
                type="checkbox"
                checked={selected.includes(ticket.id)}
                onChange={(e) => setSelected((previous) => (e.target.checked ? [...previous, ticket.id] : previous.filter((id) => id !== ticket.id)))}
              />
              Ticket {index + 1}, {formatMinor(ticket.priceMinor)}
            </label>
          ))}
          <Field label="Reason" htmlFor="refund-reason">
            <TextInput id="refund-reason" required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Can't make it any more" />
          </Field>
          {error && <ErrorBanner message={error} />}
          <div className="dialog-actions">
            <Button type="button" variant="ghost" onClick={onClose}>
              Keep my tickets
            </Button>
            <Button type="submit" variant="danger" disabled={busy || selected.length === 0 || !reason.trim()}>
              {busy ? "Cancelling…" : `Refund ${formatMinor(total)}`}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

export default function OrdersPage() {
  const { user } = useSession();
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<"upcoming" | "past">("upcoming");
  const [refunding, setRefunding] = useState<Order | null>(null);

  async function load() {
    setError(null);
    try {
      const all: Order[] = [];
      let cursor: string | null = null;
      do {
        const page: { items: Order[]; next_cursor: string | null } = await apiFetch(`/me/orders?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
        all.push(...page.items);
        cursor = page.next_cursor;
      } while (cursor);
      setOrders(all.reverse());
    } catch (err) {
      setError(errorMessage(err, "Could not load your orders."));
    }
  }

  useEffect(() => {
    if (user === undefined) return;
    if (user === null) {
      window.location.href = "/login?next=/orders";
      return;
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const now = Date.now();
  const upcoming = orders?.filter((o) => new Date(o.event.startsAt).getTime() >= now) ?? [];
  const past = orders?.filter((o) => new Date(o.event.startsAt).getTime() < now) ?? [];
  const visible = tab === "upcoming" ? upcoming : past;

  return (
    <div style={{ maxWidth: 820 }}>
      <PageHeader title="My tickets" description="Show a ticket's code at the door. It can only be scanned once." />

      <div className="tabs" role="tablist">
        <button className="tab" role="tab" aria-selected={tab === "upcoming"} onClick={() => setTab("upcoming")}>
          Upcoming ({upcoming.length})
        </button>
        <button className="tab" role="tab" aria-selected={tab === "past"} onClick={() => setTab("past")}>
          Past ({past.length})
        </button>
      </div>

      {notice && <Notice tone="success">{notice}</Notice>}
      {error && <ErrorBanner message={error} />}
      {orders === null && !error && (
        <>
          <SkeletonCard />
          <div style={{ height: 12 }} />
          <SkeletonCard />
        </>
      )}
      {orders !== null && visible.length === 0 && (
        <EmptyState
          title={tab === "upcoming" ? "Nothing coming up" : "No past events yet"}
          description={tab === "upcoming" ? "Find something to go to, or ask the assistant." : undefined}
          action={tab === "upcoming" ? <LinkButton href="/events">Discover events</LinkButton> : undefined}
        />
      )}

      {visible.map((order) => {
        const canCancel = (order.status === "PAID" || order.status === "PARTIALLY_REFUNDED") && order.tickets.some((t) => t.status === "VALID" && !t.checkedInAt) && tab === "upcoming";
        return (
          <article key={order.id} className="order-card">
            <div className="order-head">
              <div className="order-swatch" style={{ background: gradientFor(order.event.id) }} aria-hidden="true" />
              <div>
                <div className="order-title">
                  <Link href={`/events/${order.event.id}`}>{order.event.title}</Link>
                </div>
                <div className="order-sub">{formatDateTime(order.event.startsAt)}</div>
              </div>
              <div className="order-head-side">
                <Badge tone={statusTone(order.status)}>{statusLabel(order.status)}</Badge>
                <strong>{formatMinor(order.totalAmountMinor)}</strong>
              </div>
            </div>

            {order.status === "PENDING_PAYMENT" && (
              <div className="order-tickets">
                <span className="small muted">We're confirming this payment with the provider. This page will show the result shortly.</span>
              </div>
            )}

            {order.tickets.length > 0 && (
              <div className="order-tickets">
                {order.tickets.map((ticket) => (
                  <div key={ticket.id} className="ticket-line">
                    <Icon name="ticket" size={16} />
                    <code>{ticket.code}</code>
                    {ticket.status === "VALID" && !ticket.checkedInAt && <CopyCode code={ticket.code} />}
                    <Badge tone={ticket.checkedInAt ? "info" : statusTone(ticket.status)}>{ticket.checkedInAt ? "Checked in" : statusLabel(ticket.status)}</Badge>
                  </div>
                ))}
              </div>
            )}

            <div className="order-foot">
              <span>Ordered {formatShortDate(order.createdAt)}</span>
              {canCancel && (
                <Button variant="ghost" size="sm" onClick={() => setRefunding(order)}>
                  Cancel tickets
                </Button>
              )}
            </div>
          </article>
        );
      })}

      <RefundDialog
        order={refunding}
        onClose={() => setRefunding(null)}
        onDone={(message) => {
          setRefunding(null);
          setNotice(message);
          load();
        }}
      />
    </div>
  );
}
