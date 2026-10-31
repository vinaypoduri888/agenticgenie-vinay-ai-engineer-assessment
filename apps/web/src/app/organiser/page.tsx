"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch, ApiError } from "../../lib/api";
import { useSession } from "../../lib/useSession";
import { cardStyle, errorStyle } from "../../lib/styles";

interface Membership {
  organiserId: string;
  organiserName: string;
  role: "STAFF" | "ADMIN";
}

export default function OrganiserIndexPage() {
  const { user } = useSession();
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user === undefined) return;
    if (user === null) {
      window.location.href = "/login";
      return;
    }
    apiFetch<{ items: Membership[] }>("/me/memberships")
      .then((r) => setMemberships(r.items))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load memberships."))
      .finally(() => setLoading(false));
  }, [user]);

  if (user === undefined || loading) return <p>Loading…</p>;
  if (error) return <p style={errorStyle}>{error}</p>;

  return (
    <div>
      <h1>Organiser dashboard</h1>
      {memberships.length === 0 && <p>You aren't a staff/admin member of any organiser.</p>}
      {memberships.map((m) => (
        <div key={m.organiserId} style={cardStyle}>
          <strong>{m.organiserName}</strong> — {m.role}
          <div style={{ marginTop: 8, display: "flex", gap: 12 }}>
            <Link href={`/organiser/${m.organiserId}/events`}>Events</Link>
            <Link href={`/organiser/${m.organiserId}/venues`}>Venues</Link>
            <Link href={`/organiser/${m.organiserId}/reports`}>Sales reports</Link>
            <Link href={`/organiser/${m.organiserId}/checkin`}>Check in tickets</Link>
            <Link href={`/organiser/${m.organiserId}/refunds`}>Refund an order</Link>
            <Link href={`/organiser/${m.organiserId}/audit`}>Audit log</Link>
          </div>
        </div>
      ))}
    </div>
  );
}
