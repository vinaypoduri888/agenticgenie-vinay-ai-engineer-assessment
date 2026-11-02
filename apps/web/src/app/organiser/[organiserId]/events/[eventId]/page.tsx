"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiFetch, errorMessage, formatDateTime, formatMinor, statusLabel } from "../../../../../lib/api";
import { Badge, Button, Card, Dialog, ErrorBanner, Field, Meter, Notice, PageHeader, Select, SkeletonCard, Stat, TextInput, statusTone } from "../../../../../components/ui";

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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const [tierName, setTierName] = useState("General Admission");
  const [tierPrice, setTierPrice] = useState(500);
  const [tierQty, setTierQty] = useState(50);
  const [seatSectionId, setSeatSectionId] = useState("");
  const [seatPrice, setSeatPrice] = useState(1000);

  const path = `/organisers/${organiserId}/events/${eventId}`;

  async function load() {
    try {
      const detail = await apiFetch<EventDetail>(path);
      setEvent(detail);
      const venue = await apiFetch<{ sections: Section[] }>(`/organisers/${organiserId}/venues/${detail.venue.id}`);
      setSections(venue.sections);
      setSeatSectionId((current) => current || venue.sections[0]?.id || "");
    } catch (err) {
      setLoadError(errorMessage(err, "Could not load this event."));
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organiserId, eventId]);

  async function act(run: () => Promise<string>) {
    setActionError(null);
    setMessage(null);
    try {
      setMessage(await run());
      await load();
    } catch (err) {
      setActionError(errorMessage(err, "That didn't work."));
    }
  }

  function addTier(e: FormEvent) {
    e.preventDefault();
    act(async () => {
      await apiFetch(`${path}/ticket-tiers`, { method: "POST", body: { name: tierName, priceMinor: Math.round(tierPrice * 100), totalQuantity: tierQty } });
      return `Added ${tierName}.`;
    });
  }

  function generateSeats(e: FormEvent) {
    e.preventDefault();
    act(async () => {
      const result = await apiFetch<{ seatsCreated: number }>(`${path}/seats/generate`, {
        method: "POST",
        body: { sectionPrices: [{ sectionId: seatSectionId, priceMinor: Math.round(seatPrice * 100) }] },
      });
      return `${result.seatsCreated} seats are ready to sell.`;
    });
  }

  const transition = (action: string, done: string) => () =>
    act(async () => {
      await apiFetch(`${path}/${action}`, { method: "POST" });
      return done;
    });

  async function cancelEvent() {
    setConfirmCancel(false);
    await act(async () => {
      const result = await apiFetch<{ refundedOrderCount: number }>(`${path}/cancel`, { method: "POST" });
      return `Event cancelled. ${result.refundedOrderCount} order${result.refundedOrderCount === 1 ? "" : "s"} refunded.`;
    });
  }

  if (loadError) return <ErrorBanner message={loadError} />;
  if (!event) return <SkeletonCard />;

  const tiersTotal = event.tiers.reduce((sum, tier) => sum + tier.totalQuantity, 0);
  const tiersLeft = event.tiers.reduce((sum, tier) => sum + tier.remainingQuantity, 0);
  const capacity = tiersTotal + event.seatAvailability.total;
  const left = tiersLeft + event.seatAvailability.available;
  const editable = event.status === "DRAFT" || event.status === "PUBLISHED";
  const terminal = event.status === "CANCELLED" || event.status === "COMPLETED";

  return (
    <div>
      <p className="small" style={{ marginBottom: 8 }}>
        <Link href={`/organiser/${organiserId}/events`}>← All events</Link>
      </p>
      <PageHeader
        title={event.title}
        description={
          <>
            <Badge tone={statusTone(event.status)}>{statusLabel(event.status)}</Badge> {event.venue.name}, {event.venue.city} · {formatDateTime(event.startsAt)}
          </>
        }
        actions={
          <>
            {event.status === "DRAFT" && <Button onClick={transition("publish", "Event published. It's now visible and on sale.")}>Publish</Button>}
            {event.status === "PUBLISHED" && <Button onClick={transition("on-sale", "Event marked as on sale.")}>Mark on sale</Button>}
            {["PUBLISHED", "ON_SALE", "SOLD_OUT"].includes(event.status) && (
              <Button variant="secondary" onClick={transition("complete", "Event completed. Attendees can now review it.")}>
                Mark completed
              </Button>
            )}
            {!terminal && (
              <Button variant="danger" onClick={() => setConfirmCancel(true)}>
                Cancel event
              </Button>
            )}
          </>
        }
      />

      {message && <Notice tone="success">{message}</Notice>}
      {actionError && <ErrorBanner message={actionError} />}

      <div className="stat-grid">
        <Stat label="Capacity" value={capacity} />
        <Stat label="Still available" value={left} />
        <Stat label="Held or sold" value={capacity - left} />
      </div>

      <Card>
        <h3>Ticket tiers</h3>
        {event.tiers.length === 0 && <p className="muted small">No general-admission tiers yet.</p>}
        {event.tiers.map((tier) => (
          <div key={tier.id} className="tier-list-row">
            <strong style={{ minWidth: 140 }}>{tier.name}</strong>
            <span>{formatMinor(tier.priceMinor)}</span>
            <Meter value={tier.totalQuantity - tier.remainingQuantity} max={tier.totalQuantity} label={`${tier.totalQuantity - tier.remainingQuantity} of ${tier.totalQuantity} taken`} />
            <span className="small muted">
              {tier.remainingQuantity} of {tier.totalQuantity} left
            </span>
          </div>
        ))}
        {editable && (
          <form onSubmit={addTier} className="inline-form" style={{ marginTop: 16 }}>
            <Field label="Name" htmlFor="tier-name">
              <TextInput id="tier-name" required value={tierName} onChange={(e) => setTierName(e.target.value)} style={{ width: 170 }} />
            </Field>
            <Field label="Price (₹)" htmlFor="tier-price">
              <TextInput id="tier-price" type="number" min={0} step="0.01" required value={tierPrice} onChange={(e) => setTierPrice(Number(e.target.value))} style={{ width: 110 }} />
            </Field>
            <Field label="Quantity" htmlFor="tier-qty">
              <TextInput id="tier-qty" type="number" min={1} required value={tierQty} onChange={(e) => setTierQty(Number(e.target.value))} style={{ width: 100 }} />
            </Field>
            <Button type="submit" variant="secondary">
              Add tier
            </Button>
          </form>
        )}
      </Card>

      <Card>
        <h3>Reserved seating</h3>
        {event.seatAvailability.total > 0 ? (
          <p className="muted" style={{ marginBottom: 0 }}>
            {event.seatAvailability.available} available, {event.seatAvailability.held} on hold, {event.seatAvailability.sold} sold, of {event.seatAvailability.total}.
          </p>
        ) : sections.length === 0 ? (
          <p className="muted" style={{ marginBottom: 0 }}>
            This venue has no seat map. <Link href={`/organiser/${organiserId}/venues/${event.venue.id}`} style={{ color: "var(--color-accent-strong)" }}>Build one</Link> to sell reserved seats.
          </p>
        ) : editable ? (
          <form onSubmit={generateSeats} className="inline-form">
            <Field label="Section" htmlFor="seat-section">
              <Select id="seat-section" value={seatSectionId} onChange={(e) => setSeatSectionId(e.target.value)}>
                {sections.map((section) => (
                  <option key={section.id} value={section.id}>
                    {section.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Price per seat (₹)" htmlFor="seat-price">
              <TextInput id="seat-price" type="number" min={0} step="0.01" required value={seatPrice} onChange={(e) => setSeatPrice(Number(e.target.value))} style={{ width: 130 }} />
            </Field>
            <Button type="submit" variant="secondary">
              Sell this section
            </Button>
          </form>
        ) : (
          <p className="muted" style={{ marginBottom: 0 }}>No seats were put on sale for this event.</p>
        )}
      </Card>

      <p className="small" style={{ marginTop: 16 }}>
        <Link href={`/organiser/${organiserId}/orders?event_id=${event.id}`} style={{ color: "var(--color-accent-strong)" }}>See this event's orders</Link>
        {" · "}
        <Link href={`/organiser/${organiserId}/audit?entity=${encodeURIComponent(`Event:${event.id}`)}`} style={{ color: "var(--color-accent-strong)" }}>See its audit trail</Link>
      </p>

      <Dialog open={confirmCancel} title="Cancel this event?" onClose={() => setConfirmCancel(false)}>
        <p>Active holds will be released and every paid order refunded. This can't be undone.</p>
        <div className="dialog-actions">
          <Button variant="ghost" onClick={() => setConfirmCancel(false)}>
            Keep the event
          </Button>
          <Button variant="danger" onClick={cancelEvent}>
            Cancel event and refund
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
