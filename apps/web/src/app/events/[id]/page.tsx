"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { apiFetch, ApiError, errorMessage, formatDateTime, formatMinor, statusLabel } from "../../../lib/api";
import { useSession } from "../../../lib/useSession";
import { Badge, Button, EmptyState, ErrorBanner, Field, Icon, LinkButton, MetaRow, Notice, Select, Skeleton, TextArea, gradientFor, statusTone } from "../../../components/ui";

const MAX_TICKETS = 8;

interface EventDetail {
  id: string;
  title: string;
  description: string;
  category: string;
  status: string;
  startsAt: string;
  refundWindowHours: number;
  organiser?: { id: string; name: string };
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

interface ActiveHold {
  id: string;
  kind: "GA" | "SEATED";
  expiresAt: string;
  quantity: number;
  totalMinor: number;
  label: string;
}

interface PaidOrder {
  id: string;
  status: string;
  tickets?: { id: string; code: string }[];
  message?: string;
}

type PaymentOutcome = "success" | "decline" | "timeout_then_success" | "timeout_then_decline";

function useCountdown(expiresAt: string | undefined) {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!expiresAt) {
      setSecondsLeft(null);
      return;
    }
    const target = new Date(expiresAt).getTime();
    const tick = () => setSecondsLeft(Math.max(0, Math.round((target - Date.now()) / 1000)));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);
  return secondsLeft;
}

function SeatMap({ seats, selected, onToggle }: { seats: SeatRow[]; selected: string[]; onToggle: (id: string) => void }) {
  const sections = useMemo(() => {
    const grouped = new Map<string, Map<string, SeatRow[]>>();
    const inOrder = [...seats].sort(
      (a, b) => a.row.localeCompare(b.row, undefined, { numeric: true }) || a.seat.localeCompare(b.seat, undefined, { numeric: true }),
    );
    for (const seat of inOrder) {
      const rows = grouped.get(seat.section) ?? new Map<string, SeatRow[]>();
      rows.set(seat.row, [...(rows.get(seat.row) ?? []), seat]);
      grouped.set(seat.section, rows);
    }
    return [...grouped.entries()];
  }, [seats]);

  return (
    <div>
      <div className="seat-stage" aria-hidden="true">
        STAGE
      </div>
      {sections.map(([section, rows]) => (
        <div key={section} className="seat-section">
          <div className="seat-section-name">{section}</div>
          {[...rows.entries()].map(([row, rowSeats]) => (
            <div key={row} className="seat-row">
              <span className="seat-row-label">{row}</span>
              {rowSeats.map((seat) => {
                const isSelected = selected.includes(seat.id);
                const available = seat.status === "AVAILABLE";
                return (
                  <button
                    key={seat.id}
                    type="button"
                    className={`seat${isSelected ? " selected" : ""}`}
                    disabled={!available || (!isSelected && selected.length >= MAX_TICKETS)}
                    aria-pressed={isSelected}
                    aria-label={`${section}, row ${row}, seat ${seat.seat}, ${formatMinor(seat.priceMinor)}${available ? "" : ", unavailable"}`}
                    title={`Row ${row} Seat ${seat.seat}, ${formatMinor(seat.priceMinor)}`}
                    onClick={() => onToggle(seat.id)}
                  >
                    {seat.seat}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      ))}
      <div className="seat-legend">
        <span>
          <i /> Available
        </span>
        <span>
          <i className="is-selected" /> Selected
        </span>
        <span>
          <i className="is-taken" /> Taken
        </span>
      </div>
    </div>
  );
}

export default function EventDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useSession();
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [seats, setSeats] = useState<SeatRow[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedTier, setSelectedTier] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [selectedSeats, setSelectedSeats] = useState<string[]>([]);
  const [hold, setHold] = useState<ActiveHold | null>(null);
  const [order, setOrder] = useState<PaidOrder | null>(null);
  const [outcome, setOutcome] = useState<PaymentOutcome>("success");
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // One key per logical checkout, kept across retries: a timed-out attempt must
  // retry under the same key, or the server can't tell it's the same payment.
  const checkoutKey = useRef<string | null>(null);
  const [paymentPending, setPaymentPending] = useState(false);

  const [reviewRating, setReviewRating] = useState(5);
  const [reviewText, setReviewText] = useState("");
  const [reviewError, setReviewError] = useState<string | null>(null);

  const secondsLeft = useCountdown(hold?.expiresAt);

  async function load() {
    setLoadError(null);
    try {
      const detail = await apiFetch<EventDetail>(`/events/${params.id}`);
      setEvent(detail);
      if (detail.seatAvailability.total > 0) {
        const seatList = await apiFetch<{ items: SeatRow[] }>(`/events/${params.id}/seats`);
        setSeats(seatList.items);
      }
      const reviewList = await apiFetch<{ items: Review[] }>(`/events/${params.id}/reviews?limit=50`);
      setReviews(reviewList.items);
    } catch (err) {
      setLoadError(errorMessage(err, "Could not load this event."));
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  // A hold survives a reload on the server, so the page has to pick it up again.
  useEffect(() => {
    if (!user) return;
    apiFetch<{ items: ActiveHold[] }>(`/holds?event_id=${params.id}`)
      .then((res) => setHold(res.items[0] ?? null))
      .catch(() => undefined);
  }, [user, params.id]);

  useEffect(() => {
    if (secondsLeft === 0 && hold) {
      setHold(null);
      setPaymentPending(false);
      checkoutKey.current = null;
      setNotice("Your hold expired, so those tickets went back on sale.");
      load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft]);

  function selectTier(id: string) {
    setSelectedTier(id);
    setSelectedSeats([]);
    setQuantity(1);
  }

  function toggleSeat(id: string) {
    setSelectedTier("");
    setSelectedSeats((previous) => (previous.includes(id) ? previous.filter((seat) => seat !== id) : [...previous, id]));
  }

  const tier = event?.tiers.find((t) => t.id === selectedTier);
  const seatTotal = selectedSeats.reduce((sum, id) => sum + (seats.find((s) => s.id === id)?.priceMinor ?? 0), 0);
  const selectionTotal = selectedSeats.length > 0 ? seatTotal : tier ? tier.priceMinor * quantity : 0;
  const selectionCount = selectedSeats.length > 0 ? selectedSeats.length : tier ? quantity : 0;

  const allPrices = [...(event?.tiers.map((t) => t.priceMinor) ?? []), ...seats.map((s) => s.priceMinor)];
  const fromPrice = allPrices.length > 0 ? Math.min(...allPrices) : null;
  const canBuy = event?.status === "PUBLISHED" || event?.status === "ON_SALE";

  const average = reviews.length > 0 ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length : 0;

  async function createHold() {
    if (!user) {
      router.push(`/login?next=${encodeURIComponent(`/events/${params.id}`)}`);
      return;
    }
    setActionError(null);
    setNotice(null);
    setBusy(true);
    try {
      const body = selectedSeats.length > 0 ? { eventId: params.id, seatIds: selectedSeats } : { eventId: params.id, tierId: selectedTier, quantity };
      await apiFetch("/holds", { method: "POST", body, idempotencyKey: crypto.randomUUID() });
      const active = await apiFetch<{ items: ActiveHold[] }>(`/holds?event_id=${params.id}`);
      setHold(active.items[0] ?? null);
      setSelectedSeats([]);
      setSelectedTier("");
      checkoutKey.current = null;
    } catch (err) {
      setActionError(errorMessage(err, "Could not hold those tickets."));
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function releaseHold() {
    if (!hold) return;
    setBusy(true);
    setActionError(null);
    try {
      await apiFetch(`/holds/${hold.id}`, { method: "DELETE" });
      setHold(null);
      checkoutKey.current = null;
      setPaymentPending(false);
      setNotice("Hold released.");
      await load();
    } catch (err) {
      setActionError(errorMessage(err, "Could not release the hold."));
    } finally {
      setBusy(false);
    }
  }

  async function pay() {
    if (!hold) return;
    setActionError(null);
    setNotice(null);
    setBusy(true);
    checkoutKey.current ??= crypto.randomUUID();
    try {
      const result = await apiFetch<PaidOrder>("/orders", {
        method: "POST",
        body: { holdId: hold.id },
        idempotencyKey: checkoutKey.current,
        headers: { "X-Payment-Scenario": outcome },
      });
      if (result.status === "PENDING_PAYMENT") {
        setPaymentPending(true);
        return;
      }
      setPaymentPending(false);
      setHold(null);
      checkoutKey.current = null;
      if (result.status === "PAID") setOrder(result);
      else setNotice(result.message ?? `Order status: ${statusLabel(result.status)}.`);
      await load();
    } catch (err) {
      if (err instanceof ApiError && err.status === 402) {
        // A clean decline: nothing charged, the hold is intact, a retry is a new payment.
        checkoutKey.current = null;
        setPaymentPending(false);
        setActionError("Your payment was declined and nothing was charged. Your hold is still active, so you can try again.");
      } else if (err instanceof ApiError && err.code === "REQUEST_IN_PROGRESS") {
        setPaymentPending(true);
      } else {
        checkoutKey.current = null;
        setPaymentPending(false);
        setActionError(errorMessage(err, "Checkout failed."));
        if (err instanceof ApiError && err.status === 409) {
          setHold(null);
          await load();
        }
      }
    } finally {
      setBusy(false);
    }
  }

  async function submitReview(e: FormEvent) {
    e.preventDefault();
    setReviewError(null);
    try {
      await apiFetch(`/events/${params.id}/reviews`, { method: "POST", body: { rating: reviewRating, text: reviewText } });
      setReviewText("");
      await load();
    } catch (err) {
      setReviewError(errorMessage(err, "Could not submit your review."));
    }
  }

  if (loadError) {
    return <EmptyState title="We couldn't show this event" description={loadError} action={<LinkButton href="/events" variant="secondary">Back to all events</LinkButton>} />;
  }
  if (!event) {
    return (
      <div>
        <Skeleton height={190} style={{ marginBottom: 20 }} />
        <Skeleton height={32} width="55%" style={{ marginBottom: 12 }} />
        <Skeleton height={16} width="35%" />
      </div>
    );
  }

  const start = new Date(event.startsAt);
  const refundDeadline = new Date(start.getTime() - event.refundWindowHours * 3_600_000);
  const refundOpen = refundDeadline > new Date();
  const urgent = secondsLeft !== null && secondsLeft <= 60;
  const step = order ? 3 : hold ? 2 : 1;

  return (
    <div className="event-layout">
      <div>
        <div className="event-hero" style={{ background: gradientFor(event.id) }}>
          <div className="date-tile" aria-hidden="true">
            <span>{start.toLocaleDateString("en-IN", { month: "short" })}</span>
            <strong>{start.getDate()}</strong>
          </div>
        </div>

        <div className="event-title-row">
          <h1>{event.title}</h1>
          <Badge tone={statusTone(event.status)}>{statusLabel(event.status)}</Badge>
        </div>

        <div className="meta-list">
          <MetaRow icon="calendar">{formatDateTime(event.startsAt)}</MetaRow>
          <MetaRow icon="pin">
            {event.venue.name}, {event.venue.city}
            <small>{event.venue.address}</small>
          </MetaRow>
          {event.organiser && <MetaRow icon="users">Presented by {event.organiser.name}</MetaRow>}
        </div>

        <section className="event-section">
          <h2>About this event</h2>
          <p className="event-description">{event.description}</p>
        </section>

        {seats.length > 0 && (
          <section className="event-section">
            <h2>Choose your seats</h2>
            <p className="small muted">
              {event.seatAvailability.available} of {event.seatAvailability.total} available. Up to {MAX_TICKETS} per person.
            </p>
            {canBuy ? <SeatMap seats={seats} selected={selectedSeats} onToggle={toggleSeat} /> : <p className="muted">Seats aren't on sale for this event.</p>}
          </section>
        )}

        <section className="event-section">
          <h2>Cancellation policy</h2>
          <p className="muted" style={{ margin: 0 }}>
            {refundOpen
              ? `Free cancellation until ${formatDateTime(refundDeadline.toISOString())}, ${event.refundWindowHours} hours before the show.`
              : "The refund window for this event has closed."}
          </p>
        </section>

        <section className="event-section">
          <h2>Reviews</h2>
          {reviews.length === 0 ? (
            <p className="muted">No reviews yet.</p>
          ) : (
            <>
              <div className="rating-summary">
                <strong>{average.toFixed(1)}</strong>
                <span className="muted small">
                  out of 5, from {reviews.length} review{reviews.length === 1 ? "" : "s"}
                </span>
              </div>
              {reviews.map((review) => (
                <article key={review.id} className="review">
                  <div className="stars" role="img" aria-label={`${review.rating} out of 5 stars`}>
                    {"★".repeat(review.rating)}
                    {"☆".repeat(5 - review.rating)}
                  </div>
                  <p>{review.text}</p>
                </article>
              ))}
            </>
          )}
          {event.status === "COMPLETED" && user && (
            <form onSubmit={submitReview} style={{ marginTop: 24 }}>
              <h3>Were you there? Leave a review</h3>
              <div className="star-input" role="radiogroup" aria-label="Your rating">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" className={n <= reviewRating ? "on" : ""} role="radio" aria-checked={n === reviewRating} aria-label={`${n} star${n === 1 ? "" : "s"}`} onClick={() => setReviewRating(n)}>
                    <Icon name="star" size={22} />
                  </button>
                ))}
              </div>
              <Field label="Your review" htmlFor="review-text">
                <TextArea id="review-text" required value={reviewText} onChange={(e) => setReviewText(e.target.value)} style={{ minHeight: 80 }} />
              </Field>
              {reviewError && <ErrorBanner message={reviewError} />}
              <Button type="submit" variant="secondary" disabled={!reviewText.trim()}>
                Post review
              </Button>
            </form>
          )}
        </section>
      </div>

      <aside className="booking-panel" aria-label="Book tickets">
        <ol className="booking-steps" aria-label="Booking progress">
          {["Choose", "Pay", "Done"].map((label, index) => (
            <li key={label} className={index + 1 === step ? "current" : index + 1 < step ? "done" : ""} aria-current={index + 1 === step ? "step" : undefined}>
              {label}
            </li>
          ))}
        </ol>

        {order ? (
          <>
            <Notice tone="success">
              <strong>You're going!</strong> Payment succeeded and your tickets are ready.
            </Notice>
            <div className="stack small">
              {order.tickets?.map((ticket) => (
                <code key={ticket.id} style={{ wordBreak: "break-all" }}>
                  {ticket.code}
                </code>
              ))}
            </div>
            <div className="stack" style={{ marginTop: 16 }}>
              <LinkButton href="/orders" block>
                See my tickets
              </LinkButton>
              <Button variant="ghost" block onClick={() => setOrder(null)}>
                Book more
              </Button>
            </div>
          </>
        ) : hold ? (
          <>
            <div className={`hold-timer${urgent ? " urgent" : ""}`} role="timer">
              <span>Held for you</span>
              <strong>
                {secondsLeft !== null ? `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}` : ""}
              </strong>
            </div>
            <div className="booking-row">
              <span>{hold.kind === "GA" ? `${hold.quantity} × ${hold.label}` : hold.label}</span>
            </div>
            <div className="booking-row booking-total">
              <span>Total</span>
              <span>{formatMinor(hold.totalMinor)}</span>
            </div>

            {paymentPending ? (
              <Notice tone="warning">
                <strong>Confirming your payment.</strong> The payment provider hasn't answered yet. You won't be charged twice. Check again in about 30 seconds.
              </Notice>
            ) : (
              <Field label="Payment outcome (demo)" htmlFor="payment-outcome" hint="This app uses a fake payment provider, so you pick what happens.">
                <Select id="payment-outcome" value={outcome} onChange={(e) => setOutcome(e.target.value as PaymentOutcome)}>
                  <option value="success">Succeeds</option>
                  <option value="decline">Is declined</option>
                  <option value="timeout_then_success">Times out, then succeeds</option>
                  <option value="timeout_then_decline">Times out, then is declined</option>
                </Select>
              </Field>
            )}

            {actionError && <ErrorBanner message={actionError} />}
            {notice && <Notice>{notice}</Notice>}

            <div className="stack">
              <Button block onClick={pay} disabled={busy}>
                {busy ? "Processing…" : paymentPending ? "Check payment status" : `Pay ${formatMinor(hold.totalMinor)}`}
              </Button>
              <Button variant="ghost" block onClick={releaseHold} disabled={busy || paymentPending}>
                Release hold
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="booking-from">From</div>
            <div className="booking-price">{fromPrice !== null ? formatMinor(fromPrice) : "—"}</div>

            {!canBuy && <Notice tone="warning">Tickets aren't on sale: this event is {statusLabel(event.status).toLowerCase()}.</Notice>}

            {canBuy &&
              event.tiers.map((option) => (
                <button key={option.id} type="button" className={`tier-option${selectedTier === option.id ? " selected" : ""}`} aria-pressed={selectedTier === option.id} disabled={option.remainingQuantity === 0} onClick={() => selectTier(option.id)}>
                  <span>
                    <span className="tier-name">{option.name}</span>
                    <br />
                    <span className="tier-left">{option.remainingQuantity === 0 ? "Sold out" : `${option.remainingQuantity} left`}</span>
                  </span>
                  <span className="tier-price">{formatMinor(option.priceMinor)}</span>
                </button>
              ))}

            {canBuy && seats.length > 0 && selectedSeats.length === 0 && <p className="small muted">Pick seats from the map to continue.</p>}

            {tier && (
              <div className="booking-row">
                <span>Tickets</span>
                <span className="stepper">
                  <button type="button" aria-label="Fewer tickets" disabled={quantity <= 1} onClick={() => setQuantity(quantity - 1)}>
                    −
                  </button>
                  <output aria-live="polite">{quantity}</output>
                  <button type="button" aria-label="More tickets" disabled={quantity >= Math.min(MAX_TICKETS, tier.remainingQuantity)} onClick={() => setQuantity(quantity + 1)}>
                    +
                  </button>
                </span>
              </div>
            )}

            {selectionCount > 0 && (
              <div className="booking-row booking-total">
                <span>
                  {selectionCount} ticket{selectionCount === 1 ? "" : "s"}
                </span>
                <span>{formatMinor(selectionTotal)}</span>
              </div>
            )}

            {actionError && <ErrorBanner message={actionError} />}
            {notice && <Notice>{notice}</Notice>}

            {canBuy && (
              <div className="stack" style={{ marginTop: 12 }}>
                <Button block onClick={createHold} disabled={busy || selectionCount === 0}>
                  {busy ? "Holding…" : user === null ? "Log in to book" : "Hold my tickets"}
                </Button>
              </div>
            )}

            <div className="booking-assurance">
              <Icon name="shield" size={16} />
              <span>We hold your tickets for 10 minutes while you pay, and they can't be sold to anyone else.</span>
            </div>
            <div className="booking-assurance">
              <Icon name="spark" size={16} />
              <span>
                Prefer to ask? <Link href={`/assistant?prompt=${encodeURIComponent(`Tell me about ${event.title}`)}`} style={{ color: "var(--color-accent-strong)" }}>Book through the assistant</Link>.
              </span>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
