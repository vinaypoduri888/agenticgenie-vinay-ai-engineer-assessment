"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiFetch, ApiError } from "../../../../lib/api";
import { buttonStyle, cardStyle, errorStyle, inputStyle, mutedStyle } from "../../../../lib/styles";

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
}

export default function OrganiserEventsPage() {
  const { organiserId } = useParams<{ organiserId: string }>();
  const [events, setEvents] = useState<OrganiserEvent[]>([]);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [title, setTitle] = useState("");
  const [venueId, setVenueId] = useState("");
  const [category, setCategory] = useState("comedy");
  const [startsAt, setStartsAt] = useState("");
  const [description, setDescription] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [eventsRes, venuesRes] = await Promise.all([
        apiFetch<{ items: OrganiserEvent[] }>(`/organisers/${organiserId}/events`),
        apiFetch<{ items: Venue[] }>(`/organisers/${organiserId}/venues`),
      ]);
      setEvents(eventsRes.items);
      setVenues(venuesRes.items);
      if (venuesRes.items.length > 0 && !venueId) setVenueId(venuesRes.items[0]!.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load organiser data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organiserId]);

  async function createEvent(e: FormEvent) {
    e.preventDefault();
    setCreateError(null);
    try {
      await apiFetch(`/organisers/${organiserId}/events`, {
        method: "POST",
        body: { title, venueId, category, description, startsAt: new Date(startsAt).toISOString() },
      });
      setTitle("");
      setDescription("");
      await load();
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : "Could not create event.");
    }
  }

  if (loading) return <p>Loading…</p>;
  if (error) return <p style={errorStyle}>{error}</p>;

  return (
    <div>
      <h1>Events</h1>

      {venues.length === 0 ? (
        <p>
          No venues yet — <Link href={`/organiser/${organiserId}/venues`}>create one first</Link>.
        </p>
      ) : (
        <form onSubmit={createEvent} style={cardStyle}>
          <h3>Create event (draft)</h3>
          <input type="text" placeholder="Title" required value={title} onChange={(e) => setTitle(e.target.value)} style={inputStyle} />
          <select value={venueId} onChange={(e) => setVenueId(e.target.value)} style={inputStyle}>
            {venues.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} ({v.city})
              </option>
            ))}
          </select>
          <input type="text" placeholder="Category" value={category} onChange={(e) => setCategory(e.target.value)} style={inputStyle} />
          <input type="datetime-local" required value={startsAt} onChange={(e) => setStartsAt(e.target.value)} style={inputStyle} />
          <textarea placeholder="Description" required value={description} onChange={(e) => setDescription(e.target.value)} style={inputStyle} />
          {createError && <p style={errorStyle}>{createError}</p>}
          <button type="submit" style={buttonStyle}>
            Create draft event
          </button>
        </form>
      )}

      {events.map((event) => (
        <Link key={event.id} href={`/organiser/${organiserId}/events/${event.id}`} style={{ textDecoration: "none", color: "inherit" }}>
          <div style={cardStyle}>
            <strong>{event.title}</strong> <span style={mutedStyle}>{event.status}</span>
            <div style={mutedStyle}>
              {event.venue.name}, {event.venue.city} · {new Date(event.startsAt).toLocaleString()}
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
