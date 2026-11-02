"use client";

import { useEffect } from "react";

const SPOTLIT = ".card, .stat, .dashboard-tile, .order-card, .event-card, .booking-panel, .bento-card";

/** The fixed background behind every page, plus the pointer spotlight on cards. */
export function Ambient() {
  useEffect(() => {
    if (!window.matchMedia("(hover: hover)").matches) return;

    function onPointerMove(event: PointerEvent) {
      const card = (event.target as Element | null)?.closest?.<HTMLElement>(SPOTLIT);
      if (!card) return;
      const rect = card.getBoundingClientRect();
      card.style.setProperty("--mx", `${event.clientX - rect.left}px`);
      card.style.setProperty("--my", `${event.clientY - rect.top}px`);
    }

    document.addEventListener("pointermove", onPointerMove, { passive: true });
    return () => document.removeEventListener("pointermove", onPointerMove);
  }, []);

  return (
    <div className="backdrop" aria-hidden="true">
      <i className="backdrop-orb orb-a" />
      <i className="backdrop-orb orb-b" />
      <i className="backdrop-orb orb-c" />
      <div className="backdrop-grid" />
      <div className="backdrop-noise" />
    </div>
  );
}
