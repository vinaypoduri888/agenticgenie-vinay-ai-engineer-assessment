"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { apiFetch, errorMessage, formatShortDate, statusLabel } from "../../../../lib/api";
import { Badge, Button, Chip, Dialog, EmptyState, ErrorBanner, Field, LinkButton, Meter, PageHeader, Select, SkeletonCard, TextArea, TextInput, statusTone } from "../../../../components/ui";

interface Venue {
  id: string;
  name: string;
  city: string;
}

interface OrganiserEvent {
  id: string;
  title: string;
  status: string;
  startsAt: string;
  venue: { name: string; city: string };
  capacity: number;
  ticketsSold: number;
}

const FILTERS = ["ALL", "DRAFT", "PUBLISHED", "ON_SALE", "SOLD_OUT", "COMPLETED", "CANCELLED"];

export default function OrganiserEventsPage() {
  const { organiserId } = useParams<{ organiserId: string }>();
  const router = useRouter();
  const [events, setEvents] = useState<OrganiserEvent[] | null>(null);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("ALL");
  const [creating, setCreating] = useState(false);

  const [title, setTitle] = useState("");
  const [venueId, setVenueId] = useState("");
  const [category, setCategory] = useState("comedy");
  const [startsAt, setStartsAt] = useState("");
  const [description, setDescription] = useState("");
  const [refundHours, setRefundHours] = useState(24);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([apiFetch<{ items: OrganiserEvent[] }>(`/organisers/${organiserId}/events`), apiFetch<{ items: Venue[] }>(`/organisers/${organiserId}/venues`)])
      .then(([eventsRes, venuesRes]) => {
        setEvents(eventsRes.items);
        setVenues(venuesRes.items);
        setVenueId(venuesRes.items[0]?.id ?? "");
      })
      .catch((err) => setError(errorMessage(err, "Could not load events.")));
  }, [organiserId]);

  async function createEvent(e: FormEvent) {
    e.preventDefault();
    setCreateError(null);
    try {
      const created = await apiFetch<{ id: string }>(`/organisers/${organiserId}/events`, {
        method: "POST",
        body: { title, venueId, category, description, startsAt: new Date(startsAt).toISOString(), refundWindowHours: refundHours },
      });
      router.push(`/organiser/${organiserId}/events/${created.id}`);
    } catch (err) {
      setCreateError(errorMessage(err, "Could not create the event."));
    }
  }

  if (error) return <ErrorBanner message={error} />;
  if (!events) return <SkeletonCard />;

  const visible = filter === "ALL" ? events : events.filter((event) => event.status === filter);

  return (
    <div>
      <PageHeader
        title="Events"
        actions={
          venues.length > 0 ? (
            <Button onClick={() => setCreating(true)}>New event</Button>
          ) : (
            <LinkButton href={`/organiser/${organiserId}/venues`}>Create a venue first</LinkButton>
          )
        }
      />

      <div className="chip-row" style={{ marginBottom: 16 }}>
        {FILTERS.map((status) => (
          <Chip key={status} selected={filter === status} onClick={() => setFilter(status)}>
            {status === "ALL" ? `All (${events.length})` : statusLabel(status)}
          </Chip>
        ))}
      </div>

      {visible.length === 0 ? (
        <EmptyState title="No events here" />
      ) : (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Event</th>
                <th>Date</th>
                <th>Status</th>
                <th style={{ minWidth: 140 }}>Sold</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((event) => (
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

      <Dialog open={creating} title="New event" onClose={() => setCreating(false)}>
        <form onSubmit={createEvent}>
          <Field label="Title" htmlFor="ev-title">
            <TextInput id="ev-title" required value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Venue" htmlFor="ev-venue">
            <Select id="ev-venue" value={venueId} onChange={(e) => setVenueId(e.target.value)}>
              {venues.map((venue) => (
                <option key={venue.id} value={venue.id}>
                  {venue.name} ({venue.city})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Category" htmlFor="ev-category">
            <TextInput id="ev-category" required value={category} onChange={(e) => setCategory(e.target.value)} />
          </Field>
          <Field label="Starts at" htmlFor="ev-starts">
            <TextInput id="ev-starts" type="datetime-local" required value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
          </Field>
          <Field label="Refund window (hours before the show)" htmlFor="ev-refund">
            <TextInput id="ev-refund" type="number" min={0} max={720} required value={refundHours} onChange={(e) => setRefundHours(Number(e.target.value))} />
          </Field>
          <Field label="Description" htmlFor="ev-desc">
            <TextArea id="ev-desc" required value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          {createError && <ErrorBanner message={createError} />}
          <div className="dialog-actions">
            <Button type="button" variant="ghost" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button type="submit">Create draft</Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
