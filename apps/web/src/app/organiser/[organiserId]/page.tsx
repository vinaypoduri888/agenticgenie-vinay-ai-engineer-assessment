"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiFetch, errorMessage, formatMinor, formatShortDate, statusLabel } from "../../../lib/api";
import { Badge, EmptyState, ErrorBanner, LinkButton, Meter, PageHeader, SkeletonCard, Stat, statusTone } from "../../../components/ui";

interface OrganiserEvent {
  id: string;
  title: string;
  status: string;
  startsAt: string;
  venue: { name: string; city: string };
  capacity: number;
  ticketsSold: number;
}

interface SalesSummary {
  totalRevenueMinor: number;
  totalTicketCount: number;
}

export default function OrganiserOverviewPage() {
  const { organiserId } = useParams<{ organiserId: string }>();
  const [events, setEvents] = useState<OrganiserEvent[] | null>(null);
  const [sales, setSales] = useState<SalesSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      apiFetch<{ items: OrganiserEvent[] }>(`/organisers/${organiserId}/events`),
      apiFetch<SalesSummary>(`/organisers/${organiserId}/reports/sales?group_by=event`),
    ])
      .then(([eventsRes, salesRes]) => {
        setEvents(eventsRes.items);
        setSales(salesRes);
      })
      .catch((err) => setError(errorMessage(err, "Could not load this organiser.")));
  }, [organiserId]);

  if (error) return <ErrorBanner message={error} />;
  if (!events || !sales) return <SkeletonCard />;

  const now = Date.now();
  const live = events.filter((e) => ["PUBLISHED", "ON_SALE", "SOLD_OUT"].includes(e.status));
  const upcoming = live.filter((e) => new Date(e.startsAt).getTime() >= now);
  const drafts = events.filter((e) => e.status === "DRAFT").length;
  const capacity = live.reduce((sum, e) => sum + e.capacity, 0);
  const sold = live.reduce((sum, e) => sum + e.ticketsSold, 0);

  return (
    <div>
      <PageHeader title="Overview" actions={<LinkButton href={`/organiser/${organiserId}/checkin`} variant="secondary">Check in tickets</LinkButton>} />

      <div className="stat-grid">
        <Stat label="Net revenue" value={formatMinor(sales.totalRevenueMinor)} hint="After refunds" />
        <Stat label="Tickets sold" value={sales.totalTicketCount.toLocaleString("en-IN")} hint="Valid tickets, all events" />
        <Stat label="Live events" value={live.length} hint={`${drafts} draft${drafts === 1 ? "" : "s"}`} />
        <Stat label="Sold through" value={capacity > 0 ? `${Math.round((sold / capacity) * 100)}%` : "—"} hint={`${sold} of ${capacity} live seats and tickets`} />
      </div>

      <h2>Upcoming events</h2>
      {upcoming.length === 0 ? (
        <EmptyState title="Nothing upcoming" description="Publish an event and it'll show up here." action={<LinkButton href={`/organiser/${organiserId}/events`}>Go to events</LinkButton>} />
      ) : (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Event</th>
                <th>Date</th>
                <th>Status</th>
                <th style={{ minWidth: 150 }}>Sold</th>
              </tr>
            </thead>
            <tbody>
              {upcoming.map((event) => (
                <tr key={event.id}>
                  <td>
                    <Link href={`/organiser/${organiserId}/events/${event.id}`}>{event.title}</Link>
                    <div className="small muted">
                      {event.venue.name}, {event.venue.city}
                    </div>
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>{formatShortDate(event.startsAt)}</td>
                  <td>
                    <Badge tone={statusTone(event.status)}>{statusLabel(event.status)}</Badge>
                  </td>
                  <td>
                    <div className="small" style={{ marginBottom: 4 }}>
                      {event.ticketsSold} / {event.capacity}
                    </div>
                    <Meter value={event.ticketsSold} max={event.capacity} label={`${event.ticketsSold} of ${event.capacity} sold`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
