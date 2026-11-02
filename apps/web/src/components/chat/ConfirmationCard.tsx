"use client";

import { useEffect, useState } from "react";
import { Button } from "../ui";
import type { PendingConfirmationSummary } from "./types";

const ACTION_LABEL: Record<string, string> = {
  purchase: "Confirm purchase",
  cancel_order: "Confirm cancellation",
};

/**
 * This card executes nothing itself. Its buttons send the same plain reply a
 * person would type, as their next message. The server checks that message
 * against what it recorded as pending, so there is no confirm endpoint for the
 * UI, or anyone else, to call directly.
 */
export function ConfirmationCard({ pending, disabled, onRespond }: { pending: PendingConfirmationSummary; disabled?: boolean; onRespond: (reply: "Yes" | "No") => void }) {
  const [secondsLeft, setSecondsLeft] = useState(() => Math.round((new Date(pending.expiresAt).getTime() - Date.now()) / 1000));

  useEffect(() => {
    const interval = setInterval(() => setSecondsLeft(Math.round((new Date(pending.expiresAt).getTime() - Date.now()) / 1000)), 1000);
    return () => clearInterval(interval);
  }, [pending.expiresAt]);

  const expired = secondsLeft <= 0;

  return (
    <div className="confirm-card">
      <div className="confirm-card-label">{ACTION_LABEL[pending.toolName] ?? "Please confirm"}</div>
      <p>{pending.summary.replace(/\s*Reply YES to confirm\.?$/i, "")}</p>
      <div className="confirm-actions">
        <Button size="sm" disabled={disabled || expired} onClick={() => onRespond("Yes")}>
          Yes, go ahead
        </Button>
        <Button size="sm" variant="ghost" disabled={disabled || expired} onClick={() => onRespond("No")}>
          No, don't
        </Button>
        <span className="small muted" role="timer">
          {expired ? "This has expired. Ask again to continue." : `Expires in ${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}`}
        </span>
      </div>
    </div>
  );
}
