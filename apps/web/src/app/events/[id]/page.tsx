"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { apiFetch, ApiError, formatMinor } from "../../../lib/api";
import { useSession } from "../../../lib/useSession";
import { buttonStyle, cardStyle, errorStyle, inputStyle, mutedStyle, secondaryButtonStyle } from "../../../lib/styles";

interface EventDetail {
  id: string;
  title: string;
  description: string;
  category: string;
  status: string;
  startsAt: string;
  venue: { id: string; name: string; address: string; city: string };
  tiers: { id: string; name: string; priceMinor: number; remainingQuantity: number }[];
  seatAvailability: { total: number; available: number; held: number; sold: number };
}

interface SeatRow {
  id: string;
  status: string;
  priceMinor: number;
  section: string;
  row: string;
  seat: string;
}

interface Review {
  id: string;
  rating: number;
  text: string;
  createdAt: string;
}

export default function EventDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useSession();
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [seats, setSeats] = useState<SeatRow[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [selectedTier, setSelectedTier] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [selectedSeatIds, setSelectedSeatIds] = useState<string[]>([]);
  const [hold, setHold] = useState<{ id: string; expiresAt: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [reviewRating, setReviewRating] = useState(5);
  const [reviewText, setReviewText] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const detail = await apiFetch<EventDetail>(`/events/${params.id}`);
      setEvent(detail);
      if (detail.seatAvailability.total > 0) {
        const seatList = await apiFetch<{ items: SeatRow[] }>(`/events/${params.id}/seats`);
        setSeats(seatList.items);
      }
      const reviewList = await apiFetch<{ items: Review[] }>(`/events/${params.id}/reviews`);
      setReviews(reviewList.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load this event.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  function toggleSeat(seatId: string) {
    setSelectedSeatIds((prev) => (prev.includes(seatId) ? prev.filter((s) => s !== seatId) : [...prev, seatId]));
  }

  async function createHold() {
    if (!user) {
      router.push("/login");
      return;
    }
    setActionError(null);
    setActionMessage(null);
    setBusy(true);
    try {
      const body =
        selectedSeatIds.length > 0
          ? { eventId: params.id, seatIds: selectedSeatIds }
          : { eventId: params.id, tierId: selectedTier, quantity };
      const result = await apiFetch<{ id: string; expiresAt: string }>("/holds", {
        method: "POST",
        body,
        idempotencyKey: crypto.randomUUID(),
      });
      setHold(result);
      setActionMessage(`Hold created — expires at ${new Date(result.expiresAt).toLocaleTimeString()}.`);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not create a hold.");
    } finally {
      setBusy(false);
    }
  }

  async function releaseHold() {
    if (!hold) return;
    setBusy(true);
    try {
      await apiFetch(`/holds/${hold.id}`, { method: "DELETE" });
      setHold(null);
      setActionMessage("Hold released.");
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not release the hold.");
    } finally {
      setBusy(false);
    }
  }

  async function completeCheckout() {
    if (!hold) return;
    setActionError(null);
    setBusy(true);
    try {
      const order = await apiFetch<{ id: string; status: string; message?: string }>("/orders", {
        method: "POST",
        body: { holdId: hold.id },
        idempotencyKey: crypto.randomUUID(),
      });
      if (order.status === "PAID") {
        setActionMessage("Payment succeeded — tickets issued. See My Orders for details.");
      } else if (order.status === "PENDING_PAYMENT") {
        setActionMessage(order.message ?? "Payment is still being confirmed — check My Orders shortly.");
      } else {
        setActionMessage(`Order status: ${order.status}.`);
      }
      setHold(null);
      await load();
    } catch (err) {
      // Never claim success on error — surface the server's actual reason.
      setActionError(err instanceof ApiError ? `Checkout failed: ${err.message}` : "Checkout failed.");
    } finally {
      setBusy(false);
    }
  }

  async function submitReview(e: React.FormEvent) {
    e.preventDefault();
    if (!user) {
      router.push("/login");
      return;
    }
    setActionError(null);
    try {
      await apiFetch(`/events/${params.id}/reviews`, {
        method: "POST",
        body: { rating: reviewRating, text: reviewText },
      });
      setReviewText("");
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not submit review.");
    }
  }

  if (loading) return <p>Loading…</p>;
  if (error) return <p style={errorStyle}>{error}</p>;
  if (!event) return null;

  return (
    <div>
      <h1>{event.title}</h1>
      <p style={mutedStyle}>
        {event.venue.name}, {event.venue.city} · {event.category} · {new Date(event.startsAt).toLocaleString()} ·{" "}
        status: {event.status}
      </p>
      <p>{event.description}</p>

      {event.tiers.length > 0 && (
        <div style={cardStyle}>
          <h3>Tickets (General Admission)</h3>
          {event.tiers.map((tier) => (
            <div key={tier.id} style={{ marginBottom: 8 }}>
              <label>
                <input
                  type="radio"
                  name="tier"
                  checked={selectedTier === tier.id}
                  onChange={() => {
                    setSelectedTier(tier.id);
                    setSelectedSeatIds([]);
                  }}
                />{" "}
                {tier.name} — {formatMinor(tier.priceMinor)} ({tier.remainingQuantity} left)
              </label>
            </div>
          ))}
          {selectedTier && (
            <label>
              Quantity:{" "}
              <input
                type="number"
                min={1}
                max={8}
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
                style={{ width: 60 }}
              />
            </label>
          )}
        </div>
      )}

      {seats.length > 0 && (
        <div style={cardStyle}>
          <h3>Seats</h3>
          <p style={mutedStyle}>
            {event.seatAvailability.available} available / {event.seatAvailability.total} total
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {seats.map((s) => (
              <button
                key={s.id}
                disabled={s.status !== "AVAILABLE"}
                onClick={() => toggleSeat(s.id)}
                style={{
                  padding: "6px 10px",
                  border: "1px solid #999",
                  borderRadius: 4,
                  background: selectedSeatIds.includes(s.id) ? "#111" : s.status === "AVAILABLE" ? "#fff" : "#eee",
                  color: selectedSeatIds.includes(s.id) ? "#fff" : "#111",
                  cursor: s.status === "AVAILABLE" ? "pointer" : "not-allowed",
                }}
                title={`${s.section} Row ${s.row} Seat ${s.seat} — ${formatMinor(s.priceMinor)}`}
              >
                {s.row}
                {s.seat}
              </button>
            ))}
          </div>
        </div>
      )}

      {!hold ? (
        (selectedTier || selectedSeatIds.length > 0) && (
          <button onClick={createHold} disabled={busy} style={buttonStyle}>
            {busy ? "Holding…" : "Hold selection"}
          </button>
        )
      ) : (
        <div style={cardStyle}>
          <p>Hold active — expires at {new Date(hold.expiresAt).toLocaleTimeString()}.</p>
          <button onClick={completeCheckout} disabled={busy} style={{ ...buttonStyle, marginRight: 8 }}>
            {busy ? "Processing…" : "Confirm and pay"}
          </button>
          <button onClick={releaseHold} disabled={busy} style={secondaryButtonStyle}>
            Release hold
          </button>
        </div>
      )}
      {actionMessage && <p>{actionMessage}</p>}
      {actionError && <p style={errorStyle}>{actionError}</p>}

      <h3 style={{ marginTop: 32 }}>Reviews</h3>
      {reviews.length === 0 && <p style={mutedStyle}>No reviews yet.</p>}
      {reviews.map((r) => (
        <div key={r.id} style={cardStyle}>
          <strong>{"★".repeat(r.rating)}</strong>
          <p>{r.text}</p>
        </div>
      ))}
      {event.status === "COMPLETED" && user && (
        <form onSubmit={submitReview} style={cardStyle}>
          <h4>Leave a review</h4>
          <label>
            Rating:{" "}
            <select value={reviewRating} onChange={(e) => setReviewRating(Number(e.target.value))}>
              {[5, 4, 3, 2, 1].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <textarea
            required
            value={reviewText}
            onChange={(e) => setReviewText(e.target.value)}
            placeholder="Your review"
            style={{ ...inputStyle, minHeight: 60, marginTop: 8 }}
          />
          <button type="submit" style={{ ...buttonStyle, marginTop: 8 }}>
            Submit review
          </button>
        </form>
      )}
    </div>
  );
}
