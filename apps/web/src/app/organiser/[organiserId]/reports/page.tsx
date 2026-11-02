"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { apiFetch, errorMessage, formatMinor } from "../../../../lib/api";
import { EmptyState, ErrorBanner, Field, PageHeader, SkeletonCard, Stat, TextInput } from "../../../../components/ui";

interface SalesGroup {
  key: string;
  label: string | null;
  revenueMinor: number;
  ticketCount: number;
}
interface SalesSummary {
  totalRevenueMinor: number;
  totalTicketCount: number;
  groups: SalesGroup[];
}

type GroupBy = "event" | "day" | "tier";
const TABS: { key: GroupBy; label: string }[] = [
  { key: "event", label: "By event" },
  { key: "day", label: "By day" },
  { key: "tier", label: "By tier" },
];

function labelFor(group: SalesGroup, groupBy: GroupBy): string {
  if (groupBy === "day") return new Date(group.key).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  return group.label ?? group.key;
}

/** One measure, one hue. Bars carry labels and values directly, so nothing relies
 * on colour, and the same numbers are the row text a screen reader gets. */
function SalesBars({ groups, groupBy }: { groups: SalesGroup[]; groupBy: GroupBy }) {
  const max = Math.max(...groups.map((g) => g.revenueMinor), 1);
  return (
    <div className="data-table-wrap">
      <div className="bar-chart">
        {groups.map((group) => {
          const label = labelFor(group, groupBy);
          return (
            <div key={group.key} className="bar-row" title={`${label}: ${formatMinor(group.revenueMinor)} from ${group.ticketCount} tickets`}>
              <div className="bar-label">{label}</div>
              <div className="bar-track" aria-hidden="true">
                <div className="bar-fill" style={{ width: `${(group.revenueMinor / max) * 100}%` }} />
              </div>
              <div className="bar-value">
                {formatMinor(group.revenueMinor)}
                <small>
                  {group.ticketCount} ticket{group.ticketCount === 1 ? "" : "s"}
                </small>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function OrganiserReportsPage() {
  const { organiserId } = useParams<{ organiserId: string }>();
  const [groupBy, setGroupBy] = useState<GroupBy>("event");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [summary, setSummary] = useState<SalesSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    const query = new URLSearchParams({ group_by: groupBy });
    if (from) query.set("from", new Date(`${from}T00:00:00`).toISOString());
    if (to) query.set("to", new Date(`${to}T23:59:59`).toISOString());
    apiFetch<SalesSummary>(`/organisers/${organiserId}/reports/sales?${query}`)
      .then(setSummary)
      .catch((err) => setError(errorMessage(err, "Could not load sales.")));
  }, [organiserId, groupBy, from, to]);

  const average = summary && summary.totalTicketCount > 0 ? Math.round(summary.totalRevenueMinor / summary.totalTicketCount) : null;

  return (
    <div>
      <PageHeader title="Sales" description="Net of refunds. Grouped by the date each order was placed." />

      <div className="inline-form" style={{ marginBottom: 20 }}>
        <Field label="From" htmlFor="sales-from">
          <TextInput id="sales-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="To" htmlFor="sales-to">
          <TextInput id="sales-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>

      {error && <ErrorBanner message={error} />}
      {!summary && !error && <SkeletonCard />}
      {summary && (
        <>
          <div className="stat-grid">
            <Stat label="Net revenue" value={formatMinor(summary.totalRevenueMinor)} />
            <Stat label="Tickets sold" value={summary.totalTicketCount.toLocaleString("en-IN")} />
            <Stat label="Average ticket" value={average !== null ? formatMinor(average) : "—"} />
          </div>

          <div className="tabs" role="tablist">
            {TABS.map((tab) => (
              <button key={tab.key} className="tab" role="tab" aria-selected={groupBy === tab.key} onClick={() => setGroupBy(tab.key)}>
                {tab.label}
              </button>
            ))}
          </div>

          {summary.groups.length === 0 ? <EmptyState title="No sales in this period" /> : <SalesBars groups={summary.groups} groupBy={groupBy} />}
        </>
      )}
    </div>
  );
}
