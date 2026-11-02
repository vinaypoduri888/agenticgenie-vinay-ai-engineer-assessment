import Link from "next/link";
import { formatMinor } from "../../lib/api";
import { Badge } from "./Badge";

export interface EventCardData {
  id: string;
  title: string;
  category?: string | null;
  startsAt: string;
  status?: string;
  venue?: { name: string; city: string } | null;
  venueCity?: string | null;
  minPriceMinor?: number | null;
  availability?: { remaining: number; total: number };
}

// Events have no image field. Rather than fake a photo that doesn't belong to
// the event, each one gets generated art keyed by its id, so it always looks the
// same and nothing is presented as a real picture of it.
const PALETTES: Array<[string, string, string]> = [
  ["#ff5f4e", "#ffb057", "#2a0f14"],
  ["#e0408f", "#7c5cff", "#190f2e"],
  ["#17b7a6", "#3f7bff", "#07202a"],
  ["#f7a93b", "#e5484d", "#2a1309"],
  ["#6c7cff", "#22b8e6", "#0e1533"],
  ["#c04dff", "#ff6a8a", "#210c2c"],
];

export function gradientFor(id: string): string {
  // FNV-1a: ids that share a prefix still land on different palettes.
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619) >>> 0;
  const [first, second, base] = PALETTES[hash % PALETTES.length]!;
  const x = 15 + (hash >>> 3) % 70;
  const y = 10 + (hash >>> 7) % 50;
  return `radial-gradient(90% 110% at ${x}% ${y}%, ${first}, transparent 62%), radial-gradient(80% 100% at ${100 - x}% 100%, ${second}, transparent 58%), ${base}`;
}

export function availabilityLabel(event: Pick<EventCardData, "status" | "availability">): { text: string; tone: "warning" | "danger" } | null {
  if (event.status === "CANCELLED") return { text: "Cancelled", tone: "danger" };
  if (event.status === "SOLD_OUT") return { text: "Sold out", tone: "danger" };
  if (!event.availability || event.availability.total === 0) return null;
  const { remaining, total } = event.availability;
  if (remaining === 0) return { text: "Sold out", tone: "danger" };
  if (remaining <= 10 || remaining / total <= 0.2) return { text: `Only ${remaining} left`, tone: "warning" };
  return null;
}

export function EventCard({ event }: { event: EventCardData }) {
  const city = event.venue?.city ?? event.venueCity;
  const date = new Date(event.startsAt);
  const valid = !Number.isNaN(date.getTime());
  const availability = availabilityLabel(event);

  return (
    <Link href={`/events/${event.id}`} className="event-card">
      <div className="event-card-media" style={{ background: gradientFor(event.id) }}>
        {valid && (
          <div className="date-tile" aria-hidden="true">
            <span>{date.toLocaleDateString("en-IN", { month: "short" })}</span>
            <strong>{date.getDate()}</strong>
          </div>
        )}
        {availability && (
          <div className="event-card-flag">
            <Badge tone={availability.tone}>{availability.text}</Badge>
          </div>
        )}
      </div>
      <div className="event-card-body">
        <div className="event-card-title">{event.title}</div>
        <div className="event-card-meta">
          {valid && <span>{date.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</span>}
          {(event.venue?.name || city) && (
            <span>
              {event.venue?.name ? `${event.venue.name}, ` : ""}
              {city}
            </span>
          )}
        </div>
        <div className="event-card-footer">
          <span className="event-card-price">{event.minPriceMinor != null ? `From ${formatMinor(event.minPriceMinor)}` : "See tickets"}</span>
          {event.category && <span className="event-card-category">{event.category}</span>}
        </div>
      </div>
    </Link>
  );
}
