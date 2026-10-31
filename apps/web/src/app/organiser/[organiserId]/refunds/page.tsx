"use client";

import { useState, type FormEvent } from "react";
import { apiFetch, ApiError } from "../../../../lib/api";
import { buttonStyle, cardStyle, errorStyle, inputStyle, mutedStyle } from "../../../../lib/styles";

export default function OrganiserRefundPage() {
  const [orderId, setOrderId] = useState("");
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<{ status: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleRefund(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setBusy(true);
    try {
      const response = await apiFetch<{ status: string }>(`/orders/${orderId.trim()}/refund`, {
        method: "POST",
        body: { reason },
        idempotencyKey: crypto.randomUUID(),
      });
      setResult(response);
    } catch (err) {
      // Staff self-refund attempts land here as a 403 with the server's own
      // explanation — never silently succeed.
      setError(err instanceof ApiError ? err.message : "Refund failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1>Refund an order</h1>
      <p style={mutedStyle}>
        Refunds every currently-valid ticket on the order. Staff cannot refund an order they placed
        themselves — the server enforces this regardless of what this form allows you to submit.
      </p>
      <form onSubmit={handleRefund} style={cardStyle}>
        <input type="text" placeholder="Order ID" required value={orderId} onChange={(e) => setOrderId(e.target.value)} style={inputStyle} />
        <input type="text" placeholder="Reason" required value={reason} onChange={(e) => setReason(e.target.value)} style={inputStyle} />
        <button type="submit" disabled={busy} style={{ ...buttonStyle, marginTop: 8 }}>
          {busy ? "Processing…" : "Refund"}
        </button>
      </form>
      {error && <p style={errorStyle}>{error}</p>}
      {result && <p>Order status is now: {result.status}.</p>}
    </div>
  );
}
