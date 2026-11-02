"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "../lib/api";
import { Chip, EmptyState, ErrorBanner, EventCard, Icon, LinkButton, SkeletonCard, type EventCardData, type IconName } from "../components/ui";
import { AssistantPreview } from "../components/marketing/AssistantPreview";
import { SeatField } from "../components/marketing/SeatField";

const CATALOGUE_LIMIT = 50;
const FEATURED_COUNT = 6;

const EXAMPLE_PROMPTS = ["Comedy shows in Pune", "Music events under ₹2,000", "What's on in Mumbai?"];

const POINTS: Array<{ icon: IconName; title: string; body: string }> = [
  { icon: "search", title: "Searches real listings", body: "It uses the same search and availability as the rest of the app, and never invents an event." },
  { icon: "list", title: "Cites what it found", body: "Claims link back to the event or review they came from, and the links are checked in code." },
  { icon: "shield", title: "Books only on your yes", body: "Nothing is charged until you confirm. A vague reply, or an instruction hidden in a review, won't do it." },
];

const STEPS = [
  { n: "01", t: "Describe what you want", d: "City, date, category, budget, in your own words." },
  { n: "02", t: "Discover suitable events", d: "The assistant searches real listings and cites what it found." },
  { n: "03", t: "Reserve tickets", d: "A temporary hold protects your seats while you decide." },
  { n: "04", t: "Confirm securely", d: "Nothing is booked until you give an explicit, unambiguous yes." },
];

const CAPABILITIES: Array<{ icon: IconName; title: string; body: string }> = [
  { icon: "shield", title: "Secure checkout", body: "Every purchase runs through a real inventory hold and payment confirmation step, never a guess." },
  { icon: "clock", title: "Real-time availability", body: "Seat and ticket counts come straight from the database at the moment you look." },
  { icon: "ticket", title: "Transparent ticket information", body: "Prices, venues and dates shown anywhere in the app are the same records the box office uses." },
  { icon: "spark", title: "AI-assisted discovery", body: "Describe what you're looking for in plain language, and the assistant searches real listings." },
  { icon: "check", title: "Grounded answers", body: "Factual claims the assistant makes are tied to a citation you can click through to the source." },
  { icon: "chart", title: "Organiser tools", body: "Venue setup, publishing, sales reporting and check-in, under the same permissions as the API." },
];

function useCatalogue() {
  const [events, setEvents] = useState<EventCardData[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch<{ items: EventCardData[] }>(`/events?limit=${CATALOGUE_LIMIT}`);
        if (!cancelled) setEvents(res.items);
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Could not load events right now.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { events, error };
}

function CountUp({ value }: { value: number }) {
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(value);
      return;
    }
    let frame = 0;
    const started = performance.now();
    function tick(now: number) {
      const progress = Math.min(1, (now - started) / 900);
      setShown(Math.round(value * (1 - Math.pow(1 - progress, 3))));
      if (progress < 1) frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return <>{shown.toLocaleString("en-IN")}</>;
}

function CatalogueStats({ events }: { events: EventCardData[] }) {
  const cities = new Set(events.map((event) => event.venue?.city ?? event.venueCity).filter(Boolean)).size;
  const remaining = events.reduce((total, event) => total + (event.availability?.remaining ?? 0), 0);
  const more = events.length === CATALOGUE_LIMIT ? "+" : "";
  const stats = [
    { label: "Events listed", value: events.length, suffix: more },
    { label: "Cities", value: cities, suffix: more },
    { label: "Tickets left", value: remaining, suffix: more },
  ];

  return (
    <div className="hero-stats">
      {stats.map((stat) => (
        <div key={stat.label} className="hero-stat">
          <strong>
            <CountUp value={stat.value} />
            {stat.suffix}
          </strong>
          <span>{stat.label}</span>
        </div>
      ))}
    </div>
  );
}

export default function HomePage() {
  const router = useRouter();
  const { events, error } = useCatalogue();
  const featured = events?.slice(0, FEATURED_COUNT) ?? null;
  const previewEvent = events?.find((event) => event.status !== "SOLD_OUT" && event.availability?.remaining !== 0);

  return (
    <div className="landing">
      <section className="hero-section">
        <SeatField />
        <div className="hero-inner container">
          <div className="hero-copy">
            <div className="hero-pill">
              <span className="live-dot" aria-hidden="true" />
              Live availability from the box office
            </div>
            <h1 className="display">
              Find the right event. <span className="text-glow">Book it in a conversation.</span>
            </h1>
            <p className="hero-lead">
              A real ticketing platform with an AI assistant that searches live listings, explains what it found, and only
              books once you've said yes.
            </p>
            <div className="hero-cta-row">
              <Link href="/assistant" className="hero-cta hero-cta-primary">
                <span>
                  <strong>Ask the assistant</strong>
                  <small>Describe what you're after</small>
                </span>
                <Icon name="arrow" />
              </Link>
              <Link href="/events" className="hero-cta">
                <span>
                  <strong>Browse the catalogue</strong>
                  <small>Filter by city and date</small>
                </span>
                <Icon name="arrow" />
              </Link>
            </div>
            {events && events.length > 0 && <CatalogueStats events={events} />}
          </div>
        </div>
      </section>

      <section className="section container">
        <div className="section-head-row reveal">
          <div className="section-header">
            <div className="eyebrow section-live">
              <span className="live-dot" aria-hidden="true" />
              Happening now
            </div>
            <h2>On sale, with live availability</h2>
          </div>
          {featured && featured.length > 0 && (
            <LinkButton href="/events" variant="secondary" size="sm">
              See the full catalogue <Icon name="arrow" size={14} />
            </LinkButton>
          )}
        </div>
        {error && <ErrorBanner message={error} />}
        {!error && featured === null && (
          <div className="event-grid">
            {Array.from({ length: 3 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        )}
        {!error && featured !== null && featured.length === 0 && <EmptyState title="No events on sale right now" description="Check back soon." />}
        {!error && featured !== null && featured.length > 0 && (
          <div className="event-grid">
            {featured.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        )}
      </section>

      <section className="section container">
        <div className="preview-layout">
          <div className="reveal">
            <div className="section-header" style={{ marginBottom: 0 }}>
              <div className="eyebrow">The assistant</div>
              <h2>Describe it. Discover it. Book it.</h2>
              <p>It uses the same search, availability and checkout as the rest of the app. It just does the typing for you.</p>
            </div>
            <div className="preview-points">
              {POINTS.map((point) => (
                <div key={point.title} className="preview-point">
                  <Icon name={point.icon} size={20} />
                  <div>
                    <strong>{point.title}</strong>
                    <p>{point.body}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="chip-row preview-prompts">
              {EXAMPLE_PROMPTS.map((prompt) => (
                <Chip key={prompt} onClick={() => router.push(`/assistant?prompt=${encodeURIComponent(prompt)}`)}>
                  {prompt}
                </Chip>
              ))}
            </div>
          </div>
          {previewEvent && (
            <div className="reveal">
              <AssistantPreview event={previewEvent} />
            </div>
          )}
        </div>
      </section>

      <section className="section container">
        <div className="section-header reveal">
          <div className="eyebrow">How it works</div>
          <h2>From a sentence to a seat</h2>
        </div>
        <div className="steps-grid reveal">
          {STEPS.map((step) => (
            <div key={step.n} className="step">
              <div className="step-number">{step.n}</div>
              <h3>{step.t}</h3>
              <p>{step.d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section container">
        <div className="section-header reveal">
          <div className="eyebrow">Under the hood</div>
          <h2>Built on a real ticketing platform</h2>
        </div>
        <div className="bento">
          {CAPABILITIES.map((capability) => (
            <div key={capability.title} className="bento-card reveal">
              <span className="bento-icon">
                <Icon name={capability.icon} size={19} />
              </span>
              <h3>{capability.title}</h3>
              <p>{capability.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="organiser-cta container">
        <div className="organiser-cta-panel reveal">
          <div className="organiser-cta-copy">
            <h2>Running an event?</h2>
            <p>Build a seat map, publish listings, check tickets in at the door and watch sales, with your team on their own roles.</p>
          </div>
          <LinkButton href="/login?next=/organiser" variant="primary">
            Organiser login <Icon name="arrow" size={16} />
          </LinkButton>
        </div>
      </section>

      <footer className="site-footer">
        <div className="footer-grid">
          <div>
            <div className="site-nav-brand" style={{ marginBottom: 12 }}>
              <span className="brand-mark" aria-hidden="true">
                <Icon name="ticket" size={16} />
              </span>
              Agentic Genie
            </div>
            <p style={{ maxWidth: 320, fontSize: "0.9rem" }}>
              A multi-organiser event ticketing platform with an AI assistant for natural-language discovery and booking.
            </p>
          </div>
          <div>
            <div className="footer-heading">Product</div>
            <ul className="footer-links">
              <li><Link href="/events">Discover events</Link></li>
              <li><Link href="/assistant">AI assistant</Link></li>
              <li><Link href="/orders">My tickets</Link></li>
            </ul>
          </div>
          <div>
            <div className="footer-heading">Organisers</div>
            <ul className="footer-links">
              <li><Link href="/organiser">Organiser dashboard</Link></li>
            </ul>
          </div>
          <div>
            <div className="footer-heading">Account</div>
            <ul className="footer-links">
              <li><Link href="/login">Log in</Link></li>
              <li><Link href="/register">Register</Link></li>
            </ul>
          </div>
        </div>
      </footer>
    </div>
  );
}
