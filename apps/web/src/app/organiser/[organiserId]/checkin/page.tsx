"use client";

import { useState, type FormEvent } from "react";
import { apiFetch, ApiError } from "../../../../lib/api";
import { buttonStyle, cardStyle, errorStyle, inputStyle } from "../../../../lib/styles";

interface Ticket {
  id: string;
  code: string;
  status: string;
  checkedInAt: string | null;
}

export default function CheckInPage() {
  const [code, setCode] = useState("");
  const [result, setResult] = useState<Ticket | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleCheckIn(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setBusy(true);
    try {
      const ticket = await apiFetch<Ticket>(`/tickets/${code.trim()}/checkin`, { method: "POST" });
      setResult(ticket);
      setCode("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Check-in failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1>Check in a ticket</h1>
      <form onSubmit={handleCheckIn} style={cardStyle}>
        <input type="text" placeholder="Ticket code" required value={code} onChange={(e) => setCode(e.target.value)} style={inputStyle} />
        <button type="submit" disabled={busy} style={{ ...buttonStyle, marginTop: 8 }}>
          {busy ? "Checking in…" : "Check in"}
        </button>
      </form>
      {error && <p style={errorStyle}>{error}</p>}
      {result && (
        <div style={cardStyle}>
          Ticket <code>{result.code}</code> checked in at {new Date(result.checkedInAt!).toLocaleString()}.
        </div>
      )}
    </div>
  );
}
