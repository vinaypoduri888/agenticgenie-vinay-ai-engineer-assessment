"use client";

import { useEffect, useState } from "react";
import { apiFetch, ApiError, formatMinor } from "../../lib/api";
import { useSession } from "../../lib/useSession";
import { cardStyle, errorStyle, mutedStyle } from "../../lib/styles";

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

export default function OrdersPage() {
  const { user } = useSession();
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user === undefined) return;
    if (user === null) {
      window.location.href = "/login";
      return;
    }
    apiFetch<{ items: Order[] }>("/me/orders")
      .then((r) => setOrders(r.items))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load orders."))
      .finally(() => setLoading(false));
  }, [user]);

  if (user === undefined || loading) return <p>Loading…</p>;
  if (error) return <p style={errorStyle}>{error}</p>;

  return (
    <div>
      <h1>My orders</h1>
      {orders.length === 0 && <p>You have no orders yet.</p>}
      {orders.map((order) => (
        <div key={order.id} style={cardStyle}>
          <strong>{order.event.title}</strong>
          <span style={{ marginLeft: 8, ...mutedStyle }}>{order.status}</span>
          <div style={mutedStyle}>
            Ordered {new Date(order.createdAt).toLocaleString()} · Total {formatMinor(order.totalAmountMinor)}
          </div>
          {order.tickets.length > 0 && (
            <ul>
              {order.tickets.map((t) => (
                <li key={t.id}>
                  Code <code>{t.code}</code> — {t.status}
                  {t.checkedInAt ? ` (checked in ${new Date(t.checkedInAt).toLocaleString()})` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
