"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import { apiFetch, ApiError, formatMinor } from "../../../../../lib/api";
import { buttonStyle, cardStyle, errorStyle, inputStyle, mutedStyle, secondaryButtonStyle } from "../../../../../lib/styles";

interface EventDetail {
  id: string;
  title: string;
  status: string;
  startsAt: string;
  venue: { id: string; name: string; city: string };
  tiers: { id: string; name: string; priceMinor: number; totalQuantity: number; remainingQuantity: number }[];
  seatAvailability: { total: number; available: number; held: number; sold: number };
}

interface Section {
  id: string;
  name: string;
}

export default function OrganiserEventDetailPage() {
  const { organiserId, eventId } = useParams<{ organiserId: string; eventId: string }>();
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [tierName, setTierName] = useState("General Admission");
  const [tierPrice, setTierPrice] = useState(50000);
  const [tierQty, setTierQty] = useState(50);
  const [seatSectionId, setSeatSectionId] = useState("");
  const [seatPrice, setSeatPrice] = useState(100000);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const detail = await apiFetch<EventDetail>(`/organisers/${organiserId}/events/${eventId}`);
      setEvent(detail);
      const venue = await apiFetch<{ sections: Section[] }>(`/organisers/${organiserId}/venues/${detail.venue.id}`);
      setSections(venue.sections);
      if (venue.sections.length > 0 && !seatSectionId) setSeatSectionId(venue.sections[0]!.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load event.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organiserId, eventId]);

  async function addTier(e: FormEvent) {
    e.preventDefault();
    setActionError(null);
    try {
      await apiFetch(`/organisers/${organiserId}/events/${eventId}/ticket-tiers`, {
        method: "POST",
        body: { name: tierName, priceMinor: tierPrice, totalQuantity: tierQty },
      });
      setActionMessage("Ticket tier created.");
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not create tier.");
    }
  }

  async function generateSeats(e: FormEvent) {
    e.preventDefault();
    setActionError(null);
    try {
      const result = await apiFetch<{ seatsCreated: number }>(`/organisers/${organiserId}/events/${eventId}/seats/generate`, {
        method: "POST",
        body: { sectionPrices: [{ sectionId: seatSectionId, priceMinor: seatPrice }] },
      });
      setActionMessage(`${result.seatsCreated} seats generated.`);
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not generate seats.");
    }
  }

  async function publish() {
    setActionError(null);
    try {
      await apiFetch(`/organisers/${organiserId}/events/${eventId}/publish`, { method: "POST" });
      setActionMessage("Event published.");
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not publish event.");
    }
  }

  async function cancelEvent() {
    if (!window.confirm("Cancel this event? Active holds will be released and paid orders refunded.")) return;
    setActionError(null);
    try {
      const result = await apiFetch<{ refundedOrderCount: number }>(`/organisers/${organiserId}/events/${eventId}/cancel`, {
        method: "POST",
      });
      setActionMessage(`Event cancelled. ${result.refundedOrderCount} order(s) refunded.`);
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not cancel event.");
    }
  }

  if (loading) return <p>Loading…</p>;
  if (error) return <p style={errorStyle}>{error}</p>;
  if (!event) return null;

  return (
    <div>
      <h1>{event.title}</h1>
      <p style={mutedStyle}>
        Status: {event.status} · {event.venue.name}, {event.venue.city} · {new Date(event.startsAt).toLocaleString()}
      </p>

      <div style={{ marginBottom: 16 }}>
        {event.status === "DRAFT" && (
          <button onClick={publish} style={{ ...buttonStyle, marginRight: 8 }}>
            Publish
          </button>
        )}
        {event.status !== "CANCELLED" && event.status !== "COMPLETED" && (
          <button onClick={cancelEvent} style={secondaryButtonStyle}>
            Cancel event
          </button>
        )}
      </div>
      {actionMessage && <p>{actionMessage}</p>}
      {actionError && <p style={errorStyle}>{actionError}</p>}

      <div style={cardStyle}>
        <h3>Ticket tiers</h3>
        {event.tiers.map((t) => (
          <div key={t.id}>
            {t.name} — {formatMinor(t.priceMinor)} ({t.remainingQuantity}/{t.totalQuantity} remaining)
          </div>
        ))}
        <form onSubmit={addTier} style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input type="text" value={tierName} onChange={(e) => setTierName(e.target.value)} style={{ ...inputStyle, width: 160 }} />
          <input type="number" value={tierPrice} onChange={(e) => setTierPrice(Number(e.target.value))} style={{ ...inputStyle, width: 120 }} placeholder="Price (minor units)" />
          <input type="number" value={tierQty} onChange={(e) => setTierQty(Number(e.target.value))} style={{ ...inputStyle, width: 100 }} placeholder="Quantity" />
          <button type="submit" style={buttonStyle}>
            Add tier
          </button>
        </form>
      </div>

      <div style={cardStyle}>
        <h3>Seated inventory</h3>
        <p style={mutedStyle}>
          {event.seatAvailability.available} available / {event.seatAvailability.total} total (
          {event.seatAvailability.sold} sold)
        </p>
        {sections.length === 0 ? (
          <p style={mutedStyle}>This venue has no seat map yet.</p>
        ) : (
          <form onSubmit={generateSeats} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <select value={seatSectionId} onChange={(e) => setSeatSectionId(e.target.value)} style={inputStyle}>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <input type="number" value={seatPrice} onChange={(e) => setSeatPrice(Number(e.target.value))} style={{ ...inputStyle, width: 140 }} placeholder="Price (minor units)" />
            <button type="submit" style={buttonStyle}>
              Generate seats for this section
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
