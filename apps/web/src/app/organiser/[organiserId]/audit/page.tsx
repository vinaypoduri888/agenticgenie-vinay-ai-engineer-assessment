"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import { apiFetch, ApiError } from "../../../../lib/api";
import { buttonStyle, cardStyle, errorStyle, inputStyle, mutedStyle } from "../../../../lib/styles";

interface AuditEntry {
  id: string;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  requestId: string;
  createdAt: string;
}
interface AuditPage {
  items: AuditEntry[];
  next_cursor: string | null;
}

export default function OrganiserAuditPage() {
  const { organiserId } = useParams<{ organiserId: string }>();
  const [entityFilter, setEntityFilter] = useState("");
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load(reset: boolean) {
    setLoading(true);
    setError(null);
    try {
      const query: Record<string, string> = { limit: "20" };
      if (entityFilter.trim()) query.entity = entityFilter.trim();
      if (!reset && nextCursor) query.cursor = nextCursor;
      const params = new URLSearchParams(query).toString();
      const page = await apiFetch<AuditPage>(`/organisers/${organiserId}/audit?${params}`);
      setEntries((prev) => (reset ? page.items : [...prev, ...page.items]));
      setNextCursor(page.next_cursor);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the audit log.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organiserId]);

  function onFilter(e: FormEvent) {
    e.preventDefault();
    load(true);
  }

  return (
    <div>
      <h1>Audit log</h1>
      <p style={mutedStyle}>
        No entity filter shows the full organiser-wide feed (admins only). An entity filter like{" "}
        <code>Event:abc123</code> is viewable by any organiser member.
      </p>
      <form onSubmit={onFilter} style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input
          type="text"
          placeholder="Entity filter, e.g. Event:abc123"
          value={entityFilter}
          onChange={(e) => setEntityFilter(e.target.value)}
          style={{ ...inputStyle, flex: 1 }}
        />
        <button type="submit" style={buttonStyle}>
          Apply
        </button>
      </form>

      {error && <p style={errorStyle}>{error}</p>}
      {loading && entries.length === 0 && <p>Loading…</p>}
      {!loading && !error && entries.length === 0 && <p style={mutedStyle}>No audit entries found.</p>}

      {entries.map((entry) => (
        <div key={entry.id} style={cardStyle}>
          <strong>{entry.action}</strong>
          <div style={mutedStyle}>
            {entry.entityType}:{entry.entityId} · actor {entry.actorUserId ?? "system"} · {new Date(entry.createdAt).toLocaleString()}
          </div>
          <div style={mutedStyle}>request {entry.requestId}</div>
        </div>
      ))}

      {nextCursor && (
        <button onClick={() => load(false)} disabled={loading} style={buttonStyle}>
          Load more
        </button>
      )}
    </div>
  );
}
