"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch, ApiError, formatMinor } from "../../lib/api";
import { cardStyle, errorStyle, inputStyle, mutedStyle } from "../../lib/styles";

interface EventListItem {
  id: string;
  title: string;
  category: string;
  status: string;
  startsAt: string;
  venue: { name: string; city: string };
  minPriceMinor: number | null;
}

export default function EventsPage() {
  const [city, setCity] = useState("");
  const [category, setCategory] = useState("");
  const [q, setQ] = useState("");
  const [items, setItems] = useState<EventListItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load(cursor?: string, append = false) {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (city) params.set("city", city);
      if (category) params.set("category", category);
      if (q) params.set("q", q);
      if (cursor) params.set("cursor", cursor);
      const result = await apiFetch<{ items: EventListItem[]; next_cursor: string | null }>(
        `/events?${params.toString()}`,
      );
      setItems((prev) => (append ? [...prev, ...result.items] : result.items));
      setNextCursor(result.next_cursor);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load events.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    load();
  }

  return (
    <div>
      <h1>Browse events</h1>
      <form onSubmit={handleSearch} style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        <input type="text" placeholder="City" value={city} onChange={(e) => setCity(e.target.value)} style={{ ...inputStyle, width: 140 }} />
        <input type="text" placeholder="Category" value={category} onChange={(e) => setCategory(e.target.value)} style={{ ...inputStyle, width: 140 }} />
        <input type="text" placeholder="Search text" value={q} onChange={(e) => setQ(e.target.value)} style={{ ...inputStyle, width: 200 }} />
        <button type="submit">Search</button>
      </form>

      {loading && items.length === 0 && <p>Loading events…</p>}
      {error && <p style={errorStyle}>{error}</p>}
      {!loading && !error && items.length === 0 && <p>No events match your search.</p>}

      {items.map((event) => (
        <Link key={event.id} href={`/events/${event.id}`} style={{ textDecoration: "none", color: "inherit" }}>
          <div style={cardStyle}>
            <strong>{event.title}</strong>
            <span style={{ marginLeft: 8, ...mutedStyle }}>{event.status}</span>
            <div style={mutedStyle}>
              {event.venue.city} · {event.category} · {new Date(event.startsAt).toLocaleString()}
            </div>
            {event.minPriceMinor !== null && <div>From {formatMinor(event.minPriceMinor)}</div>}
          </div>
        </Link>
      ))}

      {nextCursor && (
        <button onClick={() => load(nextCursor, true)} disabled={loading}>
          {loading ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}
