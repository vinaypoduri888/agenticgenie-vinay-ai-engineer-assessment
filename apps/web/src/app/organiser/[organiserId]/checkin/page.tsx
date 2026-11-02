"use client";

import { useRef, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import { apiFetch, ApiError } from "../../../../lib/api";
import { Button, Icon, PageHeader } from "../../../../components/ui";

interface ScanResult {
  id: number;
  code: string;
  ok: boolean;
  title: string;
  detail: string;
}

const REFUSALS: Record<string, string> = {
  ALREADY_CHECKED_IN: "Already checked in",
  TICKET_REFUNDED: "Refunded ticket",
  EVENT_CANCELLED: "Event cancelled",
  NOT_FOUND: "Not a valid ticket",
};

export default function CheckInPage() {
  useParams<{ organiserId: string }>();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [scans, setScans] = useState<ScanResult[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const nextId = useRef(0);

  async function handleCheckIn(e: FormEvent) {
    e.preventDefault();
    const scanned = code.trim();
    if (!scanned) return;
    setBusy(true);
    let result: Omit<ScanResult, "id">;
    try {
      await apiFetch(`/tickets/${encodeURIComponent(scanned)}/checkin`, { method: "POST" });
      result = { code: scanned, ok: true, title: "Admit", detail: "Checked in. This code can't be used again." };
    } catch (err) {
      const apiError = err instanceof ApiError ? err : null;
      result = {
        code: scanned,
        ok: false,
        title: (apiError && REFUSALS[apiError.code]) ?? "Do not admit",
        detail: apiError?.code === "NOT_FOUND" ? "This code isn't a ticket for one of your events." : (apiError?.message ?? "Check-in failed. Try again."),
      };
    }
    setScans((previous) => [{ ...result, id: nextId.current++ }, ...previous].slice(0, 20));
    setCode("");
    setBusy(false);
    inputRef.current?.focus();
  }

  const latest = scans[0];

  return (
    <div style={{ maxWidth: 560 }}>
      <PageHeader title="Check-in" description="Scan or type a ticket code. Each code works once, even if two people scan it at the same moment." />
      <form onSubmit={handleCheckIn} className="toolbar">
        <input
          ref={inputRef}
          className="input checkin-input grow"
          placeholder="TKT-…"
          aria-label="Ticket code"
          autoFocus
          autoComplete="off"
          spellCheck={false}
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        <Button type="submit" disabled={busy || !code.trim()}>
          Check in
        </Button>
      </form>

      {latest && (
        <div className={`scan-result ${latest.ok ? "ok" : "bad"}`} role="status">
          <Icon name={latest.ok ? "check" : "alert"} size={26} />
          <div>
            <strong>{latest.title}</strong>
            <span className="small">{latest.detail}</span>
          </div>
        </div>
      )}

      {scans.length > 1 && (
        <section style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: "1rem" }}>Recent scans</h2>
          {scans.slice(1).map((scan) => (
            <div key={scan.id} className="ticket-line" style={{ padding: "6px 0" }}>
              <Icon name={scan.ok ? "check" : "alert"} size={15} />
              <code className="small muted">{scan.code}</code>
              <span className="small muted" style={{ marginLeft: "auto" }}>
                {scan.title}
              </span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
