"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetch, ApiError, formatMinor } from "../../../../lib/api";
import { cardStyle, errorStyle, inputStyle, mutedStyle } from "../../../../lib/styles";

interface SalesGroup {
  key: string;
  label: string | null;
  revenueMinor: number;
  ticketCount: number;
}
interface SalesSummary {
  groupBy: string;
  totalRevenueMinor: number;
  totalTicketCount: number;
  groups: SalesGroup[];
}

export default function OrganiserReportsPage() {
  const { organiserId } = useParams<{ organiserId: string }>();
  const [groupBy, setGroupBy] = useState<"event" | "day" | "tier">("event");
  const [summary, setSummary] = useState<SalesSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setError(null);
    apiFetch<SalesSummary>(`/organisers/${organiserId}/reports/sales?group_by=${groupBy}`)
      .then(setSummary)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load sales report."))
      .finally(() => setLoading(false));
  }, [organiserId, groupBy]);

  return (
    <div>
      <h1>Sales report</h1>
      <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as typeof groupBy)} style={{ ...inputStyle, width: 160, marginBottom: 16 }}>
        <option value="event">By event</option>
        <option value="day">By day</option>
        <option value="tier">By tier</option>
      </select>

      {loading && <p>Loading…</p>}
      {error && <p style={errorStyle}>{error}</p>}
      {summary && (
        <>
          <p>
            Total revenue: <strong>{formatMinor(summary.totalRevenueMinor)}</strong> across {summary.totalTicketCount} tickets
          </p>
          {summary.groups.map((g) => (
            <div key={g.key} style={cardStyle}>
              <strong>{g.label ?? g.key}</strong>
              <div style={mutedStyle}>
                {formatMinor(g.revenueMinor)} · {g.ticketCount} ticket(s)
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
