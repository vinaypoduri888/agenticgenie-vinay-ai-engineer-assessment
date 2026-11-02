"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { apiFetch, errorMessage, formatMinor, formatShortDate, statusLabel } from "../../../../lib/api";
import { Badge, Button, Dialog, EmptyState, ErrorBanner, Field, Notice, PageHeader, SkeletonCard, TextInput, statusTone } from "../../../../components/ui";

interface OrderTicket {
  id: string;
  code: string;
  status: string;
  priceMinor: number;
  checkedInAt: string | null;
}

interface OrganiserOrder {
  id: string;
  status: string;
  totalAmountMinor: number;
  createdAt: string;
  user: { id: string; name: string; email: string };
  event: { id: string; title: string; startsAt: string };
  tickets: OrderTicket[];
}

function RefundDialog({ order, onClose, onDone }: { order: OrganiserOrder | null; onClose: () => void; onDone: (message: string) => void }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const valid = order?.tickets.filter((t) => t.status === "VALID") ?? [];

  useEffect(() => {
    setSelected(order?.tickets.filter((t) => t.status === "VALID").map((t) => t.id) ?? []);
    setReason("");
    setError(null);
  }, [order]);

  const total = valid.filter((t) => selected.includes(t.id)).reduce((sum, t) => sum + t.priceMinor, 0);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!order) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/orders/${order.id}/refund`, { method: "POST", body: { reason, ticketIds: selected }, idempotencyKey: crypto.randomUUID() });
      onDone(`Refunded ${formatMinor(total)} to ${order.user.name}.`);
    } catch (err) {
      // A staff member's own order lands here: the server's refusal, shown as written.
      setError(errorMessage(err, "Could not process that refund."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={order !== null} title="Issue a refund" onClose={onClose}>
      {order && (
        <form onSubmit={submit}>
          <p className="small muted">
            {order.user.name}, {order.event.title}
          </p>
          {valid.map((ticket, index) => (
            <label key={ticket.id} className="check-row">
              <input type="checkbox" checked={selected.includes(ticket.id)} onChange={(e) => setSelected((previous) => (e.target.checked ? [...previous, ticket.id] : previous.filter((id) => id !== ticket.id)))} />
              Ticket {index + 1}, {formatMinor(ticket.priceMinor)}
              {ticket.checkedInAt ? " (checked in)" : ""}
            </label>
          ))}
          <Field label="Reason" htmlFor="org-refund-reason">
            <TextInput id="org-refund-reason" required value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          {error && <ErrorBanner message={error} />}
          <div className="dialog-actions">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" disabled={busy || selected.length === 0 || !reason.trim()}>
              {busy ? "Refunding…" : `Refund ${formatMinor(total)}`}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

function OrdersInner() {
  const { organiserId } = useParams<{ organiserId: string }>();
  const searchParams = useSearchParams();
  const eventId = searchParams.get("event_id");
  const [orders, setOrders] = useState<OrganiserOrder[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refunding, setRefunding] = useState<OrganiserOrder | null>(null);

  async function load(cursor?: string) {
    setError(null);
    try {
      const query = new URLSearchParams({ limit: "25" });
      if (eventId) query.set("event_id", eventId);
      if (applied) query.set("q", applied);
      if (cursor) query.set("cursor", cursor);
      const page = await apiFetch<{ items: OrganiserOrder[]; next_cursor: string | null }>(`/organisers/${organiserId}/orders?${query}`);
      setOrders((previous) => (cursor ? [...(previous ?? []), ...page.items] : page.items));
      setNextCursor(page.next_cursor);
    } catch (err) {
      setError(errorMessage(err, "Could not load orders."));
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organiserId, eventId, applied]);

  return (
    <div>
      <PageHeader title="Orders & refunds" description={eventId ? "Showing one event's orders." : "Staff can refund any order except one they placed themselves. The server enforces that."} />

      <form
        className="toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied(search.trim());
        }}
      >
        <TextInput className="grow" type="search" placeholder="Search by attendee name, email or order id" aria-label="Search orders" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Button type="submit" variant="secondary">
          Search
        </Button>
        {eventId && (
          <Link href={`/organiser/${organiserId}/orders`} className="small" style={{ color: "var(--color-accent-strong)" }}>
            Show all events
          </Link>
        )}
      </form>

      {notice && <Notice tone="success">{notice}</Notice>}
      {error && <ErrorBanner message={error} />}
      {orders === null && !error && <SkeletonCard />}
      {orders?.length === 0 && <EmptyState title="No orders found" />}

      {orders && orders.length > 0 && (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Attendee</th>
                <th>Event</th>
                <th>Placed</th>
                <th>Status</th>
                <th className="num">Total</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => {
                const refundable = (order.status === "PAID" || order.status === "PARTIALLY_REFUNDED") && order.tickets.some((t) => t.status === "VALID");
                return (
                  <tr key={order.id}>
                    <td>
                      {order.user.name}
                      <div className="small muted">{order.user.email}</div>
                    </td>
                    <td>
                      <Link href={`/organiser/${organiserId}/events/${order.event.id}`}>{order.event.title}</Link>
                      <div className="small muted">
                        {order.tickets.length} ticket{order.tickets.length === 1 ? "" : "s"}
                      </div>
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>{formatShortDate(order.createdAt)}</td>
                    <td>
                      <Badge tone={statusTone(order.status)}>{statusLabel(order.status)}</Badge>
                    </td>
                    <td className="num">{formatMinor(order.totalAmountMinor)}</td>
                    <td className="num">
                      {refundable && (
                        <Button variant="ghost" size="sm" onClick={() => setRefunding(order)}>
                          Refund
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {nextCursor && (
        <div style={{ marginTop: 16, textAlign: "center" }}>
          <Button variant="secondary" onClick={() => load(nextCursor)}>
            Load more
          </Button>
        </div>
      )}

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

export default function OrganiserOrdersPage() {
  return (
    <Suspense fallback={<SkeletonCard />}>
      <OrdersInner />
    </Suspense>
  );
}
