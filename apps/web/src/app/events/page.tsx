"use client";

import { Suspense, useEffect, useMemo, useState, type FormEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { apiFetch, errorMessage } from "../../lib/api";
import { Button, Chip, EmptyState, ErrorBanner, EventCard, Icon, PageHeader, SkeletonCard, type EventCardData } from "../../components/ui";

const CITIES = ["Pune", "Mumbai", "Bangalore"];
const CATEGORIES = ["comedy", "music"];
const PRICE_CAPS = [500, 1000, 2000];

type DateRange = "today" | "weekend" | "month";
const DATE_LABELS: Record<DateRange, string> = { today: "Today", weekend: "This weekend", month: "This month" };

function dateBounds(range: DateRange): { from: string; to: string } {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  if (range === "today") {
    end.setDate(end.getDate() + 1);
    return { from: new Date().toISOString(), to: end.toISOString() };
  }
  if (range === "weekend") {
    const untilSaturday = (6 - start.getDay() + 7) % 7;
    start.setDate(start.getDate() + untilSaturday);
    end.setTime(start.getTime());
    end.setDate(end.getDate() + 2);
    return { from: start.toISOString(), to: end.toISOString() };
  }
  end.setMonth(end.getMonth() + 1, 1);
  return { from: new Date().toISOString(), to: end.toISOString() };
}

function EventsPageInner() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const applied = useMemo(
    () => ({
      q: params.get("q") ?? "",
      city: params.get("city") ?? "",
      category: params.get("category") ?? "",
      date: (params.get("date") ?? "") as DateRange | "",
      maxPrice: params.get("max_price") ?? "",
    }),
    [params],
  );

  const [text, setText] = useState(applied.q);
  const [items, setItems] = useState<EventCardData[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters live in the URL, so a filtered list can be shared and survives a reload.
  function setFilters(patch: Partial<Record<"q" | "city" | "category" | "date" | "max_price", string>>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }

  async function load(cursor?: string) {
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ limit: "12" });
      if (applied.q) query.set("q", applied.q);
      if (applied.city) query.set("city", applied.city);
      if (applied.category) query.set("category", applied.category);
      if (applied.maxPrice) query.set("max_price", applied.maxPrice);
      if (applied.date) {
        const { from, to } = dateBounds(applied.date);
        query.set("from", from);
        query.set("to", to);
      }
      if (cursor) query.set("cursor", cursor);
      const result = await apiFetch<{ items: EventCardData[]; next_cursor: string | null }>(`/events?${query}`);
      setItems((previous) => (cursor ? [...previous, ...result.items] : result.items));
      setNextCursor(result.next_cursor);
    } catch (err) {
      setError(errorMessage(err, "Could not load events."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applied]);

  function submitSearch(e: FormEvent) {
    e.preventDefault();
    setFilters({ q: text.trim() });
  }

  const anyFilter = Boolean(applied.q || applied.city || applied.category || applied.date || applied.maxPrice);

  return (
    <div>
      <PageHeader title="Discover events" description="Comedy, music and more across India, with live availability." />

      <form className="search-bar" onSubmit={submitSearch} role="search">
        <label className="search-bar-field">
          <Icon name="search" />
          <span className="visually-hidden">Search events</span>
          <input type="search" placeholder="Search by name or description" value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <label className="search-bar-field search-bar-city">
          <Icon name="pin" />
          <span className="visually-hidden">City</span>
          <select value={applied.city} onChange={(e) => setFilters({ city: e.target.value })}>
            <option value="">All cities</option>
            {CITIES.map((city) => (
              <option key={city} value={city}>
                {city}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit">Search</Button>
      </form>

      <div className="chip-row browse-filters">
        {(Object.keys(DATE_LABELS) as DateRange[]).map((range) => (
          <Chip key={range} selected={applied.date === range} onClick={() => setFilters({ date: applied.date === range ? "" : range })}>
            {DATE_LABELS[range]}
          </Chip>
        ))}
        <span className="chip-divider" aria-hidden="true" />
        {CATEGORIES.map((category) => (
          <Chip key={category} selected={applied.category === category} onClick={() => setFilters({ category: applied.category === category ? "" : category })}>
            {category.charAt(0).toUpperCase() + category.slice(1)}
          </Chip>
        ))}
        <span className="chip-divider" aria-hidden="true" />
        {PRICE_CAPS.map((cap) => (
          <Chip key={cap} selected={applied.maxPrice === String(cap)} onClick={() => setFilters({ max_price: applied.maxPrice === String(cap) ? "" : String(cap) })}>
            Under ₹{cap.toLocaleString("en-IN")}
          </Chip>
        ))}
        {anyFilter && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setText("");
              router.replace(pathname, { scroll: false });
            }}
          >
            Clear all
          </Button>
        )}
      </div>

      {error && <ErrorBanner message={error} />}

      {loading && items.length === 0 && !error && (
        <div className="event-grid">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      )}

      {!loading && !error && items.length === 0 && (
        <EmptyState
          title="No events match"
          description={anyFilter ? "Try fewer filters, or a different city." : "Nothing is on sale right now. Check back soon."}
          action={
            anyFilter ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setText("");
                  router.replace(pathname, { scroll: false });
                }}
              >
                Clear filters
              </Button>
            ) : undefined
          }
        />
      )}

      {items.length > 0 && (
        <div className="event-grid" aria-busy={loading}>
          {items.map((event) => (
            <EventCard key={event.id} event={event} />
          ))}
        </div>
      )}

      {nextCursor && (
        <div style={{ marginTop: 32, textAlign: "center" }}>
          <Button variant="secondary" onClick={() => load(nextCursor)} disabled={loading}>
            {loading ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}
    </div>
  );
}

export default function EventsPage() {
  return (
    <Suspense fallback={<SkeletonCard />}>
      <EventsPageInner />
    </Suspense>
  );
}
