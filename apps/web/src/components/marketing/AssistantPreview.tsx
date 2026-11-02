"use client";

import { useEffect, useState } from "react";
import { formatMinor } from "../../lib/api";
import { Badge, Icon, gradientFor, type EventCardData } from "../ui";

const STAGE_MS = [900, 1000, 1400, 1300, 1700, 1100, 4200];
const LAST_STAGE = STAGE_MS.length - 1;

/**
 * Plays the real booking flow as a short loop, using a real listing's title and
 * price. It's labelled as an example and hidden from assistive tech, which gets
 * the summary in the aria-label instead.
 */
export function AssistantPreview({ event }: { event: EventCardData }) {
  const [stage, setStage] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setStage(LAST_STAGE);
      return;
    }
    const timer = setTimeout(() => setStage((current) => (current >= LAST_STAGE ? 0 : current + 1)), STAGE_MS[stage]);
    return () => clearTimeout(timer);
  }, [stage]);

  const city = event.venue?.city ?? event.venueCity;
  const price = event.minPriceMinor != null ? formatMinor(event.minPriceMinor) : null;
  const date = new Date(event.startsAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

  return (
    <div className="preview-window" role="img" aria-label={`Example conversation: the assistant finds ${event.title}, asks for confirmation, and books it only after the user says yes.`}>
      <div className="preview-bar" aria-hidden="true">
        <Icon name="spark" size={16} />
        Assistant
        <Badge>Example</Badge>
      </div>
      <div className="preview-thread" aria-hidden="true">
        <div className="pv-user">Find me {event.category ?? "something"}{city ? ` in ${city}` : ""}</div>
        {stage >= 1 && (
          <span className="pv-step">
            <Icon name="check" size={13} /> search_events
          </span>
        )}
        {stage >= 2 && <div className="pv-text">Here's one that fits:</div>}
        {stage >= 2 && (
          <div className="pv-event">
            <span className="pv-event-art order-swatch" style={{ background: gradientFor(event.id) }} />
            <span>
              <strong>{event.title}</strong>
              <small>
                {date}
                {city ? ` · ${city}` : ""}
                {price ? ` · From ${price}` : ""}
              </small>
            </span>
          </div>
        )}
        {stage >= 3 && <div className="pv-user">Book it</div>}
        {stage >= 4 && (
          <div className="pv-confirm">
            1 ticket for {event.title}
            {price ? `, ${price} total` : ""}. Confirm?
            <div className="pv-confirm-actions">
              <span>Yes, go ahead</span>
              <span>No, don't</span>
            </div>
          </div>
        )}
        {stage >= 5 && <div className="pv-user">Yes</div>}
        {stage >= 6 && (
          <div className="pv-text pv-done">
            <Icon name="check" size={16} /> Done. Your ticket is in My tickets.
          </div>
        )}
      </div>
    </div>
  );
}
